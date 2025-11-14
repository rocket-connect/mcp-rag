/* eslint-disable @typescript-eslint/ban-ts-comment */
import { describe, it, expect } from 'vitest'
import { CypherBuilder } from '../../src/index'

describe('CypherBuilder', () => {
  describe('createTools', () => {
    it('should generate cypher for multiple tools without embeddings', () => {
      const tools = [
        {
          name: 'tool1',
          tool: {
            description: 'First tool',
            inputSchema: {
              type: 'object',
              properties: {
                param1: { type: 'string' },
              },
            },
          },
        },
        {
          name: 'tool2',
          tool: {
            description: 'Second tool',
            inputSchema: {
              type: 'object',
              properties: {
                param2: { type: 'number' },
              },
            },
          },
        },
      ]

      // @ts-ignore
      const result = CypherBuilder.createTools(tools)
      expect(result.cypher).toMatchSnapshot()

      expect(result.cypher).toMatchSnapshot()
      expect(result.params).toEqual({
        tool0_name: 'tool1',
        tool0_description: 'First tool',
        tool0_schema: JSON.stringify({
          type: 'object',
          properties: { param1: { type: 'string' } },
        }),
        tool1_name: 'tool2',
        tool1_description: 'Second tool',
        tool1_schema: JSON.stringify({
          type: 'object',
          properties: { param2: { type: 'number' } },
        }),
      })
    })

    it('should generate cypher for tools with embeddings', () => {
      const mockEmbedding1 = [0.1, 0.2, 0.3, 0.4, 0.5]
      const mockEmbedding2 = [0.6, 0.7, 0.8, 0.9, 1.0]

      const tools = [
        {
          name: 'tool1',
          tool: {
            description: 'First tool',
            inputSchema: {
              type: 'object',
              properties: {
                param1: { type: 'string' },
              },
            },
          },
          embedding: mockEmbedding1,
        },
        {
          name: 'tool2',
          tool: {
            description: 'Second tool',
            inputSchema: {
              type: 'object',
              properties: {
                param2: { type: 'number' },
              },
            },
          },
          embedding: mockEmbedding2,
        },
      ]

      // @ts-ignore
      const result = CypherBuilder.createTools(tools)
      expect(result.cypher).toMatchSnapshot()

      expect(result.cypher).toContain('t.embedding = $tool0_embedding')
      expect(result.cypher).toContain('t.embedding = $tool1_embedding')
      expect(result.params).toEqual({
        tool0_name: 'tool1',
        tool0_description: 'First tool',
        tool0_schema: JSON.stringify({
          type: 'object',
          properties: { param1: { type: 'string' } },
        }),
        tool0_embedding: mockEmbedding1,
        tool1_name: 'tool2',
        tool1_description: 'Second tool',
        tool1_schema: JSON.stringify({
          type: 'object',
          properties: { param2: { type: 'number' } },
        }),
        tool1_embedding: mockEmbedding2,
      })
    })

    it('should generate cypher for mixed tools with and without embeddings', () => {
      const mockEmbedding = [0.1, 0.2, 0.3]

      const tools = [
        {
          name: 'tool1',
          tool: {
            description: 'First tool with embedding',
            inputSchema: { type: 'object' },
          },
          embedding: mockEmbedding,
        },
        {
          name: 'tool2',
          tool: {
            description: 'Second tool without embedding',
            inputSchema: { type: 'object' },
          },
        },
      ]

      // @ts-ignore
      const result = CypherBuilder.createTools(tools)
      expect(result.cypher).toMatchSnapshot()

      expect(result.cypher).toContain('t.embedding = $tool0_embedding')
      expect(result.cypher).not.toContain('t.embedding = $tool1_embedding')
      expect(result.params).toEqual({
        tool0_name: 'tool1',
        tool0_description: 'First tool with embedding',
        tool0_schema: JSON.stringify({ type: 'object' }),
        tool0_embedding: mockEmbedding,
        tool1_name: 'tool2',
        tool1_description: 'Second tool without embedding',
        tool1_schema: JSON.stringify({ type: 'object' }),
      })
    })

    it('should handle empty tools array', () => {
      // @ts-ignore
      const result = CypherBuilder.createTools([])

      expect(result.cypher).toBe('')
      expect(result.params).toEqual({})
    })

    it('should handle tools with minimal properties', () => {
      const tools = [
        {
          name: 'minimal_tool',
          tool: {
            description: '',
          },
        },
      ]

      // @ts-ignore
      const result = CypherBuilder.createTools(tools)

      expect(result.cypher).toContain('MERGE (t:Tool {name: $tool0_name})')
      expect(result.params).toEqual({
        tool0_name: 'minimal_tool',
        tool0_description: '',
        tool0_schema: '{}',
      })
    })
  })

  describe('createTool', () => {
    it('should generate cypher for a single tool without embedding', () => {
      const result = CypherBuilder.createTool('single_tool', {
        description: 'A single tool',
        inputSchema: {
          // @ts-ignore
          type: 'object',
          properties: {
            input: { type: 'string' },
          },
        },
      })

      expect(result.cypher).toContain('MERGE (t:Tool {name: $tool0_name})')
      expect(result.cypher).not.toContain('t.embedding')
      expect(result.params).toEqual({
        tool0_name: 'single_tool',
        tool0_description: 'A single tool',
        tool0_schema: JSON.stringify({
          type: 'object',
          properties: { input: { type: 'string' } },
        }),
      })
    })

    it('should generate cypher for a single tool with embedding', () => {
      const mockEmbedding = [0.1, 0.2, 0.3, 0.4, 0.5]

      const result = CypherBuilder.createTool(
        'single_tool',
        {
          description: 'A single tool',
          inputSchema: {
            // @ts-ignore
            type: 'object',
            properties: {
              input: { type: 'string' },
            },
          },
        },
        mockEmbedding
      )

      expect(result.cypher).toContain('MERGE (t:Tool {name: $tool0_name})')
      expect(result.cypher).toContain('t.embedding = $tool0_embedding')
      expect(result.params).toEqual({
        tool0_name: 'single_tool',
        tool0_description: 'A single tool',
        tool0_schema: JSON.stringify({
          type: 'object',
          properties: { input: { type: 'string' } },
        }),
        tool0_embedding: mockEmbedding,
      })
    })

    it('should generate same result as createTools for single tool', () => {
      const mockEmbedding = [0.1, 0.2, 0.3]

      const singleResult = CypherBuilder.createTool(
        'test_tool',
        {
          description: 'Test tool',
          // @ts-ignore
          inputSchema: { type: 'object' },
        },
        mockEmbedding
      )

      const multiResult = CypherBuilder.createTools([
        {
          name: 'test_tool',
          tool: {
            description: 'Test tool',
            // @ts-ignore
            inputSchema: { type: 'object' },
          },
          embedding: mockEmbedding,
        },
      ])

      expect(singleResult.cypher).toBe(multiResult.cypher)
      expect(singleResult.params).toEqual(multiResult.params)
    })
  })
})
