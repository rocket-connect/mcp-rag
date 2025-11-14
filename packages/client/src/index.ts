/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Main entry point for @mcp-rag/client
 */

import type { Tool } from 'ai'
import type {
  MCPRagConfig,
  MCPRagClient,
  GenerateOptions,
  GenerateResult,
  StreamOptions,
} from '@mcp-rag/types'
import { MigrationHelper } from '@mcp-rag/neo4j'

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
 *     // your tools here
 *   }
 * })
 * ```
 */
export function createMCPRag(config: MCPRagConfig): MCPRagClient {
  const { neo4j: driver, tools, maxActiveTools = 10, migration } = config

  // Internal state
  let migrated = false
  const toolRegistry = new Map(Object.entries(tools))

  /**
   * Ensure tools are synced to Neo4j
   */
  async function ensureMigrated(): Promise<void> {
    if (migrated) return

    // Check if migration is needed
    const session = driver.session()
    try {
      const needsMigration = migration?.shouldMigrate
        ? await migration.shouldMigrate(session)
        : await MigrationHelper.shouldMigrate(session)

      if (needsMigration) {
        if (migration?.migrate) {
          await migration.migrate(session, Object.fromEntries(toolRegistry))
        } else {
          await MigrationHelper.migrate(
            session,
            Object.fromEntries(toolRegistry)
          )
        }
      }

      migrated = true
    } finally {
      await session.close()
    }
  }

  /**
   * Select active tools based on semantic similarity
   */
  async function selectActiveTools(
    _prompt: string,
    maxTools: number
  ): Promise<string[]> {
    // TODO: Implement semantic tool selection using Neo4j
    // This is a placeholder that returns all tools
    return Array.from(toolRegistry.keys()).slice(0, maxTools)
  }

  return {
    async generate(options: GenerateOptions): Promise<GenerateResult> {
      await ensureMigrated()

      const { prompt, activeTools } = options

      // Determine which tools to use
      const selectedTools = activeTools
        ? activeTools.filter(name => toolRegistry.has(name))
        : await selectActiveTools(prompt, maxActiveTools)

      // Build active tool set
      const activeToolSet: Record<string, Tool> = {}
      for (const name of selectedTools) {
        const tool = toolRegistry.get(name)
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        if (tool) activeToolSet[name] = tool
      }

      // TODO: Implement actual generation logic with AI SDK
      // This is a placeholder
      throw new Error('Generation logic to be implemented')
    },

    // eslint-disable-next-line require-yield
    async *stream(_options: StreamOptions): AsyncGenerator<string> {
      await ensureMigrated()

      // TODO: Implement streaming logic
      // This is a placeholder
      throw new Error('Streaming logic to be implemented')
    },

    async sync(): Promise<void> {
      migrated = false
      await ensureMigrated()
    },

    // @ts-ignore
    addTool(name: string, tool: Tool): void {
      // @ts-ignore
      toolRegistry.set(name, tool)
      migrated = false // Force re-sync on next call
    },

    removeTool(name: string): void {
      toolRegistry.delete(name)
    },

    // @ts-ignore

    getTools(): Record<string, Tool> {
      // @ts-ignore

      return Object.fromEntries(toolRegistry)
    },
  }
}

// Re-export types for convenience
export type {
  MCPRagConfig,
  MCPRagClient,
  GenerateOptions,
  GenerateResult,
  StreamOptions,
} from '@mcp-rag/types'
