# Client setup

All clients use the same remote endpoint:

```text
https://your-final-origin.example/mcp
```

## Codex

```bash
codex mcp add cloud-memory --url https://your-final-origin.example/mcp
```

Restart Codex if newly added tools are not visible. Complete OAuth and verify the native `cloudmemory_*` tools. Do not substitute browser or Computer Use automation for memory and project mutations.

## Claude Code

```bash
claude mcp add --transport http cloud-memory https://your-final-origin.example/mcp
```

## OpenCode

Add a remote MCP server named `cloud-memory` in `opencode.json`:

```json
{
  "mcp": {
    "cloud-memory": {
      "type": "remote",
      "url": "https://your-final-origin.example/mcp",
      "enabled": true
    }
  }
}
```

## Claude Web and ChatGPT

Add a custom connector using the same endpoint, then complete browser OAuth. Web plans may expose different read/write or tool-count limits. Treat a saved connector as configuration only; canary the actual tools before relying on it.

## Recommended client behaviour

- Search only when prior context genuinely matters.
- Start an existing task explicitly before continuing it.
- Finish the task with `done`, `review` or `blocked` and a compact evidence note.
- Capture at most three durable, non-secret decisions at the end of meaningful work.
- Never store credentials, transcripts, code dumps or highly sensitive personal data automatically.
