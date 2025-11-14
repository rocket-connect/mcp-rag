/**
 * @mcp-rag/neo4j - Neo4j utilities for MCP RAG
 * Handles Cypher query building and test assertions
 */

import type { Session } from 'neo4j-driver'
import type { Tool } from 'ai'

// ============================================================================
// Query Builder
// ============================================================================

export interface CypherStatement {
  cypher: string
  params: Record<string, any>
}

export class CypherBuilder {
  /**
   * Build constraint creation query
   */
  static createToolConstraint(): CypherStatement {
    return {
      cypher: `
        CREATE CONSTRAINT tool_name_unique IF NOT EXISTS
        FOR (t:Tool) REQUIRE t.name IS UNIQUE
      `,
      params: {},
    }
  }

  /**
   * Build tool count query
   */
  static countTools(): CypherStatement {
    return {
      cypher: 'MATCH (t:Tool) RETURN count(t) as count',
      params: {},
    }
  }

  /**
   * Build tool creation query
   */
  static createTool(name: string, tool: Tool): CypherStatement {
    return {
      cypher: `
        MERGE (t:Tool {name: $name})
        SET t.description = $description,
            t.schema = $schema,
            t.updatedAt = datetime()
      `,
      params: {
        name,
        description: tool.description || '',
        schema: tool.inputSchema,
      },
    }
  }

  /**
   * Build query to get all tools
   */
  static getAllTools(): CypherStatement {
    return {
      cypher: 'MATCH (t:Tool) RETURN t',
      params: {},
    }
  }

  /**
   * Build query to delete all tools
   */
  static deleteAllTools(): CypherStatement {
    return {
      cypher: 'MATCH (t:Tool) DETACH DELETE t',
      params: {},
    }
  }

  /**
   * Build query to find tool by name
   */
  static findToolByName(name: string): CypherStatement {
    return {
      cypher: 'MATCH (t:Tool {name: $name}) RETURN t',
      params: { name },
    }
  }
}

// ============================================================================
// Migration Helpers
// ============================================================================

export interface MigrationConfig {
  shouldMigrate?: (session: Session) => Promise<boolean>
  migrate?: (session: Session, tools: Record<string, Tool>) => Promise<void>
  onBeforeMigrate?: (
    statements: CypherStatement[]
  ) => Promise<CypherStatement[]>
}

export class MigrationHelper {
  /**
   * Check if migration is needed (default implementation)
   */
  static async shouldMigrate(session: Session): Promise<boolean> {
    const query = CypherBuilder.countTools()
    const result = await session.run(query.cypher, query.params)
    const count = result.records[0]?.get('count').toNumber() || 0
    return count === 0
  }

  /**
   * Run default migration
   */
  static async migrate(
    session: Session,
    tools: Record<string, Tool>
  ): Promise<void> {
    // Create constraint
    const constraintQuery = CypherBuilder.createToolConstraint()
    await session.run(constraintQuery.cypher, constraintQuery.params)

    // Create tools
    for (const [name, tool] of Object.entries(tools)) {
      const toolQuery = CypherBuilder.createTool(name, tool)
      await session.run(toolQuery.cypher, toolQuery.params)
    }
  }
}

// ============================================================================
// Test Utilities
// ============================================================================

export interface TestAssertions {
  /**
   * Assert that a tool exists in the database
   */
  assertToolExists(session: Session, name: string): Promise<void>

  /**
   * Assert tool count matches expected
   */
  assertToolCount(session: Session, expected: number): Promise<void>

  /**
   * Assert tool has specific properties
   */
  assertToolProperties(
    session: Session,
    name: string,
    properties: Record<string, any>
  ): Promise<void>
}

export class Neo4jTestHelper implements TestAssertions {
  async assertToolExists(session: Session, name: string): Promise<void> {
    const query = CypherBuilder.findToolByName(name)
    const result = await session.run(query.cypher, query.params)

    if (result.records.length === 0) {
      throw new Error(`Tool "${name}" does not exist in database`)
    }
  }

  async assertToolCount(session: Session, expected: number): Promise<void> {
    const query = CypherBuilder.countTools()
    const result = await session.run(query.cypher, query.params)
    const actual = result.records[0]?.get('count').toNumber() || 0

    if (actual !== expected) {
      throw new Error(
        `Expected ${expected} tools, but found ${actual} in database`
      )
    }
  }

  async assertToolProperties(
    session: Session,
    name: string,
    properties: Record<string, any>
  ): Promise<void> {
    const query = CypherBuilder.findToolByName(name)
    const result = await session.run(query.cypher, query.params)

    if (result.records.length === 0) {
      throw new Error(`Tool "${name}" does not exist in database`)
    }

    const tool = result.records[0].get('t')
    const actualProps = tool.properties

    for (const [key, expectedValue] of Object.entries(properties)) {
      const actualValue = actualProps[key]

      if (actualValue !== expectedValue) {
        throw new Error(
          `Tool "${name}" property "${key}" expected "${expectedValue}" but got "${actualValue}"`
        )
      }
    }
  }

  /**
   * Clean up all tools from database (useful for test teardown)
   */
  async cleanup(session: Session): Promise<void> {
    const query = CypherBuilder.deleteAllTools()
    await session.run(query.cypher, query.params)
  }
}

// ============================================================================
// Exports
// ============================================================================

export { Session } from 'neo4j-driver'
