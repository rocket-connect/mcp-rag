import type { Tool } from 'ai'

export interface CypherStatement {
  cypher: string
  params: Record<string, any>
}

export class CypherBuilder {
  static createTools(
    tools: Array<{ name: string; tool: Tool }>
  ): CypherStatement {
    return {
      cypher: `
        UNWIND $tools AS toolData
        MERGE (t:Tool {name: toolData.name})
        SET t.description = toolData.description,
            t.schema = toolData.schema,
            t.updatedAt = datetime()
      `,
      params: {
        tools: tools.map(({ name, tool }) => ({
          name,
          description: tool.description || '',
          schema: JSON.stringify(tool.inputSchema), // Serialize to JSON string
        })),
      },
    }
  }

  static createTool(name: string, tool: Tool): CypherStatement {
    return CypherBuilder.createTools([{ name, tool }])
  }
}
