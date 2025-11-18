/* eslint-disable no-extra-semi */
import { describe, it, expect, afterAll } from 'vitest'
import mockToolsJson from '../../examples/github/mock-tools-github.json'
import { runBenchmark, type RequestMetrics } from './utils/run'
import type { MCPTool } from './utils/test-utils'
import { convertMCPToolsToAISDK } from './utils/test-utils'
import { generateBenchmarkSummary } from './utils/markdown'
import { saveBenchmarkResults } from './utils/ci'
import { BENCHMARKS, createDefaultTextGeneration } from './benchmark-config'

// Global variable to store benchmark results across tests
const globalBenchmarkMetrics: RequestMetrics[] = []

const BENCHMARK_CONFIG = BENCHMARKS['base-tool-selection']

describe('Base Tool Selection Benchmark', () => {
  const mcpTools = mockToolsJson.tools as MCPTool[]
  const aiSDKTools = convertMCPToolsToAISDK(mcpTools)
  const textGenerationConfig = createDefaultTextGeneration()

  afterAll(async () => {
    // Export results after all tests complete
    if (globalBenchmarkMetrics.length > 0) {
      const summary = generateBenchmarkSummary(globalBenchmarkMetrics)
      await saveBenchmarkResults(BENCHMARK_CONFIG, summary)
    }
  })

  const prompts = [
    'Get pull request #42 from rocket-connect/mcp-rag',
    'List all open issues in the repository rocket-connect/mcp-rag',
    'Create a new issue in rocket-connect/mcp-rag with title "Test Issue" and body "This is a test"',
    'Get the contents of the README.md file from the main branch in rocket-connect/mcp-rag',
    'Add a comment to issue #1 in rocket-connect/mcp-rag saying "This is a test comment"',
  ]

  const expectedTools = [
    'get_pull_request',
    'list_issues',
    'create_issue',
    'get_file_contents',
    'create_issue_comment',
  ]

  prompts.forEach((prompt, index) => {
    it(`should select correct tool for: "${prompt}"`, async () => {
      const metrics = await runBenchmark({
        prompt,
        tools: aiSDKTools,
        expectedTool: expectedTools[index],
        textGeneration: textGenerationConfig,
      })

      globalBenchmarkMetrics.push(metrics)

      console.log('\n📊 Test Result:', {
        prompt: metrics.prompt,
        expected: metrics.expectedTool,
        selected: metrics.selectedTool,
        correct: metrics.isCorrect ? '✅' : '❌',
        latency: `${metrics.latencyMs.toFixed(2)}ms`,
      })
    }, 30000)
  })

  it('should have high overall accuracy', () => {
    const correctCount = globalBenchmarkMetrics.filter(m => m.isCorrect).length
    const totalCount = globalBenchmarkMetrics.length
    const accuracy = (correctCount / totalCount) * 100

    console.log(
      `\n📈 Overall Accuracy: ${accuracy.toFixed(2)}% (${correctCount}/${totalCount})`
    )

    expect(accuracy).toBeGreaterThanOrEqual(80)
  })
})
