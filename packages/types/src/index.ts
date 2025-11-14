/**
 * Shared types for @mcp-rag packages
 */

import type { LanguageModel } from 'ai'
import type { Tool } from 'ai'
import type { Driver, Session } from 'neo4j-driver'

// ============================================================================
// Core Configuration
// ============================================================================

export interface MigrationConfig {
  /**
   * Determine if migration is needed
   * Default: checks if any tools exist in database
   */
  shouldMigrate?: (session: Session) => Promise<boolean>

  /**
   * Custom migration implementation
   * Default: creates Tool nodes with standard schema
   */
  migrate?: (session: Session, tools: Record<string, Tool>) => Promise<void>

  /**
   * Hook to modify migration statements before execution
   * Useful for multi-tenant scenarios
   */
  onBeforeMigrate?: (
    statements: Array<{ cypher: string; params: Record<string, any> }>
  ) => Promise<Array<{ cypher: string; params: Record<string, any> }>>
}

export interface MCPRagConfig {
  /**
   * AI SDK language model
   */
  model: LanguageModel

  /**
   * Neo4j driver instance
   */
  neo4j: Driver

  /**
   * Tool definitions
   */
  tools: Record<string, Tool>

  /**
   * Maximum number of tools to make active per request
   * @default 10
   */
  maxActiveTools?: number

  /**
   * Migration configuration
   */
  migration?: MigrationConfig
}

// ============================================================================
// Client Interface
// ============================================================================

export interface GenerateOptions {
  /**
   * The prompt to generate from
   */
  prompt: string

  /**
   * Optional session ID for context persistence
   */
  sessionId?: string

  /**
   * Explicitly specify which tools to make active
   * If not provided, tools are selected semantically
   */
  activeTools?: string[]

  /**
   * Temperature for generation
   */
  temperature?: number

  /**
   * Max tokens to generate
   */
  maxTokens?: number

  /**
   * Additional AI SDK options
   */
  [key: string]: any
}

export interface GenerateResult {
  /**
   * Generated text
   */
  text: string

  /**
   * Tools that were used
   */
  toolsUsed: string[]

  /**
   * Additional metadata
   */
  [key: string]: any
}

export interface StreamOptions extends Omit<GenerateOptions, 'prompt'> {
  prompt: string
  sessionId: string
}

export interface MCPRagClient {
  /**
   * Generate text with smart tool management
   */
  generate(options: GenerateOptions): Promise<GenerateResult>

  /**
   * Stream responses with tool execution
   */
  stream(options: StreamOptions): AsyncGenerator<string>

  /**
   * Explicitly sync tool definitions to Neo4j
   */
  sync(): Promise<void>

  /**
   * Add a new tool at runtime
   */
  addTool(name: string, tool: Tool): void

  /**
   * Remove a tool at runtime
   */
  removeTool(name: string): void

  /**
   * Get all registered tools
   */
  getTools(): Record<string, Tool>
}

// ============================================================================
// Utility Types
// ============================================================================

export type { Tool, LanguageModel } from 'ai'
export type { Driver, Session } from 'neo4j-driver'
