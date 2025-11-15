/* eslint-disable no-extra-semi */
/* eslint-disable @typescript-eslint/ban-ts-comment */
import { describe, it, expect, afterAll } from 'vitest'
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { tool, jsonSchema, type CoreMessage } from 'ai'
import mockToolsJson from '../mock-tools-github.json'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

/**
 * Type definitions
 */
interface MCPTool {
  name: string
  description?: string
  inputSchema?: any
}

interface RequestMetrics {
  promptNumber: number
  prompt: string
  toolCalled: string | null
  tokenCount: number // tokens for THIS request only
  cumulativeTokens: number // total tokens used up to this point
  promptTokens: number // input tokens
  completionTokens: number // output tokens
  responseTime: number
  conversationLength: number
}

interface BenchmarkSummary {
  totalTests: number
  successfulTests: number
  failedTests?: number
  minResponseTime: number
  maxResponseTime: number
  totalResponseTime: number
  minTokens: number
  maxTokens: number
  averageResponseTime: number
  totalTokens: number
  averageTokens: number
  totalPromptTokens: number
  totalCompletionTokens: number
  toolCallSuccessRate: number
  metrics: RequestMetrics[]
}

// Global variable to store benchmark results across tests
let globalBenchmarkMetrics: RequestMetrics[] = []

/**
 * Generate mock response for tool execution
 */
function getMockResponse(toolName: string, params: any): any {
  return {
    success: true,
    tool: toolName,
    params,
    result: `Mock result for ${toolName}`,
  }
}

/**
 * Normalize JSON Schema to ensure it's a valid object type
 */
function normalizeSchema(schema: any): any {
  if (!schema) {
    return {
      type: 'object',
      properties: {},
    }
  }

  if (schema.type === 'object') {
    return schema
  }

  if (schema.properties && !schema.type) {
    return {
      ...schema,
      type: 'object',
    }
  }

  return {
    type: 'object',
    properties: {
      value: schema,
    },
    required: ['value'],
  }
}

/**
 * Convert MCP tools to AI SDK compatible format
 */
function convertMCPToolsToAISDK(mcpTools: MCPTool[]): Record<string, any> {
  const tools: Record<string, any> = {}

  for (const mcpTool of mcpTools) {
    try {
      const normalizedSchema = normalizeSchema(mcpTool.inputSchema)

      tools[mcpTool.name] = tool({
        description: mcpTool.description || `Tool: ${mcpTool.name}`,
        inputSchema: jsonSchema(normalizedSchema),
        // @ts-ignore
        execute: async (params: any) => {
          const actualParams =
            mcpTool.inputSchema?.type !== 'object' && params.value
              ? params.value
              : params
          return getMockResponse(mcpTool.name, actualParams)
        },
      })
    } catch (error) {
      console.error(`    ❌ Error converting tool ${mcpTool.name}:`, error)
      throw error
    }
  }

  return tools
}

/**
 * FIXED VERSION: Generate benchmark summary statistics
 *
 * This function now includes all required fields that the markdown reporter expects:
 * - failedTests
 * - minResponseTime
 * - maxResponseTime
 * - minTokens
 * - maxTokens
 */
function generateBenchmarkSummary(metrics: RequestMetrics[]): BenchmarkSummary {
  const totalResponseTime = metrics.reduce((sum, m) => sum + m.responseTime, 0)
  const totalTokens = metrics.reduce((sum, m) => sum + m.tokenCount, 0)
  const totalPromptTokens = metrics.reduce((sum, m) => sum + m.promptTokens, 0)
  const totalCompletionTokens = metrics.reduce(
    (sum, m) => sum + m.completionTokens,
    0
  )
  const successfulToolCalls = metrics.filter(m => m.toolCalled !== null).length

  return {
    totalTests: metrics.length,
    successfulTests: successfulToolCalls,
    failedTests: metrics.length - successfulToolCalls, // ✅ ADDED
    totalResponseTime,
    averageResponseTime: Math.round(totalResponseTime / metrics.length),
    minResponseTime: Math.min(...metrics.map(m => m.responseTime)), // ✅ ADDED
    maxResponseTime: Math.max(...metrics.map(m => m.responseTime)), // ✅ ADDED
    totalTokens,
    averageTokens: Math.round(totalTokens / metrics.length),
    minTokens: Math.min(...metrics.map(m => m.tokenCount)), // ✅ ADDED
    maxTokens: Math.max(...metrics.map(m => m.tokenCount)), // ✅ ADDED
    totalPromptTokens,
    totalCompletionTokens,
    toolCallSuccessRate: (successfulToolCalls / metrics.length) * 100,
    metrics,
  }
}

/**
 * Print detailed metrics table
 */
function printMetricsTable(metrics: RequestMetrics[]): void {
  console.log('\n📊 Detailed Metrics:\n')
  console.log(
    '| # | Tool Called | Prompt Tokens | Completion Tokens | Total Tokens | Cumulative | Response Time | Messages |'
  )
  console.log(
    '|---|-------------|---------------|-------------------|--------------|------------|---------------|----------|'
  )
  metrics.forEach(m => {
    const toolName = m.toolCalled || 'None'
    console.log(
      `| ${m.promptNumber} | ${toolName.padEnd(20)} | ${String(m.promptTokens).padStart(13)} | ${String(m.completionTokens).padStart(17)} | ${String(m.tokenCount).padStart(12)} | ${String(m.cumulativeTokens).padStart(10)} | ${String(m.responseTime).padStart(13)}ms | ${String(m.conversationLength).padStart(8)} |`
    )
  })
}

/**
 * Print benchmark summary
 */
