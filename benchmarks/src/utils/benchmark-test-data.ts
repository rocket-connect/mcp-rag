export const TEST_PROMPTS = [
  'Get pull request #42 from rocket-connect/mcp-rag',
  'List all open issues in the repository rocket-connect/mcp-rag',
  'Create a new issue in rocket-connect/mcp-rag with title "Test Issue" and body "This is a test"',
  'Get the contents of the README.md file from the main branch in rocket-connect/mcp-rag',
  'Add a comment to issue #1 in rocket-connect/mcp-rag saying "This is a test comment"',
] as const

export const EXPECTED_TOOLS = [
  'get_pull_request',
  'list_issues',
  'create_issue',
  'get_file_contents',
  'create_issue_comment',
] as const
