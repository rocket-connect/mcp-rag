# @mcp-rag/client

Context-aware tool management for AI SDK using graph-based vector search.

## Installation

```bash
npm install @mcp-rag/client @ai-sdk/openai neo4j-driver ai
```

## Quick Start

```typescript
import { createMCPRag } from '@mcp-rag/client'
import { openai } from '@ai-sdk/openai'
import neo4j from 'neo4j-driver'

const driver = neo4j.driver(
  'neo4j://localhost:7687',
  neo4j.auth.basic('neo4j', 'password')
)

const rag = createMCPRag({
  model: openai('gpt-4o-mini'),
  neo4j: driver,
  tools: {
    // your tools here
  },
})

await rag.sync()
const result = await rag.generateText({
  prompt: 'Your prompt here',
})
```

## Features

- 🔍 **Vector Search** - Semantic tool retrieval using Neo4j
- 🎯 **Selective Loading** - Only load relevant tools per request
- 🔗 **Graph-Based Indexing** - Tools indexed with relationships
- 🤖 **AI SDK Compatible** - Drop-in wrapper for existing setups

## Documentation

Full documentation available at [mcp-rag](https://github.com/rocket-connect/mcp-rag)

## License

MIT
