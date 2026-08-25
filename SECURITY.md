# Security policy

## Supported version

Security updates target the latest tagged release.

## Report a vulnerability

Use GitHub’s private vulnerability reporting for this repository. Do not open a public issue containing exploit details, credentials or private deployment data.

## Deployment responsibilities

- Keep the numeric GitHub owner allowlist enabled.
- Store secrets with Wrangler or Cloudflare secrets, never Git.
- Use a unique random cookie encryption key.
- Grant optional GitHub export tokens Contents access only to one backup repository.
- Review dependency alerts and apply security releases promptly.
- Verify OAuth callbacks and MCP endpoints after any domain change.

Never include live secrets, session cookies or private memory content in bug reports.
