import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'client-unit',
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    testTimeout: 10000,
    hookTimeout: 10000,
  },
})
