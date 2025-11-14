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

    const tool2 = result.records[1].get('t').properties
    expect(tool2.name).toBe('test_tool_2')
    expect(tool2.description).toBe('Second test tool')
    expect(JSON.parse(tool2.schema)).toEqual({
      type: 'object',
      properties: { param: { type: 'string' } },
    })
    expect(tool2.updatedAt).toBeDefined()
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
})
