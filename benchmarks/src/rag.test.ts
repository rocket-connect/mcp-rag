/* eslint-disable no-extra-semi */
import { describe, it, beforeAll, afterAll } from 'vitest'
import mockToolsJson from '../../examples/github/mock-tools-github.json'
import neo4j, { Driver } from 'neo4j-driver'
import { runBenchmark, type RequestMetrics } from './utils/run'
import type { MCPTool } from './utils/test-utils'
import { generateBenchmarkSummary } from './utils/markdown'
import { saveBenchmarkResults } from './utils/ci'
import {
  BENCHMARKS,
  type TextGenerationConfig,
  extractBenchmarkMetrics,
} from './benchmark-config'
import { convertMCPToolsToAISDK } from './utils/test-utils'
import { createMCPRag } from '@mcp-rag/client'
import type { Tool } from 'ai'
import { openai } from '@ai-sdk/openai'
import { TEST_PROMPTS, EXPECTED_TOOLS } from './utils/benchmark-test-data'

const globalBenchmarkMetrics: RequestMetrics[] = []

const BENCHMARK_CONFIG = BENCHMARKS['rag-tool-selection']

function createRAGTextGenerationConfig(
  mcpRagClient: ReturnType<typeof createMCPRag>
): TextGenerationConfig {
  return {
    generateText: async ({ prompt }) => {
      // Generate text with filtered tools
      const result = await mcpRagClient.generateText({
        prompt,
      })

      // Use consolidated extraction utility
      return extractBenchmarkMetrics(result.result)
    },
    model: openai('gpt-4o-mini'),
  }
}

describe('RAG Tool Selection Benchmark', () => {
  let driver: Driver
  let mcpRagClient: ReturnType<typeof createMCPRag>
  const mcpTools = mockToolsJson.tools as MCPTool[]
  let allAISDKTools: Record<string, Tool>
  let textGenerationConfig: TextGenerationConfig

  beforeAll(async () => {
    const uri = process.env.NEO4J_URI || 'neo4j://localhost:7687'
    const username = process.env.NEO4J_USERNAME || 'neo4j'
    const password = process.env.NEO4J_PASSWORD || 'testpassword'

    driver = neo4j.driver(uri, neo4j.auth.basic(username, password))
    await driver.verifyConnectivity()
    console.log('✅ Connected to Neo4j')

    const session = driver.session()
    try {
      await session.run('MATCH (n) DETACH DELETE n')
      console.log('✅ Cleared Neo4j database')
    } finally {
      await session.close()
    }

    allAISDKTools = convertMCPToolsToAISDK(mcpTools)
    console.log(
      `✅ Converted ${Object.keys(allAISDKTools).length} tools to AI SDK format`
    )

    mcpRagClient = createMCPRag({
      model: openai('gpt-4o-mini'),
      openaiApiKey: process.env.OPENAI_API_KEY || '',
      neo4j: driver!,
      tools: allAISDKTools,
    })

    await mcpRagClient.sync({ waitForIndex: true, maxWaitMs: 60000 })
    console.log('✅ MCP-RAG client connected and index ready')

    textGenerationConfig = createRAGTextGenerationConfig(mcpRagClient)
  }, 180000) // 3 minute timeout for setup

  afterAll(async () => {
    try {
      if (mcpRagClient) {
        console.log('✅ MCP-RAG client disconnected')
      }

      if (driver) {
        await driver.close()
        console.log('✅ Neo4j driver closed')
      }

      if (globalBenchmarkMetrics.length > 0) {
        const summary = generateBenchmarkSummary(globalBenchmarkMetrics)
        console.log('\n' + summary)

        await saveBenchmarkResults(BENCHMARK_CONFIG, summary)
      }
    } catch (error) {
      console.error('Error in afterAll:', error)
    }
  })

  TEST_PROMPTS.forEach((prompt, index) => {
    it(`should select correct tool for: "${prompt}"`, async () => {
      const metrics = await runBenchmark({
        prompt,
        tools: allAISDKTools,
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
})
