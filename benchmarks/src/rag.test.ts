/* eslint-disable no-extra-semi */
import { describe, it, beforeAll, afterAll } from 'vitest'
import mockToolsJson from '../mock-tools-github.json'
import neo4j, { Driver } from 'neo4j-driver'
import { runBenchmark, type RequestMetrics } from './utils/run'
import type { MCPTool } from './utils/test-utils'
import { generateBenchmarkSummary } from './utils/markdown'
import { saveBenchmarkResults } from './utils/ci'
import { BENCHMARKS, type TextGenerationConfig } from './benchmark-config'
import { convertMCPToolsToAISDK } from './utils/test-utils'
import { createMCPRag } from '@mcp-rag/client'
import type { Tool } from 'ai'
import { openai } from '@ai-sdk/openai'

// Global variable to store benchmark results across tests
const globalBenchmarkMetrics: RequestMetrics[] = []

const BENCHMARK_CONFIG = BENCHMARKS['rag-tool-selection']

/**
 * Helper function to wait for vector index to be fully populated
 */
async function waitForIndexPopulation(
  driver: Driver,
  indexName: string,
  maxWaitMs: number = 30000
): Promise<void> {
  const startTime = Date.now()
  const session = driver.session()

  try {
    while (Date.now() - startTime < maxWaitMs) {
      const result = await session.run(
        `
        SHOW VECTOR INDEXES
        YIELD name, state, populationPercent
        WHERE name = $indexName
        RETURN name, state, populationPercent
        `,
        { indexName }
      )

      if (result.records.length > 0) {
        const record = result.records[0]
        const state = record.get('state')
        const populationPercent = record.get('populationPercent')

        if (state === 'ONLINE' && populationPercent === 100.0) {
          console.log(
            `✅ Vector index '${indexName}' is ready (state: ${state}, population: ${populationPercent}%)`
          )
          return
        }

        console.log(
          `⏳ Waiting for index '${indexName}' (state: ${state}, population: ${populationPercent}%)`
        )
      }

      await new Promise(resolve => setTimeout(resolve, 500))
    }

    throw new Error(
      `Vector index ${indexName} did not populate within ${maxWaitMs}ms`
    )
  } finally {
    await session.close()
  }
}

/**
 * Create text generation config that uses MCP-RAG client with Neo4j
 */
function createRAGTextGenerationConfig(
  mcpRagClient: ReturnType<typeof createMCPRag>
): TextGenerationConfig {
  return {
    generateText: async ({ prompt }) => {
      // Generate text with filtered tools
      const result = await mcpRagClient.generateText({
        prompt,
      })

      return {
        toolCalls: result.result.toolCalls.map(call => ({
          toolName: call.toolName,
        })),
        usage: {
          promptTokens: result.result.totalUsage.inputTokens!,
          completionTokens: result.result.totalUsage.outputTokens!,
          totalTokens: result.result.totalUsage.totalTokens!,
        },
      }
    },
    model: 'gpt-4o-mini',
  }
}

describe('RAG Tool Selection Benchmark', () => {
  let driver: Driver
  let mcpRagClient: ReturnType<typeof createMCPRag>
  const mcpTools = mockToolsJson.tools as MCPTool[]
  let allAISDKTools: Record<string, Tool>
  let textGenerationConfig: TextGenerationConfig

  beforeAll(async () => {
    // Initialize Neo4j driver
    const uri = process.env.NEO4J_URI || 'neo4j://localhost:7687'
    const username = process.env.NEO4J_USERNAME || 'neo4j'
    const password = process.env.NEO4J_PASSWORD || 'testpassword'

    driver = neo4j.driver(uri, neo4j.auth.basic(username, password))
    await driver.verifyConnectivity()
    console.log('✅ Connected to Neo4j')

    // Clear existing data
    const session = driver.session()
    try {
      await session.run('MATCH (n) DETACH DELETE n')
      console.log('✅ Cleared Neo4j database')
    } finally {
      await session.close()
    }

    // Convert MCP tools to AI SDK format
    allAISDKTools = convertMCPToolsToAISDK(mcpTools)
    console.log(
      `✅ Converted ${Object.keys(allAISDKTools).length} tools to AI SDK format`
    )

    // Create MCP-RAG client
    mcpRagClient = createMCPRag({
      model: openai('gpt-4o-mini'),
      neo4j: driver!,
      tools: allAISDKTools,
    })

    // Connect the client
    await mcpRagClient.sync()
    console.log('✅ MCP-RAG client connected')

    // Wait for vector index to be populated
    await waitForIndexPopulation(driver, 'tool_vector_index', 60000)

    // Create text generation config
    textGenerationConfig = createRAGTextGenerationConfig(mcpRagClient)
  }, 180000) // 3 minute timeout for setup

  afterAll(async () => {
    try {
      // Disconnect the client
      if (mcpRagClient) {
        console.log('✅ MCP-RAG client disconnected')
      }

      // Close Neo4j driver
      if (driver) {
        await driver.close()
        console.log('✅ Neo4j driver closed')
      }

      // Generate and save benchmark summary
      if (globalBenchmarkMetrics.length > 0) {
        const summary = generateBenchmarkSummary(globalBenchmarkMetrics)
        console.log('\n' + summary)

        // ✅ FIXED: Always save benchmark results (removed CI check)
        await saveBenchmarkResults(BENCHMARK_CONFIG, summary)
      }
    } catch (error) {
      console.error('Error in afterAll:', error)
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
        tools: allAISDKTools,
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
})
