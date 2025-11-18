import OpenAI from 'openai'
import { generateText, Tool } from 'ai'
import { CypherBuilder } from '@mcp-rag/neo4j'
import createDebug from 'debug'
import {
  MCPRagConfig,
  MCPRagClient,
  GenerateTextOptions,
  GenerateTextResultWrapper,
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
  const { model, neo4j: driver, tools, maxActiveTools = 10, migration } = config

  debug('Creating MCP RAG client with %d tools', Object.keys(tools).length)
  debugTools('Available tools: %O', Object.keys(tools))

  // Internal state
  const toolRegistry = new Map(Object.entries(tools))

  // Generate a toolset hash for this instance
  const toolsetHash = generateToolsetHash(Object.keys(tools).sort().join(','))
  debug('Generated toolset hash: %s', toolsetHash)

  const cypherBuilder = new CypherBuilder({ toolsetHash })

  // Create OpenAI client for embeddings
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || '',
  })
  const embeddingModel = 'text-embedding-3-small'
  debugEmbeddings('Using embedding model: %s', embeddingModel)

  let migrated = false

  /**
   * Generate a deterministic hash for the toolset
   */
  function generateToolsetHash(input: string): string {
    // Simple hash function for demo - in production use crypto.createHash
    let hash = 0
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash
    }
    return `toolset-${Math.abs(hash).toString(16)}`
  }

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
    debugNeo4j('Checking if migration is needed')
    const result = await session.run('MATCH (t:Tool) RETURN count(t) as count')
    const count = result.records[0].get('count').toInt()
    debugNeo4j('Found %d existing tools in database', count)
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

    // Extract schema from AI SDK tool
    const schema =
      (tool.inputSchema as any)?.jsonSchema || (tool.inputSchema as any) || {}
    const parameters = schema.properties || {}

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
    ): Promise<void> {
      const { waitForIndex = true, maxWaitMs = 30000 } = options

      debug('sync() called - forcing re-migration')
      migrated = false // Force re-migration
      await ensureMigrated()

      if (waitForIndex) {
        debug('Waiting for index population (maxWaitMs: %d)', maxWaitMs)
        await waitForIndexPopulation('tool_vector_index', maxWaitMs)
      } else {
        debug('Skipping index wait (waitForIndex=false)')
      }

      debug('sync() completed')
    },

    addTool(name: string, tool: Tool): void {
      debug('Adding tool: %s', name)
      toolRegistry.set(name, tool)
      migrated = false // Force re-migration on next call
      debugTools('Tool "%s" added. Total tools: %d', name, toolRegistry.size)
    },

    removeTool(name: string): void {
      debug('Removing tool: %s', name)
      const existed = toolRegistry.delete(name)
      if (existed) {
        migrated = false // Force re-migration on next call
        debugTools(
          'Tool "%s" removed. Total tools: %d',
          name,
          toolRegistry.size
        )
      } else {
        debugTools('Tool "%s" not found, nothing removed', name)
      }
    },

    getTools(): Record<string, Tool> {
      debug('getTools() called')
      return Object.fromEntries(toolRegistry)
    },
  }
}

export * from './types'
