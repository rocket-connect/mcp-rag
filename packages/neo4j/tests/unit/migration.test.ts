import { describe, it, expect } from 'vitest'
import { CypherBuilder } from '../../src/index'
import { tool } from 'ai'
import { z } from 'zod'

const toolsetHash = 'migration-test-hash'

const mockTool = tool({
  description: 'Migration test tool',
  inputSchema: z.object({
    action: z.string().describe('Action to perform'),
    target: z.string().describe('Target resource').optional(),
  }),
  execute: async () => ({ status: 'ok' }),
})

const mockVector = Array(1536).fill(0.2)

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

describe('CypherBuilder - Migration', () => {
  describe('migrate with multiple tools', () => {
    it('should create complete migration for empty toolset', () => {
      const builder = new CypherBuilder({ toolsetHash })
      const result = builder.migrate({ tools: [] })

      expect(removeEmbeddings(result)).toMatchSnapshot('empty-migration')
      expect(result.cypher).toContain('MERGE (toolset:ToolSet')
      expect(result.params.tool_count).toBe(0)
    })

    it('should create migration for single tool', () => {
      const builder = new CypherBuilder({ toolsetHash })
      const result = builder.migrate({
        tools: [
          {
            name: 'migrateTest',
            tool: mockTool,
            embeddings: {
              tool: mockVector,
              parameters: { action: mockVector, target: mockVector },
              returnType: mockVector,
            },
          },
        ],
      })

      expect(removeEmbeddings(result)).toMatchSnapshot('single-tool-migration')
      expect(result.params.tool_count).toBe(1)
      expect(result.params.t0_tool_name).toBe('migrateTest')
      expect(result.params.t0_toolset_hash).toBeUndefined()
    })

    it('should create migration for three tools', () => {
      const builder = new CypherBuilder({ toolsetHash })
      const result = builder.migrate({
        tools: [
          {
            name: 'toolA',
            tool: mockTool,
            embeddings: {
              tool: mockVector,
              parameters: { action: mockVector, target: mockVector },
              returnType: mockVector,
            },
          },
          {
            name: 'toolB',
            tool: mockTool,
            embeddings: {
              tool: mockVector,
              parameters: { action: mockVector, target: mockVector },
              returnType: mockVector,
            },
          },
          {
            name: 'toolC',
            tool: mockTool,
            embeddings: {
              tool: mockVector,
              parameters: { action: mockVector, target: mockVector },
              returnType: mockVector,
            },
          },
        ],
      })

      expect(removeEmbeddings(result)).toMatchSnapshot('multi-tool-migration')
      expect(result.params.tool_count).toBe(3)
      expect(result.params.t0_tool_name).toBe('toolA')
      expect(result.params.t1_tool_name).toBe('toolB')
      expect(result.params.t2_tool_name).toBe('toolC')
      expect(result.params.t0_toolset_hash).toBeUndefined()
      expect(result.params.t1_toolset_hash).toBeUndefined()
      expect(result.params.t2_toolset_hash).toBeUndefined()
    })
  })

  describe('parameter handling', () => {
    it('should handle tools with no parameters', () => {
      const builder = new CypherBuilder({ toolsetHash })
      const noParamTool = tool({
        description: 'Tool with no parameters',
        inputSchema: z.object({}),
        execute: async () => ({ status: 'ok' }),
      })

      const result = builder.migrate({
        tools: [
          {
            name: 'noParamTool',
            tool: noParamTool,
            embeddings: {
              tool: mockVector,
              parameters: {},
              returnType: mockVector,
            },
          },
        ],
      })

      expect(result.cypher).toContain('CREATE (tool:Tool')
      expect(result.cypher).toContain('CREATE (returnType:ReturnType')
      expect(result.cypher).not.toContain('CREATE (param0:Parameter')
    })

    it('should handle tools with many parameters', () => {
      const builder = new CypherBuilder({ toolsetHash })
      const manyParamTool = tool({
        description: 'Tool with many parameters',
        inputSchema: z.object({
          param1: z.string(),
          param2: z.number().optional(),
          param3: z.boolean(),
          param4: z.string().optional(),
          param5: z.array(z.string()).optional(),
        }),
        execute: async () => ({ status: 'ok' }),
      })

      const result = builder.migrate({
        tools: [
          {
            name: 'manyParamTool',
            tool: manyParamTool,
            embeddings: {
              tool: mockVector,
              parameters: {
                param1: mockVector,
                param2: mockVector,
                param3: mockVector,
                param4: mockVector,
                param5: mockVector,
              },
              returnType: mockVector,
            },
          },
        ],
      })

      // Verify we have 5 parameters created
      // Check that required/optional status is properly set
      const paramNames = [
        result.params.t0_param0_name,
        result.params.t0_param1_name,
        result.params.t0_param2_name,
        result.params.t0_param3_name,
        result.params.t0_param4_name,
      ]
      expect(paramNames).toContain('param1')
      expect(paramNames).toContain('param2')
      expect(paramNames).toContain('param3')
      expect(paramNames).toContain('param4')
      expect(paramNames).toContain('param5')

      // Find param1 and param3 (required) and param2 (optional)
      const findParamIndex = (name: string) =>
        paramNames.findIndex(n => n === name)
      const param1Idx = findParamIndex('param1')
      const param2Idx = findParamIndex('param2')
      const param3Idx = findParamIndex('param3')

      expect(result.params[`t0_param${param1Idx}_required`]).toBe(true)
      expect(result.params[`t0_param${param2Idx}_required`]).toBe(false)
      expect(result.params[`t0_param${param3Idx}_required`]).toBe(true)
    })
  })

  describe('toolset management', () => {
    it('should include toolset hash in migration', () => {
      const builder = new CypherBuilder({ toolsetHash })
      const result = builder.migrate({
        tools: [
          {
            name: 'test',
            tool: mockTool,
            embeddings: {
              tool: mockVector,
              parameters: { action: mockVector, target: mockVector },
              returnType: mockVector,
            },
          },
        ],
      })

      expect(result.params.toolset_hash).toBe(toolsetHash)
      expect(result.params.t0_toolset_hash).toBeUndefined()
    })

    it('should set updatedAt and toolCount on toolset', () => {
      const builder = new CypherBuilder({ toolsetHash })
      const result = builder.migrate({ tools: [] })

      expect(result.cypher).toContain('SET toolset.updatedAt = datetime()')
      expect(result.cypher).toContain('toolset.toolCount = $tool_count')
    })
  })

  describe('getToolsetByHash', () => {
    it('should generate cypher to get toolset with all related nodes', () => {
      const builder = new CypherBuilder({ toolsetHash })
      const result = builder.getToolsetByHash()

      expect(result).toMatchSnapshot('get-toolset-by-hash')
      expect(result.cypher).toContain(
        'MATCH (toolset:ToolSet {hash: $toolset_hash})'
      )
      expect(result.cypher).toContain(
        'OPTIONAL MATCH (toolset)-[:HAS_TOOL]->(tool:Tool)'
      )
      expect(result.cypher).toContain(
        'OPTIONAL MATCH (tool)-[:HAS_PARAM]->(param:Parameter)'
      )
      expect(result.cypher).toContain(
        'OPTIONAL MATCH (tool)-[:RETURNS]->(returnType:ReturnType)'
      )
      expect(result.params.toolset_hash).toBe(toolsetHash)
    })

    it('should return toolset metadata fields', () => {
      const builder = new CypherBuilder({ toolsetHash })
      const result = builder.getToolsetByHash()

      expect(result.cypher).toContain('toolset.hash AS hash')
      expect(result.cypher).toContain('toolset.updatedAt AS updatedAt')
      expect(result.cypher).toContain('toolset.toolCount AS toolCount')
      expect(result.cypher).toContain('tools')
    })

    it('should collect tool structure with parameters and return types', () => {
      const builder = new CypherBuilder({ toolsetHash })
      const result = builder.getToolsetByHash()

      expect(result.cypher).toContain('name: tool.name')
      expect(result.cypher).toContain('description: tool.description')
      expect(result.cypher).toContain('parameters: params')
      expect(result.cypher).toContain('returnType:')
    })
  })

  describe('deleteToolsetByHash', () => {
    it('should generate cypher to delete toolset and all related nodes', () => {
      const builder = new CypherBuilder({ toolsetHash })
      const result = builder.deleteToolsetByHash()

      expect(result).toMatchSnapshot('delete-toolset-by-hash')
      expect(result.cypher).toContain(
        'MATCH (toolset:ToolSet {hash: $toolset_hash})'
      )
      expect(result.cypher).toContain(
        'OPTIONAL MATCH (toolset)-[:HAS_TOOL]->(tool:Tool)'
      )
      expect(result.cypher).toContain(
        'OPTIONAL MATCH (tool)-[:HAS_PARAM]->(param:Parameter)'
      )
      expect(result.cypher).toContain(
        'OPTIONAL MATCH (tool)-[:RETURNS]->(returnType:ReturnType)'
      )
      expect(result.params.toolset_hash).toBe(toolsetHash)
    })

    it('should use DETACH DELETE via FOREACH for related nodes and direct delete for toolset', () => {
      const builder = new CypherBuilder({ toolsetHash })
      const result = builder.deleteToolsetByHash()

      expect(result.cypher).toContain('FOREACH (t IN tools | DETACH DELETE t)')
      expect(result.cypher).toContain('FOREACH (p IN params | DETACH DELETE p)')
      expect(result.cypher).toContain(
        'FOREACH (r IN returnTypes | DETACH DELETE r)'
      )
      expect(result.cypher).toContain('DETACH DELETE toolset')
    })

    it('should return deletion counts for verification', () => {
      const builder = new CypherBuilder({ toolsetHash })
      const result = builder.deleteToolsetByHash()

      expect(result.cypher).toContain('deletedToolsets')
      expect(result.cypher).toContain('deletedTools')
      expect(result.cypher).toContain('deletedParams')
      expect(result.cypher).toContain('deletedReturnTypes')
    })
  })
})
