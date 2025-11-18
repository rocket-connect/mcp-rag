import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'client-integration',
    globals: true,
    environment: 'node',
    testTimeout: 30000, // 30 second timeout for integration tests
    hookTimeout: 30000,
    include: ['tests/integration/**/*.test.ts'],
    setupFiles: [],
    fileParallelism: false,
  },
})
