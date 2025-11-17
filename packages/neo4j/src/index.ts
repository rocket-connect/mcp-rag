import dedent from 'dedent'
import type { Tool } from 'ai'

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

    // First create the toolset
    const toolsetStatement = dedent`
      MERGE (toolset:ToolSet {hash: $toolset_hash})
      SET toolset.updatedAt = datetime(),
          toolset.toolCount = $tool_count
    `

    // Then create all tools
    const toolsResult = this.createDecomposedTools({ tools })

    // Combine into a single migration
    const cypher = dedent`
      ${toolsetStatement}
      WITH toolset
      ${toolsResult.cypher}
    `

    return {
      cypher,
      params: {
        ...toolsResult.params,
        toolset_hash: this.toolsetHash,
        tool_count: tools.length,
      },
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
    const statements: string[] = []
    const params: Record<string, any> = {}

    params.toolset_hash = this.toolsetHash
    statements.push(dedent`
      MERGE (toolset:ToolSet {hash: $toolset_hash})
      SET toolset.updatedAt = datetime()
    `)

    params.tool_name = name
    params.tool_description = tool.description || ''
    params.tool_embedding = embeddings.tool

    statements.push(dedent`
      CREATE (tool:Tool {id: randomUUID()})
      SET tool.name = $tool_name,
          tool.description = $tool_description,
          tool.embedding = $tool_embedding,
          tool.updatedAt = datetime()
      WITH toolset, tool
      MERGE (toolset)-[:HAS_TOOL]->(tool)
    `)

    const schema = tool.inputSchema as any
    const parameters = schema?.properties || {}
    const required = schema?.required || []

    Object.entries(parameters).forEach(
      ([paramName, paramDef]: [string, any], idx) => {
        const paramPrefix = `param${idx}`

        params[`${paramPrefix}_name`] = paramName
        params[`${paramPrefix}_type`] = paramDef.type || 'unknown'
        params[`${paramPrefix}_description`] = paramDef.description || ''
        params[`${paramPrefix}_required`] = required.includes(paramName)
        params[`${paramPrefix}_embedding`] = embeddings.parameters[paramName]

        statements.push(dedent`
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
      `)
      }
    )

    statements.push(dedent`
      CREATE (returnType:ReturnType {id: randomUUID()})
      SET returnType.toolId = tool.id,
          returnType.type = 'object',
          returnType.description = 'Tool execution result',
          returnType.embedding = $return_embedding,
          returnType.updatedAt = datetime()
      WITH toolset, tool, returnType
      MERGE (tool)-[:RETURNS]->(returnType)
    `)

    params.return_embedding = embeddings.returnType

    return {
      cypher: statements.join('\n'),
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
    const statements: string[] = []
    const allParams: Record<string, any> = {}

    tools.forEach((toolInput, toolIdx) => {
      const result = this.createDecomposedTool({
        name: toolInput.name,
        tool: toolInput.tool,
        embeddings: toolInput.embeddings,
      })

      const prefixedParams: Record<string, any> = {}
      Object.entries(result.params).forEach(([key, value]) => {
        prefixedParams[`t${toolIdx}_${key}`] = value
      })

      Object.assign(allParams, prefixedParams)

      const prefixedCypher = result.cypher.replace(
        /\$(\w+)/g,
        (match, paramName) => {
          return `$t${toolIdx}_${paramName}`
        }
      )

      statements.push(prefixedCypher)
    })

    return {
      cypher: statements.join('\n'),
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

    const multipliers = {
      low: 1,
      mid: 3,
      full: 5,
    }

    const multiplier = multipliers[depth]

    if (depth === 'low') {
      return {
        cypher: dedent`
          CALL db.index.vector.queryNodes($indexName, $limit, $queryVector)
          YIELD node AS tool, score
          WHERE score >= $minScore
          WITH tool, score, 'tool' AS component
          RETURN 
            tool.name AS name,
            tool.description AS description,
            '' AS schema,
            score AS relevance,
            [{component: component, score: score}] AS matches
          ORDER BY score DESC
        `,
        params: {
          indexName,
          limit,
          queryVector: vector,
          minScore,
        },
      }
    }

    if (depth === 'mid') {
      return {
        cypher: dedent`
          CALL db.index.vector.queryNodes($indexName, $limit * ${multiplier}, $queryVector)
          YIELD node AS tool, score AS toolScore
          WHERE toolScore >= $minScore
          OPTIONAL MATCH (tool)-[:HAS_PARAM]->(param:Parameter)
          WITH tool, toolScore, 'tool' AS matchComponent, toolScore AS matchScore, collect({
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
        `,
        params: {
          indexName,
          limit,
          queryVector: vector,
          minScore,
        },
      }
    }

    // depth === 'full'
    return {
      cypher: dedent`
        CALL db.index.vector.queryNodes($indexName, $limit * ${multiplier}, $queryVector)
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
      `,
      params: {
        indexName,
        limit,
        queryVector: vector,
        minScore,
      },
    }
  }

  static createVectorIndex(options: {
    indexName: string
    dimensions: number
  }): CypherStatement {
    const { indexName, dimensions } = options
    return {
      cypher: dedent`
        CREATE VECTOR INDEX ${indexName} IF NOT EXISTS
        FOR (t:Tool)
        ON t.embedding
        OPTIONS {indexConfig: {
          \`vector.dimensions\`: $dimensions,
          \`vector.similarity_function\`: 'cosine'
        }}
      `,
      params: { dimensions },
    }
  }

  static checkVectorIndex(options: { indexName: string }): CypherStatement {
    const { indexName } = options
    return {
      cypher: dedent`
        SHOW VECTOR INDEXES
        YIELD name, state, populationPercent
        WHERE name = $indexName
        RETURN name, state, populationPercent
      `,
      params: { indexName },
    }
  }
}
