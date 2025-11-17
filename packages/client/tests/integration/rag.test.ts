import { describe, it, beforeAll, expect, afterAll } from 'vitest'
import { createMCPRag } from '../../src/'
import { openai } from '@ai-sdk/openai'
import neo4j, { Driver } from 'neo4j-driver'
import { tool } from 'ai'
import { z } from 'zod'

describe('MCP RAG Integration Tests', () => {
  let driver: Driver
  let rag: ReturnType<typeof createMCPRag>

  beforeAll(async () => {
    // Initialize Neo4j driver
    const uri = process.env.NEO4J_URI || 'neo4j://localhost:7687'
    const username = process.env.NEO4J_USERNAME || 'neo4j'
    const password = process.env.NEO4J_PASSWORD || 'testpassword'

    driver = neo4j.driver(uri, neo4j.auth.basic(username, password))

    // Verify connection
    await driver.verifyConnectivity()

    // Clear database
    const session = driver.session()
    try {
      await session.run('MATCH (n) DETACH DELETE n')
    } finally {
      await session.close()
    }

    // Create RAG client with test tools
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

    // Sync tools to Neo4j
    await rag.sync()
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

    // Check that weather tool was selected
    const toolCalls = result.result.toolCalls || []
    const toolNames = toolCalls.map((tc: any) => tc.toolName)

    // Should have selected get_weather based on semantic similarity
    expect(toolNames).toContain('get_weather')
  })

  it('should retrieve database tool for search query', async () => {
    const result = await rag.generateText({
      prompt: 'Find all users with premium accounts',
    })

    expect(result.result).toBeDefined()
    expect(result.result.text).toBeDefined()

    // Check that database tool was selected
    const toolCalls = result.result.toolCalls || []
    const toolNames = toolCalls.map((tc: any) => tc.toolName)

    // Should have selected search_database based on semantic similarity
    expect(toolNames).toContain('search_database')
  })

  it('should retrieve email tool for email query', async () => {
    const result = await rag.generateText({
      prompt: 'Send a message to john@example.com about the meeting',
    })

    expect(result.result).toBeDefined()
    expect(result.result.text).toBeDefined()

    // Check that email tool was selected
    const toolCalls = result.result.toolCalls || []
    const toolNames = toolCalls.map((tc: any) => tc.toolName)

    // Should have selected send_email based on semantic similarity
    expect(toolNames).toContain('send_email')
  })

  it('should allow explicit tool selection', async () => {
    const result = await rag.generateText({
      prompt: 'What is the weather?',
      activeTools: ['get_weather'],
    })

    expect(result.result).toBeDefined()
    expect(result.result.text).toBeDefined()

    // When explicitly specified, only that tool should be available
    const toolCalls = result.result.toolCalls || []
    const toolNames = toolCalls.map((tc: any) => tc.toolName)

    if (toolCalls.length > 0) {
      expect(toolNames).toContain('get_weather')
      expect(toolNames).not.toContain('search_database')
      expect(toolNames).not.toContain('send_email')
    }
  })

  it('should support streaming with RAG tool selection', async () => {
    const chunks: string[] = []

    const stream = rag.stream({
      prompt: 'What is the weather in San Francisco?',
      sessionId: 'test-session',
    })

    for await (const chunk of stream) {
      chunks.push(chunk)
    }

    const fullText = chunks.join('')
    expect(fullText.length).toBeGreaterThan(0)
  })

  it('should add and remove tools at runtime', async () => {
    // Add a new tool
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

    // Re-sync to update Neo4j
    await rag.sync()

    // Use the new tool
    const result = await rag.generateText({
      prompt: 'What is 2 + 2?',
      activeTools: ['calculate'],
    })

    expect(result.result).toBeDefined()

    // Remove the tool
    rag.removeTool('calculate')

    const updatedTools = rag.getTools()
    expect(updatedTools['calculate']).toBeUndefined()
  })

  it('should respect maxActiveTools limit', async () => {
    // Create RAG with low maxActiveTools
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
      maxActiveTools: 1, // Only select 1 tool
    })

    await limitedRag.sync()

    const result = await limitedRag.generateText({
      prompt: 'Use the tools',
    })

    expect(result.result).toBeDefined()

    // Should have selected at most 1 tool
    const toolCalls = result.result.toolCalls || []
    expect(toolCalls.length).toBeLessThanOrEqual(1)
  })
})
