/* global URL, console, fetch, process */

import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { aggregateMetrics } from "../benchmarks/metrics.mjs";

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}

function assertPrivateDataset(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.queries)) {
    throw new Error("Live benchmark dataset must contain a queries array");
  }
  if (value.queries.length < 20 || value.queries.length > 30) {
    throw new Error("Live benchmark dataset must contain between 20 and 30 queries");
  }
  for (const query of value.queries) {
    if (!query.id || !query.query || !Array.isArray(query.relevant)) {
      throw new Error("Every live benchmark query needs id, query and relevant fields");
    }
  }
}

async function callSearch(endpoint, token, query, requestId) {
  const started = performance.now();
  const response = await fetch(new URL("/mcp", endpoint), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: requestId,
      method: "tools/call",
      params: {
        name: "cloudmemory_search",
        arguments: {
          query: query.query,
          mode: query.mode ?? "hybrid",
          limit: query.limit ?? 10,
          include_directives: query.includeDirectives ?? true,
        },
      },
    }),
  });
  const latencyMs = performance.now() - started;
  const text = await response.text();
  if (!response.ok) throw new Error(`MCP benchmark request failed (${response.status})`);
  const payloadText = text.startsWith("event:")
    ? text.split(/\r?\n/).find((line) => line.startsWith("data:"))?.slice(5).trim()
    : text;
  if (!payloadText) throw new Error("MCP benchmark response did not contain data");
  const payload = JSON.parse(payloadText);
  if (payload.error) throw new Error(`MCP benchmark error: ${payload.error.message ?? "unknown error"}`);
  const result = payload.result?.structuredContent
    ?? JSON.parse(payload.result?.content?.[0]?.text ?? "null");
  if (!result || !Array.isArray(result.results)) throw new Error("MCP search result was malformed");
  return { result, latencyMs };
}

const datasetPath = argumentValue("--dataset") ?? ".private/benchmarks/relevance-live.json";
const endpoint = argumentValue("--endpoint") ?? process.env.CLOUD_MEMORY_ENDPOINT;
const token = process.env.CLOUD_MEMORY_MCP_TOKEN;
if (!endpoint) throw new Error("Pass --endpoint or set CLOUD_MEMORY_ENDPOINT");
if (!token) throw new Error("Set CLOUD_MEMORY_MCP_TOKEN without placing it in the dataset or repository");

const dataset = JSON.parse(await readFile(pathToFileURL(datasetPath), "utf8"));
assertPrivateDataset(dataset);
const rows = [];
const latencies = [];
const criticalFailures = [];

for (const [index, query] of dataset.queries.entries()) {
  const { result, latencyMs } = await callSearch(endpoint, token, query, index + 1);
  latencies.push(latencyMs);
  const ids = result.results.map((memory) => memory.id);
  const forbidden = new Set(query.forbidden ?? []);
  const row = {
    id: query.id,
    category: query.category ?? "private",
    results: ids,
    relevant: query.relevant,
    graded: query.graded ?? Object.fromEntries(query.relevant.map((id) => [id, 3])),
    expectNoResult: query.expectNoResult === true,
  };
  rows.push(row);
  const topFive = ids.slice(0, 5);
  const relevantHit = query.relevant.length === 0 || topFive.some((id) => query.relevant.includes(id));
  const forbiddenHit = topFive.some((id) => forbidden.has(id));
  if (query.critical === true && (!relevantHit || forbiddenHit)) {
    criticalFailures.push({ id: query.id, relevantHit, forbiddenHit });
  }
}

const metrics = aggregateMetrics(rows, latencies);
console.log(JSON.stringify({
  dataset: datasetPath,
  endpoint: new URL(endpoint).origin,
  checkedAt: new Date().toISOString(),
  metrics,
  degradedQueries: rows.filter((_, index) => latencies[index] > 5_000).map((row) => row.id),
  criticalFailures,
}, null, 2));

if (criticalFailures.length > 0) process.exitCode = 1;