function printBenchmarkSummary(summary: BenchmarkSummary): void {
  console.log('\n📈 BENCHMARK SUMMARY')
  console.log('')
  console.log(`Total Tests:              ${summary.totalTests}`)
  console.log(
    `Successful Tool Calls:    ${summary.successfulTests}/${summary.totalTests}`
  )
  console.log(
    `Tool Call Success Rate:   ${summary.toolCallSuccessRate.toFixed(1)}%`
  )
  console.log('')
  console.log(`Total Response Time:      ${summary.totalResponseTime}ms`)
  console.log(`Average Response Time:    ${summary.averageResponseTime}ms`)
  console.log(
    `Min Response Time:        ${Math.min(...summary.metrics.map(m => m.responseTime))}ms`
  )
  console.log(
    `Max Response Time:        ${Math.max(...summary.metrics.map(m => m.responseTime))}ms`
  )
  console.log('')
  console.log(`Total Tokens:             ${summary.totalTokens}`)
  console.log(`Total Prompt Tokens:      ${summary.totalPromptTokens}`)
  console.log(`Total Completion Tokens:  ${summary.totalCompletionTokens}`)
  console.log(`Average Tokens:           ${summary.averageTokens}`)
  console.log(
    `Min Tokens:               ${Math.min(...summary.metrics.map(m => m.tokenCount))}`
  )
  console.log(
    `Max Tokens:               ${Math.max(...summary.metrics.map(m => m.tokenCount))}`
  )
}

/**
 * Export benchmark summary to file for CI consumption
 */
function exportBenchmarkSummary(summary: BenchmarkSummary): void {
  if (process.env.CI || process.env.BENCHMARK_EXPORT) {
    try {
      const benchmarkName = 'base-tool-selection'
      const resultsDir = join(process.cwd(), 'results', benchmarkName)
      mkdirSync(resultsDir, { recursive: true })

      const summaryPath = join(resultsDir, 'benchmark-summary.json')
      writeFileSync(summaryPath, JSON.stringify(summary, null, 2))

      console.log(`\n✅ Benchmark summary exported to ${summaryPath}`)
    } catch (error) {
      console.error('❌ Failed to export benchmark summary:', error)
    }
  }
}

describe('Base Tool Selection Benchmark', () => {
  // Export results after all tests complete
  afterAll(() => {
    if (globalBenchmarkMetrics.length > 0) {
      const summary = generateBenchmarkSummary(globalBenchmarkMetrics)

      // Export summary to file for CI
      exportBenchmarkSummary(summary)

      // Also export to global for backward compatibility
      if (process.env.CI || process.env.BENCHMARK_EXPORT) {
        ;(global as any).__BENCHMARK_SUMMARY__ = summary
      }
    }
  })

  it('should handle 5 separate tool calls in a multi-step conversation', async () => {
    const mcpTools = mockToolsJson.tools as MCPTool[]
    const aiSDKTools = convertMCPToolsToAISDK(mcpTools)

    const metrics: RequestMetrics[] = []
    const conversationHistory: CoreMessage[] = []
    let cumulativeTokens = 0 // Track cumulative tokens across all requests

    // Individual prompts that each trigger a specific tool
    const prompts = [
      'Get repository information for rocket-connect/mcp-rag',
      'List all open issues in the repository rocket-connect/mcp-rag',
      'Create a new issue in rocket-connect/mcp-rag with title "Test Issue" and body "This is a test"',
      'Get the contents of the README.md file from the main branch in rocket-connect/mcp-rag',
      'Add a comment to issue #1 in rocket-connect/mcp-rag saying "This is a test comment"',
    ]

    console.log('\n🚀 Starting sequential tool call test...\n')

    // Execute each prompt sequentially
    for (let i = 0; i < prompts.length; i++) {
      const prompt = prompts[i]
      console.log(`\n📝 Prompt ${i + 1}/${prompts.length}: ${prompt}`)

      // Add the new user message to conversation history
      conversationHistory.push({
        role: 'user',
        content: prompt,
      })

      const startTime = Date.now()
      let toolCalled: string | null = null

      // Execute the query with accumulated conversation history
      const result = await generateText({
        model: openai('gpt-4o-mini'),
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

      // Add assistant response to conversation history
      conversationHistory.push({
        role: 'assistant',
        content: result.text,
      })

      // ✅ FIX: Get actual token usage from the API response
      const inputTokens = result.usage?.inputTokens || 0
      const outputTokens = result.usage?.outputTokens || 0
      const totalTokens =
        result.usage?.totalTokens || inputTokens + outputTokens

      // Update cumulative tokens
      cumulativeTokens += totalTokens

      // Record metrics with actual token counts
      const metric: RequestMetrics = {
        promptNumber: i + 1,
        prompt,
        toolCalled,
        tokenCount: totalTokens,
        cumulativeTokens: cumulativeTokens,
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
    }

    // Store metrics in global variable for export
    globalBenchmarkMetrics = metrics

    // Generate summary statistics
    const summary = generateBenchmarkSummary(metrics)

    // Print detailed metrics table
    printMetricsTable(metrics)

    // Print summary
    console.log('\n' + '='.repeat(100))
    printBenchmarkSummary(summary)
    console.log('='.repeat(100) + '\n')

    // Assertions
    expect(metrics).toHaveLength(5)
    expect(metrics.every(m => m.toolCalled !== null)).toBe(true)
    expect(metrics[metrics.length - 1].conversationLength).toBeGreaterThan(5)
    expect(cumulativeTokens).toBeGreaterThan(0) // Ensure we're tracking real tokens
  }, 60000) // 60 second timeout
})
