#!/usr/bin/env node
import { generateMarkdownReport, saveReport } from './markdown.js'

async function main() {
  console.log('🚀 Running benchmarks in development mode...\n')

  // Determine the benchmark name from environment or use default
  const benchmarkName = process.env.BENCHMARK_NAME || 'base-tool-selection'

  const result = {
    timestamp: new Date().toISOString(),
  }

  const report = generateMarkdownReport(result)

  console.log(report)
  console.log('\n📝 Saving results...')

  saveReport(report, 'latest.md', benchmarkName)

  console.log('\n✨ Benchmark complete!')
}

main().catch(error => {
  console.error('❌ Benchmark failed:', error)
  process.exit(1)
})
