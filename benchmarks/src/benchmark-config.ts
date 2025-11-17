import { openai } from '@ai-sdk/openai'
import { type Tool, generateText, LanguageModel } from 'ai'

/**
 * Configuration for text generation in benchmarks
 */
export interface TextGenerationConfig {
  /**
   * Custom function to generate text responses
   * This allows benchmarks to integrate with different clients (OpenAI, Anthropic, custom MCP-RAG, etc.)
   */
  generateText: (params: {
    prompt: string
    tools: Record<string, Tool>
    model: LanguageModel
  }) => Promise<{
    toolCalls: Array<{ toolName: string }>
    usage?: {
      promptTokens: number
      completionTokens: number
      totalTokens: number
    }
  }>

  /**
   * Optional setup function called before benchmark starts
   */
  setup?: () => Promise<void>

  /**
   * Optional teardown function called after benchmark completes
   */
  teardown?: () => Promise<void>

  /**
   * Model identifier to use
   */
  model: LanguageModel
}

/**
 * Configuration for a benchmark
 */
export interface BenchmarkConfig {
  /**
   * Unique identifier for the benchmark
   */
  id: string

  /**
   * Display name for the benchmark
   */
  name: string

  /**
   * Description of what this benchmark tests
   */
  description: string

  /**
   * Text generation configuration
   * Can be overridden per benchmark run
   */
  textGeneration?: TextGenerationConfig
}

/**
 * Available benchmarks
 */
export const BENCHMARKS: Record<string, BenchmarkConfig> = {
  'base-tool-selection': {
    id: 'base-tool-selection',
    name: 'Base Tool Selection',
    description:
      'Tests tool selection accuracy without any preprocessing or RAG',
  },
  'rag-tool-selection': {
    id: 'rag-tool-selection',
    name: 'RAG Tool Selection',
    description:
      'Tests tool selection using RAG with Neo4j vector search to intelligently filter relevant tools',
  },
}

/**
 * Helper to create a default text generation config using Vercel AI SDK
 */
export function createDefaultTextGeneration(): TextGenerationConfig {
  return {
    generateText: async ({ prompt, tools, model }) => {
      const result = await generateText({
        model,
        prompt,
        tools,
      })

      return {
        toolCalls: result.toolCalls.map(call => ({
          toolName: call.toolName,
        })),
        usage: {
          promptTokens: result.totalUsage.inputTokens!,
          completionTokens: result.totalUsage.outputTokens!,
          totalTokens: result.totalUsage.totalTokens!,
        },
      }
    },
    model: openai('gpt-4o-mini'),
  }
}
