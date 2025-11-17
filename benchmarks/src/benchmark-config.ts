export interface BenchmarkConfig {
  id: string
  name: string
  description: string
  model: string
}

export const BENCHMARKS: Record<string, BenchmarkConfig> = {
  'base-tool-selection': {
    id: 'base-tool-selection',
    name: 'Base AI SDK',
    description: 'Standard AI SDK generateText implementation',
    model: 'gpt-4o-mini',
  },
  'delayed-tool-selection': {
    id: 'delayed-tool-selection',
    name: 'Delayed AI SDK',
    description: 'AI SDK generateText with 1 second delay before sending',
    model: 'gpt-4o-mini',
  },
}
