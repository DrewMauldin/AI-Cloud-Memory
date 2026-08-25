import { env, SELF } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import type { Env } from "../src/server/env";
import { createDefaultApp } from "../src/server/auth/app";
import { issueAutomationToken } from "../src/server/automation/token";
import { sealSession, SESSION_COOKIE_NAME } from "../src/server/auth/session";
import { MemoryReviewStore } from "../src/server/memory/review";
import { MemoryStore } from "../src/server/memory/store";
import { ProjectStore } from "../src/server/projects/store";
import { CapabilityReceiptStore } from "../src/server/operations/receipts";

const TEST_COOKIE_ENCRYPTION_KEY = "0".repeat(64);
const testEnv = env as unknown as Env;

async function ensureUser(userId: string, login = userId): Promise<void> {
  const timestamp = new Date().toISOString();
  await testEnv.DB.prepare(
    `INSERT OR IGNORE INTO users (id, github_login, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
  ).bind(userId, login, timestamp, timestamp).run();
}

async function sessionCookie(userId = "123456789"): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const token = await sealSession({
    userId,
    login: userId === "123456789" ? "community-owner" : userId,
    issuedAt: now,
    expiresAt: now + 60,
  }, TEST_COOKIE_ENCRYPTION_KEY);
  return `${SESSION_COOKIE_NAME}=${token}`;
}

describe("Cloud Memory Worker boundaries", () => {
  it("serves bounded health with browser security headers", async () => {
    const response = await SELF.fetch("https://cloud-memory.test/api/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      service: "cloud-memory",
      environment: "local",
      checks: {
        worker: "responding",
        d1: "verified",
        vectorize: "disabled",
        workersAi: "disabled",
      },
    });
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'self'",
    );
  });

  it("rejects dashboard data access without an encrypted session", async () => {
    const response = await SELF.fetch("https://cloud-memory.test/api/session");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      authenticated: false,
      user: null,
    });
  });

  it("reports authenticated export capabilities without exposing configuration", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await sealSession({
      userId: "123456789",
      login: "community-owner",
      issuedAt: now,
      expiresAt: now + 60,
    }, TEST_COOKIE_ENCRYPTION_KEY);

    const response = await SELF.fetch("https://cloud-memory.test/api/session", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      authenticated: true,
      exportCapabilities: {
        encryptedDownload: true,
        githubExport: false,
      },
    });
  });

  it("downloads an encrypted no-store envelope through the authenticated boundary", async () => {
    const now = Math.floor(Date.now() / 1000);
    await testEnv.DB.prepare(
      `INSERT OR REPLACE INTO users (
        id, github_login, display_name, avatar_url, created_at, updated_at
      ) VALUES (?, ?, NULL, NULL, ?, ?)`,
    ).bind("123456789", "community-owner", new Date().toISOString(), new Date().toISOString()).run();
    const token = await sealSession({
      userId: "123456789",
      login: "community-owner",
      issuedAt: now,
      expiresAt: now + 60,
    }, TEST_COOKIE_ENCRYPTION_KEY);

    const response = await SELF.fetch("https://cloud-memory.test/api/exports/download", {
      method: "POST",
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
        origin: "https://cloud-memory.test",
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-disposition")).toMatch(/\.enc\.json"$/);
    await expect(response.json()).resolves.toMatchObject({
      algorithm: "AES-256-GCM",
      version: 1,
    });
  });

  it("fails closed at the route boundary when the encryption key is malformed", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await sealSession({
      userId: "123456789",
      login: "community-owner",
      issuedAt: now,
      expiresAt: now + 60,
    }, TEST_COOKIE_ENCRYPTION_KEY);
    const request = new Request("https://cloud-memory.test/api/exports/download", {
      method: "POST",
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
        origin: "https://cloud-memory.test",
      },
    });
    const response = await createDefaultApp().request(request, undefined, {
      ...testEnv,
      EXPORT_ENCRYPTION_KEY: "not-a-256-bit-hex-key",
    } as never);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "EXPORT_NOT_CONFIGURED" },
    });
  });

  it("challenges unauthenticated MCP requests with OAuth metadata", async () => {
    const response = await SELF.fetch("https://cloud-memory.test/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2026-07-28",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
      }),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
    expect(response.headers.get("www-authenticate")).toContain(
      "oauth-protected-resource",
    );
  });

  it("lists only the authenticated owner's open memory reviews", async () => {
    await ensureUser("123456789", "community-owner");
    await ensureUser("review-other-owner", "OtherOwner");
    const ownerCorrelation = `route-review-owner-${crypto.randomUUID()}`;
    const otherCorrelation = `route-review-other-${crypto.randomUUID()}`;
    const store = new MemoryReviewStore(testEnv.DB);
    await store.createReview({
      ownerId: "123456789",
      reviewType: "source_conflict",
      candidateContent: "Owner review candidate",
      candidateSha256: "a".repeat(64),
      candidateNamespace: "default",
      candidateKind: "memory",
      matchedMemoryId: null,
      similarity: null,
      correlationId: ownerCorrelation,
    });
    await store.createReview({
      ownerId: "review-other-owner",
      reviewType: "source_conflict",
      candidateContent: "Other owner review candidate",
      candidateSha256: "b".repeat(64),
      candidateNamespace: "default",
      candidateKind: "memory",
      matchedMemoryId: null,
      similarity: null,
      correlationId: otherCorrelation,
    });

    const response = await SELF.fetch("https://cloud-memory.test/api/memories/reviews?status=open&limit=100", {
      headers: { cookie: await sessionCookie() },
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { reviews: Array<{ ownerId: string; correlationId: string }> };
    expect(body.reviews.some((review) => review.correlationId === ownerCorrelation)).toBe(true);
    expect(body.reviews.some((review) => review.correlationId === otherCorrelation)).toBe(false);
    expect(body.reviews.filter((review) => review.ownerId !== "123456789")).toHaveLength(0);
  });

  it("resolves one review through the authenticated boundary without mutating memories", async () => {
    await ensureUser("123456789", "community-owner");
    const correlationId = `route-review-resolve-${crypto.randomUUID()}`;
    const { review } = await new MemoryReviewStore(testEnv.DB).createReview({
      ownerId: "123456789",
      reviewType: "probable_duplicate",
      candidateContent: "Review-only candidate",
      candidateSha256: "c".repeat(64),
      candidateNamespace: "default",
      candidateKind: "memory",
      matchedMemoryId: null,
      similarity: 0.95,
      correlationId,
    });
    const before = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS count FROM memories WHERE owner_id = ?",
    ).bind("123456789").first<{ count: number }>();

    const response = await SELF.fetch(`https://cloud-memory.test/api/memories/reviews/${review.id}/resolve`, {
      method: "POST",
      headers: {
        cookie: await sessionCookie(),
        origin: "https://cloud-memory.test",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        status: "approved",
        expected_version: review.version,
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      review: { id: review.id, status: "approved", version: 2 },
    });
    const after = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS count FROM memories WHERE owner_id = ?",
    ).bind("123456789").first<{ count: number }>();
    expect(after?.count).toBe(before?.count);
  });

  it("requires same-origin writes for relevance feedback and stores only its hash", async () => {
    await ensureUser("123456789", "community-owner");
    const memory = await new MemoryStore(testEnv.DB).create({
      ownerId: "123456789",
      content: `Feedback route memory ${crypto.randomUUID()}`,
    });
    const correlationId = `route-feedback-${crypto.randomUUID()}`;
    const payload = {
      memory_id: memory.id,
      query: "private query is transient",
      label: "helpful",
      mode: "hybrid",
      rank: 1,
      score: 0.91,
      correlation_id: correlationId,
    };

    const crossOrigin = await SELF.fetch("https://cloud-memory.test/api/memories/feedback", {
      method: "POST",
      headers: {
        cookie: await sessionCookie(),
        origin: "https://evil.example",
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    expect(crossOrigin.status).toBe(403);

    const response = await SELF.fetch("https://cloud-memory.test/api/memories/feedback", {
      method: "POST",
      headers: {
        cookie: await sessionCookie(),
        origin: "https://cloud-memory.test",
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    expect(response.status).toBe(201);
    const body = await response.json() as { feedback: Record<string, unknown>; idempotent: boolean };
    expect(body).toMatchObject({ idempotent: false, feedback: { memoryId: memory.id } });
    expect(body.feedback.querySha256).toMatch(/^[0-9a-f]{64}$/);
    expect(body.feedback).not.toHaveProperty("query");

    const replay = await SELF.fetch("https://cloud-memory.test/api/memories/feedback", {
      method: "POST",
      headers: {
        cookie: await sessionCookie(),
        origin: "https://cloud-memory.test",
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ idempotent: true });
  });

  it("manages one memory through the bounded authenticated Library lifecycle", async () => {
    await ensureUser("123456789", "community-owner");
    const memory = await new MemoryStore(testEnv.DB).create({
      ownerId: "123456789",
      content: `Library route record ${crypto.randomUUID()}`,
    });
    const cookie = await sessionCookie();

    const listed = await SELF.fetch(`https://cloud-memory.test/api/library?query=${encodeURIComponent(memory.content)}&limit=1`, {
      headers: { cookie },
    });
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      items: [expect.objectContaining({ id: memory.id, labels: [] })],
      counts: expect.any(Object),
    });

    const labelled = await SELF.fetch(`https://cloud-memory.test/api/memories/${memory.id}/labels`, {
      method: "POST",
      headers: { cookie, origin: "https://cloud-memory.test", "content-type": "application/json" },
      body: JSON.stringify({ label: "Release Notes", expectedVersion: memory.version }),
    });
    expect(labelled.status).toBe(200);
    const labelledMemory = await labelled.json() as { version: number; labels: string[] };
    expect(labelledMemory).toMatchObject({ labels: ["release-notes"], version: memory.version + 1 });

    const lifecycleEnv = {
      ...testEnv,
      MEMORY_INDEX: { deleteByIds: async () => ({ mutationId: "test-delete" }) },
    } as never;
    const archived = await createDefaultApp().request(new Request(
      `https://cloud-memory.test/api/memories/${memory.id}/archive`,
      {
        method: "POST",
        headers: { cookie, origin: "https://cloud-memory.test", "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: labelledMemory.version }),
      },
    ), undefined, lifecycleEnv);
    expect(archived.status).toBe(200);
    const archivedMemory = await archived.json() as { version: number; status: string };
    expect(archivedMemory.status).toBe("archived");

    const wrongPurge = await createDefaultApp().request(new Request(
      `https://cloud-memory.test/api/memories/${memory.id}/purge`,
      {
        method: "POST",
        headers: { cookie, origin: "https://cloud-memory.test", "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: archivedMemory.version, confirmation: "PURGE wrong-id" }),
      },
    ), undefined, lifecycleEnv);
    expect(wrongPurge.status).toBe(409);

    const purged = await createDefaultApp().request(new Request(
      `https://cloud-memory.test/api/memories/${memory.id}/purge`,
      {
        method: "POST",
        headers: { cookie, origin: "https://cloud-memory.test", "content-type": "application/json" },
        body: JSON.stringify({
          expectedVersion: archivedMemory.version,
          confirmation: `PURGE ${memory.id}`,
        }),
      },
    ), undefined, lifecycleEnv);
    expect(purged.status).toBe(200);
    await expect(purged.json()).resolves.toMatchObject({
      content: "[Permanently purged]",
      purgedAt: expect.any(String),
    });
  });

  it("commits canonical archive and purge state before best-effort vector cleanup", async () => {
    await ensureUser("123456789", "community-owner");
    const memory = await new MemoryStore(testEnv.DB).create({
      ownerId: "123456789",
      content: `Archive despite vector cleanup failure ${crypto.randomUUID()}`,
    });
    const failingVectorEnv = {
      ...testEnv,
      MEMORY_INDEX: { deleteByIds: async () => { throw new Error("Synthetic vector failure"); } },
    } as never;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await createDefaultApp().request(new Request(
        `https://cloud-memory.test/api/memories/${memory.id}/archive`,
        {
          method: "POST",
          headers: {
            cookie: await sessionCookie(),
            origin: "https://cloud-memory.test",
            "content-type": "application/json",
          },
          body: JSON.stringify({ expectedVersion: memory.version }),
        },
      ), undefined, failingVectorEnv);

      expect(response.status).toBe(200);
      const archived = await response.json() as { version: number };
      expect(archived).toMatchObject({ status: "archived", vectorState: "not_required" });
      await expect(new MemoryStore(testEnv.DB).getById("123456789", memory.id))
        .resolves.toMatchObject({ status: "archived" });

      const purgeResponse = await createDefaultApp().request(new Request(
        `https://cloud-memory.test/api/memories/${memory.id}/purge`,
        {
          method: "POST",
          headers: {
            cookie: await sessionCookie(),
            origin: "https://cloud-memory.test",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            expectedVersion: archived.version,
            confirmation: `PURGE ${memory.id}`,
          }),
        },
      ), undefined, failingVectorEnv);

      expect(purgeResponse.status).toBe(200);
      await expect(purgeResponse.json()).resolves.toMatchObject({
        content: "[Permanently purged]",
        purgedAt: expect.any(String),
      });
    } finally {
      consoleError.mockRestore();
    }
  });

  it("applies bounded Library batches with explicit partial results", async () => {
    await ensureUser("123456789", "community-owner");
    const store = new MemoryStore(testEnv.DB);
    const first = await store.create({ ownerId: "123456789", content: `Batch first ${crypto.randomUUID()}` });
    const second = await store.create({ ownerId: "123456789", content: `Batch second ${crypto.randomUUID()}` });
    const response = await SELF.fetch("https://cloud-memory.test/api/library/bulk", {
      method: "POST",
      headers: {
        cookie: await sessionCookie(),
        origin: "https://cloud-memory.test",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action: "label",
        label: "batch-reviewed",
        records: [
          { id: first.id, expectedVersion: first.version },
          { id: second.id, expectedVersion: second.version + 1 },
        ],
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      results: [
        { id: first.id, outcome: "changed", memory: { labels: ["batch-reviewed"] } },
        { id: second.id, outcome: "conflict" },
      ],
    });
  });

  it("returns one owner-scoped lifecycle activity feed", async () => {
    await ensureUser("123456789", "community-owner");
    const memories = new MemoryStore(testEnv.DB);
    const projects = new ProjectStore(testEnv.DB);
    const memory = await memories.create({ ownerId: "123456789", content: `Activity memory ${crypto.randomUUID()}` });
    const project = await projects.createProject({ ownerId: "123456789", name: `Activity project ${crypto.randomUUID()}` });
    await memories.archiveMemory({ ownerId: "123456789", memoryId: memory.id, expectedVersion: memory.version });
    await projects.archiveProject({ ownerId: "123456789", projectId: project.id, expectedVersion: project.version });

    const response = await SELF.fetch("https://cloud-memory.test/api/activity?limit=100", {
      headers: { cookie: await sessionCookie() },
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { events: Array<{ subjectType: string; subjectId: string; eventType: string }> };
    expect(body.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ subjectType: "memory", subjectId: memory.id, eventType: "archived" }),
      expect.objectContaining({ subjectType: "project", subjectId: project.id, eventType: "archived" }),
    ]));
  });

  it("lists and restores archived projects without returning their tasks on the active board", async () => {
    await ensureUser("123456789", "community-owner");
    const store = new ProjectStore(testEnv.DB);
    const project = await store.createProject({ ownerId: "123456789", name: `Archived ${crypto.randomUUID()}` });
    const task = await store.createTask({ ownerId: "123456789", projectId: project.id, title: "Preserve me" });
    const cookie = await sessionCookie();

    const archivedResponse = await SELF.fetch(`https://cloud-memory.test/api/projects/${project.id}/archive`, {
      method: "POST",
      headers: { cookie, origin: "https://cloud-memory.test", "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: project.version, confirm: true }),
    });
    const archived = await archivedResponse.json() as { version: number };

    const activeBoard = await SELF.fetch("https://cloud-memory.test/api/projects?scope=active", { headers: { cookie } });
    const activeBody = await activeBoard.json() as { projects: Array<{ id: string }>; tasks: Array<{ id: string }> };
    expect(activeBody.projects.map((item) => item.id)).not.toContain(project.id);
    expect(activeBody.tasks.map((item) => item.id)).not.toContain(task.id);

    const archive = await SELF.fetch("https://cloud-memory.test/api/projects?scope=archived", { headers: { cookie } });
    const archiveBody = await archive.json() as { projects: Array<{ id: string }>; tasks: Array<{ id: string }> };
    expect(archiveBody.projects.map((item) => item.id)).toContain(project.id);
    expect(archiveBody.tasks.map((item) => item.id)).toContain(task.id);

    const restoredResponse = await SELF.fetch(`https://cloud-memory.test/api/projects/${project.id}/restore`, {
      method: "POST",
      headers: { cookie, origin: "https://cloud-memory.test", "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: archived.version }),
    });
    expect(restoredResponse.status).toBe(200);
    await expect(restoredResponse.json()).resolves.toMatchObject({ status: "active", archivedAt: null });
  });

  it("projects capability receipts without writing a projection receipt", async () => {
    const ownerId = `projection-owner-${crypto.randomUUID()}`;
    await ensureUser(ownerId);
    const issued = await issueAutomationToken({
      database: testEnv.DB,
      ownerId,
      label: "projection test",
      scopes: ["projection:read"],
    });
    await new CapabilityReceiptStore(testEnv.DB).record({
      ownerId,
      capability: "mcp",
      status: "verified",
      detail: "MCP test receipt",
      source: "worker-test",
      checkedAt: "2026-08-24T00:00:00.000Z",
    });
    const projectStore = new ProjectStore(testEnv.DB);
    const archivedProject = await projectStore.createProject({ ownerId, name: "Projection archive" });
    await projectStore.createTask({ ownerId, projectId: archivedProject.id, title: "Preserved projection task" });
    await projectStore.archiveProject({ ownerId, projectId: archivedProject.id, expectedVersion: archivedProject.version });
    const memoryStore = new MemoryStore(testEnv.DB);
    const directive = await memoryStore.create({
      ownerId,
      content: "Keep projection writes inside the managed folder.",
      directive: true,
    });
    await memoryStore.addLabel({ ownerId, memoryId: directive.id, label: "projection", expectedVersion: directive.version });
    const archivedMemory = await memoryStore.create({ ownerId, content: "Archived projection evidence." });
    await memoryStore.archiveMemory({ ownerId, memoryId: archivedMemory.id, expectedVersion: archivedMemory.version });

    const before = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS count FROM capability_receipts WHERE owner_id = ?",
    ).bind(ownerId).first<{ count: number }>();
    const response = await SELF.fetch("https://cloud-memory.test/api/automation/obsidian-projection", {
      headers: { authorization: `Bearer ${issued.token}` },
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { files: Array<{ path: string; content: string }> };
    const status = body.files.find((file) => file.path === "Cloud Memory/System Status.md");
    expect(status?.content).toContain("MCP test receipt");
    expect(body.files.map((file) => file.path)).toContain(`Cloud Memory/Directives/${directive.id}.md`);
    expect(body.files.find((file) => file.path === `Cloud Memory/Directives/${directive.id}.md`)?.content)
      .toContain('labels: ["projection"]');
    expect(body.files.map((file) => file.path)).toContain("Cloud Memory/Archive/Projects/Projection archive.md");
    expect(body.files.map((file) => file.path)).toContain(`Cloud Memory/Archive/Memories/${archivedMemory.id}.md`);
    const after = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS count FROM capability_receipts WHERE owner_id = ?",
    ).bind(ownerId).first<{ count: number }>();
    expect(after?.count).toBe(before?.count);
    await expect(testEnv.DB.prepare(
      "SELECT capability FROM capability_receipts WHERE owner_id = ? AND capability = 'obsidian_projection'",
    ).bind(ownerId).first()).resolves.toBeNull();
  });
});
