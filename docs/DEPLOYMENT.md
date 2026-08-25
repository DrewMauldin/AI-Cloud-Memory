# Deployment

## Prerequisites

- A Cloudflare account with Workers enabled
- A GitHub account
- Node.js 22.12 or newer for local deployment

## Deploy-button path

Use the button in the README. Cloudflare imports the public repository and provisions supported bindings. The deployment script applies D1 migrations through the `DB` binding before publishing the Worker.

Automatic provisioning behaviour can vary as Cloudflare evolves. If Vectorize is not created, leave semantic search disabled and create it manually only when wanted:

```bash
npx wrangler vectorize create ai-cloud-memory --dimensions=768 --metric=cosine
```

## Local Wrangler path

```bash
git clone https://github.com/YOUR-LOGIN/AI-Cloud-Memory.git
cd AI-Cloud-Memory
npm ci
npx wrangler login
npm run types
```

Set the template values in `wrangler.jsonc`. Use your numeric GitHub user ID, not only your mutable login. Create the three required secrets:

```bash
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
openssl rand -hex 32 | npx wrangler secret put COOKIE_ENCRYPTION_KEY
```

Then run:

```bash
npm run check
npm run deploy
```

On a fresh account, `npm run deploy` performs a bootstrap publish so Cloudflare can auto-provision declared resources, applies every D1 migration through the `DB` binding, then publishes the final release. The configured placeholder owner ID denies access during bootstrap. Existing deployments reuse their bound resources.

## Custom-domain migration

Changing from `workers.dev` to a custom domain changes the OAuth resource origin. Complete all of these together:

1. Attach and verify the final HTTPS domain in Cloudflare.
2. Change `PUBLIC_ORIGIN` to the exact origin.
3. Change the GitHub OAuth homepage and callback to the new origin and `/callback`.
4. Redeploy.
5. Reauthorise every MCP client against the new `/mcp` endpoint.
6. Run the client canaries again.

Do not delete the old deployment until the new dashboard login and an authenticated MCP read and write are verified.

## Rollback

Keep the prior Worker version and a D1 Time Travel bookmark before migrations. Roll back code first, then restore data only when the migration itself caused canonical corruption. Optional Vectorize state can always be rebuilt from D1.
