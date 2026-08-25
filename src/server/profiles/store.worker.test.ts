import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import type { Env } from "../env";
import { ContextProfileStore } from "./store";

const testEnv = env as unknown as Env;
const ownerId = "profile-owner";

beforeEach(async () => {
  const now = new Date().toISOString();
  await testEnv.DB.prepare(
    "INSERT OR IGNORE INTO users (id, github_login, created_at, updated_at) VALUES (?, ?, ?, ?)",
  ).bind(ownerId, ownerId, now, now).run();
  await testEnv.DB.prepare("DELETE FROM context_packs WHERE owner_id = ?").bind(ownerId).run();
  await testEnv.DB.prepare("DELETE FROM profile_facets WHERE owner_id = ?").bind(ownerId).run();
});

describe("context profiles", () => {
  it("version-checks facets and excludes sensitive or disabled facets from briefs", async () => {
    const store = new ContextProfileStore(testEnv.DB);
    const communication = await store.saveFacet({
      ownerId,
      facetType: "communication",
      content: "Use concise Australian English.",
      sensitivity: "normal",
      enabled: true,
    });
    await store.saveFacet({
      ownerId,
      facetType: "identity",
      content: "Sensitive identity detail.",
      sensitivity: "sensitive",
      enabled: true,
    });
    const updated = await store.saveFacet({
      ownerId,
      facetType: "communication",
      content: "Use concise professional Australian English.",
      sensitivity: "normal",
      enabled: true,
      expectedVersion: communication.version,
    });
    const pack = await store.createPack({
      ownerId,
      name: "Default working context",
      scopeType: "global",
      facetTypes: ["communication", "identity"],
      memoryIds: [],
      memoryLimit: 3,
      directiveLimit: 4,
    });
    const context = await store.buildContext(ownerId, pack.id);

    expect(updated.version).toBe(2);
    expect(context?.facets).toEqual([
      expect.objectContaining({ facetType: "communication", reason: "selected_by_context_pack" }),
    ]);
    expect(context?.omittedSensitiveFacetCount).toBe(1);
    await expect(store.saveFacet({
      ownerId,
      facetType: "communication",
      content: "Stale edit",
      sensitivity: "normal",
      enabled: true,
      expectedVersion: 1,
    })).rejects.toThrow("version");
  });

  it("keeps packs owner-scoped", async () => {
    const store = new ContextProfileStore(testEnv.DB);
    const pack = await store.createPack({
      ownerId,
      name: "Repository context",
      scopeType: "repository",
      scopeId: "community-owner/ai-cloud-memory",
      facetTypes: [],
      memoryIds: [],
      memoryLimit: 5,
      directiveLimit: 5,
    });

    expect(await store.buildContext("another-owner", pack.id)).toBeNull();
  });

  it("restores archived packs with optimistic version checks", async () => {
    const store = new ContextProfileStore(testEnv.DB);
    const pack = await store.createPack({
      ownerId,
      name: "Release context",
      scopeType: "global",
      facetTypes: ["constraints"],
      memoryIds: [],
      memoryLimit: 5,
      directiveLimit: 3,
    });
    const archived = await store.archivePack(ownerId, pack.id, pack.version);
    const restored = await store.restorePack(ownerId, pack.id, archived.version);

    expect(archived).toEqual(expect.objectContaining({ enabled: false, archivedAt: expect.any(String), version: 2 }));
    expect(restored).toEqual(expect.objectContaining({ enabled: true, archivedAt: null, version: 3 }));
    await expect(store.restorePack(ownerId, pack.id, archived.version)).rejects.toThrow("version");
  });
});
