# mcp-rag

**AI SDK tool orchestration without the headache.**

Stop wrestling with tool limits and context management. Built for developers who need to use dozens of tools with AI SDK without hitting model constraints or losing their minds.

## The Problem

You're building with AI SDK and hit these walls:

- Models choke when you pass 20+ tools at once
- Managing which tools are active for each request is manual hell
- Tool results overflow context windows in multi-step flows
- Tracking tool usage across complex workflows is painful

## The Solution

```bash
npm install @mcp-rag/client ai neo4j-driver
```

```typescript
import { createMCPRag } from "@mcp-rag/client";
import { openai } from "@ai-sdk/openai";
import { tool } from "ai";
import { z } from "zod";
import neo4j from "neo4j-driver";

const driver = neo4j.driver(
  "neo4j://localhost:7687",
  neo4j.auth.basic("neo4j", "password")
);

const rag = createMCPRag({
  model: openai("gpt-4"),
  neo4j: driver,

  // Default: Uses AI SDK's embed() with text-embedding-3-small
  embeddingModel: openai.textEmbeddingModel("text-embedding-3-small"),

  // Or provide custom embedding function:
  // embedding: async (text: string) => {
  //   const { embedding } = await embed({
  //     model: yourEmbeddingModel,
  //     value: text,
  //   });
  //   return embedding; // Returns number[]
  // },

  tools: {
    searchDocs: tool({
      description: "Search documentation for answers",
      inputSchema: z.object({
        query: z.string(),
        category: z.enum(["api", "guide", "reference"]),
      }),
      execute: async ({ query, category }) => {
        // Your implementation
      },
    }),
    runTests: tool({
      description: "Execute test suite",
      inputSchema: z.object({
        suite: z.string(),
        coverage: z.boolean().optional(),
      }),
      execute: async ({ suite, coverage }) => {
        // Your implementation
      },
    }),
    // ... 98 more tools
  },
  strategy: "auto",
});

// Sync tools to Neo4j - converts Zod schemas to graph
await rag.sync();

/*
What happens during sync():

1. Tool definitions → Neo4j nodes:
   CREATE (t:Tool {
     name: 'searchDocs',
     description: 'Search documentation for answers'
   })

2. Zod schemas → structured properties:
   SET t.schema = '{
     "type": "object",
     "properties": {
       "query": {"type": "string"},
       "category": {"type": "string", "enum": ["api", "guide", "reference"]}
     },
     "required": ["query", "category"]
   }'

3. Parameters → relationships for semantic search:
   CREATE (p1:Parameter {name: 'query', type: 'string'})
   CREATE (p2:Parameter {name: 'category', type: 'string'})
   CREATE (t)-[:HAS_PARAMETER]->(p1)
   CREATE (t)-[:HAS_PARAMETER]->(p2)

4. Embeddings generated and stored:
   // For each tool, embed the description using AI SDK
   import { embed } from 'ai';
   const { embedding } = await embed({
     model: openai.textEmbeddingModel('text-embedding-3-small'),
     value: 'Search documentation for answers'
   });
   SET t.embedding = embedding  // [0.234, -0.123, 0.456, ...] (1536 dimensions)
   
   // Create vector index (once):
   CREATE VECTOR INDEX tool_embeddings IF NOT EXISTS
   FOR (t:Tool) ON t.embedding
   OPTIONS {
     indexConfig: {
       `vector.dimensions`: 1536,
       `vector.similarity_function`: 'cosine'
     }
   }

5. Semantic relationships created:
   // Tools with similar embeddings linked
   MATCH (t1:Tool), (t2:Tool)
   WHERE gds.similarity.cosine(t1.embedding, t2.embedding) > 0.8
   CREATE (t1)-[:SIMILAR_TO {score: score}]->(t2)

Result: 100 tools in graph, only 5-10 selected per request via vector search
*/

// Now use any number of tools - we handle the complexity
const result = await rag.generate({
  prompt: "Find the auth bug, check what tests failed, then deploy the fix",
  // Behind the scenes:
  // 1. Prompt embedded using AI SDK's embed():
  //    const { embedding } = await embed({
  //      model: openai.textEmbeddingModel('text-embedding-3-small'),
  //      value: 'Find the auth bug...'
  //    });
  // 2. Vector search in Neo4j finds closest tools by cosine similarity
  // 3. Only top 5-10 tools sent to model (not all 100)
  // 4. Results stored in Neo4j with relationships to tools used
  // 5. Multi-step coordination handled automatically
});
```

## Why This Exists

**You want AI SDK's clean API.** generateText, streamText, tool calling - it's great.

**You need more tools than models can handle.** Most models max out at 20-50 tools before quality degrades.

