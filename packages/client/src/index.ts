import OpenAI from 'openai'
import { generateText, Tool } from 'ai'
import { asSchema } from '@ai-sdk/provider-utils'
import { CypherBuilder } from '@mcp-rag/neo4j'
import createDebug from 'debug'
import {
  MCPRagConfig,
  MCPRagClient,
  GenerateTextOptions,
  GenerateTextResultWrapper,
  SyncResult,
  HashFunction,
  ToolsetInfo,
  DeleteToolsetResult,
} from './types'

const debug = createDebug('@mcp-rag/client')
const debugTools = createDebug('@mcp-rag/client:tools')
const debugEmbeddings = createDebug('@mcp-rag/client:embeddings')
const debugNeo4j = createDebug('@mcp-rag/client:neo4j')
const debugGenerate = createDebug('@mcp-rag/client:generate')

/**
 * Create a new MCP RAG client
 *
 * @param config - Configuration for the client
 * @returns A new MCP RAG client instance
 *
 * @example
 * ```typescript
 * import { createMCPRag } from '@mcp-rag/client'
 * import { openai } from '@ai-sdk/openai'
 * import neo4j from 'neo4j-driver'
 * import { tool } from 'ai'
 * import { z } from 'zod'
 *
 * const driver = neo4j.driver(
 *   'neo4j://localhost:7687',
 *   neo4j.auth.basic('neo4j', 'password')
 * )
 *
 * const rag = createMCPRag({
 *   model: openai('gpt-4o-mini'),
 *   openaiApiKey: process.env.OPENAI_API_KEY || "",
 *   neo4j: driver,
 *   tools: {
 *     searchDocs: tool({
 *       description: 'Search documentation',
 *       inputSchema: z.object({ query: z.string() }),
 *       execute: async ({ query }) => { ... }
 *     })
 *   }
 * })
 *
 * await rag.sync()
 * const result = await rag.generateText({ prompt: 'Search for API docs' })
 * ```
 */
