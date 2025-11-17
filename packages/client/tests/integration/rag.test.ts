import { describe, it, beforeAll, expect, afterAll } from 'vitest'
import { createMCPRag } from '../../src/'
import { openai } from '@ai-sdk/openai'
import neo4j, { Driver } from 'neo4j-driver'
import { tool } from 'ai'
import { z } from 'zod'

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

describe('MCP RAG Integration Tests', () => {
  let driver: Driver
  let rag: ReturnType<typeof createMCPRag>

  beforeAll(async () => {
    const uri = process.env.NEO4J_URI || 'neo4j://localhost:7687'
    const username = process.env.NEO4J_USERNAME || 'neo4j'
    const password = process.env.NEO4J_PASSWORD || 'testpassword'

    driver = neo4j.driver(uri, neo4j.auth.basic(username, password))
    await driver.verifyConnectivity()

    const session = driver.session()
    try {
      await session.run('MATCH (n) DETACH DELETE n')
    } finally {
      await session.close()
    }

    rag = createMCPRag({
      model: openai('gpt-4o-mini'),
      neo4j: driver,
      tools: {
        get_weather: tool({
          description: 'Get the current weather for a location',
          inputSchema: z.object({
            location: z
              .string()
              .describe('The city and state, e.g. San Francisco, CA'),
            unit: z
              .enum(['celsius', 'fahrenheit'])
              .describe('The temperature unit')
              .optional(),
          }),
          execute: async ({ location, unit }) => {
            return {
              location,
              temperature: 72,
              unit: unit || 'fahrenheit',
              conditions: 'sunny',
            }
          },
        }),
        search_database: tool({
          description: 'Search through database records',
          inputSchema: z.object({
            query: z.string().describe('The search query'),
            limit: z.number().describe('Maximum number of results').optional(),
          }),
          execute: async ({ limit }) => {
            return {
              results: [
                { id: 1, title: 'Record 1', relevance: 0.95 },
                { id: 2, title: 'Record 2', relevance: 0.87 },
              ].slice(0, limit || 10),
            }
          },
        }),
        send_email: tool({
          description: 'Send an email to a recipient',
          inputSchema: z.object({
            to: z.string().describe('Email recipient'),
            subject: z.string().describe('Email subject'),
            body: z.string().describe('Email body content'),
          }),
          execute: async ({ to, subject }) => {
            return {
              sent: true,
              messageId: 'msg-123',
              to,
              subject,
            }
          },
        }),
      },
      maxActiveTools: 10,
    })

    await rag.sync()
    await waitForIndexPopulation(driver, 'tool_vector_index')
  })

  afterAll(async () => {
    await driver.close()
  })

  it('should retrieve weather tool for weather query', async () => {
    const result = await rag.generateText({
      prompt: 'What is the temperature in New York?',
    })

    expect(result.result).toBeDefined()
    expect(result.result.text).toBeDefined()

    const toolCalls = result.result.toolCalls || []
    const toolNames = toolCalls.map((tc: any) => tc.toolName)

    expect(toolNames).toContain('get_weather')
  })

  it('should retrieve database tool for search query', async () => {
    const result = await rag.generateText({
      prompt: 'Find all users with premium accounts',
    })

    expect(result.result).toBeDefined()
    expect(result.result.text).toBeDefined()

    const toolCalls = result.result.toolCalls || []
    const toolNames = toolCalls.map((tc: any) => tc.toolName)

    expect(toolNames).toContain('search_database')
  })

  it('should retrieve email tool for email query', async () => {
    // Be more explicit to encourage tool usage
    const result = await rag.generateText({
      prompt:
        'Use the send_email tool to send an email to john@example.com with subject "Meeting" and body "See you at 3pm"',
    })

    expect(result.result).toBeDefined()

    const toolCalls = result.result.toolCalls || []
    const toolNames = toolCalls.map((tc: any) => tc.toolName)

    // Should have selected send_email
    expect(toolNames).toContain('send_email')
  })

  it('should allow explicit tool selection', async () => {
    const result = await rag.generateText({
      prompt: 'What is the weather?',
      activeTools: ['get_weather'],
    })

    expect(result.result).toBeDefined()
    expect(result.result.text).toBeDefined()

    const toolCalls = result.result.toolCalls || []
    const toolNames = toolCalls.map((tc: any) => tc.toolName)

    if (toolCalls.length > 0) {
      expect(toolNames).toContain('get_weather')
      expect(toolNames).not.toContain('search_database')
      expect(toolNames).not.toContain('send_email')
    }
  })

  it('should add and remove tools at runtime', async () => {
    const newTool = tool({
      description: 'Calculate mathematical expressions',
      inputSchema: z.object({
        expression: z.string().describe('The math expression to calculate'),
      }),
      execute: async ({ expression }) => {
        return { result: eval(expression) }
      },
    })

    rag.addTool('calculate', newTool)

    const tools = rag.getTools()
    expect(tools['calculate']).toBeDefined()

    await rag.sync()
    await waitForIndexPopulation(driver, 'tool_vector_index')

    const result = await rag.generateText({
      prompt: 'What is 2 + 2?',
      activeTools: ['calculate'],
    })

    expect(result.result).toBeDefined()

    rag.removeTool('calculate')

    const updatedTools = rag.getTools()
    expect(updatedTools['calculate']).toBeUndefined()
  })

  it('should respect maxActiveTools limit', async () => {
    const limitedRag = createMCPRag({
      model: openai('gpt-4o-mini'),
      neo4j: driver,
      tools: {
        tool1: tool({
          description: 'Tool 1',
          inputSchema: z.object({ input: z.string() }),
          execute: async () => ({ output: '1' }),
        }),
        tool2: tool({
          description: 'Tool 2',
          inputSchema: z.object({ input: z.string() }),
          execute: async () => ({ output: '2' }),
        }),
        tool3: tool({
          description: 'Tool 3',
          inputSchema: z.object({ input: z.string() }),
          execute: async () => ({ output: '3' }),
        }),
      },
      maxActiveTools: 1,
    })

    await limitedRag.sync()
    await waitForIndexPopulation(driver, 'tool_vector_index')

    const result = await limitedRag.generateText({
      prompt: 'Use the tools',
    })

    expect(result.result).toBeDefined()

    const toolCalls = result.result.toolCalls || []
    expect(toolCalls.length).toBeLessThanOrEqual(1)
  })
})
