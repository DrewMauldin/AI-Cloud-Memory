import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { MemoryStore } from "./store";

const ownerId = "123456789";

describe("MemoryStore", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM memory_events").run();
    await env.DB.prepare("DELETE FROM memories").run();
    await env.DB.prepare("DELETE FROM users").run();
    await env.DB.prepare(
      `INSERT INTO users (id, github_login, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
    )
      .bind(ownerId, "community-owner", "2026-08-23T00:00:00.000Z", "2026-08-23T00:00:00.000Z")
      .run();
  });

  it("creates a canonical memory and an append-only provenance event", async () => {
    const store = new MemoryStore(env.DB, {
      now: () => "2026-08-23T01:02:03.000Z",
      newId: () => "mem_01",
      sha256: async () => "content_hash",
    });

    const memory = await store.create({
      ownerId,
      content: "Prefer Australian English in documentation.",
      directive: true,
      source: "Codex",
      sourceUrl: "https://chatgpt.com/c/example",
      client: "Codex",
      model: "GPT-5",
    });

    expect(memory).toMatchObject({
      id: "mem_01",
      memoryNumber: 1,
      kind: "directive",
      content: "Prefer Australian English in documentation.",
      sourceClient: "Codex",
      sourceModel: "GPT-5",
      vectorState: "pending",
    });

    const event = await env.DB.prepare(
      "SELECT event_type, actor_type, client, model FROM memory_events WHERE memory_id = ?",
    )
      .bind(memory.id)
      .first<Record<string, string>>();

    expect(event).toEqual({
      event_type: "created",
      actor_type: "model",
      client: "Codex",
      model: "GPT-5",
    });
  });

  it("persists typed scope, retention and bi-temporal metadata", async () => {
    const store = new MemoryStore(env.DB, {
      now: () => "2026-08-24T01:02:03.000Z",
      newId: () => crypto.randomUUID(),
      sha256: async () => "typed_hash",
    });

    const memory = await store.create({
      ownerId,
      content: "Cloud Memory replaced TrueMemory for Atlas.",
      memoryType: "decision",
      scopeType: "project",
      scopeId: "atlas",
      retentionTier: "core",
      observedAt: "2026-08-23T10:00:00.000Z",
      reviewAt: "2026-09-24T00:00:00.000Z",
    });

    expect(memory).toMatchObject({
      memoryType: "decision",
      scopeType: "project",
      scopeId: "atlas",
      retentionTier: "core",
      observedAt: "2026-08-23T10:00:00.000Z",
      recordedAt: "2026-08-24T01:02:03.000Z",
      reviewAt: "2026-09-24T00:00:00.000Z",
    });
  });

  it("rejects secret-like content before writing a canonical record", async () => {
    const store = new MemoryStore(env.DB, {
      now: () => "2026-08-23T01:02:03.000Z",
      newId: () => "mem_secret",
      sha256: async () => "secret_hash",
    });

    await expect(store.create({
      ownerId,
      content: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456",
    })).rejects.toMatchObject({
      name: "SecretPatternError",
      code: "SECRET_PATTERN",
    });
    await expect(env.DB.prepare("SELECT COUNT(*) AS count FROM memories").first<{ count: number }>()
      .then((result) => result?.count)).resolves.toBe(0);
  });

  it("finds directives and BM25 lexical matches only within the owner boundary", async () => {
    const store = new MemoryStore(env.DB, {
      now: () => "2026-08-23T01:02:03.000Z",
      newId: (() => {
        let value = 0;
        return () => `mem_0${++value}`;
      })(),
      sha256: async (content) => `hash_${content.length}`,
    });

    await store.create({ ownerId, content: "Use Australian English.", directive: true });
    await store.create({ ownerId, content: "Cloud Memory uses D1.", directive: false });

    const directives = await store.listDirectives(ownerId);
    const results = await store.searchExact(ownerId, "Cloud D1", 10, false);

    expect(directives.map((memory) => memory.content)).toEqual([
      "Use Australian English.",
    ]);
    expect(results.map((memory) => memory.content)).toEqual([
      "Cloud Memory uses D1.",
    ]);
    expect(await store.getByNumber("other-owner", 2)).toBeNull();
  });

  it("lists a bounded current memory set for managed projections", async () => {
    const store = new MemoryStore(env.DB, {
      now: () => "2026-08-24T01:02:03.000Z",
      newId: () => crypto.randomUUID(),
      sha256: async (content) => `hash_${content}`,
    });
    await store.create({ ownerId, content: "Current fact" });
    await store.create({ ownerId, content: "Current directive", directive: true });

    const projected = await store.listActive(ownerId, 1, false);

    expect(projected).toHaveLength(1);
    expect(projected[0]?.kind).toBe("memory");
    expect(await store.listActive("other-owner", 100, true)).toEqual([]);
  });

  it("lists stable cursor pages with labels and lifecycle metadata", async () => {
    let now = "2026-08-24T01:00:00.000Z";
    const store = new MemoryStore(env.DB, {
      now: () => now,
      newId: () => crypto.randomUUID(),
      sha256: async (content) => `hash_${content}`,
    });
    const older = await store.create({ ownerId, content: "Older searchable library record", summary: "Short heading" });
    now = "2026-08-24T02:00:00.000Z";
    const newer = await store.create({ ownerId, content: "Newer library record", directive: true });
    const labelled = await store.addLabel({
      ownerId,
      memoryId: newer.id,
      label: "  Cloud Memory  ",
      expectedVersion: newer.version,
    });

    const first = await store.listLibrary({ ownerId, limit: 1 });
    const second = await store.listLibrary({ ownerId, limit: 1, cursor: first.nextCursor ?? undefined });
    const filtered = await store.listLibrary({ ownerId, limit: 10, label: "cloud memory" });
    const searched = await store.listLibrary({ ownerId, limit: 10, query: "searchable library" });

    expect(first.items).toEqual([
      expect.objectContaining({
        id: newer.id,
        labels: ["cloud-memory"],
        archivedAt: null,
        retrievalCount: 0,
        version: labelled.version,
      }),
    ]);
    expect(first.nextCursor).not.toBeNull();
    expect(second.items.map((memory) => memory.id)).toEqual([older.id]);
    expect(filtered.items.map((memory) => memory.id)).toEqual([newer.id]);
    expect(searched.items.map((memory) => memory.id)).toEqual([older.id]);
    expect(new Set([...first.items, ...second.items].map((memory) => memory.id)).size).toBe(2);
    expect(await store.listLibrary({ ownerId: "other-owner", limit: 100 })).toMatchObject({ items: [] });

    const retrieved = await store.recordRetrieval(ownerId, newer.id);
    expect(retrieved).toMatchObject({
      lastRetrievedAt: "2026-08-24T02:00:00.000Z",
      retrievalCount: 1,
      version: labelled.version,
    });
  });

  it("sorts stable Library pages and returns bounded related records", async () => {
    let now = "2026-08-24T02:10:00.000Z";
    const store = new MemoryStore(env.DB, {
      now: () => now,
      newId: () => crypto.randomUUID(),
      sha256: async (content) => `hash_${content}`,
    });
    const low = await store.create({
      ownerId,
      content: "Low-priority project context",
      importance: 0.2,
      scopeType: "project",
      scopeId: "cloud-memory-related",
    });
    now = "2026-08-24T02:11:00.000Z";
    const high = await store.create({
      ownerId,
      content: "High-priority project context",
      importance: 0.9,
      scopeType: "project",
      scopeId: "cloud-memory-related",
    });
    await store.addLabel({ ownerId, memoryId: low.id, label: "ranking", expectedVersion: low.version });
    await store.addLabel({ ownerId, memoryId: high.id, label: "ranking", expectedVersion: high.version });

    const first = await store.listLibrary({ ownerId, limit: 1, sort: "importance", scopeType: "project", scopeId: "cloud-memory-related" });
    const second = await store.listLibrary({ ownerId, limit: 1, sort: "importance", scopeType: "project", scopeId: "cloud-memory-related", cursor: first.nextCursor ?? undefined });
    const related = await store.listRelated(ownerId, high.id, 5);

    expect(first.items.map((memory) => memory.id)).toEqual([high.id]);
    expect(second.items.map((memory) => memory.id)).toEqual([low.id]);
    expect(related.map((memory) => memory.id)).toContain(low.id);
    expect(await store.listRelated("other-owner", high.id, 5)).toEqual([]);
  });

  it("archives and restores a memory with versioned audit history", async () => {
    let now = "2026-08-24T02:59:00.000Z";
    const store = new MemoryStore(env.DB, {
      now: () => now,
      newId: () => crypto.randomUUID(),
      sha256: async (content) => `hash_${content}`,
    });
    const memory = await store.create({ ownerId, content: "Lifecycle record" });

    now = "2026-08-24T03:00:00.000Z";
    const archived = await store.archiveMemory({ ownerId, memoryId: memory.id, expectedVersion: memory.version });
    now = "2026-08-24T03:01:00.000Z";
    const restored = await store.restoreMemory({ ownerId, memoryId: memory.id, expectedVersion: archived.version });
    const history = await store.listMemoryEvents(ownerId, memory.id, 20);

    expect(archived).toMatchObject({ status: "archived", archivedAt: "2026-08-24T03:00:00.000Z" });
    expect(restored).toMatchObject({ status: "active", archivedAt: null, vectorState: "pending" });
    expect(history.map((event) => event.eventType)).toEqual(["updated", "archived", "created"]);
    await expect(store.archiveMemory({
      ownerId: "other-owner",
      memoryId: memory.id,
      expectedVersion: restored.version,
    })).rejects.toMatchObject({ name: "MemoryConflictError" });
  });

  it("purges content only after archive and keeps a non-sensitive tombstone", async () => {
    const store = new MemoryStore(env.DB, {
      now: () => "2026-08-24T04:00:00.000Z",
      newId: () => crypto.randomUUID(),
      sha256: async () => "purged_hash",
    });
    const memory = await store.create({
      ownerId,
      content: "Content that must be removed",
      summary: "Sensitive summary",
      sourceUrl: "https://chatgpt.com/c/private",
      scopeType: "project",
      scopeId: "private-project",
    });

    await expect(store.purgeMemory({
      ownerId,
      memoryId: memory.id,
      expectedVersion: memory.version,
      confirmation: `PURGE ${memory.id}`,
    })).rejects.toMatchObject({ name: "MemoryConflictError" });

    const archived = await store.archiveMemory({ ownerId, memoryId: memory.id, expectedVersion: memory.version });
    expect(await env.DB.prepare(
      "SELECT status, version, purged_at FROM memories WHERE owner_id = ? AND id = ?",
    ).bind(ownerId, memory.id).first()).toEqual({ status: "archived", version: 2, purged_at: null });
    const purged = await store.purgeMemory({
      ownerId,
      memoryId: memory.id,
      expectedVersion: archived.version,
      confirmation: `PURGE ${memory.id}`,
    });
    const events = await store.listMemoryEvents(ownerId, memory.id, 20);

    expect(purged).toMatchObject({
      content: "[Permanently purged]",
      summary: null,
      sourceUrl: null,
      scopeId: null,
      sensitivity: "normal",
      status: "archived",
      vectorState: "not_required",
    });
    expect(JSON.stringify(events)).not.toContain("Content that must be removed");
    expect(JSON.stringify(events)).not.toContain("Sensitive summary");
    await expect(store.addLabel({
      ownerId,
      memoryId: memory.id,
      label: "must-not-return",
      expectedVersion: purged.version,
    })).rejects.toMatchObject({ name: "MemoryConflictError" });
    await expect(store.removeLabel({
      ownerId,
      memoryId: memory.id,
      label: "private",
      expectedVersion: purged.version,
    })).rejects.toMatchObject({ name: "MemoryConflictError" });
  });

  it("records a failed derived-index update without changing canonical content", async () => {
    const store = new MemoryStore(env.DB, {
      now: () => "2026-08-23T01:02:03.000Z",
      newId: () => crypto.randomUUID(),
      sha256: async () => "hash",
    });
    const memory = await store.create({ ownerId, content: "Canonical text" });

    await store.setVectorState(ownerId, memory.id, "failed");

    expect(await store.getById(ownerId, memory.id)).toMatchObject({
      content: "Canonical text",
      vectorState: "failed",
    });
    const events = await env.DB.prepare(
      "SELECT event_type FROM memory_events WHERE memory_id = ? ORDER BY created_at",
    )
      .bind(memory.id)
      .all<{ event_type: string }>();
    expect(events.results.map((event) => event.event_type).sort()).toEqual([
      "created",
      "index_failed",
    ]);
    expect((await store.listNeedingVectorRepair(ownerId, 25)).map((item) => item.id)).toEqual([
      memory.id,
    ]);
    expect(await store.counts(ownerId)).toMatchObject({ failed: 1, indexed: 0, pending: 0 });
  });

  it("finds an active exact duplicate only inside the owner, namespace, and kind boundary", async () => {
    const store = new MemoryStore(env.DB, {
      now: () => "2026-08-23T01:02:03.000Z",
      newId: () => crypto.randomUUID(),
      sha256: async (content) => `hash:${content.trim().toLowerCase()}`,
    });
    const memory = await store.create({
      ownerId,
      namespace: "project-atlas",
      content: "Atlas uses D1.",
      source: "Codex",
      sourceId: "atlas-chat-1",
    });

    expect(await store.findActiveByContent(
      ownerId,
      "project-atlas",
      "memory",
      "Atlas uses D1.",
    )).toMatchObject({ id: memory.id });
    expect(await store.findActiveByContent(
      ownerId,
      "other-project",
      "memory",
      "Atlas uses D1.",
    )).toBeNull();
    expect(await store.findActiveByContent(
      "other-owner",
      "project-atlas",
      "memory",
      "Atlas uses D1.",
    )).toBeNull();
    expect(await store.findBySourceIdentity(
      ownerId,
      "project-atlas",
      "Codex",
      "atlas-chat-1",
    )).toMatchObject({ id: memory.id });
    expect(await store.findBySourceIdentity(
      ownerId,
      "other-project",
      "Codex",
      "atlas-chat-1",
    )).toBeNull();
  });

  it("atomically creates a replacement and preserves an explicit supersession chain", async () => {
    const ids = [
      "old-memory",
      "old-event",
      "replacement-memory",
      "replacement-event",
      "superseded-event",
    ];
    const store = new MemoryStore(env.DB, {
      now: (() => {
        const times = ["2026-08-23T01:00:00.000Z", "2026-08-24T02:00:00.000Z"];
        return () => times.shift() ?? "2026-08-24T02:00:00.000Z";
      })(),
      newId: () => ids.shift() ?? crypto.randomUUID(),
      sha256: async (content) => `hash:${content}`,
    });
    const old = await store.create({
      ownerId,
      namespace: "project-atlas",
      content: "Atlas uses SQLite.",
      client: "Codex",
      model: "GPT-5.6",
    });

    const result = await store.createSuperseding({
      ownerId,
      namespace: "project-atlas",
      content: "Atlas now uses D1.",
      supersedesId: old.id,
      expectedSupersededVersion: 1,
      client: "Claude Code",
      model: "Sonnet 5",
      sourceUrl: "https://claude.ai/chat/example",
      correlationId: "capture-123",
    });

    expect(result.replacement).toMatchObject({
      id: "replacement-memory",
      status: "active",
      supersedesId: old.id,
      validFrom: "2026-08-24T02:00:00.000Z",
      version: 1,
    });
    expect(result.superseded).toMatchObject({
      id: old.id,
      status: "superseded",
      validUntil: "2026-08-24T02:00:00.000Z",
      version: 2,
    });
    expect(await store.searchExact(ownerId, "SQLite", 5, false)).toEqual([]);
    expect(await store.searchExact(ownerId, "SQLite", 5, false, true))
      .toEqual([expect.objectContaining({ id: old.id, status: "superseded" })]);
    expect(await store.searchExact(ownerId, "SQLite", 5, false, true, 2025))
      .toEqual([]);

    const events = await env.DB.prepare(
      `SELECT memory_id, event_type, client, model, source_url, correlation_id
       FROM memory_events
       WHERE memory_id IN (?, ?)
       ORDER BY created_at, event_type`,
    ).bind(old.id, result.replacement.id).all<Record<string, string | null>>();
    expect(events.results).toEqual(expect.arrayContaining([
      expect.objectContaining({
        memory_id: old.id,
        event_type: "superseded",
        client: "Claude Code",
        model: "Sonnet 5",
        source_url: "https://claude.ai/chat/example",
        correlation_id: "capture-123",
      }),
      expect.objectContaining({
        memory_id: result.replacement.id,
        event_type: "created",
        correlation_id: "capture-123",
      }),
    ]));

    const replay = await store.createSuperseding({
      ownerId,
      namespace: "project-atlas",
      content: "Atlas now uses D1.",
      supersedesId: old.id,
      expectedSupersededVersion: 1,
      client: "Claude Code",
      model: "Sonnet 5",
      sourceUrl: "https://claude.ai/chat/example",
      correlationId: "capture-123",
    });
    expect(replay.replacement.id).toBe(result.replacement.id);
    expect(await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM memories WHERE owner_id = ?",
    ).bind(ownerId).first<{ count: number }>()).toEqual({ count: 2 });

    await expect(store.createSuperseding({
      ownerId,
      namespace: "project-atlas",
      content: "Atlas now uses Durable Objects.",
      supersedesId: old.id,
      expectedSupersededVersion: 1,
      correlationId: "capture-456",
    })).rejects.toThrow("Memory version conflict");
    expect(await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM memories WHERE owner_id = ?",
    ).bind(ownerId).first<{ count: number }>()).toEqual({ count: 2 });
  });

  it("does not create a replacement across an owner or version boundary", async () => {
    const store = new MemoryStore(env.DB, {
      now: () => "2026-08-24T02:00:00.000Z",
      newId: () => crypto.randomUUID(),
      sha256: async (content) => `hash:${content}`,
    });
    const old = await store.create({
      ownerId,
      content: "Old fact",
      source: "Codex",
      sourceId: "chat-1",
    });

    await expect(store.createSuperseding({
      ownerId,
      content: "New fact",
      supersedesId: old.id,
      expectedSupersededVersion: 1,
      source: "Codex",
      sourceId: "chat-1",
    })).rejects.toThrow("distinct source identity");

    await expect(store.createSuperseding({
      ownerId: "other-owner",
      content: "New fact",
      supersedesId: old.id,
      expectedSupersededVersion: 1,
    })).rejects.toThrow("Memory version conflict");
    await expect(store.createSuperseding({
      ownerId,
      content: "New fact",
      supersedesId: old.id,
      expectedSupersededVersion: 9,
    })).rejects.toThrow("Memory version conflict");

    expect(await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM memories WHERE content = 'New fact'",
    ).first<{ count: number }>()).toEqual({ count: 0 });
    expect(await store.getById(ownerId, old.id)).toMatchObject({ status: "active", version: 1 });
  });

  it("allows only one same-millisecond concurrent supersession claim", async () => {
    const store = new MemoryStore(env.DB, {
      now: () => "2026-08-24T02:00:00.000Z",
      newId: () => crypto.randomUUID(),
      sha256: async (content) => `hash:${content}`,
    });
    const old = await store.create({ ownerId, content: "Old concurrent fact" });

    const results = await Promise.allSettled([
      store.createSuperseding({
        ownerId,
        content: "Concurrent replacement A",
        supersedesId: old.id,
        expectedSupersededVersion: 1,
        correlationId: "concurrent-a",
      }),
      store.createSuperseding({
        ownerId,
        content: "Concurrent replacement B",
        supersedesId: old.id,
        expectedSupersededVersion: 1,
        correlationId: "concurrent-b",
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM memories WHERE owner_id = ?",
    ).bind(ownerId).first<{ count: number }>()).toEqual({ count: 2 });
  });
});
