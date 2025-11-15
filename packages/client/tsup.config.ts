import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: {
    compilerOptions: {
      composite: false, // Disable composite mode for DTS generation
      rootDir: './src',
      outDir: './dist',
    },
  },
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  minify: false,
  external: ['ai', 'neo4j-driver', 'zod'],
})
