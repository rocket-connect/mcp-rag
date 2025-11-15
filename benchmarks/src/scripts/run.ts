#!/usr/bin/env node
import { generateMarkdownReport, saveReport } from '../reporting/markdown.js';

async function main() {
  console.log('🚀 Running benchmarks in development mode...\n');
  
  const result = {
    timestamp: new Date().toISOString(),
  };
  
  const report = generateMarkdownReport(result);
  
  console.log(report);
  console.log('\n📝 Saving results...');
  
  saveReport(report, 'latest.md');
  
  console.log('\n✨ Benchmark complete!');
}

main().catch((error) => {
  console.error('❌ Benchmark failed:', error);
  process.exit(1);
});