/* eslint-disable @typescript-eslint/no-explicit-any */
import { tool } from 'ai'
import { jsonSchema } from '@ai-sdk/provider-utils'

export interface MCPTool {
  name: string
  description?: string
  inputSchema: any
}

/**
 * Generate mock responses based on tool name
 */
function getMockResponse(toolName: string, params: any): any {
  const responses: Record<string, any> = {
    get_pull_request: {
      number: params.pull_number,
      title: 'Mock PR Title',
      state: 'open',
      body: 'Mock PR description',
    },
    list_issues: {
      issues: [
        { number: 1, title: 'Mock Issue 1', state: 'open' },
        { number: 2, title: 'Mock Issue 2', state: 'closed' },
      ],
    },
    create_issue: {
      number: 42,
      title: params.title,
      body: params.body,
      state: 'open',
    },
    get_file_contents: {
      content: 'Mock file content for README.md',
      encoding: 'utf-8',
    },
    add_issue_comment: {
      id: 123,
      body: params.body,
    },
  }

  return responses[toolName] || { success: true, message: 'Mock response' }
}

/**
 * Clean schema properties recursively
 */
function cleanSchemaProperties(
  properties: Record<string, any>
): Record<string, any> {
  const cleaned: Record<string, any> = {}

  for (const [key, value] of Object.entries(properties)) {
    if (!value || typeof value !== 'object') {
      continue
    }

    const prop = { ...value }

    // Handle type field
    if (!prop.type || prop.type === null || prop.type === undefined) {
      console.warn(`  ⚠️  Property "${key}" missing type, defaulting to string`)
      prop.type = 'string'
    } else if (
      typeof prop.type === 'string' &&
      prop.type.toLowerCase() === 'none'
    ) {
      console.warn(
        `  ⚠️  Property "${key}" has invalid type "None", defaulting to string`
      )
      prop.type = 'string'
    }

    // Recursively clean nested objects
    if (prop.type === 'object' && prop.properties) {
      prop.properties = cleanSchemaProperties(prop.properties)
    }

    // Recursively clean array items
    if (prop.type === 'array' && prop.items) {
      if (prop.items.properties) {
        prop.items.properties = cleanSchemaProperties(prop.items.properties)
      }
      if (!prop.items.type || prop.items.type === null) {
        prop.items.type = 'string'
      }
    }

    cleaned[key] = prop
  }

  return cleaned
}

/**
 * Normalize JSON Schema to ensure it's valid
 */
function normalizeSchema(schema: any): any {
  if (!schema) {
    return {
      type: 'object',
      properties: {},
    }
  }

  // Clone the schema to avoid mutations
  const normalized = JSON.parse(JSON.stringify(schema))

  // Ensure root has type: object
  if (
    !normalized.type ||
    normalized.type === null ||
    normalized.type === undefined
  ) {
    if (normalized.properties) {
      console.warn(`  ⚠️  Root schema missing type, setting to object`)
      normalized.type = 'object'
    } else {
      return {
        type: 'object',
        properties: {},
      }
    }
  }

  // Handle invalid root type
  const validTypes = [
    'object',
    'array',
    'string',
    'number',
    'boolean',
    'null',
    'integer',
  ]
  if (normalized.type && !validTypes.includes(normalized.type.toLowerCase())) {
    console.warn(
      `  ⚠️  Invalid root schema type "${normalized.type}", defaulting to object`
    )
    return {
      type: 'object',
      properties: {},
    }
  }

  // Ensure root is object type (AI SDK requirement)
  if (normalized.type !== 'object') {
    return {
      type: 'object',
      properties: {
        value: normalized,
      },
      required: ['value'],
    }
  }

  // Clean all properties recursively
  if (normalized.properties) {
    normalized.properties = cleanSchemaProperties(normalized.properties)
  } else {
    // If no properties, add an empty object
    normalized.properties = {}
  }

  return normalized
}

/**
 * Convert MCP tools to AI SDK compatible format
 */
export function convertMCPToolsToAISDK(
  mcpTools: MCPTool[]
): Record<string, any> {
  const tools: Record<string, any> = {}

  for (const mcpTool of mcpTools) {
    try {
      const normalizedSchema = normalizeSchema(mcpTool.inputSchema)

      if (process.env.DEBUG_SCHEMA) {
        console.log(
          `  📄 Normalized schema for ${mcpTool.name}:`,
          JSON.stringify(normalizedSchema, null, 2)
        )
      }

      tools[mcpTool.name] = tool({
        description: mcpTool.description || `Tool: ${mcpTool.name}`,
        inputSchema: jsonSchema(normalizedSchema),
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        execute: async (params: any) => {
          const actualParams =
            mcpTool.inputSchema?.type !== 'object' && params.value
              ? params.value
              : params
          return getMockResponse(mcpTool.name, actualParams)
        },
      })
    } catch (error) {
      console.error(`  ❌ Error converting tool ${mcpTool.name}:`, error)
      console.error(
        `  📄 Original schema:`,
        JSON.stringify(mcpTool.inputSchema, null, 2)
      )
      throw error
    }
  }

  return tools
}
