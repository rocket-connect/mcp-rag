/* eslint-disable no-extra-semi */
import { describe, it, expect, afterAll } from 'vitest'
import mockToolsJson from '../mock-tools-github.json'
import { runBenchmark, type RequestMetrics } from './utils/run'
import type { MCPTool } from './utils/test-utils'
import { generateBenchmarkSummary } from './utils/markdown'
import { saveBenchmarkResults } from './utils/ci'
import { BENCHMARKS } from './benchmark-config'

// Global variable to store benchmark results across tests
const globalBenchmarkMetrics: RequestMetrics[] = []

const BENCHMARK_CONFIG = BENCHMARKS['delayed-tool-selection']

// Helper function to add delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('Delayed AI SDK Tool Selection', () => {
  // Export results after all tests complete
  afterAll(() => {
    if (globalBenchmarkMetrics.length > 0) {
      const summary = generateBenchmarkSummary(globalBenchmarkMetrics)
      saveBenchmarkResults(BENCHMARK_CONFIG, summary)
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
    'add_issue_comment',
  ]

  prompts.forEach((prompt, index) => {
    it(`should select ${expectedTools[index]} for prompt ${index + 1} (with 1s delay)`, async () => {
      const mcpTools = mockToolsJson.tools as MCPTool[]

      // Add 1 second delay before sending
      await delay(1000)

      const metrics = await runBenchmark({
        config: BENCHMARK_CONFIG,
        prompts: [prompt],
        mcpTools,
      })

      // Store metrics for summary
      globalBenchmarkMetrics.push(...metrics)

      // Assertions
      expect(metrics).toHaveLength(1)
      expect(metrics[0].toolCalled).toBe(expectedTools[index])
      expect(metrics[0].tokenCount).toBeGreaterThan(0)
    }, 30000) // 30 second timeout per test
  })
})
