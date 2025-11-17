# MCP RAG

A lightweight wrapper around AI SDK that intelligently indexes and retrieves MCP tools using graph-based vector search.

## What It Does

MCP RAG indexes your MCP toolset into a graph structure and uses Neo4j-powered vector search to retrieve relevant tool subsets from large collections. This dramatically reduces context overhead when working with extensive tool libraries.

See our [benchmarks](./benchmarks/latest.md) for performance improvements.

## Installation

```bash
npm install @mcp-rag/client @ai-sdk/openai neo4j-driver ai
```

Set your OpenAI API key:

```bash
export OPENAI_API_KEY=your_key_here
```

## Quick Start

```typescript
import { createMCPRag } from '@mcp-rag/client'
import { openai } from '@ai-sdk/openai'
import neo4j from 'neo4j-driver'
import { tool } from 'ai'
import { z } from 'zod'

const driver = neo4j.driver(
  'neo4j://localhost:7687',
  neo4j.auth.basic('neo4j', 'password')
)

const rag = createMCPRag({
  model: openai('gpt-4'),
  neo4j: driver,
  tools: {
    searchDocs: tool({
      /* ... */
    }),
    queryDatabase: tool({
      /* ... */
    }),
    sendEmail: tool({
      /* ... */
    }),
    fetchWeather: tool({
      /* ... */
    }),
    analyzeImage: tool({
      /* ... */
    }),
    // ... hundreds more tools
  },
})

await rag.sync()
const result = await rag.generateText({
  prompt: 'Search for API docs',
})
```

## Features

- **Graph-based indexing** – Tools are indexed with their relationships and metadata
- **Vector search** – Neo4j-powered semantic search for tool retrieval
- **AI SDK compatible** – Drop-in wrapper that works with your existing AI SDK setup
- **Selective loading** – Only load the tools you need for each request

## Documentation

- [API Reference](./docs/api.md)
- [Configuration](./docs/configuration.md)
- [Examples](./examples)

## License

MIT
