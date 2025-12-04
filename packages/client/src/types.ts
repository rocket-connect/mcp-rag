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

export interface MCPRagClient {
  generateText(options: GenerateTextOptions): Promise<GenerateTextResultWrapper>
  sync(options?: { waitForIndex?: boolean; maxWaitMs?: number }): Promise<SyncResult>
  addTool(name: string, tool: Tool): void
  removeTool(name: string): void
  getTools(): Record<string, Tool>
  /** Get the current toolset hash */
  getToolsetHash(): string
}