**You're tired of manual context management.** Multi-step flows with tool results explode your token budget.

This package solves that with intelligent tool selection and Neo4j-powered context persistence.

## Core Features

### Intelligent Tool Selection

```typescript
const rag = createMCPRag({
  model: openai("gpt-4"),
  neo4j: driver,
  tools: my100Tools,
  strategy: "semantic", // Auto-select relevant tools per request
});

// Model only sees 5-10 most relevant tools
await rag.generate({ prompt: "Debug the auth flow" });
```

### Context Persistence with Neo4j

```typescript
// Tool results stored in knowledge graph
// Retrieved automatically for follow-up requests

await rag.generate({
  prompt: "What did the last test run show?",
  sessionId: "debug-session-123",
  // Previous tool results auto-retrieved from Neo4j
});
```

### Multi-Step Orchestration

```typescript
// Complex workflows without manual step management
const result = await rag.generate({
  prompt: "Research topic, write draft, get feedback, revise",
  sessionId: "writing-session",
  // Tool results cached in Neo4j
  // Smart step coordination via AI SDK
});

console.log(result.steps); // Full execution trace
```

## Architecture

```
┌─────────────────────────────────────────────┐
│             @mcp-rag/client                 │
├─────────────────────────────────────────────┤
│                                             │
│  AI SDK Wrapper                             │
│  ├─ Tool Selection (semantic/graph/auto)   │
│  ├─ Context Management (Neo4j)             │
│  └─ Multi-step Coordination                │
│                                             │
└─────────────────────────────────────────────┘
         │              │
         ▼              ▼
    AI SDK (peer)   Neo4j Driver
```

## Packages

- **@mcp-rag/client** - Main package, AI SDK wrapper with smart tool management
- **@mcp-rag/utils** - Tool adapters, MCP helpers, Neo4j utilities
- **@mcp-rag/types** - TypeScript definitions

## Installation

```bash
# Core dependencies
npm install @mcp-rag/client ai neo4j-driver

# Optional: Types for TypeScript
npm install -D @mcp-rag/types
```

## Quick Start

### Basic Setup

```typescript
import { createMCPRag } from "@mcp-rag/client";
import { openai } from "@ai-sdk/openai";
import neo4j from "neo4j-driver";

const driver = neo4j.driver(
  "neo4j://localhost:7687",
  neo4j.auth.basic("neo4j", "password")
);

const rag = createMCPRag({
  model: openai("gpt-4"),
  neo4j: driver,
  tools: myLargeToolset,
  strategy: "graph", // Use knowledge graph for tool selection
});

// On first call, automatically checks and applies migrations
// Optional: explicitly sync tool definitions to Neo4j
await rag.sync();

const result = await rag.generate({
  prompt: "Continue from where we left off",
  sessionId: "my-session",
  // Previous context auto-loaded from Neo4j
});
```

### Multi-Tenancy and Custom Migrations

```typescript
const rag = createMCPRag({
  model: openai("gpt-4"),
  neo4j: driver,
  tools: myTools,
  // Customize migration for multi-tenant architectures
  migration: {
    // Override or modify Cypher statements
    onBeforeMigrate: async (statements) => {
      // Add organization ID to tool nodes
      return statements.map((stmt) => ({
        ...stmt,
        cypher: stmt.cypher.replace(
          "CREATE (t:Tool",
          "CREATE (t:Tool {orgId: $orgId}"
        ),
        params: { ...stmt.params, orgId: "org_123" },
      }));
    },
    // Run custom logic after migration
    onAfterMigrate: async (session) => {
      // Create organization-specific indexes
      await session.run(`
        CREATE INDEX tool_org_name IF NOT EXISTS
        FOR (t:Tool)
        ON (t.orgId, t.name)
      `);
    },
    // Custom migration check (default checks Tool node existence)
    shouldMigrate: async (session) => {
      const result = await session.run(
        "MATCH (t:Tool {orgId: $orgId}) RETURN count(t) as count",
        { orgId: "org_123" }
      );
      return result.records[0].get("count") === 0;
    },
  },
});

// Migrations run automatically on first generate/stream call
// Or explicitly trigger:
await rag.sync();
```

### Advanced Migration Control

```typescript
const rag = createMCPRag({
  model: openai("gpt-4"),
  neo4j: driver,
  tools: myTools,
  migration: {
    // Completely override migration logic
    migrate: async (session, tools) => {
      // Your custom migration implementation
      for (const [name, tool] of Object.entries(tools)) {
        await session.run(
          `
          MERGE (t:Tool {name: $name, orgId: $orgId})
          SET t.description = $description,
              t.schema = $schema,
              t.updatedAt = datetime()
          WITH t
          MERGE (o:Organization {id: $orgId})
          MERGE (o)-[:OWNS]->(t)
        `,
          {
            name,
            orgId: "org_123",
            description: tool.description,
            schema: JSON.stringify(tool.inputSchema),
          }
        );
      }
    },
  },
});
```

