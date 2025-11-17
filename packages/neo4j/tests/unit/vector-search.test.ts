import { describe, it, expect } from 'vitest'
import { CypherBuilder } from '../../src/index'

const toolsetHash = 'search-test-hash'
const mockVector = Array(1536).fill(0.3)

// Helper to remove embedding properties and queryVector from params for snapshot testing
function removeEmbeddings(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(removeEmbeddings)
  }
  if (obj !== null && typeof obj === 'object') {
    const result: any = {}
    for (const key in obj) {
      if (!key.includes('embedding')) {
        if (key === 'queryVector') {
          result[key] = '[VECTOR_PLACEHOLDER]'
        } else {
          result[key] = removeEmbeddings(obj[key])
        }
      }
    }
    return result
  }
  return obj
}

describe('CypherBuilder - Vector Search', () => {
  describe('vectorSearchDecomposed', () => {
    it('should create low depth search query', () => {
      const builder = new CypherBuilder({ toolsetHash })
      const result = builder.vectorSearchDecomposed({
        vector: mockVector,
        depth: 'low',
      })

      expect(removeEmbeddings(result)).toMatchSnapshot('vector-search-low')
      expect(result.cypher).toContain('db.index.vector.queryNodes')
      expect(result.cypher).toContain('tool.name AS name')
      expect(result.cypher).toContain('tool.description AS description')
      expect(result.params.queryVector).toEqual(mockVector)
      expect(result.params.limit).toBe(5)
    })

    it('should create mid depth search query', () => {
      const builder = new CypherBuilder({ toolsetHash })
      const result = builder.vectorSearchDecomposed({
        vector: mockVector,
        depth: 'mid',
      })

      expect(removeEmbeddings(result)).toMatchSnapshot('vector-search-mid')
      expect(result.cypher).toContain('OPTIONAL MATCH (tool)-[:HAS_PARAM]->(param:Parameter)')
      expect(result.cypher).toContain('toString(params) AS schema')
      expect(result.cypher).toContain('matches')
      expect(result.params.limit).toBe(5)
    })

    it('should create full depth search query', () => {
      const builder = new CypherBuilder({ toolsetHash })
      const result = builder.vectorSearchDecomposed({
        vector: mockVector,
        depth: 'full',
      })

      expect(removeEmbeddings(result)).toMatchSnapshot('vector-search-full')
      expect(result.cypher).toContain('OPTIONAL MATCH (tool)-[:RETURNS]->(returnType:ReturnType)')
      expect(result.cypher).toContain('toString({parameters: params, returns: returnType}) AS schema')
      expect(result.cypher).toContain('matches')
      expect(result.params.limit).toBe(5)
    })

    it('should apply custom limit', () => {
      const builder = new CypherBuilder({ toolsetHash })
      const result = builder.vectorSearchDecomposed({
        vector: mockVector,
        limit: 10,
      })

      expect(result.params.limit).toBe(10)
    })

    it('should use custom index name', () => {
      const builder = new CypherBuilder({ toolsetHash })
      const result = builder.vectorSearchDecomposed({
        vector: mockVector,
        indexName: 'custom_index',
      })

      expect(result.params.indexName).toBe('custom_index')
    })

    it('should apply minScore filter when provided', () => {
      const builder = new CypherBuilder({ toolsetHash })
      const result = builder.vectorSearchDecomposed({
        vector: mockVector,
        minScore: 0.8,
      })

      expect(result.cypher).toContain('WHERE score >= $minScore')
      expect(result.params.minScore).toBe(0.8)
    })

    it('should multiply limit by depth factor for mid depth', () => {
      const builder = new CypherBuilder({ toolsetHash })
      const result = builder.vectorSearchDecomposed({
        vector: mockVector,
        depth: 'mid',
        limit: 10,
      })

      expect(result.cypher).toContain('$limit * 3')
    })

    it('should multiply limit by depth factor for full depth', () => {
      const builder = new CypherBuilder({ toolsetHash })
      const result = builder.vectorSearchDecomposed({
        vector: mockVector,
        depth: 'full',
        limit: 10,
      })

      expect(result.cypher).toContain('$limit * 5')
    })
  })

  describe('static vector index methods', () => {
    it('should create vector index statement', () => {
      const result = CypherBuilder.createVectorIndex({
        indexName: 'tool_index',
        dimensions: 1536,
      })

      expect(removeEmbeddings(result)).toMatchSnapshot('create-vector-index')
      expect(result.cypher).toContain('CREATE VECTOR INDEX tool_index IF NOT EXISTS')
      expect(result.cypher).toContain('FOR (t:Tool)')
      expect(result.cypher).toContain('ON t.embedding')
      expect(result.params.dimensions).toBe(1536)
    })

    it('should check vector index statement', () => {
      const result = CypherBuilder.checkVectorIndex({
        indexName: 'tool_index',
      })

      expect(removeEmbeddings(result)).toMatchSnapshot('check-vector-index')
      expect(result.cypher).toContain('SHOW VECTOR INDEXES')
      expect(result.cypher).toContain('WHERE name = $indexName')
      expect(result.params.indexName).toBe('tool_index')
    })
  })

  describe('search result structure', () => {
    it('should return name, description, and relevance for low depth', () => {
      const builder = new CypherBuilder({ toolsetHash })
      const result = builder.vectorSearchDecomposed({
        vector: mockVector,
        depth: 'low',
      })

      expect(result.cypher).toContain('tool.name AS name')
      expect(result.cypher).toContain('tool.description AS description')
      expect(result.cypher).toContain('score AS relevance')
      expect(result.cypher).toContain("'tool' AS component")
    })

    it('should include matches array for mid depth', () => {
      const builder = new CypherBuilder({ toolsetHash })
      const result = builder.vectorSearchDecomposed({
        vector: mockVector,
        depth: 'mid',
      })

      expect(result.cypher).toContain('COLLECT(DISTINCT {component: matchComponent, score: matchScore}) AS matches')
    })

    it('should include matches array for full depth', () => {
      const builder = new CypherBuilder({ toolsetHash })
      const result = builder.vectorSearchDecomposed({
        vector: mockVector,
        depth: 'full',
      })

      expect(result.cypher).toContain('COLLECT(DISTINCT {component: matchComponent, score: matchScore}) AS matches')
    })
  })
})