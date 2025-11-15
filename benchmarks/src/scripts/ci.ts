#!/usr/bin/env node
import { execSync } from 'child_process';
import { generateMarkdownReport, saveReport, saveHistoricalReport } from '../reporting/markdown.js';

function getGitInfo() {
  try {
    const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
    return { commit, branch };
  } catch {
    return { commit: undefined, branch: undefined };
  }
}

async function main() {
  console.log('🤖 Running benchmarks in CI mode...\n');
  
  const gitInfo = getGitInfo();
  const result = {
    timestamp: new Date().toISOString(),
    ...gitInfo,
  };
  
  const report = generateMarkdownReport(result);
  
  console.log(report);
  console.log('\n📝 Saving results...');
  
  saveReport(report, 'latest.md');
  saveHistoricalReport(report);
  
  console.log('\n✨ Benchmark complete!');
}

main().catch((error) => {
  console.error('❌ Benchmark failed:', error);
  process.exit(1);
});