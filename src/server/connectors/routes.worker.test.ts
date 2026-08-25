import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { sealSession, SESSION_COOKIE_NAME } from "../auth/session";
import type { Env } from "../env";
import { MemoryStore } from "../memory/store";

const testEnv = env as unknown as Env;
const ownerId = "123456789";

async function cookie(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const token = await sealSession({
    userId: ownerId,
    login: "community-owner",
    issuedAt: now,
    expiresAt: now + 60,
  }, "0".repeat(64));
  return `${SESSION_COOKIE_NAME}=${token}`;
}

describe("connector dashboard routes", () => {
  beforeEach(async () => {
    await testEnv.DB.prepare("DELETE FROM connector_runs").run();
    await testEnv.DB.prepare("DELETE FROM memory_events").run();
    await testEnv.DB.prepare("DELETE FROM memories").run();
    await testEnv.DB.prepare("DELETE FROM users").run();
    const timestamp = new Date().toISOString();
    await testEnv.DB.prepare(
      "INSERT INTO users (id, github_login, created_at, updated_at) VALUES (?, ?, ?, ?)",
    ).bind(ownerId, "community-owner", timestamp, timestamp).run();
  });

  it("requires auth and same-origin, then applies only an unchanged preview", async () => {
    expect((await SELF.fetch("https://cloud-memory.test/api/connectors")).status).toBe(401);
    const session = await cookie();
    const input = `${JSON.stringify({ id: "existing", content: "Connector route duplicate" })}\n`;
    await new MemoryStore(testEnv.DB).create({ ownerId, content: "Connector route duplicate" });

    const previewResponse = await SELF.fetch("https://cloud-memory.test/api/connectors/preview", {
      method: "POST",
      headers: { cookie: session, origin: "https://cloud-memory.test", "content-type": "application/json" },
      body: JSON.stringify({ adapterId: "cloud_memory_jsonl", input }),
    });
    expect(previewResponse.status).toBe(201);
    const preview = await previewResponse.json() as {
      run: { id: string; version: number };
      preview: { previewSha256: string };
    };

    const tampered = await SELF.fetch(`https://cloud-memory.test/api/connectors/${preview.run.id}/apply`, {
      method: "POST",
      headers: { cookie: session, origin: "https://cloud-memory.test", "content-type": "application/json" },
      body: JSON.stringify({
        adapterId: "cloud_memory_jsonl",
        input: `${JSON.stringify({ id: "changed", content: "Changed" })}\n`,
        expectedVersion: preview.run.version,
        previewSha256: preview.preview.previewSha256,
      }),
    });
    expect(tampered.status).toBe(409);

    const applied = await SELF.fetch(`https://cloud-memory.test/api/connectors/${preview.run.id}/apply`, {
      method: "POST",
      headers: { cookie: session, origin: "https://cloud-memory.test", "content-type": "application/json" },
      body: JSON.stringify({
        adapterId: "cloud_memory_jsonl",
        input,
        expectedVersion: preview.run.version,
        previewSha256: preview.preview.previewSha256,
      }),
    });
    expect(applied.status).toBe(200);
    await expect(applied.json()).resolves.toMatchObject({ status: "completed", importedCount: 0, duplicateCount: 1 });
  });
});
