import dedent from 'dedent'
import type { Tool } from 'ai'
import neo4j from 'neo4j-driver'
import createDebug from 'debug'

const debug = createDebug('@mcp-rag/neo4j')
const debugCypher = createDebug('@mcp-rag/neo4j:cypher')
const debugParams = createDebug('@mcp-rag/neo4j:params')

export interface CypherStatement {
  cypher: string
  params: Record<string, any>
}

export interface ToolInput {
  name: string
  tool: Tool
  embedding: number[]
}

export interface VectorSearchOptions {
  vector: number[]
  limit?: number
  indexName?: string
  depth?: 'low' | 'mid' | 'full'
  minScore?: number
}

export interface SearchResult {
  name: string
  description: string
  schema: string
  relevance: number
  matches?: Array<{
    component: string
    score: number
  }>
}

export interface MigrationResult {
  toolsetCreated: boolean
  toolsCreated: number
  nodesCreated: number
  statements: CypherStatement[]
}

export class CypherBuilder {
  private toolsetHash: string

  constructor(options: { toolsetHash: string }) {
    this.toolsetHash = options.toolsetHash
    debug('CypherBuilder initialized with toolsetHash: %s', this.toolsetHash)
  }

  /**
   * Creates a complete migration that sets up the toolset and all tool nodes
   * This is useful for initializing or syncing your tools to Neo4j
   */
  migrate(options: {
    tools: Array<{
      name: string
      tool: Tool
      embeddings: {
        tool: number[]
        parameters: Record<string, number[]>
        returnType: number[]
      }
    }>
  }): CypherStatement {
    const { tools } = options
    debug('migrate: Starting migration for %d tools', tools.length)

    // First create the toolset
    const toolsetStatement = dedent`
      MERGE (toolset:ToolSet {hash: $toolset_hash})
      SET toolset.updatedAt = datetime(),
          toolset.toolCount = $tool_count
    `

    // Then create all tools
    const toolsResult = this.createDecomposedTools({ tools })

    // Combine into a single migration
    // If no tools, just return the toolset statement with a RETURN clause
    const cypher =
      tools.length === 0
        ? dedent`
          ${toolsetStatement}
          RETURN toolset
        `
        : dedent`
          ${toolsetStatement}
          WITH toolset
          ${toolsResult.cypher}
        `

    const params = {
      ...toolsResult.params,
      toolset_hash: this.toolsetHash,
      tool_count: tools.length,
    }

    debug(
      'migrate: Generated migration cypher with %d parameters for %d tools',
      Object.keys(params).length,
      tools.length
    )
    debugCypher('migrate: Full Cypher statement:\n%s', cypher)
    debugParams('migrate: Parameters: %O', this._sanitizeParams(params))

    return {
      cypher,
      params,
    }
  }

  /**
   * Alias for migrate() - syncs tools to Neo4j
   */
  sync(options: {
    tools: Array<{
      name: string
      tool: Tool
      embeddings: {
        tool: number[]
        parameters: Record<string, number[]>
        returnType: number[]
      }
    }>
  }): CypherStatement {
    debug('sync: Delegating to migrate()')
    return this.migrate(options)
  }

