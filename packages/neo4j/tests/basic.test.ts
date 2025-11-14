import { describe, it, expect } from 'vitest'
import { CypherBuilder } from '../src/index'
import type { Tool } from 'ai'

describe('Basic Tool Array Unwinding', () => {
  it('should produce cypher statement that unwinds array and creates node', () => {
    const tools: Array<{ name: string; tool: Tool }> = [
      {
        name: 'test_tool',
        tool: {
          description: 'A test tool',
          inputSchema: {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            type: 'object',
            properties: {
              input: { type: 'string' },
            },
          },
        },
      },
    ]

    const statements = tools.map(({ name, tool }) =>
      CypherBuilder.createTool(name, tool)
    )
    expect(statements).toHaveLength(1)

    const statement = statements[0]

    // see ./__snapshots__/basic.test.ts.snap
    expect(statement.cypher).toMatchSnapshot()

    expect(statement.params).toEqual({
      tools: [
        {
          name: 'test_tool',
          description: 'A test tool',
          schema: {
            type: 'object',
            properties: {
              input: { type: 'string' },
            },
          },
        },
      ],
    })
  })
})
