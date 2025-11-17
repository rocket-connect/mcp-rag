import OpenAI from 'openai'
import { generateText, streamText, Tool } from 'ai'
import { CypherBuilder } from '@mcp-rag/neo4j'
import {
  MCPRagConfig,
  MCPRagClient,
  GenerateTextOptions,
  GenerateTextResultWrapper,
  StreamOptions,
} from './types'

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
 *   model: openai('gpt-4'),
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

  // Internal state
  const toolRegistry = new Map(Object.entries(tools))

  // Generate a toolset hash for this instance
  const toolsetHash = generateToolsetHash(Object.keys(tools).sort().join(','))
  const cypherBuilder = new CypherBuilder({ toolsetHash })

  // Create OpenAI client for embeddings
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || '',
  })
  const embeddingModel = 'text-embedding-3-small'

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
   * Ensure tools are synced to Neo4j
   */
  async function ensureMigrated(): Promise<void> {
    if (migrated) return

    const session = driver.session()
    try {
      // Check if we should migrate
      const shouldMigrate = migration?.shouldMigrate || defaultShouldMigrate
      if (!(await shouldMigrate(session))) {
        migrated = true
        return
      }

      // Create vector index
      const indexStatement = CypherBuilder.createVectorIndex({
        indexName: 'tool_vector_index',
        dimensions: 1536, // text-embedding-3-small dimensions
      })
      await session.run(indexStatement.cypher, indexStatement.params)

      // Generate embeddings for all tools
      const toolsWithEmbeddings = await Promise.all(
        Array.from(toolRegistry.entries()).map(async ([name, tool]) => {
          const embeddings = await generateToolEmbeddings(name, tool)
          return {
            name,
            tool,
            embeddings,
          }
        })
      )

      // Use custom migration if provided, otherwise use default
      if (migration?.migrate) {
        await migration.migrate(session, Object.fromEntries(toolRegistry))
      } else {
        // Use CypherBuilder.migrate() for the full migration
        const statement = cypherBuilder.migrate({
          tools: toolsWithEmbeddings,
        })

        // Apply onBeforeMigrate hook if provided
        let statements = [statement]
        if (migration?.onBeforeMigrate) {
          statements = await migration.onBeforeMigrate(statements)
        }

        for (const stmt of statements) {
          await session.run(stmt.cypher, stmt.params)
        }
      }

      migrated = true
    } finally {
      await session.close()
    }
  }

  async function defaultShouldMigrate(session: any): Promise<boolean> {
    const result = await session.run('MATCH (t:Tool) RETURN count(t) as count')
    return result.records[0].get('count').toInt() === 0
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
    const toolEmbedding = await generateEmbedding(toolText)

    // Extract schema from AI SDK tool
    const schema =
      (tool.inputSchema as any)?.jsonSchema || (tool.inputSchema as any) || {}
    const parameters = schema.properties || {}

    const parameterEmbeddings: Record<string, number[]> = {}
    for (const [paramName, paramDef] of Object.entries(parameters)) {
      const paramText = `${paramName}: ${(paramDef as any).description || ''}`
      parameterEmbeddings[paramName] = await generateEmbedding(paramText)
    }

    const returnTypeEmbedding = await generateEmbedding('Tool execution result')

    return {
      tool: toolEmbedding,
      parameters: parameterEmbeddings,
      returnType: returnTypeEmbedding,
    }
  }

  async function generateEmbedding(text: string): Promise<number[]> {
    const response = await openai.embeddings.create({
      model: embeddingModel,
      input: text,
    })
    return response.data[0].embedding
  }

  /**
   * Select active tools based on semantic similarity using CypherBuilder
   */
  async function selectActiveTools(
    prompt: string,
    maxTools: number
  ): Promise<string[]> {
    const session = driver.session()
    try {
      // Generate embedding for the prompt
      const queryVector = await generateEmbedding(prompt)

      // Use CypherBuilder.vectorSearchDecomposed for semantic search
      const statement = cypherBuilder.vectorSearchDecomposed({
        vector: queryVector,
        limit: maxTools,
        minScore: 0.0,
        depth: 'low',
      })

      const result = await session.run(statement.cypher, statement.params)

      return result.records.map(record => record.get('name'))
    } finally {
      await session.close()
    }
  }

  return {
    async generateText(
      options: GenerateTextOptions
    ): Promise<GenerateTextResultWrapper> {
      await ensureMigrated()

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { prompt, activeTools, metadata, ...restOptions } = options

      // Determine which tools to use
      const selectedTools = activeTools
        ? activeTools.filter(name => toolRegistry.has(name))
        : await selectActiveTools(prompt, maxActiveTools)

      // Build active tool set
      const activeToolSet: Record<string, Tool> = {}
      for (const name of selectedTools) {
        const tool = toolRegistry.get(name)
        if (tool) {
          activeToolSet[name] = tool
        }
      }

      // Call AI SDK's generateText with proper typing
      const result = await generateText({
        model,
        prompt,
        tools: activeToolSet,
        ...restOptions,
      })

      return {
        result,
      }
    },

    async *stream(options: StreamOptions): AsyncGenerator<string> {
      await ensureMigrated()

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { prompt, activeTools, metadata, ...restOptions } = options

      // Determine which tools to use
      const selectedTools = activeTools
        ? activeTools.filter(name => toolRegistry.has(name))
        : await selectActiveTools(prompt, maxActiveTools)

      // Build active tool set
      const activeToolSet: Record<string, Tool> = {}
      for (const name of selectedTools) {
        const tool = toolRegistry.get(name)
        if (tool) {
          activeToolSet[name] = tool
        }
      }

      // Call AI SDK's streamText
      const stream = await streamText({
        model,
        prompt,
        tools: activeToolSet,
        ...restOptions,
      })

      // Stream the text
      for await (const chunk of stream.textStream) {
        yield chunk
      }
    },

    async sync(): Promise<void> {
      migrated = false // Force re-migration
      await ensureMigrated()
    },

    addTool(name: string, tool: Tool): void {
      toolRegistry.set(name, tool)
      migrated = false // Force re-migration on next call
    },

    removeTool(name: string): void {
      toolRegistry.delete(name)
      migrated = false // Force re-migration on next call
    },

    getTools(): Record<string, Tool> {
      return Object.fromEntries(toolRegistry)
    },
  }
}

export * from './types'
