import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

export interface BenchmarkResult {
  timestamp: string;
  commit?: string;
  branch?: string;
}

export function generateMarkdownReport(result: BenchmarkResult): string {
  return `# Benchmark Results

**Generated**: ${result.timestamp}
${result.commit ? `**Commit**: ${result.commit}` : ''}
${result.branch ? `**Branch**: ${result.branch}` : ''}

## Test Output

This is a test benchmark that prints the current date.
`;
}

export function saveReport(content: string, filename: string): void {
  const resultsDir = join(process.cwd(), 'results');
  const historyDir = join(resultsDir, 'history');
  
  mkdirSync(resultsDir, { recursive: true });
  mkdirSync(historyDir, { recursive: true });
  
  const filepath = join(resultsDir, filename);
  writeFileSync(filepath, content);
  console.log(`✅ Report saved to ${filepath}`);
}

export function saveHistoricalReport(content: string): void {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T').join('-').slice(0, -5);
  const filename = `${timestamp}.md`;
  const historyPath = join(process.cwd(), 'results', 'history', filename);
  
  writeFileSync(historyPath, content);
  console.log(`📊 Historical report saved to ${historyPath}`);
}