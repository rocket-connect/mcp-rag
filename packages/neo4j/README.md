# @mcp-rag/neo4j

Neo4j utilities for MCP RAG - Cypher query builder and test assertions.

## Installation

```bash
npm install @mcp-rag/neo4j neo4j-driver
```

## Usage

```typescript
import { CypherBuilder } from '@mcp-rag/neo4j'
import neo4j from 'neo4j-driver'

const builder = new CypherBuilder({
  toolsetHash: 'unique-hash',
})

// Create vector index
const indexQuery = CypherBuilder.createVectorIndex({
  indexName: 'tool_vector_index',
  dimensions: 1536,
})

// Vector search
const searchQuery = builder.vectorSearchDecomposed({
  vector: embedding,
  limit: 5,
  depth: 'mid',
})
```

## Features

- 🔧 **Cypher Query Builder** - Type-safe query construction
- ✅ **Test Utilities** - Assertions for Neo4j testing
- 📊 **Vector Search** - Graph-based semantic search
- 🗂️ **Tool Decomposition** - Granular tool indexing

## Documentation

Full documentation available at [mcp-rag](https://github.com/rocket-connect/mcp-rag)

## License

MIT
