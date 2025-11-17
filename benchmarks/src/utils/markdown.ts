import type { RequestMetrics } from './run'

export interface BenchmarkSummary {
  totalTests: number
  successfulTests: number
  failedTests: number
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

/**
 * Generate benchmark summary statistics
 */
export function generateBenchmarkSummary(
  metrics: RequestMetrics[]
): BenchmarkSummary {
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
    failedTests: metrics.length - successfulToolCalls,
    totalResponseTime,
    averageResponseTime: Math.round(totalResponseTime / metrics.length),
    minResponseTime: Math.min(...metrics.map(m => m.responseTime)),
    maxResponseTime: Math.max(...metrics.map(m => m.responseTime)),
    totalTokens,
    averageTokens: Math.round(totalTokens / metrics.length),
    minTokens: Math.min(...metrics.map(m => m.tokenCount)),
    maxTokens: Math.max(...metrics.map(m => m.tokenCount)),
    totalPromptTokens,
    totalCompletionTokens,
    toolCallSuccessRate: (successfulToolCalls / metrics.length) * 100,
    metrics,
  }
}

/**
 * Print detailed metrics table
 */
export function printMetricsTable(metrics: RequestMetrics[]): void {
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
export function printBenchmarkSummary(summary: BenchmarkSummary): void {
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
  console.log(`Min Response Time:        ${summary.minResponseTime}ms`)
  console.log(`Max Response Time:        ${summary.maxResponseTime}ms`)
  console.log('')
  console.log(`Total Tokens:             ${summary.totalTokens}`)
  console.log(`Total Prompt Tokens:      ${summary.totalPromptTokens}`)
  console.log(`Total Completion Tokens:  ${summary.totalCompletionTokens}`)
  console.log(`Average Tokens:           ${summary.averageTokens}`)
  console.log(`Min Tokens:               ${summary.minTokens}`)
  console.log(`Max Tokens:               ${summary.maxTokens}`)
}
