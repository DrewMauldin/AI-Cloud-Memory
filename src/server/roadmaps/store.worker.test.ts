import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import {
  RoadmapCorrelationConflictError,
  RoadmapNotFoundError,
  RoadmapStore,
  RoadmapVersionConflictError,
} from "./store";

const ownerId = "123456789";

describe("RoadmapStore", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM roadmap_promotions").run();
    await env.DB.prepare("DELETE FROM roadmap_events").run();
    await env.DB.prepare("DELETE FROM roadmap_items").run();
    await env.DB.prepare("DELETE FROM task_events").run();
    await env.DB.prepare("DELETE FROM tasks").run();
    await env.DB.prepare("DELETE FROM projects").run();
    await env.DB.prepare("DELETE FROM users").run();
    await env.DB.prepare(
      `INSERT INTO users (id, github_login, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
    ).bind(ownerId, "community-owner", "2026-08-24T00:00:00.000Z", "2026-08-24T00:00:00.000Z").run();
  });

  it("keeps bounded AI ideas separate from tasks with exact provenance", async () => {
    const ids = ["roadmap_1", "event_1", "roadmap_2", "event_2"];
    const store = new RoadmapStore(env.DB, {
      now: () => "2026-08-24T14:00:00.000Z",
      newId: () => ids.shift()!,
    });
    const projectId = await createProject("project_1");

    const later = await store.create({
      ownerId,
      projectId,
      title: "Add collaborative project sharing",
      description: "Explore a future owner-approved sharing model.",
      horizon: "later",
      impact: "high",
      effort: "large",
      sourceType: "model",
      client: "Codex",
      model: "GPT-5",
      sourceUrl: "https://chatgpt.com/c/roadmap",
      correlationId: "idea-later",
    });
    const next = await store.create({
      ownerId,
      projectId,
      title: "Add roadmap suggestions",
      horizon: "next",
      impact: "high",
      effort: "small",
      sourceType: "model",
      client: "Claude Web",
      model: "Claude",
      correlationId: "idea-next",
    });

    expect(later).toMatchObject({ status: "suggested", horizon: "later", sourceModel: "GPT-5" });
    expect(next).toMatchObject({ status: "suggested", horizon: "next", sourceClient: "Claude Web" });
    const result = await store.list(ownerId, { scope: "active", limit: 1 });
    expect(result.items).toEqual([next]);
    expect(result.total).toBe(2);
    await expect(store.create({
      ownerId,
      projectId,
      title: later.title,
      horizon: "someday",
      impact: "high",
      effort: "large",
      sourceType: "model",
      client: "Codex",
      model: "GPT-5",
      sourceUrl: "https://chatgpt.com/c/roadmap",
      correlationId: "idea-later",
    })).rejects.toBeInstanceOf(RoadmapCorrelationConflictError);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM tasks").first<{ count: number }>()).toEqual({ count: 0 });
  });

  it("version-checks review, archive and restore lifecycle changes", async () => {
    const store = new RoadmapStore(env.DB, {
      now: () => "2026-08-24T14:00:00.000Z",
      newId: () => crypto.randomUUID(),
    });
    const projectId = await createProject("project_1");
    const created = await store.create({ ownerId, projectId, title: "Future search tuning", sourceType: "human" });
    const planned = await store.update({
      ownerId,
      roadmapId: created.id,
      expectedVersion: created.version,
      status: "planned",
      horizon: "next",
      impact: "high",
      effort: "medium",
      actorType: "human",
      client: "Cloud Memory dashboard",
    });
    expect(planned).toMatchObject({ status: "planned", horizon: "next", version: 2 });
    await expect(store.update({
      ownerId,
      roadmapId: created.id,
      expectedVersion: 1,
      title: "Stale change",
      actorType: "human",
    })).rejects.toBeInstanceOf(RoadmapVersionConflictError);

    const archived = await store.archive({
      ownerId,
      roadmapId: created.id,
      expectedVersion: planned.version,
      actorType: "human",
    });
    expect(archived).toMatchObject({ status: "archived", archivedAt: "2026-08-24T14:00:00.000Z" });
    expect((await store.list(ownerId, { scope: "active" })).items).toEqual([]);
    const restored = await store.restore({
      ownerId,
      roadmapId: created.id,
      expectedVersion: archived.version,
      actorType: "human",
    });
    expect(restored).toMatchObject({ status: "suggested", archivedAt: null, version: 4 });
  });

  it("promotes one idea into exactly one linked Inbox task across retries", async () => {
    const ids = ["roadmap_1", "roadmap_event", "promotion_1", "task_1", "task_event", "promote_event"];
    const store = new RoadmapStore(env.DB, {
      now: () => "2026-08-24T14:00:00.000Z",
      newId: () => ids.shift()!,
    });
    const projectId = await createProject("project_1");
    const idea = await store.create({
      ownerId,
      projectId,
      title: "Add release confidence trends",
      description: "Show whether deployment evidence is improving over time.",
      sourceType: "model",
      client: "Codex",
      model: "GPT-5",
      sourceUrl: "https://chatgpt.com/c/roadmap",
    });

    const promoted = await store.promote({
      ownerId,
      roadmapId: idea.id,
      expectedVersion: idea.version,
      correlationId: "promote-release-trends",
      client: "Codex",
      model: "GPT-5",
      sourceUrl: "https://chatgpt.com/c/roadmap",
    });
    expect(promoted).toMatchObject({
      replayed: false,
      roadmap: { status: "promoted", promotedTaskId: "task_1", version: 2 },
      task: { id: "task_1", status: "inbox", position: 1000, dueAt: null, archivedAt: null, sourceModel: "GPT-5" },
    });

    const replay = await store.promote({
      ownerId,
      roadmapId: idea.id,
      expectedVersion: idea.version,
      correlationId: "promote-release-trends",
      client: "Codex",
      model: "GPT-5",
    });
    expect(replay).toMatchObject({ replayed: true, task: { id: "task_1" } });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM tasks").first<{ count: number }>()).toEqual({ count: 1 });
    expect((await store.events(ownerId, idea.id)).map((event) => event.eventType).sort()).toEqual(["created", "promoted"]);
  });

  it("fails closed for cross-owner reads and correlation reuse", async () => {
    const store = new RoadmapStore(env.DB);
    const projectId = await createProject("project_1");
    const first = await store.create({
      ownerId,
      projectId,
      title: "First idea",
      sourceType: "model",
      client: "Codex",
      model: "GPT-5",
      correlationId: "shared-correlation",
    });
    await expect(store.get("other-owner", first.id)).resolves.toBeNull();
    await expect(store.create({
      ownerId,
      projectId,
      title: "Different idea",
      sourceType: "model",
      client: "Codex",
      model: "GPT-5",
      correlationId: "shared-correlation",
    })).rejects.toBeInstanceOf(RoadmapCorrelationConflictError);
    await expect(store.promote({
      ownerId: "other-owner",
      roadmapId: first.id,
      expectedVersion: first.version,
      correlationId: "cross-owner",
      client: "Codex",
      model: "GPT-5",
    })).rejects.toBeInstanceOf(RoadmapNotFoundError);
  });
});

async function createProject(id: string): Promise<string> {
  const timestamp = "2026-08-24T14:00:00.000Z";
  await env.DB.prepare(
    `INSERT INTO projects (id, owner_id, name, colour, status, created_at, updated_at)
     VALUES (?, ?, ?, '#c9ff3b', 'active', ?, ?)`,
  ).bind(id, ownerId, "Cloud Memory", timestamp, timestamp).run();
  return id;
}
