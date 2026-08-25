import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { sealSession, SESSION_COOKIE_NAME } from "../auth/session";
import type { Env } from "../env";

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

describe("roadmap dashboard routes", () => {
  beforeEach(async () => {
    await testEnv.DB.prepare("DELETE FROM roadmap_promotions").run();
    await testEnv.DB.prepare("DELETE FROM roadmap_events").run();
    await testEnv.DB.prepare("DELETE FROM roadmap_items").run();
    await testEnv.DB.prepare("DELETE FROM task_events").run();
    await testEnv.DB.prepare("DELETE FROM tasks").run();
    await testEnv.DB.prepare("DELETE FROM projects").run();
    await testEnv.DB.prepare("DELETE FROM users").run();
    const timestamp = "2026-08-24T14:00:00.000Z";
    await testEnv.DB.prepare(
      `INSERT INTO users (id, github_login, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    ).bind(ownerId, "community-owner", timestamp, timestamp).run();
    await testEnv.DB.prepare(
      `INSERT INTO projects (id, owner_id, name, colour, status, created_at, updated_at)
       VALUES ('project-1', ?, 'Cloud Memory', '#c9ff3b', 'active', ?, ?)`,
    ).bind(ownerId, timestamp, timestamp).run();
  });

  it("authenticates reads and protects writes with same-origin validation", async () => {
    expect((await SELF.fetch("https://cloud-memory.test/api/roadmaps")).status).toBe(401);
    const session = await cookie();
    const denied = await SELF.fetch("https://cloud-memory.test/api/roadmaps", {
      method: "POST",
      headers: { cookie: session, origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ projectId: "project-1", title: "Denied idea" }),
    });
    expect(denied.status).toBe(403);

    const createdResponse = await SELF.fetch("https://cloud-memory.test/api/roadmaps", {
      method: "POST",
      headers: { cookie: session, origin: "https://cloud-memory.test", "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "project-1",
        title: "Add a release trend view",
        horizon: "next",
        impact: "high",
        effort: "small",
        sourceType: "human",
      }),
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as { id: string; version: number };

    const list = await SELF.fetch("https://cloud-memory.test/api/roadmaps?projectId=project-1&scope=active&limit=20", {
      headers: { cookie: session },
    });
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      total: 1,
      items: [{ id: created.id, title: "Add a release trend view", horizon: "next" }],
    });
  });

  it("updates, archives, restores and promotes through versioned routes", async () => {
    const session = await cookie();
    const mutationHeaders = {
      cookie: session,
      origin: "https://cloud-memory.test",
      "content-type": "application/json",
    };
    const createdResponse = await SELF.fetch("https://cloud-memory.test/api/roadmaps", {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({ projectId: "project-1", title: "Roadmap route idea" }),
    });
    const created = await createdResponse.json() as { id: string; version: number };

    const plannedResponse = await SELF.fetch(`https://cloud-memory.test/api/roadmaps/${created.id}`, {
      method: "PATCH",
      headers: mutationHeaders,
      body: JSON.stringify({ expectedVersion: created.version, status: "planned", horizon: "next" }),
    });
    expect(plannedResponse.status).toBe(200);
    const planned = await plannedResponse.json() as { version: number };

    const archivedResponse = await SELF.fetch(`https://cloud-memory.test/api/roadmaps/${created.id}/archive`, {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({ expectedVersion: planned.version, confirm: true }),
    });
    const archived = await archivedResponse.json() as { version: number; status: string };
    expect(archived.status).toBe("archived");

    const restoredResponse = await SELF.fetch(`https://cloud-memory.test/api/roadmaps/${created.id}/restore`, {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({ expectedVersion: archived.version }),
    });
    const restored = await restoredResponse.json() as { version: number };
    const promotedResponse = await SELF.fetch(`https://cloud-memory.test/api/roadmaps/${created.id}/promote`, {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({
        expectedVersion: restored.version,
        correlationId: "dashboard-promote-1",
        confirm: true,
        client: "Cloud Memory dashboard",
      }),
    });
    expect(promotedResponse.status).toBe(200);
    await expect(promotedResponse.json()).resolves.toMatchObject({
      replayed: false,
      roadmap: { status: "promoted" },
      task: { status: "inbox", title: "Roadmap route idea" },
    });

    const stale = await SELF.fetch(`https://cloud-memory.test/api/roadmaps/${created.id}`, {
      method: "PATCH",
      headers: mutationHeaders,
      body: JSON.stringify({ expectedVersion: restored.version, title: "Stale" }),
    });
    expect(stale.status).toBe(409);
  });
});
