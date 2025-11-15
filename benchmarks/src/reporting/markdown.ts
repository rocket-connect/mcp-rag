import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

export interface BenchmarkMetric {
  promptNumber: number
  toolCalled: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cumulativeTokens: number
  responseTime: number
  conversationLength: number
}

export interface BenchmarkSummary {
  totalTests: number
  successfulTests: number
  failedTests: number
  totalResponseTime: number
  averageResponseTime: number
  minResponseTime: number
  maxResponseTime: number
  totalTokens: number
  totalPromptTokens: number
  totalCompletionTokens: number
  averageTokens: number
  minTokens: number
  maxTokens: number
  toolCallSuccessRate: number
  metrics?: BenchmarkMetric[]
}

export interface BenchmarkResult {
  timestamp: string
  commit?: string
  branch?: string
  summary?: BenchmarkSummary
}

export function generateMarkdownReport(result: BenchmarkResult): string {
  const sections: string[] = []

  // Header
  sections.push('# 🚀 MCP-RAG Benchmark Report')
  sections.push('')
  sections.push(`**Generated:** ${new Date(result.timestamp).toLocaleString()}`)

  if (result.commit || result.branch) {
    sections.push('')
    sections.push('## 📍 Git Information')
    sections.push('')
    if (result.commit) sections.push(`- **Commit:** \`${result.commit}\``)
    if (result.branch) sections.push(`- **Branch:** \`${result.branch}\``)
  }

  sections.push('')

  // Summary section
  const summary = result.summary
  if (summary) {
    sections.push('## 📊 Summary')
    sections.push('')
    sections.push(`- **Total Tests:** ${summary.totalTests}`)
    sections.push(
      `- **Successful Tests:** ${summary.successfulTests} (${summary.toolCallSuccessRate.toFixed(1)}%)`
    )
    sections.push(`- **Failed Tests:** ${summary.failedTests || 0}`)
    sections.push('')

    // Performance metrics
    sections.push('## ⚡ Performance')
    sections.push('')
    sections.push(
      `- **Total Response Time:** ${summary.totalResponseTime?.toLocaleString() || 'N/A'}ms`
    )
    sections.push(
      `- **Average Response Time:** ${summary.averageResponseTime ? Math.round(summary.averageResponseTime).toLocaleString() : 'N/A'}ms`
    )
    sections.push(
      `- **Min Response Time:** ${summary.minResponseTime?.toLocaleString() || 'N/A'}ms`
    )
    sections.push(
      `- **Max Response Time:** ${summary.maxResponseTime?.toLocaleString() || 'N/A'}ms`
    )
    sections.push('')

    // Token usage
    sections.push('## 🔢 Token Usage')
    sections.push('')
    sections.push(
      `- **Total Tokens:** ${summary.totalTokens?.toLocaleString() || 'N/A'}`
    )
    sections.push(
      `- **Prompt Tokens:** ${summary.totalPromptTokens?.toLocaleString() || 'N/A'}`
    )
    sections.push(
      `- **Completion Tokens:** ${summary.totalCompletionTokens?.toLocaleString() || 'N/A'}`
    )
    sections.push(
      `- **Average Tokens per Test:** ${summary.averageTokens ? Math.round(summary.averageTokens).toLocaleString() : 'N/A'}`
    )
    sections.push(
      `- **Min Tokens:** ${summary.minTokens?.toLocaleString() || 'N/A'}`
    )
    sections.push(
      `- **Max Tokens:** ${summary.maxTokens?.toLocaleString() || 'N/A'}`
    )
    sections.push('')

    // Detailed metrics table (if available)
    if (
      summary.metrics &&
      Array.isArray(summary.metrics) &&
      summary.metrics.length > 0
    ) {
      sections.push('## 📈 Detailed Metrics')
      sections.push('')
      sections.push(
        '| # | Tool Called | Prompt Tokens | Completion Tokens | Total Tokens | Cumulative | Response Time | Messages |'
      )
      sections.push(
        '|---|-------------|---------------|-------------------|--------------|------------|---------------|----------|'
      )

      summary.metrics.forEach(metric => {
        // Handle both RequestMetrics (tokenCount) and BenchmarkMetric (totalTokens)
        const totalTokens =
          metric.totalTokens || (metric as any).tokenCount || 0
        const promptTokens = metric.promptTokens || 0
        const completionTokens = metric.completionTokens || 0
        const cumulativeTokens = metric.cumulativeTokens || 0
        const responseTime = metric.responseTime || 0
        const conversationLength = metric.conversationLength || 0
        const toolCalled = metric.toolCalled || 'N/A'

        sections.push(
          `| ${metric.promptNumber} | ${toolCalled.padEnd(20)} | ${promptTokens.toLocaleString().padStart(13)} | ${completionTokens.toLocaleString().padStart(17)} | ${totalTokens.toLocaleString().padStart(12)} | ${cumulativeTokens.toLocaleString().padStart(10)} | ${responseTime.toLocaleString().padEnd(13)}ms | ${conversationLength.toLocaleString().padStart(8)} |`
        )
      })
      sections.push('')

      // Tool usage summary
      if (summary.metrics.length > 0) {
        sections.push('## 🔧 Tool Usage')
        sections.push('')
        const toolCounts: Record<string, number> = {}
        summary.metrics.forEach(metric => {
          const toolName = metric.toolCalled || 'N/A'
          toolCounts[toolName] = (toolCounts[toolName] || 0) + 1
        })

        sections.push('| Tool | Count |')
        sections.push('|------|-------|')
        Object.entries(toolCounts)
          .sort((a, b) => b[1] - a[1])
          .forEach(([tool, count]) => {
            sections.push(`| ${tool} | ${count} |`)
          })
        sections.push('')
      }
    }
  } else {
    sections.push('## ℹ️ No benchmark data available')
    sections.push('')
    sections.push(
      'Run benchmarks with metrics collection enabled to see detailed results.'
    )
    sections.push('')
  }

  // Footer
  sections.push('---')
  sections.push('')
  sections.push('*Generated by MCP-RAG Benchmark Suite*')

  return sections.join('\n')
}

export function saveReport(
  content: string,
  filename: string,
  benchmarkName: string
): void {
  const resultsDir = join(process.cwd(), 'results', benchmarkName)
  mkdirSync(resultsDir, { recursive: true })

  const filepath = join(resultsDir, filename)
  writeFileSync(filepath, content)
  console.log(`✅ Report saved to ${filepath}`)
}

export function saveHistoricalReport(
  content: string,
  benchmarkName: string
): void {
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .split('T')
    .join('-')
    .slice(0, -5)
  const filename = `${timestamp}.md`
  const historyDir = join(process.cwd(), 'results', benchmarkName, 'history')
  const historyPath = join(historyDir, filename)

  // Ensure the history directory exists before trying to write
  mkdirSync(historyDir, { recursive: true })

  writeFileSync(historyPath, content)
  console.log(`📊 Historical report saved to ${historyPath}`)
}
