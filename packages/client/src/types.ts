import { Driver } from 'neo4j-driver'
import {
  LanguageModel,
  Tool,
  GenerateTextResult as AIGenerateTextResult,
  ModelMessage,
} from 'ai'

export interface MCPRagConfig {
  model: LanguageModel
  neo4j: Driver
  tools: Record<string, Tool>
  openaiApiKey: string
  maxActiveTools?: number
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

export interface MCPRagClient {
  generateText(options: GenerateTextOptions): Promise<GenerateTextResultWrapper>
  sync(options?: { waitForIndex?: boolean; maxWaitMs?: number }): Promise<void>
  addTool(name: string, tool: Tool): void
  removeTool(name: string): void
  getTools(): Record<string, Tool>
}
