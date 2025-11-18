import { createMCPRag } from '@mcp-rag/client'
import { openai } from '@ai-sdk/openai'
import * as neo4j from './neo4j'
import { githubTools } from './tools'

// Change this with DEBUG=@mcp-rag/* pnpm start to see query and tools selected
const PROMPT =
  'Get the contents of the README.md file from the main branch in rocket-connect/mcp-rag'

async function main() {
  try {
    await neo4j.connect()

    // @mcp-rag/client - Vercel AI SDK Wrapper
    const rag = createMCPRag({
      model: openai('gpt-4o-mini'),
      neo4j: neo4j.driver,
      tools: githubTools,
    })

    // Seeds your tools into a semantic graph using Neo4j
    await rag.sync()

    await new Promise(resolve => setTimeout(resolve, 2000))

    // Wrapper fetches tools from graph relevant to your query
    const result = await rag.generateText({
      prompt: PROMPT,
    })

    console.log('\n📊 Results:')
    console.log('='.repeat(80))
    console.log('\n📝 Generated Text:')
    console.log(result.result.text)

    if (result.result.toolCalls && result.result.toolCalls.length > 0) {
      console.log('\n🛠️  Tool Calls:')
      result.result.toolCalls.forEach((call, idx) => {
        console.log(`\n  ${idx + 1}. ${call.toolName}`)
        console.log(`     Input:`, JSON.stringify(call.input, null, 2))
      })
    }

    console.log('\n📈 Usage Stats:')
    console.log(`  Input Tokens: ${result.result.totalUsage.inputTokens}`)
    console.log(`  Output Tokens: ${result.result.totalUsage.outputTokens}`)
    console.log(`  Total Tokens: ${result.result.totalUsage.totalTokens}`)
    console.log('='.repeat(80))
  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  } finally {
    await neo4j.driver.close()
    console.log('\n✅ Disconnected from Neo4j')
  }
}

main()
