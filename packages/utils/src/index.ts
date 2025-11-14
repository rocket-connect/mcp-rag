/**
 * Utility functions for mcp-rag
 */

import type { Tool } from 'ai'
import type { Session } from 'neo4j-driver'

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length')
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  if (denominator === 0) return 0

  return dotProduct / denominator
}

/**
 * Normalize a vector to unit length
 */
export function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0))
  if (magnitude === 0) return vector
  return vector.map(val => val / magnitude)
}

/**
 * Generate a unique session ID
 */
export function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substring(7)}`
}

/**
 * Extract tool names from a set of tools
 */
export function getToolNames(tools: Record<string, Tool>): string[] {
  return Object.keys(tools)
}

/**
 * Check if a tool exists in the tool set
 */
export function hasTool(
  tools: Record<string, Tool>,
  toolName: string
): boolean {
  return toolName in tools
}

/**
 * Format a tool description for embedding
 * Combines name and description for better semantic matching
 */
export function formatToolDescription(
  name: string,
  description?: string
): string {
  if (!description) return name
  return `${name}: ${description}`
}

/**
 * Validate that a Neo4j session is open
 */
export async function validateSession(session: Session): Promise<void> {
  try {
    await session.run('RETURN 1')
  } catch (error) {
    throw new Error('Neo4j session is not available')
  }
}

/**
 * Safely close a Neo4j session
 */
export async function closeSession(session: Session): Promise<void> {
  try {
    await session.close()
  } catch (error) {
    console.error('Error closing Neo4j session:', error)
  }
}

/**
 * Create a retry wrapper for async functions
 */
export function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number
    delay?: number
    backoff?: number
  } = {}
): Promise<T> {
  const { maxRetries = 3, delay = 1000, backoff = 2 } = options

  return new Promise((resolve, reject) => {
    let attempt = 0

    const execute = async () => {
      try {
        const result = await fn()
        resolve(result)
      } catch (error) {
        attempt++
        if (attempt >= maxRetries) {
          reject(error)
          return
        }

        const waitTime = delay * Math.pow(backoff, attempt - 1)
        setTimeout(execute, waitTime)
      }
    }

    execute()
  })
}

/**
 * Batch an array into chunks
 */
export function batch<T>(array: T[], size: number): T[][] {
  const batches: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    batches.push(array.slice(i, i + size))
  }
  return batches
}

/**
 * Debounce a function
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout

  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn(...args), delay)
  }
}

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Truncate text to a maximum length
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength - 3) + '...'
}

/**
 * Sanitize a string for use in Cypher queries
 */
export function sanitizeCypher(input: string): string {
  return input.replace(/[`'"\\]/g, '\\$&')
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes'

  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
}

/**
 * Create a hash of a string (simple djb2)
 */
export function hashString(str: string): number {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i)
  }
  return hash >>> 0
}