  createDecomposedTool(options: {
    name: string
    tool: Tool
    embeddings: {
      tool: number[]
      parameters: Record<string, number[]>
      returnType: number[]
    }
  }): CypherStatement {
    const { name, tool, embeddings } = options
    debug('createDecomposedTool: Creating tool "%s"', name)

    const statements: string[] = []
    const params: Record<string, any> = {}

    params.tool_name = name
    params.tool_description = tool.description || ''
    params.tool_embedding = embeddings.tool

    const toolStatement = dedent`
      CREATE (tool:Tool {id: randomUUID()})
      SET tool.name = $tool_name,
          tool.description = $tool_description,
          tool.embedding = $tool_embedding,
          tool.updatedAt = datetime()
      WITH toolset, tool
      MERGE (toolset)-[:HAS_TOOL]->(tool)
    `
    statements.push(toolStatement)

    // Handle both AI SDK tool format (with jsonSchema wrapper) and raw schema format
    const rawSchema = tool.inputSchema as any
    const schema = rawSchema?.jsonSchema || rawSchema || {}
    const parameters = schema?.properties || {}
    const required = schema?.required || []

    debug(
      'createDecomposedTool: Tool "%s" has %d parameters',
      name,
      Object.keys(parameters).length
    )

    Object.entries(parameters).forEach(
      ([paramName, paramDef]: [string, any], idx) => {
        const paramPrefix = `param${idx}`

        params[`${paramPrefix}_name`] = paramName
        params[`${paramPrefix}_type`] = paramDef.type || 'unknown'
        params[`${paramPrefix}_description`] = paramDef.description || ''
        params[`${paramPrefix}_required`] = required.includes(paramName)
        params[`${paramPrefix}_embedding`] = embeddings.parameters[paramName]

        const paramStatement = dedent`
        CREATE (param${idx}:Parameter {id: randomUUID()})
        SET param${idx}.name = $${paramPrefix}_name,
            param${idx}.toolId = tool.id,
            param${idx}.type = $${paramPrefix}_type,
            param${idx}.description = $${paramPrefix}_description,
            param${idx}.required = $${paramPrefix}_required,
            param${idx}.embedding = $${paramPrefix}_embedding,
            param${idx}.updatedAt = datetime()
        WITH toolset, tool, param${idx}
        MERGE (tool)-[:HAS_PARAM]->(param${idx})
      `
        statements.push(paramStatement)
      }
    )

    const returnStatement = dedent`
      CREATE (returnType:ReturnType {id: randomUUID()})
      SET returnType.toolId = tool.id,
          returnType.type = 'object',
          returnType.description = 'Tool execution result',
          returnType.embedding = $return_embedding,
          returnType.updatedAt = datetime()
      WITH toolset, tool, returnType
      MERGE (tool)-[:RETURNS]->(returnType)
    `
    statements.push(returnStatement)

    params.return_embedding = embeddings.returnType

    const cypher = statements.join('\n')

    debug(
      'createDecomposedTool: Tool "%s" generated %d statements',
      name,
      statements.length
    )
    debugCypher('createDecomposedTool: Tool "%s" Cypher:\n%s', name, cypher)
    debugParams(
      'createDecomposedTool: Tool "%s" params: %O',
      name,
      this._sanitizeParams(params)
    )

    return {
      cypher,
      params,
    }
  }

  createDecomposedTools(options: {
    tools: Array<{
      name: string
      tool: Tool
      embeddings: {
        tool: number[]
        parameters: Record<string, number[]>
        returnType: number[]
      }
    }>
  }): CypherStatement {
    const { tools } = options
    debug('createDecomposedTools: Creating %d decomposed tools', tools.length)

    const statements: string[] = []
    const allParams: Record<string, any> = {}

    // Create toolset once at the beginning
    // statements.push(dedent`
    //   MERGE (toolset:ToolSet {hash: $toolset_hash})
    //   SET toolset.updatedAt = datetime()
    // `)
    allParams.toolset_hash = this.toolsetHash

    tools.forEach((toolInput, toolIdx) => {
      debug(
        'createDecomposedTools: Processing tool %d/%d: "%s"',
        toolIdx + 1,
        tools.length,
        toolInput.name
      )

      const result = this.createDecomposedTool({
        name: toolInput.name,
        tool: toolInput.tool,
        embeddings: toolInput.embeddings,
      })

      const prefixedParams: Record<string, any> = {}
      Object.entries(result.params).forEach(([key, value]) => {
        // Skip the toolset_hash param since we already added it
        if (key !== 'toolset_hash') {
          prefixedParams[`t${toolIdx}_${key}`] = value
        }
      })

      Object.assign(allParams, prefixedParams)

      // Remove the toolset MERGE statement from individual tools
      // It was already created once at the beginning
      let prefixedCypher = result.cypher
        .replace(
          /MERGE \(toolset:ToolSet \{hash: \$toolset_hash\}\)\s*SET toolset\.updatedAt = datetime\(\)\s*/,
          ''
        )
        .replace(/\$(\w+)/g, (_, paramName) => {
          return `$t${toolIdx}_${paramName}`
        })
        .trim()

      // Add WITH toolset at the end to pass it to next tool
      if (toolIdx < tools.length - 1) {
        prefixedCypher += '\nWITH toolset'
      }

      statements.push(prefixedCypher)
    })

    const cypher = statements.join('\n')

    debug(
      'createDecomposedTools: Generated %d statements with %d total parameters',
      statements.length,
      Object.keys(allParams).length
    )
    debugCypher('createDecomposedTools: Combined Cypher:\n%s', cypher)
    debugParams(
      'createDecomposedTools: Combined params: %O',
      this._sanitizeParams(allParams)
    )

    return {
      cypher,
      params: allParams,
    }
  }

