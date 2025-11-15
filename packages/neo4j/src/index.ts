import type { Tool } from 'ai'

export interface CypherStatement {
  cypher: string
  params: Record<string, any>
}

export interface ToolInput {
  name: string
  tool: Tool
  embedding?: number[]
}

export interface VectorSearchOptions {
  vector: number[]
  limit?: number
  indexName?: string
  filterByIds?: string[]
  filterByNames?: string[]
  minScore?: number
}

export class CypherBuilder {
  /**
   * Generate Cypher MERGE statements for multiple tools with optional embeddings
   * @param tools - Array of tools with names, tool objects, and optional embeddings
   * @returns Cypher statement with parameters
   */
  static createTools(tools: ToolInput[]): CypherStatement {
    const statements: string[] = []
    const params: Record<string, unknown> = {}

    tools.forEach((toolInput, index) => {
      const { name, tool, embedding } = toolInput
      const paramPrefix = `tool${index}`
      const varName = `t${index}` // Use unique variable name for each tool

      params[`${paramPrefix}_name`] = name
      params[`${paramPrefix}_description`] = tool.description || ''
      params[`${paramPrefix}_schema`] = JSON.stringify(tool.inputSchema || {})

      // Add embedding parameter if provided
      if (embedding) {
        params[`${paramPrefix}_embedding`] = embedding
      }

      // Build the SET clause conditionally based on whether embedding is provided
      const setClause = embedding
        ? `SET ${varName}.name = $${paramPrefix}_name,
            ${varName}.description = $${paramPrefix}_description,
            ${varName}.schema = $${paramPrefix}_schema,
            ${varName}.embedding = $${paramPrefix}_embedding,
            ${varName}.updatedAt = datetime()`
        : `SET ${varName}.name = $${paramPrefix}_name,
            ${varName}.description = $${paramPrefix}_description,
            ${varName}.schema = $${paramPrefix}_schema,
            ${varName}.updatedAt = datetime()`

      statements.push(`
      MERGE (${varName}:Tool {name: $${paramPrefix}_name})
      ${setClause}`)
    })

    return {
      cypher: statements.join('\n'),
      params,
    }
  }

  /**
   * Generate Cypher MERGE statement for a single tool with optional embedding
   * @param name - Tool name
   * @param tool - Tool object
   * @param embedding - Optional embedding vector
   * @returns Cypher statement with parameters
   */
  static createTool(
    name: string,
    tool: Tool,
    embedding?: number[]
  ): CypherStatement {
    return CypherBuilder.createTools([{ name, tool, embedding }])
  }

  /**
   * Generate Cypher vector search query with filtering
   * @param options - Vector search options
   * @returns Cypher statement with parameters
   */
  static vectorSearch(options: VectorSearchOptions): CypherStatement {
    const {
      vector,
      limit = 10,
      indexName = 'tool_embeddings',
      filterByIds,
      filterByNames,
      minScore,
    } = options

    const params: Record<string, any> = {
      queryVector: vector,
      limit,
      indexName,
    }

    // Build WHERE clause for filters
    const whereClauses: string[] = []

    if (filterByIds && filterByIds.length > 0) {
      whereClauses.push('node.id IN $filterIds')
      params.filterIds = filterByIds
    }

    if (filterByNames && filterByNames.length > 0) {
      whereClauses.push('node.name IN $filterNames')
      params.filterNames = filterByNames
    }

    if (minScore !== undefined) {
      whereClauses.push('score >= $minScore')
      params.minScore = minScore
    }

    const whereClause =
      whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

    const cypher = `CALL db.index.vector.queryNodes($indexName, $limit, $queryVector)
YIELD node, score
${whereClause}
RETURN node.name AS name,
       node.description AS description,
       node.schema AS schema,
       score
ORDER BY score DESC`.trim()

    return {
      cypher,
      params,
    }
  }

  /**
   * Generate Cypher to create vector index
   * @param indexName - Name of the index
   * @param dimensions - Vector dimensions (e.g., 1536 for OpenAI embeddings)
   * @param similarityFunction - 'cosine' or 'euclidean'
   * @returns Cypher statement with parameters
   */
  static createVectorIndex(
    indexName: string,
    dimensions: number,
    similarityFunction: 'cosine' | 'euclidean' = 'cosine'
  ): CypherStatement {
    const cypher = `CREATE VECTOR INDEX ${indexName} IF NOT EXISTS
FOR (t:Tool)
ON t.embedding
OPTIONS {
  indexConfig: {
    \`vector.dimensions\`: $dimensions,
    \`vector.similarity_function\`: '${similarityFunction}'
  }
}`

    return {
      cypher,
      params: {
        dimensions,
      },
    }
  }

  /**
   * Generate Cypher to check if vector index exists and is online
   * @param indexName - Name of the index
   * @returns Cypher statement with parameters
   */
  static checkVectorIndex(indexName: string): CypherStatement {
    const cypher = `SHOW VECTOR INDEXES
WHERE name = $indexName
RETURN name, state, type`

    return {
      cypher,
      params: {
        indexName,
      },
    }
  }
}