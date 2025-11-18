/* eslint-disable no-extra-semi */
import { describe, it, expect, afterAll } from 'vitest'
import mockToolsJson from '../../examples/github/mock-tools-github.json'
import { runBenchmark, type RequestMetrics } from './utils/run'
import type { MCPTool } from './utils/test-utils'
import { convertMCPToolsToAISDK } from './utils/test-utils'
import { generateBenchmarkSummary } from './utils/markdown'
import { saveBenchmarkResults } from './utils/ci'
import { BENCHMARKS, createDefaultTextGeneration } from './benchmark-config'
import { TEST_PROMPTS, EXPECTED_TOOLS } from './utils/benchmark-test-data'

const globalBenchmarkMetrics: RequestMetrics[] = []

const BENCHMARK_CONFIG = BENCHMARKS['base-tool-selection']

describe('Base Tool Selection Benchmark', () => {
  const mcpTools = mockToolsJson.tools as MCPTool[]
  const aiSDKTools = convertMCPToolsToAISDK(mcpTools)
  const textGenerationConfig = createDefaultTextGeneration()

  afterAll(async () => {
    if (globalBenchmarkMetrics.length > 0) {
      const summary = generateBenchmarkSummary(globalBenchmarkMetrics)
      await saveBenchmarkResults(BENCHMARK_CONFIG, summary)
    }
  })

  TEST_PROMPTS.forEach((prompt, index) => {
    it(`should select correct tool for: "${prompt}"`, async () => {
      const metrics = await runBenchmark({
        prompt,
        tools: aiSDKTools,
        expectedTool: EXPECTED_TOOLS[index],
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
