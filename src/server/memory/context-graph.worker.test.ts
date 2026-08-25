import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import { ContextGraphStore } from "./context-graph";
import { MemoryStore } from "./store";

const ownerId = "graph-owner";

beforeAll(async () => {
  await env.DB.prepare("INSERT OR IGNORE INTO users (id, github_login, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .bind(ownerId, "graph-owner", "2026-08-24T00:00:00.000Z", "2026-08-24T00:00:00.000Z").run();
});

describe("ContextGraphStore", () => {
  it("expands related memories by one bounded owner-scoped hop", async () => {
    const memories = new MemoryStore(env.DB);
    const first = await memories.create({ ownerId, content: "Cloud Memory uses D1." });
    const second = await memories.create({ ownerId, content: "The Obsidian projection is read-only." });
    const graph = new ContextGraphStore(env.DB);
    const cloud = await graph.upsertEntity({ ownerId, canonicalName: "Cloud Memory", entityType: "system" });
    const obsidian = await graph.upsertEntity({ ownerId, canonicalName: "Obsidian", entityType: "system" });
    await graph.linkMemory({ ownerId, memoryId: first.id, entityId: cloud.id, relation: "subject" });
    await graph.linkMemory({ ownerId, memoryId: second.id, entityId: obsidian.id, relation: "subject" });
    await graph.relate({ ownerId, fromEntityId: cloud.id, toEntityId: obsidian.id, relationshipType: "projects_to", evidenceMemoryId: second.id });

    expect(await graph.relatedMemoryIds(ownerId, [first.id], 5)).toEqual([second.id]);
  });

  it("never crosses an owner boundary", async () => {
    const graph = new ContextGraphStore(env.DB);
    const entity = await graph.upsertEntity({ ownerId, canonicalName: "Private system", entityType: "system" });
    await expect(graph.linkMemory({ ownerId: "other-owner", memoryId: "missing", entityId: entity.id })).rejects.toThrow("not found");
  });

  it("returns bounded aliases with their owner-scoped entity", async () => {
    const graph = new ContextGraphStore(env.DB);
    const entity = await graph.upsertEntity({ ownerId, canonicalName: "Cloudflare D1", entityType: "system" });
    await graph.addAlias(ownerId, entity.id, "D1");

    const snapshot = await graph.list(ownerId);

    expect(snapshot.entities.find((item) => item.id === entity.id)?.aliases).toEqual(["D1"]);
  });
});
