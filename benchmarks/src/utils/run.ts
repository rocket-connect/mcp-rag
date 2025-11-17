import { generateText, type CoreMessage } from 'ai'
import { openai } from '@ai-sdk/openai'
import type { BenchmarkConfig } from '../benchmark-config'
import type { MCPTool } from './test-utils'
import { convertMCPToolsToAISDK } from './test-utils'

export interface RequestMetrics {
  promptNumber: number
  prompt: string
  toolCalled: string | null
  tokenCount: number
  cumulativeTokens: number
  promptTokens: number
  completionTokens: number
  responseTime: number
  conversationLength: number
}

export interface RunBenchmarkOptions {
  config: BenchmarkConfig
  prompts: string[]
  mcpTools: MCPTool[]
  onProgress?: (metric: RequestMetrics) => void
}

export async function runBenchmark({
  config,
  prompts,
  mcpTools,
  onProgress,
}: RunBenchmarkOptions): Promise<RequestMetrics[]> {
  const aiSDKTools = convertMCPToolsToAISDK(mcpTools)
  const metrics: RequestMetrics[] = []
  const conversationHistory: CoreMessage[] = []
  let cumulativeTokens = 0

  console.log(`\n🚀 Starting ${config.name} benchmark...\n`)

  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i]
    console.log(`\n📝 Prompt ${i + 1}/${prompts.length}: ${prompt}`)

    conversationHistory.push({
      role: 'user',
      content: prompt,
    })

    const startTime = Date.now()
    let toolCalled: string | null = null

    const result = await generateText({
      model: openai(config.model),
      messages: conversationHistory,
      tools: aiSDKTools,
      maxRetries: 3,
      onStepFinish: async step => {
        if (step.toolCalls && step.toolCalls.length > 0) {
          step.toolCalls.forEach(toolCall => {
            toolCalled = toolCall.toolName
            console.log(
              `  🔧 Tool called: ${toolCall.toolName}`,
              '\n  Input:',
              JSON.stringify(toolCall.input, null, 2)
            )
          })
        }
      },
    })

    const endTime = Date.now()
    const responseTime = endTime - startTime

    conversationHistory.push({
      role: 'assistant',
      content: result.text,
    })

    const inputTokens = result.usage?.inputTokens || 0
    const outputTokens = result.usage?.outputTokens || 0
    const totalTokens = result.usage?.totalTokens || inputTokens + outputTokens

    cumulativeTokens += totalTokens

    const metric: RequestMetrics = {
      promptNumber: i + 1,
      prompt,
      toolCalled,
      tokenCount: totalTokens,
      cumulativeTokens,
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      responseTime,
      conversationLength: conversationHistory.length,
    }
    metrics.push(metric)

    console.log(`  ⏱️  Response time: ${responseTime}ms`)
    console.log(
      `  💬 Conversation length: ${conversationHistory.length} messages`
    )
    console.log(
      `  📊 Tokens - Input: ${inputTokens}, Output: ${outputTokens}, Total: ${totalTokens}`
    )
    console.log(`  📈 Cumulative tokens: ${cumulativeTokens}`)

    if (onProgress) {
      onProgress(metric)
    }
  }

  return metrics
}
