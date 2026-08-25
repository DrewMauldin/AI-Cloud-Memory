# Architecture

AI Cloud Memory is a single-owner, independently deployed Cloudflare Worker. Each installation is isolated by account and GitHub identity.

## Trust boundaries

1. GitHub authenticates the owner.
2. `ALLOWED_GITHUB_USER_ID` restricts dashboard and MCP ownership to one immutable numeric account ID.
3. The Worker runs the OAuth provider, dashboard, MCP server and bounded scheduled maintenance.
4. D1 stores canonical owner-scoped records and append-only lifecycle evidence.
5. KV holds OAuth state required by the provider.
6. Vectorize and Workers AI are optional derived services. They are never canonical.
7. GitHub exports and Obsidian Markdown are optional projections.

## Data flow

```text
AI client -> MCP OAuth -> Worker -> owner-scoped service -> D1
                                           |              |
                                           |              +-> encrypted export
                                           +-> optional Vectorize/Workers AI
```

Every mutation validates the authenticated owner on the server. Client-supplied owner IDs are not trusted. Versioned mutations use optimistic concurrency and correlation IDs where lifecycle idempotency matters.

## Search

Lexical retrieval and temporal intent detection run against D1. When semantic search is enabled, the Worker fuses lexical and Vectorize candidates, applies bounded importance and entity signals, then optionally reranks. Results explain their sources and degraded components.

## Project lifecycle

Projects contain tasks with Inbox, Planned, In progress, Review, Blocked and Done states. Completed tasks age into Done history after the configured retention period. Tasks can be archived independently. Roadmap ideas remain future-facing until explicitly promoted, with correlation-safe promotion history.

## Projection rule

D1 is always canonical. External Markdown, WebDAV and GitHub files are replaceable outputs with receipts. Do not configure multiple systems to write directly into the same Obsidian projection folder.
