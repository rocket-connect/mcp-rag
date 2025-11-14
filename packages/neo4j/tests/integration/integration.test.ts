/* eslint-disable @typescript-eslint/ban-ts-comment */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Neo4jTestHelper } from './neo4j-helper'
import { CypherBuilder } from '../../src/index'

describe('Neo4j Integration Tests', () => {
  let neo4jHelper: Neo4jTestHelper

  beforeAll(async () => {
    neo4jHelper = new Neo4jTestHelper()
    await neo4jHelper.connect()
  })

  beforeEach(async () => {
    await neo4jHelper.clearDatabase()
  })

  afterAll(async () => {
    await neo4jHelper.close()
  })

  it('should execute snapshotted cypher and verify data was inserted', async () => {
    // Test data - using the Tool interface from 'ai' package
    const tools = [
      {
        name: 'test_tool_1',
        tool: {
          description: 'First test tool',
          inputSchema: { type: 'object', properties: {} },
        },
      },
      {
        name: 'test_tool_2',
        tool: {
          description: 'Second test tool',
          inputSchema: {
            type: 'object',
            properties: { param: { type: 'string' } },
          },
        },
      },
    ]

    // Generate cypher using CypherBuilder
    // @ts-ignore
    const { cypher, params } = CypherBuilder.createTools(tools)

    // Execute the cypher
    await neo4jHelper.executeCypher(cypher, params)

    // Verify data was inserted
    const result = await neo4jHelper.executeCypher(
      'MATCH (t:Tool) RETURN t ORDER BY t.name'
    )

    expect(result.records.length).toBe(2)

    const tool1 = result.records[0].get('t').properties
    expect(tool1.name).toBe('test_tool_1')
    expect(tool1.description).toBe('First test tool')
    expect(JSON.parse(tool1.schema)).toEqual({
      type: 'object',
      properties: {},
    })
    expect(tool1.updatedAt).toBeDefined()
    expect(tool1.embedding).toBeUndefined()

    const tool2 = result.records[1].get('t').properties
    expect(tool2.name).toBe('test_tool_2')
    expect(tool2.description).toBe('Second test tool')
    expect(JSON.parse(tool2.schema)).toEqual({
      type: 'object',
      properties: { param: { type: 'string' } },
    })
    expect(tool2.updatedAt).toBeDefined()
    expect(tool2.embedding).toBeUndefined()
  })

  it('should handle MERGE correctly - no duplicates on re-execution', async () => {
    const tools = [
      {
        name: 'unique_tool',
        tool: {
          description: 'A unique tool',
          inputSchema: { type: 'object' },
        },
      },
    ]

    // Generate cypher using CypherBuilder
    // @ts-ignore
    const { cypher, params } = CypherBuilder.createTools(tools)

    // Execute twice
    await neo4jHelper.executeCypher(cypher, params)
    await neo4jHelper.executeCypher(cypher, params)

    // Should still only have one record
    const result = await neo4jHelper.executeCypher(
      'MATCH (t:Tool {name: $name}) RETURN count(t) as count',
      { name: 'unique_tool' }
    )

    expect(result.records[0].get('count').toNumber()).toBe(1)
  })

  it('should store embeddings when provided', async () => {
    const mockEmbedding1 = [0.1, 0.2, 0.3, 0.4, 0.5]
    const mockEmbedding2 = [0.6, 0.7, 0.8, 0.9, 1.0]

    const tools = [
      {
        name: 'tool_with_embedding_1',
        tool: {
          description: 'Tool with embedding',
          inputSchema: { type: 'object', properties: {} },
        },
        embedding: mockEmbedding1,
      },
      {
        name: 'tool_with_embedding_2',
        tool: {
          description: 'Another tool with embedding',
          inputSchema: { type: 'object', properties: {} },
        },
        embedding: mockEmbedding2,
      },
    ]

    // Generate cypher using CypherBuilder
    // @ts-ignore
    const { cypher, params } = CypherBuilder.createTools(tools)

    // Execute the cypher
    await neo4jHelper.executeCypher(cypher, params)

    // Verify embeddings were stored
    const result = await neo4jHelper.executeCypher(
      'MATCH (t:Tool) WHERE t.embedding IS NOT NULL RETURN t ORDER BY t.name'
    )

    expect(result.records.length).toBe(2)

    const tool1 = result.records[0].get('t').properties
    expect(tool1.name).toBe('tool_with_embedding_1')
    expect(tool1.embedding).toEqual(mockEmbedding1)

    const tool2 = result.records[1].get('t').properties
    expect(tool2.name).toBe('tool_with_embedding_2')
    expect(tool2.embedding).toEqual(mockEmbedding2)
  })

  it('should handle mixed tools with and without embeddings', async () => {
    const mockEmbedding = [0.1, 0.2, 0.3, 0.4, 0.5]

    const tools = [
      {
        name: 'tool_with_embedding',
        tool: {
          description: 'Tool with embedding',
          inputSchema: { type: 'object' },
        },
        embedding: mockEmbedding,
      },
      {
        name: 'tool_without_embedding',
        tool: {
          description: 'Tool without embedding',
          inputSchema: { type: 'object' },
        },
      },
    ]

    // Generate cypher using CypherBuilder
    // @ts-ignore
    const { cypher, params } = CypherBuilder.createTools(tools)

    // Execute the cypher
    await neo4jHelper.executeCypher(cypher, params)

    // Verify both tools exist
    const allTools = await neo4jHelper.executeCypher(
      'MATCH (t:Tool) RETURN t ORDER BY t.name'
    )
    expect(allTools.records.length).toBe(2)

    // Verify tool with embedding
    const withEmbedding = await neo4jHelper.executeCypher(
      'MATCH (t:Tool {name: $name}) RETURN t',
      { name: 'tool_with_embedding' }
    )
    const toolWithEmbedding = withEmbedding.records[0].get('t').properties
    expect(toolWithEmbedding.embedding).toEqual(mockEmbedding)

    // Verify tool without embedding
    const withoutEmbedding = await neo4jHelper.executeCypher(
      'MATCH (t:Tool {name: $name}) RETURN t',
      { name: 'tool_without_embedding' }
    )
    const toolWithoutEmbedding = withoutEmbedding.records[0].get('t').properties
    expect(toolWithoutEmbedding.embedding).toBeUndefined()
  })
})
