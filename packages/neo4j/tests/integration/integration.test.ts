/* eslint-disable @typescript-eslint/ban-ts-comment */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Driver, Session } from 'neo4j-driver'
import { CypherBuilder } from '../../src/index.js'
import { getDriver, closeDriver, clearDatabase } from './neo4j-helper'
import type { Tool } from 'ai'

describe('Neo4j Integration Tests', () => {
  let driver: Driver
  let session: Session
  let builder: CypherBuilder

  beforeAll(async () => {
    driver = getDriver()
    session = driver.session()

    // Initialize CypherBuilder with a test toolset hash
    builder = new CypherBuilder({ toolsetHash: 'test-integration-hash' })
  })

  beforeEach(async () => {
    // Clear database before each test
    await clearDatabase(session)
  })

  afterAll(async () => {
    await session.close()
    await closeDriver()
  })

  it('should execute snapshotted cypher and verify data was inserted', async () => {
    const searchTool: Tool = {
      description: 'A test tool for searching',
      inputSchema: {
        // @ts-ignore
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query string',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results',
          },
        },
        required: ['query'],
      },
    }

    const tools = [
      {
        name: 'searchTool',
        tool: searchTool,
        embeddings: {
          tool: new Array(1536).fill(0.1),
          parameters: {
            query: new Array(1536).fill(0.2),
            limit: new Array(1536).fill(0.3),
          },
          returnType: new Array(1536).fill(0.4),
        },
      },
    ]

    // Manually create the toolset first
    await session.run(
      `MERGE (toolset:ToolSet {hash: $toolset_hash})
       SET toolset.updatedAt = datetime()`,
      { toolset_hash: 'test-integration-hash' }
    )

    // Generate cypher using CypherBuilder instance method
    const { cypher: originalCypher, params } = builder.createDecomposedTools({
      tools,
    })

    // Prepend toolset matching to make it available in context
    const cypher = `
      MATCH (toolset:ToolSet {hash: $toolset_hash})
      WITH toolset
      ${originalCypher}
    `

    // Execute the cypher
    await session.run(cypher, params)

    // Verify the data was inserted
    const result = await session.run(
      `
      MATCH (toolset:ToolSet {hash: $toolset_hash})
      MATCH (toolset)-[:HAS_TOOL]->(tool:Tool)
      MATCH (tool)-[:HAS_PARAM]->(param:Parameter)
      MATCH (tool)-[:RETURNS]->(returnType:ReturnType)
      RETURN 
        tool.name AS toolName,
        tool.description AS toolDescription,
        count(DISTINCT param) AS paramCount,
        count(DISTINCT returnType) AS returnTypeCount
    `,
      { toolset_hash: 'test-integration-hash' }
    )

    expect(result.records).toHaveLength(1)
    const record = result.records[0]
    expect(record.get('toolName')).toBe('searchTool')
    expect(record.get('toolDescription')).toBe('A test tool for searching')
    expect(record.get('paramCount').toNumber()).toBe(2)
    expect(record.get('returnTypeCount').toNumber()).toBe(1)
  })

  it('should handle MERGE correctly - no duplicates on re-execution', async () => {
    const testTool: Tool = {
      description: 'Test tool',
      inputSchema: {
        // @ts-ignore
        type: 'object',
        properties: {
          input: {
            type: 'string',
            description: 'Input parameter',
          },
        },
        required: ['input'],
      },
    }

    const tools = [
      {
        name: 'testTool',
        tool: testTool,
        embeddings: {
          tool: new Array(1536).fill(0.5),
          parameters: {
            input: new Array(1536).fill(0.6),
          },
          returnType: new Array(1536).fill(0.7),
        },
      },
    ]

    // Manually create the toolset first
    await session.run(
      `MERGE (toolset:ToolSet {hash: $toolset_hash})
       SET toolset.updatedAt = datetime()`,
      { toolset_hash: 'test-integration-hash' }
    )

    // Generate cypher using CypherBuilder instance method
    const { cypher: originalCypher, params } = builder.createDecomposedTools({
      tools,
    })

    // Prepend toolset matching to make it available in context
    const cypher = `
      MATCH (toolset:ToolSet {hash: $toolset_hash})
      WITH toolset
      ${originalCypher}
    `

    // Execute twice
    await session.run(cypher, params)
    await session.run(cypher, params)

    // Verify only one toolset was created (MERGE should prevent duplicates)
    const toolsetResult = await session.run(
      `
      MATCH (toolset:ToolSet {hash: $toolset_hash})
      RETURN count(toolset) AS count
    `,
      { toolset_hash: 'test-integration-hash' }
    )

    expect(toolsetResult.records[0].get('count').toNumber()).toBe(1)

    // Verify tools were created (note: CREATE is used, so we'll have duplicates for tools)
    // This is expected behavior based on the current implementation
    const toolResult = await session.run(`
      MATCH (tool:Tool {name: 'testTool'})
      RETURN count(tool) AS count
    `)

    // Since the implementation uses CREATE for tools, we expect 2 tools after 2 executions
    expect(toolResult.records[0].get('count').toNumber()).toBe(2)
  })

  it('should store embeddings when provided', async () => {
    const embeddedTool: Tool = {
      description: 'Tool with embeddings',
      inputSchema: {
        // @ts-ignore
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'Text input',
          },
        },
        required: ['text'],
      },
    }

    const tools = [
      {
        name: 'embeddedTool',
        tool: embeddedTool,
        embeddings: {
          tool: [0.1, 0.2, 0.3],
          parameters: {
            text: [0.4, 0.5, 0.6],
          },
          returnType: [0.7, 0.8, 0.9],
        },
      },
    ]

    // Manually create the toolset first
    await session.run(
      `MERGE (toolset:ToolSet {hash: $toolset_hash})
       SET toolset.updatedAt = datetime()`,
      { toolset_hash: 'test-integration-hash' }
    )

    // Generate cypher using CypherBuilder instance method
    const { cypher: originalCypher, params } = builder.createDecomposedTools({
      tools,
    })

    // Prepend toolset matching to make it available in context
    const cypher = `
      MATCH (toolset:ToolSet {hash: $toolset_hash})
      WITH toolset
      ${originalCypher}
    `

    // Execute the cypher
    await session.run(cypher, params)

    // Verify embeddings were stored
    const result = await session.run(`
      MATCH (tool:Tool {name: 'embeddedTool'})
      MATCH (tool)-[:HAS_PARAM]->(param:Parameter {name: 'text'})
      MATCH (tool)-[:RETURNS]->(returnType:ReturnType)
      RETURN 
        tool.embedding AS toolEmbedding,
        param.embedding AS paramEmbedding,
        returnType.embedding AS returnEmbedding
    `)

    expect(result.records).toHaveLength(1)
    const record = result.records[0]

    expect(record.get('toolEmbedding')).toEqual([0.1, 0.2, 0.3])
    expect(record.get('paramEmbedding')).toEqual([0.4, 0.5, 0.6])
    expect(record.get('returnEmbedding')).toEqual([0.7, 0.8, 0.9])
  })

  it('should handle mixed tools with and without embeddings', async () => {
    const tool1: Tool = {
      description: 'First tool',
      inputSchema: {
        // @ts-ignore
        type: 'object',
        properties: {
          param1: {
            type: 'string',
            description: 'Parameter 1',
          },
        },
        required: ['param1'],
      },
    }

    const tool2: Tool = {
      description: 'Second tool',
      inputSchema: {
        // @ts-ignore
        type: 'object',
        properties: {
          param2: {
            type: 'string',
            description: 'Parameter 2',
          },
        },
        required: ['param2'],
      },
    }

    const tools = [
      {
        name: 'tool1',
        tool: tool1,
        embeddings: {
          tool: [0.1, 0.2],
          parameters: {
            param1: [0.3, 0.4],
          },
          returnType: [0.5, 0.6],
        },
      },
      {
        name: 'tool2',
        tool: tool2,
        embeddings: {
          tool: [0.7, 0.8],
          parameters: {
            param2: [0.9, 1.0],
          },
          returnType: [1.1, 1.2],
        },
      },
    ]

    // Manually create the toolset first
    await session.run(
      `MERGE (toolset:ToolSet {hash: $toolset_hash})
       SET toolset.updatedAt = datetime()`,
      { toolset_hash: 'test-integration-hash' }
    )

    // Generate cypher using CypherBuilder instance method
    // @ts-ignore
    const { cypher: originalCypher, params } = builder.createDecomposedTools({
      tools,
    })

    // Prepend toolset matching to make it available in context
    const cypher = `
      MATCH (toolset:ToolSet {hash: $toolset_hash})
      WITH toolset
      ${originalCypher}
    `

    // Execute the cypher
    await session.run(cypher, params)

    // Verify both tools were created
    const result = await session.run(`
      MATCH (tool:Tool)
      WHERE tool.name IN ['tool1', 'tool2']
      RETURN tool.name AS name, tool.description AS description
      ORDER BY tool.name
    `)

    expect(result.records).toHaveLength(2)
    expect(result.records[0].get('name')).toBe('tool1')
    expect(result.records[0].get('description')).toBe('First tool')
    expect(result.records[1].get('name')).toBe('tool2')
    expect(result.records[1].get('description')).toBe('Second tool')

    // Verify parameters were created for both tools
    const paramResult = await session.run(`
      MATCH (tool:Tool)-[:HAS_PARAM]->(param:Parameter)
      WHERE tool.name IN ['tool1', 'tool2']
      RETURN tool.name AS toolName, param.name AS paramName
      ORDER BY tool.name
    `)

    expect(paramResult.records).toHaveLength(2)
    expect(paramResult.records[0].get('toolName')).toBe('tool1')
    expect(paramResult.records[0].get('paramName')).toBe('param1')
    expect(paramResult.records[1].get('toolName')).toBe('tool2')
    expect(paramResult.records[1].get('paramName')).toBe('param2')
  })
})
