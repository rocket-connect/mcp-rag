/* eslint-disable @typescript-eslint/ban-ts-comment */
import { describe, it, expect, vi } from 'vitest'
import { createMCPRag } from '../../src/index'
import type { Tool } from 'ai'
import type { Driver } from 'neo4j-driver'

// Mock tools for testing
const mockTool: Tool = {
  description: 'A test tool',
  // @ts-ignore
  inputSchema: {
    // @ts-ignore
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The query string' },
    },
  },
}

const mockToolWithDifferentDescription: Tool = {
  description: 'A different description',
  // @ts-ignore
  inputSchema: {
    // @ts-ignore
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The query string' },
    },
  },
}

const mockToolWithDifferentParam: Tool = {
  description: 'A test tool',
  // @ts-ignore
  inputSchema: {
    // @ts-ignore
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Updated query description' },
    },
  },
}

const mockToolWithExtraParam: Tool = {
  description: 'A test tool',
  // @ts-ignore
  inputSchema: {
    // @ts-ignore
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The query string' },
      limit: { type: 'number', description: 'Max results' },
    },
  },
}

// Create a mock Neo4j driver
const createMockDriver = (): Driver => {
  return {
    session: vi.fn(() => ({
      run: vi.fn().mockResolvedValue({ records: [] }),
      close: vi.fn().mockResolvedValue(undefined),
    })),
    close: vi.fn().mockResolvedValue(undefined),
    verifyConnectivity: vi.fn().mockResolvedValue(undefined),
  } as unknown as Driver
}

