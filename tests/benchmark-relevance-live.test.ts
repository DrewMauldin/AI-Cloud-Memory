import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const cleanups: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

function runBenchmark(args: string[], env: Record<string, string>): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/benchmark-relevance-live.mjs", ...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function fixture(criticalFailure = false): Promise<{ datasetPath: string; endpoint: string }> {
  const directory = await mkdtemp(join(tmpdir(), "cloud-memory-live-benchmark-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const datasetPath = join(directory, "relevance-live.json");
  const queries = Array.from({ length: 20 }, (_, index) => ({
    id: `q${String(index + 1).padStart(2, "0")}`,
    query: `benchmark query ${index + 1}`,
    relevant: [`memory-${index + 1}`],
    critical: index === 0,
  }));
  await writeFile(datasetPath, JSON.stringify({ version: "1", queries }));

  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body) as { id: number; params: { arguments: { query: string } } };
      const query = payload.params.arguments.query;
      const number = Number(query.match(/\d+$/)?.[0] ?? 0);
      const id = criticalFailure && number === 1 ? "unexpected-memory" : `memory-${number}`;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: payload.id,
        result: { structuredContent: { results: [{ id }] } },
      }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fake benchmark server did not start");
  return { datasetPath, endpoint: `http://127.0.0.1:${address.port}` };
}

describe("live relevance benchmark", () => {
  it("runs 20 private-shaped queries without exposing its bearer token", async () => {
    const { datasetPath, endpoint } = await fixture();

    const result = await runBenchmark(["--dataset", datasetPath, "--endpoint", endpoint], {
      CLOUD_MEMORY_MCP_TOKEN: "test-token-not-secret",
    });

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain("test-token-not-secret");
    const report = JSON.parse(result.stdout) as { metrics: { recallAt5: number }; criticalFailures: unknown[] };
    expect(report.metrics.recallAt5).toBe(1);
    expect(report.criticalFailures).toEqual([]);
  });

  it("exits non-zero when a critical query misses", async () => {
    const { datasetPath, endpoint } = await fixture(true);

    const result = await runBenchmark(["--dataset", datasetPath, "--endpoint", endpoint], {
      CLOUD_MEMORY_MCP_TOKEN: "test-token-not-secret",
    });

    expect(result.code).toBe(1);
    const report = JSON.parse(result.stdout) as { criticalFailures: unknown[] };
    expect(report.criticalFailures).toEqual([
      { id: "q01", relevantHit: false, forbiddenHit: false },
    ]);
  });
});
