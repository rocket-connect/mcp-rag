import neo4j from 'neo4j-driver'

const uri = process.env.NEO4J_URI || 'neo4j://localhost:7687'
const username = process.env.NEO4J_USERNAME || 'neo4j'
const password = process.env.NEO4J_PASSWORD || 'testpassword'

export const driver = neo4j.driver(uri, neo4j.auth.basic(username, password))

export async function connect() {
  console.log('Connecting to Neo4j')
  await driver.verifyConnectivity()
  console.log(`Connected to Neo4j at ${uri}`)
}