describe('Hash Function', () => {
  describe('custom hashFunction', () => {
    it('should use the custom hash function when provided', () => {
      const customHashFn = vi.fn((input: string) => `custom-${input.length}`)
      const driver = createMockDriver()

      const client = createMCPRag({
        // @ts-ignore - mock model
        model: {},
        neo4j: driver,
        tools: { toolA: mockTool, toolB: mockTool },
        openaiApiKey: 'test-key',
        hashFunction: customHashFn,
      })

      const hash = client.getToolsetHash()

      // The custom function should have been called
      expect(customHashFn).toHaveBeenCalled()
      // Hash should match our custom format
      expect(hash).toMatch(/^custom-\d+$/)
    })

    it('should pass JSON string of sorted tools to hash function', () => {
      let receivedInput = ''
      const customHashFn = vi.fn((input: string) => {
        receivedInput = input
        return `hash`
      })
      const driver = createMockDriver()

      createMCPRag({
        // @ts-ignore - mock model
        model: {},
        neo4j: driver,
        tools: {
          zebra: mockTool,
          alpha: mockTool,
        },
        openaiApiKey: 'test-key',
        hashFunction: customHashFn,
      })

      // Should be valid JSON
      const parsed = JSON.parse(receivedInput)

      // Tools should be sorted lexicographically
      const keys = Object.keys(parsed)
      expect(keys).toEqual(['alpha', 'zebra'])

      // Should contain tool definitions
      expect(parsed.alpha).toHaveProperty('description')
      expect(parsed.alpha).toHaveProperty('inputSchema')
      expect(parsed.zebra).toHaveProperty('description')
      expect(parsed.zebra).toHaveProperty('inputSchema')
    })

    it('should include full tool schema in hash input', () => {
      let receivedInput = ''
      const customHashFn = vi.fn((input: string) => {
        receivedInput = input
        return `hash`
      })
      const driver = createMockDriver()

      createMCPRag({
        // @ts-ignore - mock model
        model: {},
        neo4j: driver,
        tools: { myTool: mockTool },
        openaiApiKey: 'test-key',
        hashFunction: customHashFn,
      })

      const parsed = JSON.parse(receivedInput)

      // Verify full schema is included
      expect(parsed.myTool.description).toBe('A test tool')
      expect(parsed.myTool.inputSchema.type).toBe('object')
      expect(parsed.myTool.inputSchema.properties.query.type).toBe('string')
      expect(parsed.myTool.inputSchema.properties.query.description).toBe(
        'The query string'
      )
    })

    it('should return custom hash value from hash function', () => {
      const expectedHash = 'my-custom-hash-abc123'
      const customHashFn = vi.fn(() => expectedHash)
      const driver = createMockDriver()

      const client = createMCPRag({
        // @ts-ignore - mock model
        model: {},
        neo4j: driver,
        tools: { tool1: mockTool },
        openaiApiKey: 'test-key',
        hashFunction: customHashFn,
      })

      expect(client.getToolsetHash()).toBe(expectedHash)
    })
  })

  describe('default hash function', () => {
    it('should generate deterministic hash without custom function', () => {
      const driver = createMockDriver()

      const client1 = createMCPRag({
        // @ts-ignore - mock model
        model: {},
        neo4j: driver,
        tools: { toolA: mockTool, toolB: mockTool },
        openaiApiKey: 'test-key',
      })

      const client2 = createMCPRag({
        // @ts-ignore - mock model
        model: {},
        neo4j: driver,
        tools: { toolB: mockTool, toolA: mockTool }, // Different order
        openaiApiKey: 'test-key',
      })

      // Should produce same hash regardless of tool order
      expect(client1.getToolsetHash()).toBe(client2.getToolsetHash())
    })

    it('should produce different hashes for different toolsets', () => {
      const driver = createMockDriver()

      const client1 = createMCPRag({
        // @ts-ignore - mock model
        model: {},
        neo4j: driver,
        tools: { toolA: mockTool },
        openaiApiKey: 'test-key',
      })

      const client2 = createMCPRag({
        // @ts-ignore - mock model
        model: {},
        neo4j: driver,
        tools: { toolB: mockTool },
        openaiApiKey: 'test-key',
      })

      expect(client1.getToolsetHash()).not.toBe(client2.getToolsetHash())
    })

    it('should use toolset- prefix for default hash', () => {
      const driver = createMockDriver()

      const client = createMCPRag({
        // @ts-ignore - mock model
        model: {},
        neo4j: driver,
        tools: { myTool: mockTool },
        openaiApiKey: 'test-key',
      })

      expect(client.getToolsetHash()).toMatch(/^toolset-[a-f0-9]+$/)
    })
  })

  describe('hash changes on tool definition changes', () => {
    it('should produce different hash when tool description changes', () => {
      const driver = createMockDriver()

      const client1 = createMCPRag({
        // @ts-ignore - mock model
        model: {},
        neo4j: driver,
        tools: { myTool: mockTool },
        openaiApiKey: 'test-key',
      })

      const client2 = createMCPRag({
        // @ts-ignore - mock model
        model: {},
        neo4j: driver,
        tools: { myTool: mockToolWithDifferentDescription },
        openaiApiKey: 'test-key',
      })

      expect(client1.getToolsetHash()).not.toBe(client2.getToolsetHash())
    })

    it('should produce different hash when parameter description changes', () => {
      const driver = createMockDriver()

      const client1 = createMCPRag({
        // @ts-ignore - mock model
        model: {},
        neo4j: driver,
        tools: { myTool: mockTool },
        openaiApiKey: 'test-key',
      })

      const client2 = createMCPRag({
        // @ts-ignore - mock model
        model: {},
        neo4j: driver,
        tools: { myTool: mockToolWithDifferentParam },
        openaiApiKey: 'test-key',
      })

      expect(client1.getToolsetHash()).not.toBe(client2.getToolsetHash())
    })

    it('should produce different hash when parameter is added', () => {
      const driver = createMockDriver()

      const client1 = createMCPRag({
        // @ts-ignore - mock model
        model: {},
        neo4j: driver,
        tools: { myTool: mockTool },
        openaiApiKey: 'test-key',
      })

      const client2 = createMCPRag({
        // @ts-ignore - mock model
        model: {},
        neo4j: driver,
        tools: { myTool: mockToolWithExtraParam },
        openaiApiKey: 'test-key',
      })

      expect(client1.getToolsetHash()).not.toBe(client2.getToolsetHash())
    })
  })

  describe('hash updates on tool changes', () => {
    it('should update hash when tool is added', () => {
      const driver = createMockDriver()

      const client = createMCPRag({
        // @ts-ignore - mock model
        model: {},
        neo4j: driver,
        tools: { alpha: mockTool },
        openaiApiKey: 'test-key',
      })

      const initialHash = client.getToolsetHash()

      // Add a new tool
      client.addTool('beta', mockTool)

      const newHash = client.getToolsetHash()
      expect(newHash).not.toBe(initialHash)
    })

    it('should update hash when tool is removed', () => {
      const driver = createMockDriver()

      const client = createMCPRag({
        // @ts-ignore - mock model
        model: {},
        neo4j: driver,
        tools: { alpha: mockTool, beta: mockTool },
        openaiApiKey: 'test-key',
      })

      const initialHash = client.getToolsetHash()

      // Remove a tool
      client.removeTool('alpha')

      const newHash = client.getToolsetHash()
      expect(newHash).not.toBe(initialHash)
    })

    it('should produce same hash after adding and removing same tool', () => {
      const driver = createMockDriver()

      const client = createMCPRag({
        // @ts-ignore - mock model
        model: {},
        neo4j: driver,
        tools: { alpha: mockTool },
        openaiApiKey: 'test-key',
      })

      const initialHash = client.getToolsetHash()

      // Add then remove
      client.addTool('beta', mockTool)
      client.removeTool('beta')

      expect(client.getToolsetHash()).toBe(initialHash)
    })
  })

  describe('getToolsetHash', () => {
    it('should return current hash', () => {
      const driver = createMockDriver()

      const client = createMCPRag({
        // @ts-ignore - mock model
        model: {},
        neo4j: driver,
        tools: { tool1: mockTool },
        openaiApiKey: 'test-key',
        hashFunction: () => 'static-hash',
      })

      expect(client.getToolsetHash()).toBe('static-hash')
    })
  })

  describe('deep sorting of nested properties', () => {
    it('should produce same hash regardless of nested property order', () => {
      const driver = createMockDriver()

      // Tool with properties in one order
      const toolPropsOrderA: Tool = {
        description: 'A test tool',
        // @ts-ignore
        inputSchema: {
          // @ts-ignore
          type: 'object',
          properties: {
            alpha: { type: 'string', description: 'First param' },
            beta: { type: 'number', description: 'Second param' },
          },
        },
      }

      // Same tool with properties in different order
      const toolPropsOrderB: Tool = {
        description: 'A test tool',
        // @ts-ignore
        inputSchema: {
          // @ts-ignore
          type: 'object',
          properties: {
            beta: { type: 'number', description: 'Second param' },
            alpha: { type: 'string', description: 'First param' },
          },
        },
      }

      const client1 = createMCPRag({
        // @ts-ignore - mock model
        model: {},
        neo4j: driver,
        tools: { myTool: toolPropsOrderA },
        openaiApiKey: 'test-key',
      })

      const client2 = createMCPRag({
        // @ts-ignore - mock model
        model: {},
        neo4j: driver,
        tools: { myTool: toolPropsOrderB },
        openaiApiKey: 'test-key',
      })

      // Should produce same hash regardless of property order
      expect(client1.getToolsetHash()).toBe(client2.getToolsetHash())
    })

    it('should produce same hash when deeply nested properties are in different order', () => {
      const driver = createMockDriver()

      // Tool with deeply nested properties in one order
      const toolDeepOrderA: Tool = {
        description: 'Complex tool',
        // @ts-ignore
        inputSchema: {
          // @ts-ignore
          type: 'object',
          properties: {
            config: {
              type: 'object',
              properties: {
                zebra: { type: 'string' },
                apple: { type: 'number' },
              },
            },
          },
        },
      }

      // Same tool with deeply nested properties in different order
      const toolDeepOrderB: Tool = {
        description: 'Complex tool',
        // @ts-ignore
        inputSchema: {
          // @ts-ignore
          type: 'object',
          properties: {
            config: {
              type: 'object',
              properties: {
                apple: { type: 'number' },
                zebra: { type: 'string' },
              },
            },
          },
        },
      }

      const client1 = createMCPRag({
        // @ts-ignore - mock model
        model: {},
        neo4j: driver,
        tools: { myTool: toolDeepOrderA },
        openaiApiKey: 'test-key',
      })

      const client2 = createMCPRag({
        // @ts-ignore - mock model
        model: {},
        neo4j: driver,
        tools: { myTool: toolDeepOrderB },
        openaiApiKey: 'test-key',
      })

      // Should produce same hash regardless of deeply nested property order
      expect(client1.getToolsetHash()).toBe(client2.getToolsetHash())
    })

    it('should sort nested JSON in hash input for custom hash function', () => {
      let receivedInput = ''
      const customHashFn = vi.fn((input: string) => {
        receivedInput = input
        return 'hash'
      })
      const driver = createMockDriver()

      // Tool with properties in reverse alphabetical order
      const tool: Tool = {
        description: 'A tool',
        // @ts-ignore
        inputSchema: {
          // @ts-ignore
          type: 'object',
          properties: {
            zebra: { type: 'string', description: 'Z param' },
            apple: { type: 'number', description: 'A param' },
          },
        },
      }

      createMCPRag({
        // @ts-ignore - mock model
        model: {},
        neo4j: driver,
        tools: { myTool: tool },
        openaiApiKey: 'test-key',
        hashFunction: customHashFn,
      })

      const parsed = JSON.parse(receivedInput)

      // Verify nested properties are sorted (apple before zebra)
      const propKeys = Object.keys(parsed.myTool.inputSchema.properties)
      expect(propKeys).toEqual(['apple', 'zebra'])
    })
  })
})