  vectorSearchDecomposed(options: VectorSearchOptions): CypherStatement {
    const {
      vector,
      limit = 5,
      indexName = 'tool_vector_index',
      depth = 'low',
      minScore = 0.0,
    } = options

    debug(
      'vectorSearchDecomposed: Searching with depth=%s, limit=%d, minScore=%f',
      depth,
      limit,
      minScore
    )

    let cypher: string
    const params: Record<string, any> = {
      queryVector: vector,
      limit,
      indexName,
      minScore,
    }

    if (depth === 'low') {
      cypher = dedent`
        CALL db.index.vector.queryNodes($indexName, $limit, $queryVector)
        YIELD node AS tool, score
        WHERE score >= $minScore
        RETURN 
          tool.name AS name,
          tool.description AS description,
          'tool' AS component,
          score AS relevance
        ORDER BY score DESC
      `
    } else if (depth === 'mid') {
      cypher = dedent`
        CALL db.index.vector.queryNodes($indexName, $limit * 3, $queryVector)
        YIELD node AS tool, score AS toolScore
        WHERE toolScore >= $minScore
        OPTIONAL MATCH (tool)-[:HAS_PARAM]->(param:Parameter)
        WITH tool, toolScore, 'tool' AS matchComponent, toolScore AS matchScore,
             collect(DISTINCT {
               name: param.name,
               type: param.type,
               required: param.required,
               description: param.description
             }) AS params
        RETURN 
          tool.name AS name,
          tool.description AS description,
          toString(params) AS schema,
          toolScore AS relevance,
          COLLECT(DISTINCT {component: matchComponent, score: matchScore}) AS matches
        ORDER BY toolScore DESC
        LIMIT $limit
      `
    } else {
      // full depth
      cypher = dedent`
        CALL db.index.vector.queryNodes($indexName, $limit * 5, $queryVector)
        YIELD node AS tool, score AS toolScore
        WHERE toolScore >= $minScore
        OPTIONAL MATCH (tool)-[:HAS_PARAM]->(param:Parameter)
        OPTIONAL MATCH (tool)-[:RETURNS]->(returnType:ReturnType)
        WITH tool, toolScore, 'tool' AS matchComponent, toolScore AS matchScore,
             collect(DISTINCT {
               name: param.name,
               type: param.type,
               required: param.required,
               description: param.description
             }) AS params,
             collect(DISTINCT {
               type: returnType.type,
               description: returnType.description
             })[0] AS returnType
        RETURN 
          tool.name AS name,
          tool.description AS description,
          toString({parameters: params, returns: returnType}) AS schema,
          toolScore AS relevance,
          COLLECT(DISTINCT {component: matchComponent, score: matchScore}) AS matches
        ORDER BY toolScore DESC
        LIMIT $limit
      `
    }

    debug('vectorSearchDecomposed: Generated search query for depth=%s', depth)
    debugCypher('vectorSearchDecomposed: Cypher query:\n%s', cypher)
    debugParams(
      'vectorSearchDecomposed: Search params (vector truncated): %O',
      {
        ...params,
        queryVector: `[${vector.length} dimensions]`,
      }
    )

    return {
      cypher,
      params,
    }
  }

  static createVectorIndex(options: {
    indexName: string
    dimensions: number
  }): CypherStatement {
    const { indexName, dimensions } = options
    debug(
      'createVectorIndex: Creating index "%s" with %d dimensions',
      indexName,
      dimensions
    )

    const cypher = dedent`
      CREATE VECTOR INDEX ${indexName} IF NOT EXISTS
      FOR (t:Tool)
      ON t.embedding
      OPTIONS {indexConfig: {
        \`vector.dimensions\`: $dimensions,
        \`vector.similarity_function\`: 'cosine'
      }}
    `

    debugCypher('createVectorIndex: Cypher:\n%s', cypher)
    debugParams('createVectorIndex: Params: %O', { dimensions })

    return {
      cypher,
      params: {
        dimensions: neo4j.int(dimensions),
      },
    }
  }

