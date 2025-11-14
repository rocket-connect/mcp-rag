import neo4j, { Driver, Session, QueryResult } from 'neo4j-driver'

export interface Neo4jTestConfig {
  uri?: string
  username?: string
  password?: string
  database?: string
}

export class Neo4jTestHelper {
  private driver: Driver
  private session: Session | null = null
  private database: string

  constructor(config: Neo4jTestConfig = {}) {
    const uri = config.uri || process.env.NEO4J_URI || 'neo4j://localhost:7687'
    const username = config.username || process.env.NEO4J_USERNAME || 'neo4j'
    const password =
      config.password || process.env.NEO4J_PASSWORD || 'testpassword'
    this.database = config.database || process.env.NEO4J_DATABASE || 'neo4j'

    this.driver = neo4j.driver(uri, neo4j.auth.basic(username, password))
  }

  async connect(): Promise<void> {
    this.session = this.driver.session({ database: this.database })
    await this.session.run('RETURN 1')
  }

  async clearDatabase(): Promise<void> {
    if (!this.session) {
      throw new Error('Not connected. Call connect() first.')
    }

    await this.session.run('MATCH (n) DETACH DELETE n')
  }

  async executeCypher(
    cypher: string,
    params?: Record<string, unknown>
  ): Promise<QueryResult> {
    if (!this.session) {
      throw new Error('Not connected. Call connect() first.')
    }

    return await this.session.run(cypher, params)
  }

  async close(): Promise<void> {
    if (this.session) {
      await this.session.close()
      this.session = null
    }
    await this.driver.close()
  }

  getDriver(): Driver {
    return this.driver
  }

  getSession(): Session {
    if (!this.session) {
      throw new Error('Not connected. Call connect() first.')
    }
    return this.session
  }
}
