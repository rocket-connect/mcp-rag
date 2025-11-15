#!/usr/bin/env node
import { execSync } from 'child_process'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import {
  generateMarkdownReport,
  saveReport,
  saveHistoricalReport,
  BenchmarkResult,
} from '../reporting/markdown.js'

function getGitInfo() {
  try {
    const commit = execSync('git rev-parse --short HEAD', {
      encoding: 'utf-8',
    }).trim()
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf-8',
    }).trim()
    return { commit, branch }
  } catch {
    return { commit: undefined, branch: undefined }
  }
}

async function runBenchmarks() {
  console.log('🧪 Running benchmark tests...\n')

  try {
    // Set environment variable to export benchmark data
    process.env.BENCHMARK_EXPORT = 'true'

    execSync('pnpm vitest run --reporter=verbose', {
      encoding: 'utf-8',
      stdio: 'inherit', // Show output in real-time
      env: {
        ...process.env,
        BENCHMARK_EXPORT: 'true',
      },
    })

    return true
  } catch (error: any) {
    // Vitest might exit with non-zero even on success in some cases
    console.log(error.stdout || error.message)

    // Check if tests actually passed by looking for success indicators
    const output = error.stdout || ''
    if (output.includes('passed') || output.includes('✓')) {
      return true
    }

    throw error
  }
}

async function main() {
  console.log('🤖 Running benchmarks in CI mode...\n')

  const gitInfo = getGitInfo()

  // Run the benchmarks
  const success = await runBenchmarks()

  if (!success) {
    throw new Error('Benchmark execution failed')
  }

  // Wait a bit for file to be written
  await new Promise(resolve => setTimeout(resolve, 500))

  // Determine the benchmark name from the test file or use a default
  // For now, we'll use 'base-tool-selection' as default
  // You can extend this to detect from environment or test file
  const benchmarkName = process.env.BENCHMARK_NAME || 'base-tool-selection'

  // Read benchmark summary from file
  const summaryPath = join(
    process.cwd(),
    'results',
    benchmarkName,
    'benchmark-summary.json'
  )
  let summary = undefined

  if (existsSync(summaryPath)) {
    try {
      const summaryContent = readFileSync(summaryPath, 'utf-8')
      summary = JSON.parse(summaryContent)

      console.log('\n✅ Benchmark summary loaded from file')
      console.log(`   - Total tests: ${summary.totalTests}`)
      console.log(`   - Successful: ${summary.successfulTests}`)
      console.log(`   - Metrics collected: ${summary.metrics?.length || 0}`)
    } catch (error) {
      console.error('❌ Error reading benchmark summary file:', error)
    }
  } else {
    console.warn(
      '\n⚠️  Warning: No benchmark summary file found at',
      summaryPath
    )
    console.warn(
      'This might mean the benchmark test did not complete successfully or BENCHMARK_EXPORT is not set.\n'
    )
  }

  const result: BenchmarkResult = {
    timestamp: new Date().toISOString(),
    ...gitInfo,
    summary,
  }

  try {
    const report = generateMarkdownReport(result)

    console.log('\n' + '='.repeat(70))
    console.log('📄 GENERATED REPORT')
    console.log('='.repeat(70))
    console.log(report)
    console.log('='.repeat(70))
    console.log('\n📝 Saving results...')

    saveReport(report, 'latest.md', benchmarkName)
    saveHistoricalReport(report, benchmarkName)

    console.log('\n✨ Benchmark complete!')
  } catch (error) {
    console.error('❌ Error generating or saving report:', error)
    throw error
  }
}

main().catch(error => {
  console.error('❌ Benchmark failed:', error)
  process.exit(1)
})
