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
}
