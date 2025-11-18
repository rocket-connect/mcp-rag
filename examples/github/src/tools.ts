import { tool } from 'ai'
import { jsonSchema } from 'ai'
import mockToolsJson from '../mock-tools-github.json'

interface MCPTool {
  name: string
  description?: string
  inputSchema: any
}

function getMockResponse(toolName: string, params: any): any {
  const responses: Record<string, any> = {
    get_file_contents: {
      content: `# MCP-RAG

A Retrieval-Augmented Generation (RAG) system for Model Context Protocol (MCP) tools.

## Features
- 🔍 Vector search for intelligent tool selection
- 🗄️ Neo4j graph database integration
- 🤖 OpenAI embeddings support
- 📊 Comprehensive benchmarking suite

Mock file contents retrieved for: ${params.owner}/${params.repo}/${params.path}`,
      path: params.path,
      sha: 'abc123def456',
      size: 1234,
      type: 'file',
    },
    get_pull_request: {
      number: params.pull_number,
      title: `Mock PR #${params.pull_number}`,
      body: 'This is a mock pull request for demonstration purposes',
      state: 'open',
      user: { login: 'mock-user' },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    list_issues: [
      {
        number: 1,
        title: 'Example issue 1',
        state: 'open',
        labels: [{ name: 'bug' }],
        created_at: new Date().toISOString(),
      },
      {
        number: 2,
        title: 'Example issue 2',
        state: 'open',
        labels: [{ name: 'enhancement' }],
        created_at: new Date().toISOString(),
      },
    ],
    create_issue: {
      number: 42,
      title: params.title,
      body: params.body || '',
      state: 'open',
      created_at: new Date().toISOString(),
      html_url: `https://github.com/${params.owner}/${params.repo}/issues/42`,
    },
    add_issue_comment: {
      id: 123,
      body: params.body,
    },
  }

  return responses[toolName] || { success: true, message: 'Mock response' }
}

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

  const normalized = JSON.parse(JSON.stringify(schema))

  if (
    !normalized.type ||
    normalized.type === null ||
    normalized.type === undefined
  ) {
    if (normalized.properties) {
      normalized.type = 'object'
    } else {
      return {
        type: 'object',
        properties: {},
      }
    }
  }

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
    return {
      type: 'object',
      properties: {},
    }
  }

  if (normalized.type !== 'object') {
    return {
      type: 'object',
      properties: {
        value: normalized,
      },
      required: ['value'],
    }
  }

  if (normalized.properties) {
    normalized.properties = cleanSchemaProperties(normalized.properties)
  } else {
    normalized.properties = {}
  }

  return normalized
}

export function convertMCPToolsToAISDK(
  mcpTools: MCPTool[]
): Record<string, any> {
  const tools: Record<string, any> = {}

  for (const mcpTool of mcpTools) {
    try {
      const normalizedSchema = normalizeSchema(mcpTool.inputSchema)

      tools[mcpTool.name] = tool({
        description: mcpTool.description || `Tool: ${mcpTool.name}`,
        inputSchema: jsonSchema(normalizedSchema),
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
      throw error
    }
  }

  return tools
}

// Load GitHub tools from the JSON file (same as benchmarks)
const githubMCPTools = mockToolsJson.tools as MCPTool[]

// Convert MCP tools to AI SDK format
export const githubTools = convertMCPToolsToAISDK(githubMCPTools)
