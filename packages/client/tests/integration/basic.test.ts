/* eslint-disable @typescript-eslint/ban-ts-comment */
import { describe, it, beforeAll, expect } from 'vitest'
import { createMCPRag } from '../../src/'
import { openai } from '@ai-sdk/openai'
import neo4j, { Driver } from 'neo4j-driver'
import { tool } from 'ai'
import { z } from 'zod'

describe('OpenAI Client Integration Tests', () => {
  let driver: Driver

  beforeAll(async () => {
    // Initialize Neo4j driver
    const uri = process.env.NEO4J_URI || 'neo4j://localhost:7687'
    const username = process.env.NEO4J_USERNAME || 'neo4j'
    const password = process.env.NEO4J_PASSWORD || 'testpassword'

    driver = neo4j.driver(uri, neo4j.auth.basic(username, password))

    // Verify connection
    await driver.verifyConnectivity()
  })

  it('should construct client with openai model and invoke a simple tool', async () => {
    // Define the parameter schema
    const weatherSchema = z.object({
      location: z
        .string()
        .describe('The city and state, e.g. San Francisco, CA'),
    })

    // Define a simple test tool using AI SDK's tool helper
    const testTool = tool({
      description: 'Get the current weather for a location',
      inputSchema: weatherSchema,
      // @ts-ignore
      execute: async ({ location }) => {
        // Mock weather response
        return {
          location,
          temperature: 72,
          condition: 'sunny',
        }
      },
    })

    // Create the client with OpenAI model and a single tool
    const client = createMCPRag({
      model: openai('gpt-4o-mini'),
      openaiApiKey: process.env.OPENAI_API_KEY || '',
      neo4j: driver,
      tools: {
        get_weather: testTool,
      },
      maxActiveTools: 10,
    })

    // Send a message that should invoke the tool
    const result = await client.generateText({
      prompt: "What's the weather like in San Francisco?",
      activeTools: ['get_weather'], // Explicitly activate our tool
    })

    // Assertions
    expect(result).toBeDefined()
    expect(result.result.steps).toBeDefined()
    expect(result.result.steps).toHaveLength(1)

    const step = result.result.steps[0]

    // Assert step has content
    expect(step.content).toBeDefined()
    expect(Array.isArray(step.content)).toBe(true)
    expect(step.content.length).toBeGreaterThanOrEqual(2)

    // Assert tool call was made
    const toolCall = step.content.find(c => c.type === 'tool-call')
    expect(toolCall).toBeDefined()
    expect(toolCall?.type).toBe('tool-call')
    expect(toolCall?.toolName).toBe('get_weather')
    expect(toolCall?.toolCallId).toBeDefined()
    expect(toolCall?.input).toEqual({
      location: 'San Francisco, CA',
    })

    // Assert tool result was received
    const toolResult = step.content.find(c => c.type === 'tool-result')
    expect(toolResult).toBeDefined()
    expect(toolResult?.type).toBe('tool-result')
    expect(toolResult?.toolName).toBe('get_weather')
    expect(toolResult?.toolCallId).toBe(toolCall?.toolCallId)
    expect(toolResult?.output).toEqual({
      location: 'San Francisco, CA',
      temperature: 72,
      condition: 'sunny',
    })

    // Assert finish reason
    expect(step.finishReason).toBe('tool-calls')

    // Assert usage metrics
    expect(step.usage).toBeDefined()
    expect(step.usage.inputTokens).toBeGreaterThan(0)
    expect(step.usage.outputTokens).toBeGreaterThan(0)
    expect(step.usage.totalTokens).toBe(
      (step?.usage?.inputTokens || 0) + (step?.usage?.outputTokens || 0)
    )

    // Assert request was properly formed
    expect(step.request).toBeDefined()
    expect(step.request.body).toBeDefined()
    const requestBody = step.request.body as any
    expect(requestBody.model).toBe('gpt-4o-mini')
    expect(requestBody.tools).toBeDefined()
    expect(requestBody.tools).toHaveLength(1)
    expect(requestBody.tools[0].name).toBe('get_weather')

    // Assert response metadata
    expect(step.response).toBeDefined()
    expect(step.response.id).toBeDefined()
    expect(step.response.modelId).toContain('gpt-4o-mini')
    expect(step.response.messages).toBeDefined()
    expect(step.response.messages).toHaveLength(2) // assistant message + tool message

    // Assert provider metadata
    expect(step.providerMetadata).toBeDefined()
    expect(step?.providerMetadata?.openai).toBeDefined()
    expect(step?.providerMetadata?.openai.responseId).toBeDefined()
  })
})
