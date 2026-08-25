#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { accessSync, chmodSync, constants, mkdirSync, writeFileSync } from "node:fs";
import process from "node:process";
import { delimiter, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";

const SUPPORTED_CLIENTS = ["codex", "claude-code", "opencode"];

function validateEndpoint(value) {
  const endpoint = new URL(value);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/mcp") {
    throw new Error("Endpoint must be a credential-free HTTPS URL ending in /mcp");
  }
  return endpoint.href;
}

function commandFor(client, endpoint) {
  if (client === "codex") return ["codex", ["mcp", "add", "cloud-memory", "--url", endpoint]];
  if (client === "claude-code") return ["claude", ["mcp", "add", "--transport", "http", "--scope", "user", "cloud-memory", endpoint]];
  if (client === "opencode") return ["opencode", ["mcp", "add", "cloud-memory", "--url", endpoint]];
  throw new Error(`Unsupported client: ${client}`);
}

function loginCommandFor(client) {
  if (client === "codex") return "codex mcp login cloud-memory";
  if (client === "claude-code") return "claude mcp login cloud-memory";
  if (client === "opencode") return "opencode mcp auth cloud-memory";
  throw new Error(`Unsupported client: ${client}`);
}

function inspectCommandFor(client) {
  if (client === "codex") return ["codex", ["mcp", "get", "cloud-memory"]];
  if (client === "claude-code") return ["claude", ["mcp", "get", "cloud-memory"]];
  if (client === "opencode") return ["opencode", ["mcp", "list"]];
  throw new Error(`Unsupported client: ${client}`);
}

function executableAvailable(command) {
  return (process.env.PATH ?? "").split(delimiter).some((directory) => {
    try {
      accessSync(resolve(directory, command), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

export function buildPlan({ endpoint, clients = SUPPORTED_CLIENTS }) {
  const canonicalEndpoint = validateEndpoint(endpoint);
  return clients.map((client) => {
    if (!SUPPORTED_CLIENTS.includes(client)) throw new Error(`Unsupported client: ${client}`);
    const [command, args] = commandFor(client, canonicalEndpoint);
    return { client, command, args, loginCommand: loginCommandFor(client) };
  });
}

function inspect(client) {
  const [command, args] = inspectCommandFor(client);
  if (!executableAvailable(command)) return { client, available: false, configured: false, output: "CLI not installed" };
  const result = spawnSync(command, args, { encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().slice(0, 20_000);
  return { client, available: true, configured: result.status === 0 && output.includes("cloud-memory"), output };
}

function writeBackup(results) {
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const directory = resolve(process.cwd(), ".cloud-memory-backups", stamp);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  for (const result of results) {
    const path = resolve(directory, `${result.client}.txt`);
    writeFileSync(path, `${result.output}\n`, { mode: 0o600 });
    chmodSync(path, 0o600);
  }
  return directory;
}

function parseArguments(argv) {
  const mode = argv[0] ?? "inspect";
  if (!["inspect", "plan", "apply"].includes(mode)) throw new Error("Mode must be inspect, plan or apply");
  const endpointIndex = argv.indexOf("--endpoint");
  const clientsIndex = argv.indexOf("--clients");
  const endpoint = endpointIndex >= 0 ? argv[endpointIndex + 1] : undefined;
  const clients = clientsIndex >= 0 ? argv[clientsIndex + 1]?.split(",").filter(Boolean) : SUPPORTED_CLIENTS;
  if ((mode === "plan" || mode === "apply") && !endpoint) throw new Error("--endpoint is required for plan and apply");
  return { mode, endpoint, clients };
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const inspections = options.clients.map(inspect);
  if (options.mode === "inspect") {
    process.stdout.write(`${JSON.stringify({ mode: "inspect", clients: inspections }, null, 2)}\n`);
    return;
  }
  const plan = buildPlan({ endpoint: options.endpoint, clients: options.clients });
  if (options.mode === "plan") {
    process.stdout.write(`${JSON.stringify({ mode: "plan", changes: plan, authenticationIsSeparate: true }, null, 2)}\n`);
    return;
  }
  const unavailable = inspections.find((result) => !result.available);
  if (unavailable) throw new Error(`${unavailable.client} is not installed; no changes were made`);
  const existing = inspections.find((result) => result.configured);
  if (existing) {
    throw new Error(`${existing.client} already has a cloud-memory entry; inspect it manually before replacement. No changes were made`);
  }
  if (plan.length !== 1) {
    throw new Error("Apply one client at a time with --clients <client> so a later CLI failure cannot leave a partial multi-client rollout");
  }
  const backupDirectory = writeBackup(inspections);
  const applied = [];
  for (const item of plan) {
    execFileSync(item.command, item.args, { stdio: "inherit" });
    applied.push(item.client);
  }
  process.stdout.write(`${JSON.stringify({ mode: "apply", applied, backupDirectory, next: plan.map((item) => item.loginCommand) }, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
