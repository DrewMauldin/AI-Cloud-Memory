import { readFileSync } from "node:fs";
import process from "node:process";
import { URL } from "node:url";

const config = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const d1 = config.d1_databases?.[0];
const oauthKv = config.kv_namespaces?.[0];

if (d1?.binding !== "DB" || d1?.database_name !== "ai-cloud-memory" || d1?.migrations_dir !== "migrations") {
  throw new Error("D1 must use the portable DB binding, ai-cloud-memory name and migrations directory");
}
if (oauthKv?.binding !== "OAUTH_KV") {
  throw new Error("OAuth KV must use the portable OAUTH_KV binding");
}
if (config.vectorize?.[0]?.binding !== "MEMORY_INDEX" || config.vectorize?.[0]?.index_name !== "ai-cloud-memory") {
  throw new Error("Vectorize must use the portable ai-cloud-memory index");
}
if (config.ai?.binding !== "AI") {
  throw new Error("Workers AI must use the AI binding");
}
if (config.vars?.PUBLIC_ORIGIN !== "auto") {
  const publicOrigin = new URL(config.vars?.PUBLIC_ORIGIN ?? "https://invalid.example/path");
  if (publicOrigin.protocol !== "https:" || publicOrigin.origin !== config.vars?.PUBLIC_ORIGIN) {
    throw new Error("PUBLIC_ORIGIN must be auto or an exact HTTPS origin");
  }
}
if (config.vars?.SEMANTIC_SEARCH_ENABLED !== "false") {
  throw new Error("Community deployments must default to lexical-only search");
}
if (!packageJson.scripts?.deploy?.includes("wrangler deploy && wrangler d1 migrations apply DB --remote && wrangler deploy")) {
  throw new Error("Fresh-account deploy must provision bindings before D1 migrations and publish the final release afterwards");
}

const configuredCrons = new Set(config.triggers?.crons ?? []);
for (const cron of ["11 * * * *", "23 2 * * *", "37 3 * * SUN"]) {
  if (!configuredCrons.has(cron)) throw new Error(`Required Cron Trigger is missing or invalid: ${cron}`);
}
if (configuredCrons.size !== 3) throw new Error("Unexpected Cron Trigger configured");

const workerFirstRoutes = new Set(config.assets?.run_worker_first ?? []);
for (const route of [
  "/api/*",
  "/mcp",
  "/login",
  "/authorize",
  "/authorize/*",
  "/bridge/*",
  "/callback",
  "/logout",
  "/oauth/*",
  "/.well-known/*",
]) {
  if (!workerFirstRoutes.has(route)) {
    throw new Error(`OAuth/API route is not configured Worker-first: ${route}`);
  }
}

const serialized = JSON.stringify(config);
for (const privateIdentifier of ["drews" + "digest", "Maul" + "din", "181" + "441848", "dr" + "3w"]) {
  if (serialized.toLowerCase().includes(privateIdentifier.toLowerCase())) {
    throw new Error(`Private identifier found in deployment template: ${privateIdentifier}`);
  }
}

process.stdout.write("Community deployment template is portable and ready.\n");
