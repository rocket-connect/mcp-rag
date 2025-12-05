/* eslint-disable @typescript-eslint/ban-ts-comment */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createMCPRag } from '../../src/'
import { openai } from '@ai-sdk/openai'
import neo4j, { Driver, Session } from 'neo4j-driver'
import { tool } from 'ai'
import { z } from 'zod'

/**
 * Lifecycle Integration Tests for MCPRagClient
 *
 * Tests the full lifecycle of toolset management through the client:
 * 1. Setup - Create toolset with sync()
 * 2. Get - Retrieve toolset by hash with getToolsetByHash()
 * 3. Detect Changes - Verify hash changes when tools change
 * 4. Teardown - Delete toolset by hash with deleteToolsetByHash()
 */
describe('Client Toolset Lifecycle Integration Tests', () => {
  let driver: Driver
  let session: Session

  const mockTool = tool({
    description: 'A lifecycle test tool',
    inputSchema: z.object({
      action: z.string().describe('Action to perform'),
    }),
    // @ts-ignore
    execute: async ({ action }) => ({ action, status: 'ok' }),
  })

  const mockTool2 = tool({
    description: 'A second lifecycle test tool',
    inputSchema: z.object({
      input: z.string().describe('Input value'),
    }),
    // @ts-ignore
    execute: async ({ input }) => ({ input, processed: true }),
  })

  async function clearDatabase(): Promise<void> {
    await session.run('MATCH (n) DETACH DELETE n')
  }

  beforeAll(async () => {
    const uri = process.env.NEO4J_URI || 'neo4j://localhost:7687'
    const username = process.env.NEO4J_USERNAME || 'neo4j'
    const password = process.env.NEO4J_PASSWORD || 'testpassword'

    driver = neo4j.driver(uri, neo4j.auth.basic(username, password))
    session = driver.session()
    await driver.verifyConnectivity()
  })

  beforeEach(async () => {
    await clearDatabase()
  })

  afterAll(async () => {
    await session.close()
    await driver.close()
  })

  describe('Full Lifecycle: Setup -> Get -> Update -> Teardown', () => {
    it('should complete full toolset lifecycle', async () => {
      // ============ STEP 1: SETUP - Create initial toolset ============
      const client = createMCPRag({
        model: openai('gpt-4o-mini'),
        openaiApiKey: process.env.OPENAI_API_KEY || '',
        neo4j: driver,
        tools: {
          lifecycleTool: mockTool,
        },
      })

      // Sync to create toolset in Neo4j
      const syncResult = await client.sync()
      const initialHash = syncResult.hash

      expect(initialHash).toBeDefined()
      expect(typeof initialHash).toBe('string')

      // ============ STEP 2: GET - Retrieve toolset by hash ============
      const toolsetInfo = await client.getToolsetByHash(initialHash)

      expect(toolsetInfo).not.toBeNull()
      expect(toolsetInfo!.hash).toBe(initialHash)
      expect(toolsetInfo!.toolCount).toBe(1)
      expect(toolsetInfo!.tools).toHaveLength(1)
      expect(toolsetInfo!.tools[0].name).toBe('lifecycleTool')
      expect(toolsetInfo!.tools[0].description).toBe('A lifecycle test tool')
      expect(toolsetInfo!.tools[0].parameters).toHaveLength(1)
      expect(toolsetInfo!.updatedAt).toBeInstanceOf(Date)

      // ============ STEP 3: UPDATE - Add a new tool and sync ============
      client.addTool('newTool', mockTool2)
      const newHash = client.getToolsetHash()

      // Hash should have changed
      expect(newHash).not.toBe(initialHash)

      // Sync the updated toolset
      const updatedSyncResult = await client.sync()
      expect(updatedSyncResult.hash).toBe(newHash)

      // Verify new toolset exists
      const newToolsetInfo = await client.getToolsetByHash(newHash)
      expect(newToolsetInfo).not.toBeNull()
      expect(newToolsetInfo!.toolCount).toBe(2)
      expect(newToolsetInfo!.tools).toHaveLength(2)

      // Both toolsets should exist in the database
      const oldToolsetStillExists = await client.getToolsetByHash(initialHash)
      expect(oldToolsetStillExists).not.toBeNull()

      // ============ STEP 4: TEARDOWN - Delete old toolset by hash ============
      const deleteResult = await client.deleteToolsetByHash(initialHash)

      expect(deleteResult.deletedToolsets).toBe(1)
      expect(deleteResult.deletedTools).toBe(1)
      expect(deleteResult.deletedParams).toBe(1)
      expect(deleteResult.deletedReturnTypes).toBe(1)

      // Verify old toolset is gone
      const oldToolsetGone = await client.getToolsetByHash(initialHash)
      expect(oldToolsetGone).toBeNull()

      // Verify new toolset still exists
      const newToolsetStillExists = await client.getToolsetByHash(newHash)
      expect(newToolsetStillExists).not.toBeNull()
      expect(newToolsetStillExists!.toolCount).toBe(2)

      // Cleanup
      await client.deleteToolsetByHash(newHash)
    })
  })

  describe('getToolsetByHash', () => {
    it('should return null for non-existent hash', async () => {
      const client = createMCPRag({
        model: openai('gpt-4o-mini'),
        openaiApiKey: process.env.OPENAI_API_KEY || '',
        neo4j: driver,
        tools: { lifecycleTool: mockTool },
      })

      const result = await client.getToolsetByHash('non-existent-hash')
      expect(result).toBeNull()
    })

    it('should return toolset with empty tools array for toolset with no tools', async () => {
      const client = createMCPRag({
        model: openai('gpt-4o-mini'),
        openaiApiKey: process.env.OPENAI_API_KEY || '',
        neo4j: driver,
        tools: {},
      })

      await client.sync()
      const hash = client.getToolsetHash()

      const result = await client.getToolsetByHash(hash)

      expect(result).not.toBeNull()
      expect(result!.hash).toBe(hash)
      expect(result!.toolCount).toBe(0)
      // Filter out any null entries
      const validTools = result!.tools.filter(t => t && t.name !== null)
      expect(validTools).toHaveLength(0)
    })

    it('should return complete tool structure with parameters and return types', async () => {
      const client = createMCPRag({
        model: openai('gpt-4o-mini'),
        openaiApiKey: process.env.OPENAI_API_KEY || '',
        neo4j: driver,
        tools: { completeTool: mockTool },
      })

      await client.sync()
      const hash = client.getToolsetHash()

      const result = await client.getToolsetByHash(hash)

      expect(result).not.toBeNull()
      expect(result!.tools).toHaveLength(1)

      const storedTool = result!.tools[0]
      expect(storedTool.name).toBe('completeTool')
      expect(storedTool.description).toBe('A lifecycle test tool')
      expect(storedTool.parameters).toHaveLength(1)

      // Check parameter structure
      const actionParam = storedTool.parameters.find(p => p.name === 'action')
      expect(actionParam).toBeDefined()
      expect(actionParam!.type).toBe('string')
      expect(actionParam!.description).toBe('Action to perform')

      // Check return type
      expect(storedTool.returnType).toBeDefined()
      expect(storedTool.returnType.type).toBe('object')
    })
  })

  describe('deleteToolsetByHash', () => {
    it('should return zero counts for non-existent hash', async () => {
      const client = createMCPRag({
        model: openai('gpt-4o-mini'),
        openaiApiKey: process.env.OPENAI_API_KEY || '',
        neo4j: driver,
        tools: { lifecycleTool: mockTool },
      })

      const result = await client.deleteToolsetByHash('non-existent-hash')

      expect(result.deletedToolsets).toBe(0)
      expect(result.deletedTools).toBe(0)
      expect(result.deletedParams).toBe(0)
      expect(result.deletedReturnTypes).toBe(0)
    })

    it('should delete toolset with multiple tools', async () => {
      const client = createMCPRag({
        model: openai('gpt-4o-mini'),
        openaiApiKey: process.env.OPENAI_API_KEY || '',
        neo4j: driver,
        tools: {
          tool1: mockTool,
          tool2: mockTool,
          tool3: mockTool,
        },
      })

      await client.sync()
      const hash = client.getToolsetHash()

      // Verify 3 tools exist
      const beforeDelete = await client.getToolsetByHash(hash)
      expect(beforeDelete!.toolCount).toBe(3)

      // Delete
      const result = await client.deleteToolsetByHash(hash)

      expect(result.deletedToolsets).toBe(1)
      expect(result.deletedTools).toBe(3)
      expect(result.deletedParams).toBe(3) // 1 param per tool
      expect(result.deletedReturnTypes).toBe(3)

      // Verify nothing remains
      const afterDelete = await client.getToolsetByHash(hash)
      expect(afterDelete).toBeNull()
    })

    it('should only delete specified toolset, leaving others intact', async () => {
      // Create client with one tool
      const client = createMCPRag({
        model: openai('gpt-4o-mini'),
        openaiApiKey: process.env.OPENAI_API_KEY || '',
        neo4j: driver,
        tools: { deleteTool: mockTool },
      })

      // Sync first toolset
      await client.sync()
      const hash1 = client.getToolsetHash()

      // Add another tool (creates new hash) and sync again
      client.addTool('keepTool', mockTool2)
      const hash2 = client.getToolsetHash()
      expect(hash2).not.toBe(hash1)

      // Force sync of the new toolset
      await client.sync()

      // Both toolsets should now exist
      expect(await client.getToolsetByHash(hash1)).not.toBeNull()
      expect(await client.getToolsetByHash(hash2)).not.toBeNull()

      // Delete only the first one
      await client.deleteToolsetByHash(hash1)

      // Verify first is gone
      expect(await client.getToolsetByHash(hash1)).toBeNull()

      // Verify second still exists
      const remaining = await client.getToolsetByHash(hash2)
      expect(remaining).not.toBeNull()
      expect(remaining!.toolCount).toBe(2)

      // Cleanup
      await client.deleteToolsetByHash(hash2)
    })
  })

  describe('Change Detection', () => {
    it('should detect tool changes via hash comparison', async () => {
      const client = createMCPRag({
        model: openai('gpt-4o-mini'),
        openaiApiKey: process.env.OPENAI_API_KEY || '',
        neo4j: driver,
        tools: { myTool: mockTool },
      })

      // Get original hash
      const originalHash = client.getToolsetHash()

      // Sync original toolset
      await client.sync()

      // Verify original exists
      const originalExists = await client.getToolsetByHash(originalHash)
      expect(originalExists).not.toBeNull()

      // Simulate tool definition change by adding a tool
      client.addTool('anotherTool', mockTool2)
      const changedHash = client.getToolsetHash()

      // Verify hash changed
      expect(changedHash).not.toBe(originalHash)

      // Changed hash doesn't exist in DB yet
      const changedNotYetSynced = await client.getToolsetByHash(changedHash)
      expect(changedNotYetSynced).toBeNull()

      // Client workflow: detect change, delete old, create new
      await client.deleteToolsetByHash(originalHash)
      await client.sync()

      // Verify old is gone, new exists
      expect(await client.getToolsetByHash(originalHash)).toBeNull()
      const newToolset = await client.getToolsetByHash(changedHash)
      expect(newToolset).not.toBeNull()
      expect(newToolset!.toolCount).toBe(2)
    })

    it('should produce same hash for same tools', async () => {
      const client1 = createMCPRag({
        model: openai('gpt-4o-mini'),
        openaiApiKey: process.env.OPENAI_API_KEY || '',
        neo4j: driver,
        tools: { myTool: mockTool },
      })

      const client2 = createMCPRag({
        model: openai('gpt-4o-mini'),
        openaiApiKey: process.env.OPENAI_API_KEY || '',
        neo4j: driver,
        tools: { myTool: mockTool },
      })

      expect(client1.getToolsetHash()).toBe(client2.getToolsetHash())
    })

    it('should produce different hash when tool description changes', async () => {
      const originalTool = tool({
        description: 'Original description',
        inputSchema: z.object({ input: z.string() }),
        // @ts-ignore
        execute: async () => ({}),
      })

      const modifiedTool = tool({
        description: 'Modified description',
        inputSchema: z.object({ input: z.string() }),
        // @ts-ignore
        execute: async () => ({}),
      })

      const client1 = createMCPRag({
        model: openai('gpt-4o-mini'),
        openaiApiKey: process.env.OPENAI_API_KEY || '',
        neo4j: driver,
        tools: { myTool: originalTool },
      })

      const client2 = createMCPRag({
        model: openai('gpt-4o-mini'),
        openaiApiKey: process.env.OPENAI_API_KEY || '',
        neo4j: driver,
        tools: { myTool: modifiedTool },
      })

      expect(client1.getToolsetHash()).not.toBe(client2.getToolsetHash())
    })
  })

  describe('Tool Management', () => {
    it('should update hash when adding a tool', async () => {
      const client = createMCPRag({
        model: openai('gpt-4o-mini'),
        openaiApiKey: process.env.OPENAI_API_KEY || '',
        neo4j: driver,
        tools: { tool1: mockTool },
      })

      const hashBefore = client.getToolsetHash()
      client.addTool('tool2', mockTool2)
      const hashAfter = client.getToolsetHash()

      expect(hashAfter).not.toBe(hashBefore)
    })

    it('should update hash when removing a tool', async () => {
      const client = createMCPRag({
        model: openai('gpt-4o-mini'),
        openaiApiKey: process.env.OPENAI_API_KEY || '',
        neo4j: driver,
        tools: { tool1: mockTool, tool2: mockTool2 },
      })

      const hashBefore = client.getToolsetHash()
      client.removeTool('tool2')
      const hashAfter = client.getToolsetHash()

      expect(hashAfter).not.toBe(hashBefore)
    })

    it('should reflect tool changes in synced toolset', async () => {
      const client = createMCPRag({
        model: openai('gpt-4o-mini'),
        openaiApiKey: process.env.OPENAI_API_KEY || '',
        neo4j: driver,
        tools: { tool1: mockTool },
      })

      // Initial sync
      await client.sync()
      const hash1 = client.getToolsetHash()

      const toolset = await client.getToolsetByHash(hash1)
      expect(toolset!.toolCount).toBe(1)

      // Verify hash changes when tools change
      client.addTool('tool2', mockTool2)
      const hash2 = client.getToolsetHash()
      expect(hash2).not.toBe(hash1)

      client.removeTool('tool1')
      const hash3 = client.getToolsetHash()
      expect(hash3).not.toBe(hash2)
      expect(hash3).not.toBe(hash1)

      // getTools should reflect the current state
      const tools = client.getTools()
      expect(Object.keys(tools)).toHaveLength(1)
      expect(tools['tool2']).toBeDefined()

      // Cleanup
      await client.deleteToolsetByHash(hash1)
    })
  })
})
