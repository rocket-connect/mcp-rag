/**
 * Core types for mcp-rag
 */

import type { LanguageModel, Tool } from 'ai'
import type { Driver, Session } from 'neo4j-driver'
import type { z } from 'zod'

/**
 * Configuration for creating an MCP RAG client
 */
export interface MCPRagConfig {
  /**
   * The language model to use for generation
   */
  model: LanguageModel

  /**
   * Neo4j driver instance for context persistence
   */
  neo4j: Driver

  /**
   * Tools available to the model
   */
  tools: Record<string, Tool>

  /**
   * Optional embedding model for semantic tool selection
   * Defaults to OpenAI's text-embedding-3-small
   */
  embeddingModel?: any // EmbeddingModel from AI SDK

  /**
   * Optional custom embedding function
   */
  embedding?: (text: string) => Promise<number[]>

  /**
   * Maximum number of active tools per request
   * @default 10
   */
  maxActiveTools?: number

  /**
   * Optional migration configuration
   */
  migration?: MigrationConfig
}

/**
 * Migration configuration for Neo4j schema management
 */
export interface MigrationConfig {
  /**
   * Hook called before migrations are applied
   */
  onBeforeMigrate?: (
    statements: MigrationStatement[]
  ) => Promise<MigrationStatement[]>

  /**
   * Hook called after migrations are applied
   */
  onAfterMigrate?: (session: Session) => Promise<void>

  /**
   * Custom check to determine if migration is needed
   */
  shouldMigrate?: (session: Session) => Promise<boolean>

  /**
   * Completely override the default migration logic
   */
  migrate?: (session: Session, tools: Record<string, Tool>) => Promise<void>
}

/**
 * A Cypher statement with parameters for migration
 */
export interface MigrationStatement {
  cypher: string
  params: Record<string, any>
}

/**
 * Options for generating text
 */
export interface GenerateOptions {
  /**
   * The user's prompt
   */
  prompt: string

  /**
   * Optional session ID for context persistence
   */
  sessionId?: string

  /**
   * Manually specify which tools should be active
   * Overrides semantic tool selection
   */
  activeTools?: string[]

  /**
   * Temperature for generation (0-1)
   */
  temperature?: number

  /**
   * Maximum tokens to generate
   */
  maxTokens?: number

  /**
   * Additional AI SDK options
   */
  [key: string]: any
}

/**
 * Options for streaming text
 */
export interface StreamOptions extends GenerateOptions {
  /**
   * Callback for each chunk of text
   */
  onChunk?: (chunk: string) => void

  /**
   * Callback when a tool is called
   */
  onToolCall?: (toolName: string, input: any) => void

  /**
   * Callback when a tool returns a result
   */
  onToolResult?: (toolName: string, result: any) => void
}

/**
 * Result from text generation
 */
export interface GenerateResult {
  /**
   * The generated text
   */
  text: string

  /**
   * Tools that were called during generation
   */
  toolCalls: ToolCall[]

  /**
   * Results from tool executions
   */
  toolResults: ToolResult[]

  /**
   * Token usage statistics
   */
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

/**
 * A tool call made by the model
 */
export interface ToolCall {
  /**
   * Unique ID for this tool call
   */
  toolCallId: string

  /**
   * Name of the tool being called
   */
  toolName: string

  /**
   * Input arguments for the tool
   */
  input: any
}

/**
 * Result from executing a tool
 */
export interface ToolResult {
  /**
   * ID of the tool call this result is for
   */
  toolCallId: string

  /**
   * Name of the tool that was executed
   */
  toolName: string

  /**
   * Output from the tool execution
   */
  output: any

  /**
   * Error if the tool execution failed
   */
  error?: Error
}

/**
 * The main MCP RAG client interface
 */
export interface MCPRagClient {
  /**
   * Generate text with smart tool management
   */
  generate(options: GenerateOptions): Promise<GenerateResult>

  /**
   * Stream text generation with tool execution
   */
  stream(options: StreamOptions): AsyncGenerator<string>

  /**
   * Explicitly sync tool definitions to Neo4j
   */
  sync(): Promise<void>

  /**
   * Add a new tool to the client
   */
  addTool(name: string, tool: Tool): void

  /**
   * Remove a tool from the client
   */
  removeTool(name: string): void

  /**
   * Get all available tools
   */
  getTools(): Record<string, Tool>

  /**
   * Close the Neo4j driver connection
   */
  close(): Promise<void>
}

/**
 * Context stored in Neo4j for a session
 */
export interface SessionContext {
  /**
   * Unique session identifier
   */
  sessionId: string

  /**
   * Messages in this session
   */
  messages: Message[]

  /**
   * Tool calls made in this session
   */
  toolCalls: ToolCall[]

  /**
   * When the session was created
   */
  createdAt: Date

  /**
   * When the session was last updated
   */
  updatedAt: Date
}

/**
 * A message in a conversation
 */
export interface Message {
  /**
   * Role of the message sender
   */
  role: 'user' | 'assistant' | 'system'

  /**
   * Content of the message
   */
  content: string

  /**
   * When the message was created
   */
  timestamp: Date
}

/**
 * Tool metadata stored in Neo4j
 */
export interface ToolMetadata {
  /**
   * Tool name
   */
  name: string

  /**
   * Tool description
   */
  description: string

  /**
   * Zod schema for inputs
   */
  schema: z.ZodSchema

  /**
   * Embedding vector for semantic search
   */
  embedding: number[]

  /**
   * Number of times this tool has been called
   */
  usageCount: number

  /**
   * When the tool was last used
   */
  lastUsedAt?: Date
}
