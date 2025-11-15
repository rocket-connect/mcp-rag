/**
 * Shared types for @mcp-rag packages
 */

import type { LanguageModel, generateText } from 'ai'
import type { Tool } from 'ai'
import type { Driver, Session } from 'neo4j-driver'

// ============================================================================
// AI SDK Type Extraction - Pull types directly from AI SDK for type safety
// ============================================================================

/**
 * Extract parameter types from AI SDK's generateText function
 * This ensures we stay in sync with the AI SDK API
 */
type GenerateTextParams = Parameters<typeof generateText>[0]

/**
 * Extract return type from AI SDK's generateText function
 * This ensures our results match the AI SDK's return structure
 */
type GenerateTextResult = Awaited<ReturnType<typeof generateText>>

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

/**
 * Options for generateText method
 * Extends AI SDK's generateText parameters while adding our custom fields
 * Note: We exclude 'messages' because we use 'prompt' - these are mutually exclusive in the AI SDK
 */
export interface GenerateTextOptions
  extends Omit<GenerateTextParams, 'model' | 'tools' | 'prompt' | 'messages'> {
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
   * Additional metadata to attach to the result
   */
  metadata?: Record<string, any>
}

/**
 * Result from generateText method
 */
export interface GenerateTextResultWrapper {
  /**
   * Full AI SDK result for advanced use cases
   */
  result: GenerateTextResult
}

export interface StreamOptions extends Omit<GenerateTextOptions, 'prompt'> {
  prompt: string
  sessionId: string
}

export interface MCPRagClient {
  /**
   * Generate text with smart tool management
   * Uses AI SDK's generateText under the hood with automatic tool selection
   */
  generateText(options: GenerateTextOptions): Promise<GenerateTextResultWrapper>

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
// Utility Types - Re-export for convenience
// ============================================================================

export type { Tool, LanguageModel } from 'ai'
export type { Driver, Session } from 'neo4j-driver'

/**
 * Re-export AI SDK types for advanced use cases
 */
export type { GenerateTextParams, GenerateTextResult }
