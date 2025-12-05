import { describe, it, expect } from 'vitest'
import { CypherBuilder } from '../../src/index'
import { tool } from 'ai'
import { z } from 'zod'

const toolsetHash = 'test-toolset-hash'

const mockTool = tool({
  description: 'A test tool for searching',
  inputSchema: z.object({
    query: z.string().describe('Search query string'),
    limit: z.number().describe('Maximum number of results').optional(),
  }),
  execute: async () => ({ results: [] }),
})

const mockVector = Array(1536).fill(0.1)

// Helper to remove embedding properties from params for snapshot testing
function removeEmbeddings(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(removeEmbeddings)
  }
  if (obj !== null && typeof obj === 'object') {
    const result: any = {}
    for (const key in obj) {
      if (!key.includes('embedding')) {
        result[key] = removeEmbeddings(obj[key])
      }
    }
    return result
  }
  return obj
}

describe('CypherBuilder - Basic Operations', () => {
  describe('constructor', () => {
    it('should create instance with toolset hash', () => {
      const builder = new CypherBuilder({ toolsetHash })
      expect(builder).toBeInstanceOf(CypherBuilder)
    })
  })

  describe('createDecomposedTool', () => {
    it('should create cypher for single tool with embeddings', () => {
      const builder = new CypherBuilder({ toolsetHash })
      const result = builder.createDecomposedTool({
        name: 'searchTool',
        tool: mockTool,
        embeddings: {
          tool: mockVector,
          parameters: {
            query: mockVector,
            limit: mockVector,
          },
          returnType: mockVector,
        },
      })

      expect(removeEmbeddings(result)).toMatchSnapshot('single-tool-creation')
      expect(result.cypher).toContain('CREATE (tool:Tool')
      expect(result.cypher).toContain('CREATE (param0:Parameter')
      expect(result.cypher).toContain('CREATE (param1:Parameter')
      expect(result.cypher).toContain('CREATE (returnType:ReturnType')
      expect(result.params.tool_name).toBe('searchTool')
      expect(result.params.param0_name).toBe('query')
      expect(result.params.param1_name).toBe('limit')
    })

    it('should handle tool without optional parameters', () => {
      const builder = new CypherBuilder({ toolsetHash })
      const simpleTool = tool({
        description: 'Simple tool',
        inputSchema: z.object({
          input: z.string(),
        }),
        execute: async () => ({ status: 'ok' }),
      })

      const result = builder.createDecomposedTool({
        name: 'simpleTool',
        tool: simpleTool,
        embeddings: {
          tool: mockVector,
          parameters: { input: mockVector },
          returnType: mockVector,
        },
      })

      expect(result.cypher).toContain('CREATE (param0:Parameter')
      expect(result.params.param0_required).toBe(true)
    })
  })

  describe('createDecomposedTools', () => {
    it('should create cypher for multiple tools', () => {
      const builder = new CypherBuilder({ toolsetHash })
      const result = builder.createDecomposedTools({
        tools: [
          {
            name: 'tool1',
            tool: mockTool,
            embeddings: {
              tool: mockVector,
              parameters: { query: mockVector, limit: mockVector },
              returnType: mockVector,
            },
          },
          {
            name: 'tool2',
            tool: mockTool,
            embeddings: {
              tool: mockVector,
              parameters: { query: mockVector, limit: mockVector },
              returnType: mockVector,
            },
          },
        ],
      })

      expect(removeEmbeddings(result)).toMatchSnapshot(
        'multiple-tools-creation'
      )
      expect(result.params.t0_tool_name).toBe('tool1')
      expect(result.params.t1_tool_name).toBe('tool2')
      expect(result.params.toolset_hash).toBe(toolsetHash)
      expect(result.params.t0_toolset_hash).toBeUndefined()
      expect(result.params.t1_toolset_hash).toBeUndefined()
    })
  })

  describe('migrate/sync', () => {
    it('should create migration with toolset and tools', () => {
      const builder = new CypherBuilder({ toolsetHash })
      const result = builder.migrate({
        tools: [
          {
            name: 'searchTool',
            tool: mockTool,
            embeddings: {
              tool: mockVector,
              parameters: { query: mockVector, limit: mockVector },
              returnType: mockVector,
            },
          },
        ],
      })

      expect(removeEmbeddings(result)).toMatchSnapshot('migration-statement')
      expect(result.cypher).toContain('MERGE (toolset:ToolSet')
      expect(result.params.toolset_hash).toBe(toolsetHash)
      expect(result.params.tool_count).toBe(1)
      expect(result.params.t0_toolset_hash).toBeUndefined()
    })

    it('should sync tools (alias for migrate)', () => {
      const builder = new CypherBuilder({ toolsetHash })
      const syncResult = builder.sync({
        tools: [
          {
            name: 'tool1',
            tool: mockTool,
            embeddings: {
              tool: mockVector,
              parameters: { query: mockVector, limit: mockVector },
              returnType: mockVector,
            },
          },
        ],
      })

      const migrateResult = builder.migrate({
        tools: [
          {
            name: 'tool1',
            tool: mockTool,
            embeddings: {
              tool: mockVector,
              parameters: { query: mockVector, limit: mockVector },
              returnType: mockVector,
            },
          },
        ],
      })

      expect(syncResult.cypher).toBe(migrateResult.cypher)
    })
  })
})
