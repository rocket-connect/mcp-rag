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

      expect(result.cypher).toContain('MERGE (t0:Tool {name: $tool0_name})')
      expect(result.cypher).toContain('SET t0.name = $tool0_name')
      expect(result.cypher).toContain('MERGE (t1:Tool {name: $tool1_name})')
      expect(result.cypher).toContain('SET t1.name = $tool1_name')

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

      // Verify unique variable names with embeddings (t0, t1)
      expect(result.cypher).toContain('MERGE (t0:Tool {name: $tool0_name})')
      expect(result.cypher).toContain('t0.embedding = $tool0_embedding')
      expect(result.cypher).toContain('MERGE (t1:Tool {name: $tool1_name})')
      expect(result.cypher).toContain('t1.embedding = $tool1_embedding')

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
      const mockEmbedding = [0.1, 0.2, 0.3, 0.4, 0.5]

      const tools = [
        {
          name: 'tool1',
          tool: {
            description: 'First tool',
            inputSchema: { type: 'object', properties: {} },
          },
          embedding: mockEmbedding,
        },
        {
          name: 'tool2',
          tool: {
            description: 'Second tool',
            inputSchema: { type: 'object', properties: {} },
          },
        },
      ]

      // @ts-ignore
      const result = CypherBuilder.createTools(tools)
      expect(result.cypher).toMatchSnapshot()

      // Tool1 should have embedding
      expect(result.cypher).toContain('t0.embedding = $tool0_embedding')
      // Tool2 should NOT have embedding
      expect(result.cypher).not.toContain('t1.embedding')

      expect(result.params.tool0_embedding).toEqual(mockEmbedding)
      expect(result.params.tool1_embedding).toBeUndefined()
    })
  })

  describe('vectorSearch', () => {
    const mockVector = [0.1, 0.2, 0.3, 0.4, 0.5]

    it('should generate basic vector search query', () => {
      const result = CypherBuilder.vectorSearch({
        vector: mockVector,
      })

      expect(result.cypher).toMatchSnapshot()
      expect(result.cypher).toContain(
        'CALL db.index.vector.queryNodes($indexName, $limit, $queryVector)'
      )
      expect(result.cypher).toContain('YIELD node, score')
      expect(result.cypher).toContain('RETURN node.name AS name')
      expect(result.cypher).toContain('ORDER BY score DESC')

      expect(result.params).toEqual({
        queryVector: mockVector,
        limit: 10,
        indexName: 'tool_embeddings',
      })
    })

    it('should generate vector search with custom limit', () => {
      const result = CypherBuilder.vectorSearch({
        vector: mockVector,
        limit: 5,
      })

      expect(result.cypher).toMatchSnapshot()
      expect(result.params.limit).toBe(5)
    })

    it('should generate vector search with custom index name', () => {
      const result = CypherBuilder.vectorSearch({
        vector: mockVector,
        indexName: 'custom_index',
      })

      expect(result.cypher).toMatchSnapshot()
      expect(result.params.indexName).toBe('custom_index')
    })

    it('should generate vector search filtered by IDs', () => {
      const result = CypherBuilder.vectorSearch({
        vector: mockVector,
        filterByIds: ['id1', 'id2', 'id3'],
      })

      expect(result.cypher).toMatchSnapshot()
      expect(result.cypher).toContain('WHERE node.id IN $filterIds')
      expect(result.params.filterIds).toEqual(['id1', 'id2', 'id3'])
    })

    it('should generate vector search filtered by names', () => {
      const result = CypherBuilder.vectorSearch({
        vector: mockVector,
        filterByNames: ['tool1', 'tool2'],
      })

      expect(result.cypher).toMatchSnapshot()
      expect(result.cypher).toContain('WHERE node.name IN $filterNames')
      expect(result.params.filterNames).toEqual(['tool1', 'tool2'])
    })

    it('should generate vector search with minimum score filter', () => {
      const result = CypherBuilder.vectorSearch({
        vector: mockVector,
        minScore: 0.8,
      })

      expect(result.cypher).toMatchSnapshot()
      expect(result.cypher).toContain('WHERE score >= $minScore')
      expect(result.params.minScore).toBe(0.8)
    })

    it('should generate vector search with multiple filters', () => {
      const result = CypherBuilder.vectorSearch({
        vector: mockVector,
        limit: 20,
        filterByIds: ['id1', 'id2'],
        filterByNames: ['tool1', 'tool2', 'tool3'],
        minScore: 0.75,
      })

      expect(result.cypher).toMatchSnapshot()
      expect(result.cypher).toContain(
        'WHERE node.id IN $filterIds AND node.name IN $filterNames AND score >= $minScore'
      )
      expect(result.params).toEqual({
        queryVector: mockVector,
        limit: 20,
        indexName: 'tool_embeddings',
        filterIds: ['id1', 'id2'],
        filterNames: ['tool1', 'tool2', 'tool3'],
        minScore: 0.75,
      })
    })

    it('should generate vector search with ID and score filters only', () => {
      const result = CypherBuilder.vectorSearch({
        vector: mockVector,
        filterByIds: ['id1'],
        minScore: 0.9,
      })

      expect(result.cypher).toMatchSnapshot()
      expect(result.cypher).toContain(
        'WHERE node.id IN $filterIds AND score >= $minScore'
      )
      expect(result.params.filterNames).toBeUndefined()
    })

    it('should generate vector search with name and score filters only', () => {
      const result = CypherBuilder.vectorSearch({
        vector: mockVector,
        filterByNames: ['tool1'],
        minScore: 0.85,
      })

      expect(result.cypher).toMatchSnapshot()
      expect(result.cypher).toContain(
        'WHERE node.name IN $filterNames AND score >= $minScore'
      )
      expect(result.params.filterIds).toBeUndefined()
    })

    it('should handle empty filter arrays gracefully', () => {
      const result = CypherBuilder.vectorSearch({
        vector: mockVector,
        filterByIds: [],
        filterByNames: [],
      })

      expect(result.cypher).toMatchSnapshot()
      expect(result.cypher).not.toContain('WHERE')
      expect(result.params.filterIds).toBeUndefined()
      expect(result.params.filterNames).toBeUndefined()
    })
  })

  describe('createVectorIndex', () => {
    it('should generate cypher to create vector index with cosine similarity', () => {
      const result = CypherBuilder.createVectorIndex('tool_embeddings', 1536)

      expect(result.cypher).toMatchSnapshot()
      expect(result.cypher).toContain('CREATE VECTOR INDEX tool_embeddings')
      expect(result.cypher).toContain('IF NOT EXISTS')
      expect(result.cypher).toContain('FOR (t:Tool)')
      expect(result.cypher).toContain('ON t.embedding')
      expect(result.cypher).toContain('`vector.dimensions`: $dimensions')
      expect(result.cypher).toContain("`vector.similarity_function`: 'cosine'")

      expect(result.params).toEqual({
        dimensions: 1536,
      })
    })

    it('should generate cypher to create vector index with euclidean similarity', () => {
      const result = CypherBuilder.createVectorIndex('tool_embeddings', 768)

      expect(result.cypher).toMatchSnapshot()
      expect(result.params).toEqual({
        dimensions: 768,
      })
    })

    it('should generate cypher to create vector index with custom name', () => {
      const result = CypherBuilder.createVectorIndex('my_custom_index', 256)

      expect(result.cypher).toMatchSnapshot()
      expect(result.cypher).toContain('CREATE VECTOR INDEX my_custom_index')
    })
  })

  describe('checkVectorIndex', () => {
    it('should generate cypher to check vector index status', () => {
      const result = CypherBuilder.checkVectorIndex('tool_embeddings')

      expect(result.cypher).toMatchSnapshot()
      expect(result.cypher).toContain('SHOW VECTOR INDEXES')
      expect(result.cypher).toContain('WHERE name = $indexName')
      expect(result.cypher).toContain('RETURN name, state, type')

      expect(result.params).toEqual({
        indexName: 'tool_embeddings',
      })
    })
  })
})
