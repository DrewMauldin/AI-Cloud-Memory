# Privacy model

AI Cloud Memory is self-hosted in the adopter’s Cloudflare account. The project maintainer does not operate a central API and cannot access an adopter’s Worker, D1 database, KV namespace, index or GitHub repository.

## Stored data

- D1: canonical memories, directives, projects, tasks, roadmap items, reviews, receipts and provenance
- KV: OAuth provider state
- Vectorize: optional derived embeddings and metadata
- GitHub: optional encrypted export artefacts in a repository chosen by the adopter
- WebDAV or Obsidian: optional Markdown projections chosen by the adopter

Workers AI and Vectorize are not called in the default lexical-only mode. n8n, WebDAV, pCloud and Obsidian are not required.

## What not to store

Do not capture passwords, access tokens, private keys, recovery codes, session cookies or raw secret configuration. Avoid automatic storage of health, financial, legal, identity and sensitive relationship information. Store the smallest useful durable fact, not a transcript or document dump.

## Provider relationship

Cloudflare and GitHub process data according to the adopter’s own accounts, settings, regions, terms and retention policies. Review those provider policies before deployment. This repository cannot select data residency or contractual controls for the adopter.

## Public code, private workspace

The repository is public. A deployed workspace is owner-restricted by GitHub numeric user ID. Do not remove the allowlist or publish OAuth/session secrets. `robots.txt` intentionally prevents indexing of Worker dashboard assets; the separate product website may be public and indexable.