## Configuration

```typescript
interface MCPRagConfig {
  // AI SDK model (required)
  model: LanguageModel;

  // Neo4j connection (required)
  neo4j: Driver;

  // Your tools (required)
  tools: Record<string, Tool>;

  // Tool selection strategy
  strategy?: "auto" | "semantic" | "graph";

  // Embedding model (uses AI SDK's EmbeddingModel interface)
  embeddingModel?: EmbeddingModel<string>; // Default: openai.textEmbeddingModel('text-embedding-3-small')

  // Or provide custom embedding function
  embedding?: (text: string) => Promise<number[]>;

  // Max tools to send per request (default: 10)
  maxActiveTools?: number;

  // Migration configuration
  migration?: {
    // Modify migration statements (e.g., add orgId)
    onBeforeMigrate?: (
      statements: MigrationStatement[]
    ) => Promise<MigrationStatement[]>;

    // Run custom logic after migration
    onAfterMigrate?: (session: Session) => Promise<void>;

    // Custom check if migration needed
    shouldMigrate?: (session: Session) => Promise<boolean>;

    // Completely override migration
    migrate?: (session: Session, tools: Record<string, Tool>) => Promise<void>;
  };
}

interface MigrationStatement {
  cypher: string;
  params: Record<string, any>;
}
```

## Embedding Configuration

Embeddings power the semantic tool selection. The package uses AI SDK's embedding models by default.

### Default Embedding (Recommended)

By default, uses OpenAI's text-embedding-3-small (1536 dimensions):

```typescript
import { openai } from "@ai-sdk/openai";

const rag = createMCPRag({
  model: openai("gpt-4"),
  neo4j: driver,
  tools: myTools,
  // Default: openai.textEmbeddingModel('text-embedding-3-small')
});
```

### Different Embedding Model

Use any AI SDK embedding model:

```typescript
import { openai } from "@ai-sdk/openai";
import { mistral } from "@ai-sdk/mistral";

const rag = createMCPRag({
  model: openai("gpt-4"),
  neo4j: driver,
  tools: myTools,
  embeddingModel: openai.textEmbeddingModel("text-embedding-3-large"), // 3072 dimensions
  // or: mistral.textEmbeddingModel('mistral-embed'), // 1024 dimensions
});
```

### Custom Embedding Function

Bring your own embedding implementation:

```typescript
import { embed } from "ai";
import { createMCPRag } from "@mcp-rag/client";
import { cohere } from "@ai-sdk/cohere";

const rag = createMCPRag({
  model: openai("gpt-4"),
  neo4j: driver,
  tools: myTools,
  embedding: async (text: string) => {
    // Use AI SDK's embed() with any provider
    const { embedding } = await embed({
      model: cohere.textEmbeddingModel("embed-english-v3.0"),
      value: text,
    });
    return embedding; // number[]
  },
});
```

### Local Embeddings

Use local models for privacy or cost savings:

```typescript
import { pipeline } from "@xenova/transformers";

const embedder = await pipeline(
  "feature-extraction",
  "Xenova/all-MiniLM-L6-v2"
);

const rag = createMCPRag({
  model: openai("gpt-4"),
  neo4j: driver,
  tools: myTools,
  embedding: async (text: string) => {
    const output = await embedder(text, { pooling: "mean", normalize: true });
    return Array.from(output.data); // number[]
  },
});
```

### Batch Embedding Optimization

For large tool sets, embeddings are generated using AI SDK's `embedMany()` for efficiency:

```typescript
// Internally during sync(), the package uses:
import { embedMany } from "ai";

const { embeddings } = await embedMany({
  model: openai.textEmbeddingModel("text-embedding-3-small"),
  values: toolDescriptions, // All tool descriptions at once
  maxParallelCalls: 5, // Parallel requests for speed
});
```

### What Gets Embedded

During `sync()`, embeddings are generated for:

1. **Tool descriptions** - Primary signal for semantic matching
2. **Tool names** - Fallback when descriptions are sparse
3. **Parameter descriptions** - For fine-grained matching
4. **Enum values** - When tools have categorical inputs

All embeddings are stored in Neo4j Tool nodes and indexed for fast vector search using cosine similarity.

## Database Migrations

When using Neo4j, tool definitions are synced to the database. The migration system is designed for multi-tenant architectures and custom data models.

### Automatic Migration

