import { Driver } from 'neo4j-driver'
import {
  LanguageModel,
  Tool,
  GenerateTextResult as AIGenerateTextResult,
  ModelMessage,
} from 'ai'

/**
 * Function to generate a hash from a string input.
 * This allows customization for browser environments where Node.js crypto is unavailable.
 */
export type HashFunction = (input: string) => string

export interface MCPRagConfig {
  model: LanguageModel
  neo4j: Driver
  tools: Record<string, Tool>
  openaiApiKey: string
  dangerouslyAllowBrowser?: boolean
  maxActiveTools?: number
  /**
   * Custom hash function for generating toolset hashes.
   * Useful for browser environments where Node.js crypto module is unavailable.
   * If not provided, a default bitwise hash function is used.
   *
   * @example
   * ```typescript
   * // Using Web Crypto API in browser
   * hashFunction: async (input) => {
   *   const encoder = new TextEncoder();
   *   const data = encoder.encode(input);
   *   const hashBuffer = await crypto.subtle.digest('SHA-256', data);
   *   const hashArray = Array.from(new Uint8Array(hashBuffer));
   *   return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
   * }
   * ```
   */
  hashFunction?: HashFunction
  migration?: {
    shouldMigrate?: (session: any) => Promise<boolean>
    migrate?: (session: any, tools: Record<string, Tool>) => Promise<void>
    onBeforeMigrate?: (
      statements: Array<{ cypher: string; params: Record<string, any> }>
    ) => Promise<Array<{ cypher: string; params: Record<string, any> }>>
  }
}

export type GenerateTextOptions = (
  | {
      prompt: string
      messages?: never
    }
  | {
      messages: Array<ModelMessage>
      prompt?: never
    }
) & {
  activeTools?: string[]
  metadata?: Record<string, unknown>
  maxOutputTokens?: number
  temperature?: number
  topP?: number
  topK?: number
  presencePenalty?: number
  frequencyPenalty?: number
  stopSequences?: string[]
  seed?: number
  maxRetries?: number
  abortSignal?: AbortSignal
  headers?: Record<string, string | undefined>
}

export interface GenerateTextResultWrapper {
  result: AIGenerateTextResult<Record<string, Tool>, never>
}

export interface SyncResult {
  /** The hash of the toolset after synchronization */
  hash: string
}

/** Serialized parameter info stored in Neo4j */
export interface StoredParameter {
  name: string
  type: string
  description: string
  required: boolean
}

/** Serialized return type info stored in Neo4j */
export interface StoredReturnType {
  type: string
  description: string
}

/** Serialized tool info stored in Neo4j (without execute function) */
export interface StoredTool {
  name: string
  description: string
  parameters: StoredParameter[]
  returnType: StoredReturnType
}

export interface ToolsetInfo {
  /** The hash of the toolset */
  hash: string
  /** When the toolset was last updated */
  updatedAt: Date
  /** Number of tools in the toolset */
  toolCount: number
  /** The tools in the toolset */
  tools: StoredTool[]
}

export interface DeleteToolsetResult {
  /** Number of toolsets deleted (0 or 1) */
  deletedToolsets: number
  /** Number of tools deleted */
  deletedTools: number
  /** Number of parameters deleted */
  deletedParams: number
  /** Number of return types deleted */
  deletedReturnTypes: number
}

export interface GetActiveToolsOptions {
  /** The prompt to use for semantic tool selection */
  prompt: string
  /** Maximum number of tools to return (defaults to maxActiveTools from config) */
  maxTools?: number
}

export interface GetActiveToolsResult {
  /** The selected tools as a record, ready to pass to AI SDK's generateText */
  tools: Record<string, Tool>
  /** The names of the selected tools */
  names: string[]
}

export interface MCPRagClient {
  generateText(options: GenerateTextOptions): Promise<GenerateTextResultWrapper>
  /**
   * Get active tools based on semantic similarity to a prompt.
   * Use this when you want to manage AI SDK calls yourself but still
   * want RAG-based tool selection.
   *
   * @example
   * ```typescript
   * const { tools, names } = await client.getActiveTools({
   *   prompt: 'What is the weather like?'
   * })
   *
   * // Use with AI SDK directly
   * const result = await generateText({
   *   model: openai('gpt-4o'),
   *   tools,
   *   prompt: 'What is the weather like?'
   * })
   * ```
   */
  getActiveTools(options: GetActiveToolsOptions): Promise<GetActiveToolsResult>
  sync(options?: {
    waitForIndex?: boolean
    maxWaitMs?: number
  }): Promise<SyncResult>
  addTool(name: string, tool: Tool): void
  removeTool(name: string): void
  getTools(): Record<string, Tool>
  /** Get the current toolset hash */
  getToolsetHash(): string
  /** Get toolset info by hash from Neo4j */
  getToolsetByHash(hash: string): Promise<ToolsetInfo | null>
  /** Delete toolset by hash from Neo4j */
  deleteToolsetByHash(hash: string): Promise<DeleteToolsetResult>
}