  static checkVectorIndex(options: { indexName: string }): CypherStatement {
    const { indexName } = options
    debug('checkVectorIndex: Checking status of index "%s"', indexName)

    const cypher = dedent`
      SHOW VECTOR INDEXES
      YIELD name, state, populationPercent
      WHERE name = $indexName
      RETURN name, state, populationPercent
    `

    debugCypher('checkVectorIndex: Cypher:\n%s', cypher)
    debugParams('checkVectorIndex: Params: %O', { indexName })

    return {
      cypher,
      params: {
        indexName,
      },
    }
  }

  /**
   * Gets a toolset by its hash, including all tools, parameters, and return types
   * Returns the toolset metadata and all associated tools with their full structure
   */
  getToolsetByHash(): CypherStatement {
    debug('getToolsetByHash: Getting toolset with hash "%s"', this.toolsetHash)

    const cypher = dedent`
      MATCH (toolset:ToolSet {hash: $toolset_hash})
      OPTIONAL MATCH (toolset)-[:HAS_TOOL]->(tool:Tool)
      OPTIONAL MATCH (tool)-[:HAS_PARAM]->(param:Parameter)
      OPTIONAL MATCH (tool)-[:RETURNS]->(returnType:ReturnType)
      WITH toolset, tool,
           collect(DISTINCT {
             name: param.name,
             type: param.type,
             description: param.description,
             required: param.required
           }) AS params,
           returnType
      WITH toolset, collect(DISTINCT CASE WHEN tool IS NOT NULL THEN {
        name: tool.name,
        description: tool.description,
        parameters: params,
        returnType: {
          type: returnType.type,
          description: returnType.description
        }
      } END) AS tools
      RETURN
        toolset.hash AS hash,
        toolset.updatedAt AS updatedAt,
        toolset.toolCount AS toolCount,
        [t IN tools WHERE t IS NOT NULL] AS tools
    `

    debugCypher('getToolsetByHash: Cypher:\n%s', cypher)
    debugParams('getToolsetByHash: Params: %O', {
      toolset_hash: this.toolsetHash,
    })

    return {
      cypher,
      params: {
        toolset_hash: this.toolsetHash,
      },
    }
  }

  /**
   * Deletes a toolset by its hash, including all related tools, parameters, and return types
   * Uses DETACH DELETE to remove all relationships automatically
   * Returns count of deleted nodes for verification
   */
  deleteToolsetByHash(): CypherStatement {
    debug(
      'deleteToolsetByHash: Deleting toolset with hash "%s"',
      this.toolsetHash
    )

    const cypher = dedent`
      MATCH (toolset:ToolSet {hash: $toolset_hash})
      OPTIONAL MATCH (toolset)-[:HAS_TOOL]->(tool:Tool)
      OPTIONAL MATCH (tool)-[:HAS_PARAM]->(param:Parameter)
      OPTIONAL MATCH (tool)-[:RETURNS]->(returnType:ReturnType)
      WITH toolset,
           collect(DISTINCT tool) AS tools,
           collect(DISTINCT param) AS params,
           collect(DISTINCT returnType) AS returnTypes
      WITH toolset, tools, params, returnTypes,
           1 AS toolsetCount,
           size(tools) AS toolCount,
           size(params) AS paramCount,
           size(returnTypes) AS returnTypeCount
      FOREACH (t IN tools | DETACH DELETE t)
      FOREACH (p IN params | DETACH DELETE p)
      FOREACH (r IN returnTypes | DETACH DELETE r)
      DETACH DELETE toolset
      RETURN
        toolsetCount AS deletedToolsets,
        toolCount AS deletedTools,
        paramCount AS deletedParams,
        returnTypeCount AS deletedReturnTypes
    `

    debugCypher('deleteToolsetByHash: Cypher:\n%s', cypher)
    debugParams('deleteToolsetByHash: Params: %O', {
      toolset_hash: this.toolsetHash,
    })

    return {
      cypher,
      params: {
        toolset_hash: this.toolsetHash,
      },
    }
  }

  /**
   * Helper to sanitize parameters for logging (truncates embeddings)
   */
  private _sanitizeParams(params: Record<string, any>): Record<string, any> {
    const sanitized: Record<string, any> = {}
    for (const [key, value] of Object.entries(params)) {
      if (key.includes('embedding') && Array.isArray(value)) {
        sanitized[key] = `[${value.length} dimensions]`
      } else {
        sanitized[key] = value
      }
    }
    return sanitized
  }
}
