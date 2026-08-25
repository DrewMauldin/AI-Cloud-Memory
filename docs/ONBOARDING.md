# Onboarding

Open `/setup.html` on your deployed Worker. The page derives the current origin, shows exact callback and MCP URLs, and saves checklist state only in that browser.

## Success criteria

Your instance is ready when:

- GitHub login succeeds only for the configured numeric owner ID
- the dashboard health panel verifies Worker and D1
- the client connects to `/mcp` and completes OAuth
- `cloudmemory_health` succeeds
- `cloudmemory_board` returns your board
- a harmless memory search succeeds
- one explicitly approved test memory can be created and then archived

Configured is not the same as connected, authenticated or verified. Record a client as ready only after the real tool call succeeds.

## First project

Create one small project and one task through the MCP tools, not by automating the dashboard. Start the task when work begins and finish it with a short evidence note when the outcome is known. This proves the end-to-end lifecycle and gives every connected model the same state.
