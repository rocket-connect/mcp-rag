import neo4j, { Driver, Session } from 'neo4j-driver'

let driver: Driver | null = null

export function getDriver(): Driver {
  if (!driver) {
    const uri = process.env.NEO4J_URI || 'neo4j://localhost:7687'
    const username = process.env.NEO4J_USERNAME || 'neo4j'
    const password = process.env.NEO4J_PASSWORD || 'testpassword'

    driver = neo4j.driver(uri, neo4j.auth.basic(username, password))
  }

  return driver
}

export async function clearDatabase(session: Session): Promise<void> {
  await session.run('MATCH (n) DETACH DELETE n')
}

export async function closeDriver(): Promise<void> {
  if (driver) {
    await driver.close()
    driver = null
  }
}
