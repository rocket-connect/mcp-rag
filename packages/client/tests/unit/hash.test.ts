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
    type: 'object',
    properties: {
      query: { type: 'string' },
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

    it('should pass lexicographically sorted tool names to hash function', () => {
      let receivedInput = ''
      const customHashFn = vi.fn((input: string) => {
        receivedInput = input
        return `hash-${input}`
      })
      const driver = createMockDriver()

      createMCPRag({
        // @ts-ignore - mock model
        model: {},
        neo4j: driver,
        tools: {
          zebra: mockTool,
          alpha: mockTool,
          beta: mockTool,
        },
        openaiApiKey: 'test-key',
        hashFunction: customHashFn,
      })

      // Tools should be sorted lexicographically: alpha, beta, zebra
      expect(receivedInput).toBe('alpha,beta,zebra')
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

  describe('hash updates on tool changes', () => {
    it('should update hash when tool is added', () => {
      const hashCalls: string[] = []
      const customHashFn = vi.fn((input: string) => {
        hashCalls.push(input)
        return `hash-${input.replace(/,/g, '-')}`
      })
      const driver = createMockDriver()

      const client = createMCPRag({
        // @ts-ignore - mock model
        model: {},
        neo4j: driver,
        tools: { alpha: mockTool },
        openaiApiKey: 'test-key',
        hashFunction: customHashFn,
      })

      const initialHash = client.getToolsetHash()
      expect(initialHash).toBe('hash-alpha')

      // Add a new tool
      client.addTool('beta', mockTool)

      const newHash = client.getToolsetHash()
      expect(newHash).toBe('hash-alpha-beta')
      expect(newHash).not.toBe(initialHash)
    })

    it('should update hash when tool is removed', () => {
      const customHashFn = vi.fn(
        (input: string) => `hash-${input.replace(/,/g, '-')}`
      )
      const driver = createMockDriver()

      const client = createMCPRag({
        // @ts-ignore - mock model
        model: {},
        neo4j: driver,
        tools: { alpha: mockTool, beta: mockTool },
        openaiApiKey: 'test-key',
        hashFunction: customHashFn,
      })

      expect(client.getToolsetHash()).toBe('hash-alpha-beta')

      // Remove a tool
      client.removeTool('alpha')

      expect(client.getToolsetHash()).toBe('hash-beta')
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
})
