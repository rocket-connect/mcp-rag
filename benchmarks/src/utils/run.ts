/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Tool } from 'ai'
import type { TextGenerationConfig } from '../benchmark-config'

export interface RequestMetrics {
  prompt: string
  expectedTool: string
  selectedTool: string | null
  isCorrect: boolean
  latencyMs: number
  timestamp: string
  // Additional properties for benchmark reporting
  toolCalled: string | null
  promptNumber: number
  promptTokens: number
  completionTokens: number
  tokenCount: number
  cumulativeTokens: number
  responseTime: number
  conversationLength: number
}

/**
 * Run a single benchmark request
 */
export async function runBenchmark(params: {
  prompt: string
  tools: Record<string, Tool>
  expectedTool: string
  textGeneration: TextGenerationConfig
}): Promise<RequestMetrics> {
  const { prompt, tools, expectedTool, textGeneration } = params

  const startTime = performance.now()

  try {
    const result = await textGeneration.generateText({
      prompt,
      tools,
      model: textGeneration.model,
    })

    const endTime = performance.now()
    const latencyMs = endTime - startTime

    const selectedTool = result.toolCalls[0]?.toolName || null
    const isCorrect = selectedTool === expectedTool

    // ✅ FIXED: Extract token usage from the result
    const promptTokens = result.usage?.promptTokens || 0
    const completionTokens = result.usage?.completionTokens || 0
    const totalTokens =
      result.usage?.totalTokens || promptTokens + completionTokens

    return {
      prompt,
      expectedTool,
      selectedTool,
      isCorrect,
      latencyMs,
      timestamp: new Date().toISOString(),
      toolCalled: selectedTool,
      promptNumber: 1,
      promptTokens,
      completionTokens,
      tokenCount: totalTokens,
      cumulativeTokens: 0,
      responseTime: latencyMs,
      conversationLength: 2, // prompt + response
    }
  } catch (error) {
    const endTime = performance.now()
    const latencyMs = endTime - startTime

    console.error('Error in runBenchmark:', error)

    return {
      prompt,
      expectedTool,
      selectedTool: null,
      isCorrect: false,
      latencyMs,
      timestamp: new Date().toISOString(),
      toolCalled: null,
      promptNumber: 1,
      promptTokens: 0,
      completionTokens: 0,
      tokenCount: 0,
      cumulativeTokens: 0,
      responseTime: latencyMs,
      conversationLength: 2,
    }
  }
}

/**
 * Run multiple benchmark requests
 */
export async function runBenchmarks(params: {
  prompts: string[]
  tools: Record<string, Tool>
  expectedTools: string[]
  textGeneration: TextGenerationConfig
  onProgress?: (completed: number, total: number) => void
}): Promise<RequestMetrics[]> {
  const { prompts, tools, expectedTools, textGeneration, onProgress } = params

  if (prompts.length !== expectedTools.length) {
    throw new Error('Prompts and expectedTools arrays must have same length')
  }

  const results: RequestMetrics[] = []
  let cumulativeTokens = 0

  for (let i = 0; i < prompts.length; i++) {
    const metrics = await runBenchmark({
      prompt: prompts[i],
      tools,
      expectedTool: expectedTools[i],
      textGeneration,
    })

    // Update prompt number and cumulative tokens
    metrics.promptNumber = i + 1
    cumulativeTokens += metrics.tokenCount
    metrics.cumulativeTokens = cumulativeTokens

    results.push(metrics)

    if (onProgress) {
      onProgress(i + 1, prompts.length)
    }
  }

  return results
}

/**
 * Calculate accuracy from metrics
 */
export function calculateAccuracy(metrics: RequestMetrics[]): number {
  if (metrics.length === 0) return 0
  const correct = metrics.filter(m => m.isCorrect).length
  return (correct / metrics.length) * 100
}

/**
 * Calculate average latency from metrics
 */
export function calculateAverageLatency(metrics: RequestMetrics[]): number {
  if (metrics.length === 0) return 0
  const total = metrics.reduce((sum, m) => sum + m.latencyMs, 0)
  return total / metrics.length
}