On first call to `generate()` or `stream()`, the system checks if tools are migrated and automatically applies migrations if needed.

```typescript
const rag = createMCPRag({ model, neo4j: driver, tools });

// This triggers auto-migration check
await rag.generate({ prompt: "Hello" });
```

### Explicit Sync

```typescript
// Explicitly sync tool definitions
await rag.sync();

// Useful for:
// - Deployment scripts
// - Testing
// - Tool updates
```

### Default Migration Behavior

By default, migrations create:

- Tool nodes with name, description, and schema
- Indexes for efficient tool lookup
- Version tracking

### Multi-Tenant Customization

For multi-tenant applications where tools belong to organizations:

```typescript
const rag = createMCPRag({
  model: openai("gpt-4"),
  neo4j: driver,
  tools: myTools,
  migration: {
    onBeforeMigrate: async (statements) => {
      // Inject organization context
      return statements.map((stmt) => ({
        cypher: stmt.cypher.replace(
          "CREATE (t:Tool",
          "CREATE (t:Tool {orgId: $orgId, tenantId: $tenantId}"
        ),
        params: {
          ...stmt.params,
          orgId: getCurrentOrg(),
          tenantId: getCurrentTenant(),
        },
      }));
    },
  },
});
```

### Custom Data Models

If you need complete control over the data model:

```typescript
const rag = createMCPRag({
  model: openai("gpt-4"),
  neo4j: driver,
  tools: myTools,
  migration: {
    migrate: async (session, tools) => {
      // Implement your schema
      await session.run(
        `
        MERGE (org:Organization {id: $orgId})
      `,
        { orgId: "org_123" }
      );

      for (const [name, tool] of Object.entries(tools)) {
        await session.run(
          `
          MERGE (t:Tool {name: $name, orgId: $orgId})
          SET t += $props
          WITH t
          MATCH (org:Organization {id: $orgId})
          MERGE (org)-[:HAS_TOOL]->(t)
        `,
          {
            name,
            orgId: "org_123",
            props: {
              description: tool.description,
              schema: JSON.stringify(tool.inputSchema),
              version: "1.0",
              createdAt: new Date().toISOString(),
            },
          }
        );
      }
    },
  },
});
```

## API

### `createMCPRag(config)`

Create a new RAG client.

### `rag.generate(options)`

Generate text with smart tool management.

```typescript
const result = await rag.generate({
  prompt: string,
  sessionId?: string,        // For context persistence
  activeTools?: string[],    // Manual tool selection override
  temperature?: number,      // AI SDK options pass through
  // ... other AI SDK generateText options
});
```

### `rag.stream(options)`

Stream responses with tool execution.

```typescript
const stream = await rag.stream({
  prompt: string,
  sessionId: string,
  // ... other AI SDK streamText options
});

for await (const chunk of stream) {
  console.log(chunk);
}
```

### `rag.sync()`

Explicitly sync tool definitions to Neo4j. On first call to `generate()` or `stream()`, migrations are checked and applied automatically. Use `sync()` when you need explicit control.

```typescript
// Sync tools on app startup
await rag.sync();

// Sync after tool updates
rag.addTool(
  "newTool",
  tool({
    /* ... */
  })
);
await rag.sync();
```

## Use Cases

**Building AI agents with 50+ tools**

- GitHub API, filesystem, browser automation, database queries
- Model only sees relevant subset per request based on semantic similarity

**Long-running workflows**

- Research tasks with many steps
- Code generation + review + testing + deployment
- Tool results cached in Neo4j, preventing context window overflow

**Multi-tenant applications**

- Isolated tool sets per organization
- Custom data models with organization relationships
- Flexible migration system for complex schemas

**Production AI applications**

- Tool usage tracking via graph relationships
- Session-based context persistence
- Semantic tool discovery at scale

## Requirements

- Node.js >= 18
- Neo4j >= 5.0
- AI SDK >= 4.0

## Documentation

Full docs at **mcp-rag.rconnect.tech**

- Detailed guides
- API reference
- Architecture deep-dive
- Example patterns

## Roadmap

- [ ] Core tool selection engine (semantic + graph-based)
- [ ] Neo4j context persistence layer
- [ ] Multi-step orchestration with AI SDK
- [ ] Streaming support
- [ ] Tool usage analytics
- [ ] Advanced migration patterns
- [ ] Performance optimizations

## License

MIT © 2025 rconnect.tech

## Links

- [Documentation](https://mcp-rag.rconnect.tech)
- [GitHub](https://github.com/rconnect-tech/mcp-rag)
- [NPM](https://npmjs.com/package/@mcp-rag/client)

---

**Stop fighting AI SDK's tool limits. Start building.**