export function createMCPRag(config: MCPRagConfig): MCPRagClient {
  const {
    model,
    neo4j: driver,
    tools,
    openaiApiKey,
    maxActiveTools = 10,
    migration,
    dangerouslyAllowBrowser,
    hashFunction,
  } = config

  debug('Creating MCP RAG client with %d tools', Object.keys(tools).length)
  debugTools('Available tools: %O', Object.keys(tools))

  // Internal state
  const toolRegistry = new Map(Object.entries(tools))

  /**
   * Default hash function - simple bitwise hash for demo purposes.
   * Can be overridden via config.hashFunction for browser environments.
   */
  const defaultHashFunction: HashFunction = (input: string): string => {
    let hash = 0
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash
    }
    return `toolset-${Math.abs(hash).toString(16)}`
  }

  // Use custom hash function if provided, otherwise use default
  const activeHashFunction = hashFunction || defaultHashFunction

  /**
   * Recursively sort all keys in an object/array for deterministic JSON serialization.
   * This ensures the same data structure always produces the same JSON string
   * regardless of the original property insertion order.
   */
  function sortObjectKeysDeep(obj: unknown): unknown {
    if (obj === null || typeof obj !== 'object') {
      return obj
    }

    if (Array.isArray(obj)) {
      return obj.map(sortObjectKeysDeep)
    }

    const sortedKeys = Object.keys(obj as Record<string, unknown>).sort()
    const result: Record<string, unknown> = {}
    for (const key of sortedKeys) {
      result[key] = sortObjectKeysDeep((obj as Record<string, unknown>)[key])
    }
    return result
  }

  /**
   * Deep clone a tool object for hashing purposes.
   * Strips out non-serializable properties like 'execute' functions.
   */
  function cloneToolForHashing(tool: Tool): Record<string, unknown> {
    return {
      description: tool.description,
      inputSchema: tool.inputSchema,
    }
  }

  /**
   * Compute the toolset hash by:
   * 1. Creating a deep clone of all tools (excluding execute functions)
   * 2. Sorting tools lexicographically by name
   * 3. Recursively sorting all nested object keys
   * 4. Converting to JSON string
   * 5. Passing to hash function
   *
   * This ensures any change to tool definitions (parameters, descriptions, etc.)
   * will result in a different hash, and the same toolset always produces
   * the same hash regardless of property insertion order.
   */
  function computeToolsetHash(): string {
    const toolEntries = Array.from(toolRegistry.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, tool]) => [name, cloneToolForHashing(tool)])

    const sortedToolsObject = Object.fromEntries(toolEntries)
    // Recursively sort all nested keys for deterministic serialization
    const deepSortedObject = sortObjectKeysDeep(sortedToolsObject)
    const jsonString = JSON.stringify(deepSortedObject)
    return activeHashFunction(jsonString)
  }

  // Generate initial toolset hash
  let toolsetHash = computeToolsetHash()
  debug('Generated toolset hash: %s', toolsetHash)

  // CypherBuilder needs to be recreated when toolset changes
  let cypherBuilder = new CypherBuilder({ toolsetHash })

  // Create OpenAI client for embeddings
  const openai = new OpenAI({
    apiKey: openaiApiKey,
    dangerouslyAllowBrowser,
  })
  const embeddingModel = 'text-embedding-3-small'
  debugEmbeddings('Using embedding model: %s', embeddingModel)

  let migrated = false

  /**
   * Wait for vector index to be fully populated
   */
  async function waitForIndexPopulation(
    indexName: string,
    maxWaitMs: number = 30000
  ): Promise<void> {
    const startTime = Date.now()
    const session = driver.session()

    try {
      while (Date.now() - startTime < maxWaitMs) {
        const checkStatement = CypherBuilder.checkVectorIndex({ indexName })
        const result = await session.run(
          checkStatement.cypher,
          checkStatement.params
        )

        if (result.records.length > 0) {
          const record = result.records[0]
          const state = record.get('state')
          const populationPercent = record.get('populationPercent')

          if (state === 'ONLINE' && populationPercent === 100.0) {
            debug(
              'Vector index "%s" is ready (state: %s, population: %s%%)',
              indexName,
              state,
              populationPercent
            )
            return
          }

          debug(
            'Waiting for index "%s" (state: %s, population: %s%%)',
            indexName,
            state,
            populationPercent
          )
        }

        await new Promise(resolve => setTimeout(resolve, 500))
      }

      throw new Error(
        `Vector index ${indexName} did not populate within ${maxWaitMs}ms`
      )
    } finally {
      await session.close()
    }
  }

  /**
   * Ensure tools are synced to Neo4j
   */
  async function ensureMigrated(): Promise<void> {
    if (migrated) {
      debug('Already migrated, skipping')
      return
    }

    debug('Starting migration process')
    const session = driver.session()
    try {
      // Check if we should migrate
      const shouldMigrate = migration?.shouldMigrate || defaultShouldMigrate
      const shouldMigrateResult = await shouldMigrate(session)
      debug('Should migrate: %s', shouldMigrateResult)

      if (!shouldMigrateResult) {
        migrated = true
        debug('Migration not needed')
        return
      }

      // Create vector index
      debug('Creating vector index')
      const indexStatement = CypherBuilder.createVectorIndex({
        indexName: 'tool_vector_index',
        dimensions: 1536, // text-embedding-3-small dimensions
      })
      debugNeo4j('Executing index creation query')
      await session.run(indexStatement.cypher, indexStatement.params)
      debug('Vector index created successfully')

      // Generate embeddings for all tools
      debug('Generating embeddings for %d tools', toolRegistry.size)
      const toolsWithEmbeddings = await Promise.all(
        Array.from(toolRegistry.entries()).map(async ([name, tool]) => {
          debugEmbeddings('Generating embeddings for tool: %s', name)
          const embeddings = await generateToolEmbeddings(name, tool)
          debugEmbeddings(
            'Generated embeddings for tool "%s": tool=%d dims, %d params, returnType=%d dims',
            name,
            embeddings.tool.length,
            Object.keys(embeddings.parameters).length,
            embeddings.returnType.length
          )
          return {
            name,
            tool,
            embeddings,
          }
        })
      )

      // Use custom migration if provided, otherwise use default
      if (migration?.migrate) {
        debug('Using custom migration function')
        await migration.migrate(session, Object.fromEntries(toolRegistry))
      } else {
        debug('Using default migration (CypherBuilder.migrate)')
        // Use CypherBuilder.migrate() for the full migration
        const statement = cypherBuilder.migrate({
          tools: toolsWithEmbeddings,
        })

        // Apply onBeforeMigrate hook if provided
        let statements = [statement]
        if (migration?.onBeforeMigrate) {
          debug('Applying onBeforeMigrate hook')
          statements = await migration.onBeforeMigrate(statements)
          debug('Hook returned %d statements', statements.length)
        }

        debugNeo4j('Executing %d migration statements', statements.length)
        for (const [idx, stmt] of statements.entries()) {
          debugNeo4j('Executing statement %d/%d', idx + 1, statements.length)
          await session.run(stmt.cypher, stmt.params)
        }
        debug('Migration completed successfully')
      }

      migrated = true
    } catch (error) {
      debug('Migration failed: %O', error)
      throw error
    } finally {
      await session.close()
    }
  }

  async function defaultShouldMigrate(session: any): Promise<boolean> {
    debugNeo4j('Checking if migration is needed for hash: %s', toolsetHash)
    // Check if this specific toolset hash already exists
    const result = await session.run(
      'MATCH (ts:ToolSet {hash: $hash}) RETURN count(ts) as count',
      { hash: toolsetHash }
    )
    const count = result.records[0].get('count').toInt()
    debugNeo4j('Found %d existing toolsets with hash: %s', count, toolsetHash)
    // Migrate if this specific toolset doesn't exist yet
    return count === 0
  }

  async function generateToolEmbeddings(
    name: string,
    tool: Tool
  ): Promise<{
    tool: number[]
    parameters: Record<string, number[]>
    returnType: number[]
  }> {
    const toolText = `${name}: ${tool.description || ''}`
    debugEmbeddings('Embedding tool text: "%s"', toolText)
    const toolEmbedding = await generateEmbedding(toolText)

    // Extract schema from AI SDK tool using asSchema to handle Zod schemas
    const normalizedSchema = asSchema(tool.inputSchema)
    const jsonSchema = normalizedSchema.jsonSchema || {}
    const parameters = jsonSchema.properties || {}

    debugEmbeddings(
      'Tool "%s" has %d parameters to embed',
      name,
      Object.keys(parameters).length
    )

    const parameterEmbeddings: Record<string, number[]> = {}
    for (const [paramName, paramDef] of Object.entries(parameters)) {
      const paramText = `${paramName}: ${(paramDef as any).description || ''}`
      debugEmbeddings('Embedding parameter "%s": "%s"', paramName, paramText)
      parameterEmbeddings[paramName] = await generateEmbedding(paramText)
    }

    debugEmbeddings('Embedding return type for tool "%s"', name)
    const returnTypeEmbedding = await generateEmbedding('Tool execution result')

    return {
      tool: toolEmbedding,
      parameters: parameterEmbeddings,
      returnType: returnTypeEmbedding,
    }
  }

  async function generateEmbedding(text: string): Promise<number[]> {
    debugEmbeddings('Calling OpenAI API for embedding')
    const response = await openai.embeddings.create({
      model: embeddingModel,
      input: text,
    })
    const embedding = response.data[0].embedding
    debugEmbeddings('Received embedding with %d dimensions', embedding.length)
    return embedding
  }

  /**
   * Select active tools based on semantic similarity using CypherBuilder
   */
  async function selectActiveTools(
    prompt: string,
    maxTools: number
  ): Promise<string[]> {
    debug('Selecting active tools for prompt (max: %d)', maxTools)
    debugTools('Prompt: "%s"', prompt)

    const session = driver.session()
    try {
      // Generate embedding for the prompt
      debugEmbeddings('Generating embedding for prompt')
      const queryVector = await generateEmbedding(prompt)

      // Use CypherBuilder.vectorSearchDecomposed for semantic search
      debugNeo4j('Executing vector search')
      const statement = cypherBuilder.vectorSearchDecomposed({
        vector: queryVector,
        limit: maxTools,
        minScore: 0.0,
        depth: 'low',
      })

      const result = await session.run(statement.cypher, statement.params)
      const selectedTools = result.records.map(record => record.get('name'))

      debug('Selected %d tools', selectedTools.length)
      debugTools('Selected tools: %O', selectedTools)

      // Log relevance scores
      result.records.forEach(record => {
        debugTools(
          'Tool "%s" relevance: %f',
          record.get('name'),
          record.get('relevance')
        )
      })

      return selectedTools
    } catch (error) {
      debug('Tool selection failed: %O', error)
      throw error
    } finally {
      await session.close()
    }
  }

  return {
    async generateText(
      options: GenerateTextOptions
    ): Promise<GenerateTextResultWrapper> {
      debugGenerate('generateText called')
      await ensureMigrated()

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { prompt, messages, activeTools, metadata, ...restOptions } =
        options

      debugGenerate('Prompt: "%s"', prompt)
      debugGenerate('Messages: %O', messages)
      debugGenerate('Active tools override: %O', activeTools)

      // Determine which tools to use
      const promptText =
        prompt || (messages?.[messages.length - 1] as any)?.content || ''
      const selectedTools = activeTools
        ? activeTools.filter(name => {
            const has = toolRegistry.has(name)
            if (!has) {
              debugTools('Warning: requested tool "%s" not found', name)
            }
            return has
          })
        : await selectActiveTools(promptText, maxActiveTools)

      debug('Using %d tools for generation', selectedTools.length)

      // Build active tool set
      const activeToolSet: Record<string, Tool> = {}
      for (const name of selectedTools) {
        const tool = toolRegistry.get(name)
        if (tool) {
          activeToolSet[name] = tool
          debugTools('Added tool to active set: %s', name)
        }
      }

      // Call AI SDK's generateText with proper typing
      debugGenerate('Calling AI SDK generateText')

      // Build the request based on whether we have prompt or messages
      const generateTextArgs = {
        ...restOptions,
        model,
        tools: activeToolSet,
      }

      let result
      if (prompt) {
        result = await generateText({
          ...generateTextArgs,
          prompt,
        })
      } else if (messages) {
        result = await generateText({
          ...generateTextArgs,
          messages,
        })
      } else {
        throw new Error('Either prompt or messages must be provided')
      }

      debugGenerate('Generation completed')
      debugGenerate('Response length: %d chars', result.text.length)
      if (result.toolCalls?.length) {
        debugGenerate('Tool calls made: %d', result.toolCalls.length)
        result.toolCalls.forEach(call => {
          debugTools('Tool called: %s', call.toolName)
        })
      }

      return {
        result,
      }
    },

    async sync(
      options: { waitForIndex?: boolean; maxWaitMs?: number } = {}
    ): Promise<SyncResult> {
      const { waitForIndex = true, maxWaitMs = 30000 } = options

      debug('sync() called - forcing re-migration')

      // Recompute hash before sync to ensure it's up to date
      toolsetHash = computeToolsetHash()
      cypherBuilder = new CypherBuilder({ toolsetHash })
      debug('Recomputed toolset hash: %s', toolsetHash)

      migrated = false // Force re-migration
      await ensureMigrated()

      if (waitForIndex) {
        debug('Waiting for index population (maxWaitMs: %d)', maxWaitMs)
        await waitForIndexPopulation('tool_vector_index', maxWaitMs)
      } else {
        debug('Skipping index wait (waitForIndex=false)')
      }

      debug('sync() completed with hash: %s', toolsetHash)
      return { hash: toolsetHash }
    },

    addTool(name: string, tool: Tool): void {
      debug('Adding tool: %s', name)
      toolRegistry.set(name, tool)
      migrated = false // Force re-migration on next call
      // Recompute hash after adding tool
      toolsetHash = computeToolsetHash()
      cypherBuilder = new CypherBuilder({ toolsetHash })
      debugTools(
        'Tool "%s" added. Total tools: %d, new hash: %s',
        name,
        toolRegistry.size,
        toolsetHash
      )
    },

    removeTool(name: string): void {
      debug('Removing tool: %s', name)
      const existed = toolRegistry.delete(name)
      if (existed) {
        migrated = false // Force re-migration on next call
        // Recompute hash after removing tool
        toolsetHash = computeToolsetHash()
        cypherBuilder = new CypherBuilder({ toolsetHash })
        debugTools(
          'Tool "%s" removed. Total tools: %d, new hash: %s',
          name,
          toolRegistry.size,
          toolsetHash
        )
      } else {
        debugTools('Tool "%s" not found, nothing removed', name)
      }
    },

    getTools(): Record<string, Tool> {
      debug('getTools() called')
      return Object.fromEntries(toolRegistry)
    },

    getToolsetHash(): string {
      return toolsetHash
    },

    async getToolsetByHash(hash: string): Promise<ToolsetInfo | null> {
      debug('getToolsetByHash() called with hash: %s', hash)
      const session = driver.session()
      try {
        const builder = new CypherBuilder({ toolsetHash: hash })
        const statement = builder.getToolsetByHash()
        debugNeo4j('Executing getToolsetByHash query')
        const result = await session.run(statement.cypher, statement.params)

        if (result.records.length === 0) {
          debug('getToolsetByHash: No toolset found with hash: %s', hash)
          return null
        }

        const record = result.records[0]
        const toolsetInfo: ToolsetInfo = {
          hash: record.get('hash'),
          updatedAt: record.get('updatedAt').toStandardDate(),
          toolCount:
            typeof record.get('toolCount')?.toInt === 'function'
              ? record.get('toolCount').toInt()
              : record.get('toolCount'),
          tools: record.get('tools'),
        }

        debug(
          'getToolsetByHash: Found toolset with %d tools',
          toolsetInfo.toolCount
        )
        return toolsetInfo
      } finally {
        await session.close()
      }
    },

    async deleteToolsetByHash(hash: string): Promise<DeleteToolsetResult> {
      debug('deleteToolsetByHash() called with hash: %s', hash)
      const session = driver.session()
      try {
        const builder = new CypherBuilder({ toolsetHash: hash })
        const statement = builder.deleteToolsetByHash()
        debugNeo4j('Executing deleteToolsetByHash query')
        const result = await session.run(statement.cypher, statement.params)

        if (result.records.length === 0) {
          debug('deleteToolsetByHash: No toolset found with hash: %s', hash)
          return {
            deletedToolsets: 0,
            deletedTools: 0,
            deletedParams: 0,
            deletedReturnTypes: 0,
          }
        }

        const record = result.records[0]
        const deleteResult: DeleteToolsetResult = {
          deletedToolsets:
            typeof record.get('deletedToolsets')?.toInt === 'function'
              ? record.get('deletedToolsets').toInt()
              : record.get('deletedToolsets'),
          deletedTools:
            typeof record.get('deletedTools')?.toInt === 'function'
              ? record.get('deletedTools').toInt()
              : record.get('deletedTools'),
          deletedParams:
            typeof record.get('deletedParams')?.toInt === 'function'
              ? record.get('deletedParams').toInt()
              : record.get('deletedParams'),
          deletedReturnTypes:
            typeof record.get('deletedReturnTypes')?.toInt === 'function'
              ? record.get('deletedReturnTypes').toInt()
              : record.get('deletedReturnTypes'),
        }

        debug(
          'deleteToolsetByHash: Deleted %d toolsets, %d tools, %d params, %d returnTypes',
          deleteResult.deletedToolsets,
          deleteResult.deletedTools,
          deleteResult.deletedParams,
          deleteResult.deletedReturnTypes
        )
        return deleteResult
      } finally {
        await session.close()
      }
    },
  }
}

export * from './types'
