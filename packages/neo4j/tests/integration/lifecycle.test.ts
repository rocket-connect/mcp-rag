/* eslint-disable @typescript-eslint/ban-ts-comment */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Driver, Session } from 'neo4j-driver'
import { CypherBuilder } from '../../src/index.js'
import { getDriver, closeDriver, clearDatabase } from './neo4j-helper'
import type { Tool } from 'ai'

/**
 * Lifecycle Integration Tests
 *
 * Tests the full lifecycle of toolset management in Neo4j:
 * 1. Setup - Create toolset with migrate()
 * 2. Get - Retrieve toolset by hash with getToolsetByHash()
 * 3. Detect Changes - Verify hash changes when tools change
 * 4. Teardown - Delete toolset by hash with deleteToolsetByHash()
 */
describe('Toolset Lifecycle Integration Tests', () => {
  let driver: Driver
  let session: Session

  const lifecycleHash = 'lifecycle-test-hash-v1'
  const updatedHash = 'lifecycle-test-hash-v2'

  const mockTool: Tool = {
    description: 'A lifecycle test tool',
    inputSchema: {
      // @ts-ignore
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Action to perform',
        },
        target: {
          type: 'string',
          description: 'Target resource',
        },
      },
      required: ['action'],
    },
  }

  const mockVector = Array(1536).fill(0.1)

  beforeAll(async () => {
    driver = getDriver()
    session = driver.session()
  })

  beforeEach(async () => {
    await clearDatabase(session)
  })

  afterAll(async () => {
    await session.close()
    await closeDriver()
  })

  describe('Full Lifecycle: Setup -> Get -> Update -> Teardown', () => {
    it('should complete full toolset lifecycle', async () => {
      // ============ STEP 1: SETUP - Create initial toolset ============
      const builder = new CypherBuilder({ toolsetHash: lifecycleHash })

      const migrateResult = builder.migrate({
        tools: [
          {
            name: 'lifecycleTool',
            tool: mockTool,
            embeddings: {
              tool: mockVector,
              parameters: { action: mockVector, target: mockVector },
              returnType: mockVector,
            },
          },
        ],
      })

      await session.run(migrateResult.cypher, migrateResult.params)

      // Verify setup was successful
      const setupVerify = await session.run(
        `MATCH (ts:ToolSet {hash: $hash}) RETURN ts.toolCount AS count`,
        { hash: lifecycleHash }
      )
      expect(setupVerify.records).toHaveLength(1)
      expect(setupVerify.records[0].get('count')).toBe(1)

      // ============ STEP 2: GET - Retrieve toolset by hash ============
      const getStatement = builder.getToolsetByHash()
      const getResult = await session.run(
        getStatement.cypher,
        getStatement.params
      )

      expect(getResult.records).toHaveLength(1)
      const record = getResult.records[0]
      expect(record.get('hash')).toBe(lifecycleHash)
      expect(record.get('toolCount')).toBe(1)

      const tools = record.get('tools')
      expect(tools).toHaveLength(1)
      expect(tools[0].name).toBe('lifecycleTool')
      expect(tools[0].description).toBe('A lifecycle test tool')
      expect(tools[0].parameters).toHaveLength(2)

      // ============ STEP 3: UPDATE - Create new toolset with different hash ============
      const updatedBuilder = new CypherBuilder({ toolsetHash: updatedHash })

      const updatedMigrateResult = updatedBuilder.migrate({
        tools: [
          {
            name: 'lifecycleTool',
            tool: { ...mockTool, description: 'Updated lifecycle tool' },
            embeddings: {
              tool: mockVector,
              parameters: { action: mockVector, target: mockVector },
              returnType: mockVector,
            },
          },
          {
            name: 'newTool',
            tool: {
              description: 'A new tool added in v2',
              inputSchema: {
                // @ts-ignore
                type: 'object',
                properties: {
                  input: { type: 'string', description: 'Input value' },
                },
              },
            },
            embeddings: {
              tool: mockVector,
              parameters: { input: mockVector },
              returnType: mockVector,
            },
          },
        ],
      })

      await session.run(
        updatedMigrateResult.cypher,
        updatedMigrateResult.params
      )

      // Verify both toolsets exist (old and new)
      const bothExist = await session.run(
        `MATCH (ts:ToolSet) WHERE ts.hash IN [$h1, $h2] RETURN ts.hash AS hash, ts.toolCount AS count ORDER BY ts.hash`,
        { h1: lifecycleHash, h2: updatedHash }
      )
      expect(bothExist.records).toHaveLength(2)

      // ============ STEP 4: TEARDOWN - Delete old toolset by hash ============
      const deleteStatement = builder.deleteToolsetByHash()
      const deleteResult = await session.run(
        deleteStatement.cypher,
        deleteStatement.params
      )

      expect(deleteResult.records).toHaveLength(1)
      const deleteRecord = deleteResult.records[0]
      expect(deleteRecord.get('deletedToolsets').toNumber()).toBe(1)
      expect(deleteRecord.get('deletedTools').toNumber()).toBe(1)
      expect(deleteRecord.get('deletedParams').toNumber()).toBe(2)
      expect(deleteRecord.get('deletedReturnTypes').toNumber()).toBe(1)

      // Verify old toolset is gone
      const oldGone = await session.run(
        `MATCH (ts:ToolSet {hash: $hash}) RETURN ts`,
        { hash: lifecycleHash }
      )
      expect(oldGone.records).toHaveLength(0)

      // Verify new toolset still exists
      const newExists = await session.run(
        `MATCH (ts:ToolSet {hash: $hash}) RETURN ts.toolCount AS count`,
        { hash: updatedHash }
      )
      expect(newExists.records).toHaveLength(1)
      expect(newExists.records[0].get('count')).toBe(2)

      // Cleanup: delete the updated toolset
      const cleanupBuilder = new CypherBuilder({ toolsetHash: updatedHash })
      const cleanupDelete = cleanupBuilder.deleteToolsetByHash()
      await session.run(cleanupDelete.cypher, cleanupDelete.params)
    })
  })

  describe('getToolsetByHash', () => {
    it('should return empty result for non-existent hash', async () => {
      const builder = new CypherBuilder({ toolsetHash: 'non-existent-hash' })
      const getStatement = builder.getToolsetByHash()
      const result = await session.run(getStatement.cypher, getStatement.params)

      expect(result.records).toHaveLength(0)
    })

    it('should return toolset with empty tools array for toolset with no tools', async () => {
      const builder = new CypherBuilder({ toolsetHash: lifecycleHash })

      // Create toolset with no tools
      const migrateResult = builder.migrate({ tools: [] })
      await session.run(migrateResult.cypher, migrateResult.params)

      const getStatement = builder.getToolsetByHash()
      const result = await session.run(getStatement.cypher, getStatement.params)

      expect(result.records).toHaveLength(1)
      const record = result.records[0]
      expect(record.get('hash')).toBe(lifecycleHash)
      expect(record.get('toolCount')).toBe(0)
      // The tools array may contain a null entry when there are no tools
      const tools = record.get('tools')
      expect(tools.filter((t: any) => t.name !== null)).toHaveLength(0)
    })

    it('should return complete tool structure with parameters and return types', async () => {
      const builder = new CypherBuilder({ toolsetHash: lifecycleHash })

      const migrateResult = builder.migrate({
        tools: [
          {
            name: 'completeTool',
            tool: mockTool,
            embeddings: {
              tool: mockVector,
              parameters: { action: mockVector, target: mockVector },
              returnType: mockVector,
            },
          },
        ],
      })
      await session.run(migrateResult.cypher, migrateResult.params)

      const getStatement = builder.getToolsetByHash()
      const result = await session.run(getStatement.cypher, getStatement.params)

      expect(result.records).toHaveLength(1)
      const tools = result.records[0].get('tools')
      expect(tools).toHaveLength(1)

      const tool = tools[0]
      expect(tool.name).toBe('completeTool')
      expect(tool.description).toBe('A lifecycle test tool')
      expect(tool.parameters).toHaveLength(2)
      expect(tool.returnType).toBeDefined()
      expect(tool.returnType.type).toBe('object')
    })
  })

  describe('deleteToolsetByHash', () => {
    it('should return no records for non-existent hash', async () => {
      const builder = new CypherBuilder({ toolsetHash: 'non-existent-hash' })
      const deleteStatement = builder.deleteToolsetByHash()
      const result = await session.run(
        deleteStatement.cypher,
        deleteStatement.params
      )

      // MATCH returns no rows when toolset doesn't exist, so no records
      expect(result.records).toHaveLength(0)
    })

    it('should delete toolset with multiple tools', async () => {
      const builder = new CypherBuilder({ toolsetHash: lifecycleHash })

      const migrateResult = builder.migrate({
        tools: [
          {
            name: 'tool1',
            tool: mockTool,
            embeddings: {
              tool: mockVector,
              parameters: { action: mockVector, target: mockVector },
              returnType: mockVector,
            },
          },
          {
            name: 'tool2',
            tool: mockTool,
            embeddings: {
              tool: mockVector,
              parameters: { action: mockVector, target: mockVector },
              returnType: mockVector,
            },
          },
          {
            name: 'tool3',
            tool: mockTool,
            embeddings: {
              tool: mockVector,
              parameters: { action: mockVector, target: mockVector },
              returnType: mockVector,
            },
          },
        ],
      })
      await session.run(migrateResult.cypher, migrateResult.params)

      // Verify 3 tools exist
      const beforeDelete = await session.run(
        `MATCH (ts:ToolSet {hash: $hash})-[:HAS_TOOL]->(t:Tool) RETURN count(t) AS count`,
        { hash: lifecycleHash }
      )
      expect(beforeDelete.records[0].get('count').toNumber()).toBe(3)

      // Delete
      const deleteStatement = builder.deleteToolsetByHash()
      const result = await session.run(
        deleteStatement.cypher,
        deleteStatement.params
      )

      expect(result.records[0].get('deletedToolsets').toNumber()).toBe(1)
      expect(result.records[0].get('deletedTools').toNumber()).toBe(3)
      expect(result.records[0].get('deletedParams').toNumber()).toBe(6) // 2 params per tool
      expect(result.records[0].get('deletedReturnTypes').toNumber()).toBe(3)

      // Verify nothing remains
      const afterDelete = await session.run(
        `MATCH (n) WHERE n:ToolSet OR n:Tool OR n:Parameter OR n:ReturnType RETURN count(n) AS count`
      )
      expect(afterDelete.records[0].get('count').toNumber()).toBe(0)
    })

    it('should only delete specified toolset, leaving others intact', async () => {
      // Create two toolsets
      const builder1 = new CypherBuilder({ toolsetHash: 'hash-to-delete' })
      const builder2 = new CypherBuilder({ toolsetHash: 'hash-to-keep' })

      const migrate1 = builder1.migrate({
        tools: [
          {
            name: 'deleteTool',
            tool: mockTool,
            embeddings: {
              tool: mockVector,
              parameters: { action: mockVector, target: mockVector },
              returnType: mockVector,
            },
          },
        ],
      })

      const migrate2 = builder2.migrate({
        tools: [
          {
            name: 'keepTool',
            tool: mockTool,
            embeddings: {
              tool: mockVector,
              parameters: { action: mockVector, target: mockVector },
              returnType: mockVector,
            },
          },
        ],
      })

      await session.run(migrate1.cypher, migrate1.params)
      await session.run(migrate2.cypher, migrate2.params)

      // Verify both exist
      const bothExist = await session.run(
        `MATCH (ts:ToolSet) RETURN count(ts) AS count`
      )
      expect(bothExist.records[0].get('count').toNumber()).toBe(2)

      // Delete only the first one
      const deleteStatement = builder1.deleteToolsetByHash()
      await session.run(deleteStatement.cypher, deleteStatement.params)

      // Verify only the second one remains
      const remaining = await session.run(
        `MATCH (ts:ToolSet) RETURN ts.hash AS hash`
      )
      expect(remaining.records).toHaveLength(1)
      expect(remaining.records[0].get('hash')).toBe('hash-to-keep')

      // Verify the kept toolset's tool still exists
      const keptTool = await session.run(
        `MATCH (ts:ToolSet {hash: 'hash-to-keep'})-[:HAS_TOOL]->(t:Tool) RETURN t.name AS name`
      )
      expect(keptTool.records).toHaveLength(1)
      expect(keptTool.records[0].get('name')).toBe('keepTool')
    })
  })

  describe('Change Detection', () => {
    it('should allow detecting changes by comparing hashes', async () => {
      // This test demonstrates how clients can detect changes
      // by comparing the hash of the current toolset with the stored hash

      const originalHash = 'original-toolset-hash'
      const changedHash = 'changed-toolset-hash'

      // Create original toolset
      const originalBuilder = new CypherBuilder({ toolsetHash: originalHash })
      const originalMigrate = originalBuilder.migrate({
        tools: [
          {
            name: 'myTool',
            tool: mockTool,
            embeddings: {
              tool: mockVector,
              parameters: { action: mockVector, target: mockVector },
              returnType: mockVector,
            },
          },
        ],
      })
      await session.run(originalMigrate.cypher, originalMigrate.params)

      // Simulate client checking if toolset exists
      const checkOriginal = originalBuilder.getToolsetByHash()
      const originalResult = await session.run(
        checkOriginal.cypher,
        checkOriginal.params
      )
      expect(originalResult.records).toHaveLength(1) // Toolset exists

      // Simulate tool definition change (which would produce a new hash)
      const changedBuilder = new CypherBuilder({ toolsetHash: changedHash })
      const checkChanged = changedBuilder.getToolsetByHash()
      const changedResult = await session.run(
        checkChanged.cypher,
        checkChanged.params
      )
      expect(changedResult.records).toHaveLength(0) // New hash doesn't exist

      // Client detects change: changedHash not in DB means tools changed
      // Client should:
      // 1. Delete old toolset
      // 2. Create new toolset with new hash

      // Delete old
      const deleteOld = originalBuilder.deleteToolsetByHash()
      await session.run(deleteOld.cypher, deleteOld.params)

      // Create new
      const newMigrate = changedBuilder.migrate({
        tools: [
          {
            name: 'myTool',
            tool: { ...mockTool, description: 'Updated description' },
            embeddings: {
              tool: mockVector,
              parameters: { action: mockVector, target: mockVector },
              returnType: mockVector,
            },
          },
        ],
      })
      await session.run(newMigrate.cypher, newMigrate.params)

      // Verify new toolset exists
      const verifyNew = changedBuilder.getToolsetByHash()
      const verifyResult = await session.run(verifyNew.cypher, verifyNew.params)
      expect(verifyResult.records).toHaveLength(1)
      expect(verifyResult.records[0].get('hash')).toBe(changedHash)
    })
  })
})
