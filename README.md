# MCP RAG

[![npm version](https://badge.fury.io/js/@mcp-rag%2Fclient.svg)](https://badge.fury.io/js/@mcp-rag%2Fclient) [![CI](https://github.com/rocket-connect/mcp-rag/actions/workflows/ci.yml/badge.svg)](https://github.com/rocket-connect/mcp-rag/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A lightweight wrapper around AI SDK that intelligently indexes and retrieves MCP tools using graph-based vector search.

<div align="center">
  <img src="/docs/neo4j-model.png" alt="Neo4j Model" width="60%" />
</div>

## What It Does

MCP RAG indexes your MCP toolset into a graph structure and uses Neo4j-powered vector search to retrieve relevant tool subsets from large collections. This dramatically reduces context overhead when working with extensive tool libraries.

## Benchmarks

MCP RAG sees improvements in both efficiency and performance compared to baseline tool selection, while maintaining the same level of accuracy.

**Benchmark Methodology:** Tests simulate a realistic conversation with 5 sequential prompts, each triggering a different tool as context accumulates—mirroring real-world multi-turn interactions. All tests use the complete toolset from the GitHub MCP Server (90+ tools) to represent authentic large-scale tool selection scenarios.

See the proof in the pudding:

**[Base Tool Selection Results](./benchmarks/results/base-tool-selection/latest.md)** - Baseline approach passing all tools to the model.

**[RAG Tool Selection Results](./benchmarks/results/rag-tool-selection/latest.md)** - RAG-powered intelligent filtering with vector search.

**[View Test Suite](./benchmarks/src/rag.test.ts)** - Complete benchmark implementation and test cases.

## Installation

[![npm version](https://badge.fury.io/js/@mcp-rag%2Fclient.svg)](https://badge.fury.io/js/@mcp-rag%2Fclient)

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

<details>
<summary><strong>What does <code>rag.sync()</code> do?</strong></summary>

<br>

The `sync()` method performs a complete synchronization of your tools to Neo4j, creating the graph structure needed for semantic search. Here's what happens under the hood:

1. **Creates Vector Index**: Sets up a Neo4j vector index for similarity search using 1536-dimensional embeddings (OpenAI's `text-embedding-3-small` model)

2. **Generates Embeddings**: For each tool in your toolset, it creates embeddings for:
   - The tool itself (name + description)
   - Each parameter (name + description)
   - The return type

3. **Builds Graph Structure**: Creates a graph in Neo4j with the following relationships:
   - `ToolSet` nodes that group tools together
   - `Tool` nodes with their embeddings
   - `Parameter` nodes connected to tools via `HAS_PARAM` relationships
   - `ReturnType` nodes connected to tools via `RETURNS` relationships

4. **Idempotent by Design**: The sync process uses `MERGE` operations, so running it multiple times won't create duplicates. It will update existing nodes if the toolset has changed.

**When to call it:**

- After initial client creation (required before first use)
- After adding or removing tools with `addTool()` or `removeTool()`
- To force a re-index of your tools

The sync process is optimized to only run when necessary - subsequent calls to `generateText()` won't re-sync unless you explicitly call `sync()` again or modify the toolset.

</details>

<details>
<summary><strong>What does <code>rag.generateText()</code> do?</strong></summary>

<br>

The `generateText()` method is a smart wrapper around the AI SDK's `generateText` function that adds automatic tool selection. Here's the workflow:

1. **Ensures Migration**: Automatically calls the sync process if tools haven't been indexed yet

2. **Semantic Tool Selection**:
   - Generates an embedding for your prompt
   - Performs a Neo4j vector similarity search to find the most relevant tools
   - By default, selects up to 10 tools (configurable via `maxActiveTools`)
   - You can override this by passing `activeTools` array explicitly

3. **Calls AI SDK**: Passes only the selected subset of tools to the AI SDK's native `generateText` function along with your prompt and any additional options

4. **Returns Full Result**: Returns the complete AI SDK result wrapped in a `GenerateTextResultWrapper` object, giving you access to:
   - Tool calls made by the model
   - Token usage statistics
   - Response content
   - All other AI SDK metadata

**Key Benefits:**

- **Reduced Context Size**: Only relevant tools are sent to the LLM, saving tokens
- **Better Performance**: Fewer tools mean faster response times
- **Same AI SDK Experience**: Accepts all standard AI SDK parameters and returns familiar result structures

</details>

<div align="center">
  <img src="/docs/example-tools-model.png" alt="Tools Select Model" width="60%" />
</div>

## Examples

### GitHub MCP Server Demo

Want to see MCP RAG in action? Check out our complete example that demonstrates intelligent tool selection with the GitHub MCP Server's 93 tools:

**[📖 View GitHub Example →](./examples/github/README.md)**

<div align="center">
  <img src="/docs/neo4j-browser-tools.png" alt="GitHub Tools in Neo4j Browser" width="60%" />
</div>

This example shows:

- How to mock and index all 93 GitHub MCP server tools
- Vector similarity search selecting the top 10 most relevant tools
- Real-world tool selection with detailed debug output
- Interactive testing with different prompts

Perfect for understanding how MCP RAG reduces context overhead in large toolsets!

## Features

- **Graph-based indexing** – Tools are indexed with their relationships and metadata
- **Vector search** – Neo4j-powered semantic search for tool retrieval
- **AI SDK compatible** – Drop-in wrapper that works with your existing AI SDK setup
- **Selective loading** – Only load the tools you need for each request

## License

MIT [rconnect.tech](https://www.rconnect.tech)
