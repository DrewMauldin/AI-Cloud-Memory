import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import {
  MAX_RECEIPT_CHARS,
  AgentRunStore,
  AgentRunNotFoundError,
  AgentRunTransitionError,
} from "./runs";

const ownerA = "agent_run_owner_a";
const ownerB = "agent_run_owner_b";
const projectId = "agent_run_project";
const taskId = "agent_run_task";
const conversationId = "agent_run_conversation";
const memoryId = "agent_run_memory";

async function seedOwner(id: string, login: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO users (id, github_login, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
  ).bind(id, login, "2026-08-24T00:00:00.000Z", "2026-08-24T00:00:00.000Z").run();
}

async function seedRecords(): Promise<void> {
  await seedOwner(ownerA, "agent-run-a");
  await seedOwner(ownerB, "agent-run-b");
  await env.DB.prepare(
    `INSERT OR IGNORE INTO projects (id, owner_id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(projectId, ownerA, "Agent Runs", "2026-08-24T00:00:00.000Z", "2026-08-24T00:00:00.000Z").run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tasks (id, owner_id, project_id, title, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(taskId, ownerA, projectId, "Record the run", "2026-08-24T00:00:00.000Z", "2026-08-24T00:00:00.000Z").run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO conversations (id, owner_id, title, client, external_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(conversationId, ownerA, "Agent conversation", "Codex", "agent-run-conversation", "2026-08-24T00:00:00.000Z", "2026-08-24T00:00:00.000Z").run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO memories (id, owner_id, namespace, kind, content, content_sha256, created_at, updated_at)
     VALUES (?, ?, 'default', 'memory', ?, ?, ?, ?)`,
  ).bind(memoryId, ownerA, "A bounded run receipt was recorded.", "agent-run-memory-hash", "2026-08-24T00:00:00.000Z", "2026-08-24T00:00:00.000Z").run();
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM agent_run_memories").run();
  await env.DB.prepare("DELETE FROM agent_run_events").run();
  await env.DB.prepare("DELETE FROM agent_runs").run();
  await seedRecords();
});

describe("AgentRunStore", () => {
  it("creates an owner-scoped run with task and conversation linkage", async () => {
    const ids = ["run_1", "event_1"];
    const store = new AgentRunStore(env.DB, {
      now: () => "2026-08-24T01:00:00.000Z",
      newId: () => ids.shift()!,
    });

    const result = await store.startRun({
      ownerId: ownerA,
      correlationId: "corr_1",
      taskId,
      conversationId,
      actorType: "model",
      client: "Codex",
      model: "GPT-5",
      sourceUrl: "https://chatgpt.com/c/agent-run",
    });

    expect(result).toMatchObject({
      idempotent: false,
      run: {
        id: "run_1",
        ownerId: ownerA,
        taskId,
        conversationId,
        correlationId: "corr_1",
        status: "running",
      },
    });
    expect(await store.listRunEvents(ownerA, "run_1")).toHaveLength(1);
  });

  it("does not expose a run or its memories across owners", async () => {
    const store = new AgentRunStore(env.DB, { newId: () => "run_owner" });
    const { run } = await store.startRun({
      ownerId: ownerA,
      correlationId: "corr_owner",
      actorType: "model",
      client: "Codex",
      model: "GPT-5",
    });

    expect(await store.getRun(ownerB, run.id)).toBeNull();
    await expect(store.listRunEvents(ownerB, run.id)).resolves.toEqual([]);
    await expect(store.linkMemory({
      ownerId: ownerB,
      runId: run.id,
      memoryId,
      relation: "read",
    })).rejects.toBeInstanceOf(AgentRunNotFoundError);
  });

  it("makes a repeated start with the same owner and correlation id idempotent", async () => {
    const store = new AgentRunStore(env.DB, { newId: () => "run_retry" });
    const input = {
      ownerId: ownerA,
      correlationId: "corr_retry",
      taskId,
      actorType: "model" as const,
      client: "Codex",
      model: "GPT-5",
    };

    const first = await store.startRun(input);
    const second = await store.startRun(input);

    expect(first.idempotent).toBe(false);
    expect(second).toEqual({ run: first.run, idempotent: true });
    expect(await store.listRunEvents(ownerA, first.run.id)).toHaveLength(1);
  });

  it("rejects a finish or heartbeat after a terminal transition", async () => {
    const ids = ["run_transition", "event_transition_start", "event_transition_finish"];
    const store = new AgentRunStore(env.DB, {
      now: () => "2026-08-24T02:00:00.000Z",
      newId: () => ids.shift()!,
    });
    const { run } = await store.startRun({
      ownerId: ownerA,
      correlationId: "corr_transition",
      actorType: "model",
      client: "Codex",
      model: "GPT-5",
    });

    await store.finishRun({ ownerId: ownerA, runId: run.id, status: "succeeded", receipt: "Done" });
    await expect(store.heartbeat({ ownerId: ownerA, runId: run.id })).rejects.toBeInstanceOf(AgentRunTransitionError);
    await expect(store.finishRun({ ownerId: ownerA, runId: run.id, status: "failed" })).rejects.toBeInstanceOf(AgentRunTransitionError);
  });

  it("makes an identical heartbeat retry idempotent and bounds completion receipts", async () => {
    let tick = 0;
    const ids = ["run_receipt", "event_receipt_start", "event_receipt_heartbeat", "event_receipt_finish"];
    const store = new AgentRunStore(env.DB, {
      now: () => `2026-08-24T0${tick}:00:00.000Z`,
      newId: () => ids.shift()!,
    });
    const { run } = await store.startRun({
      ownerId: ownerA,
      correlationId: "corr_receipt",
      actorType: "model",
      client: "Codex",
      model: "GPT-5",
    });

    tick = 3;
    const heartbeat = await store.heartbeat({ ownerId: ownerA, runId: run.id });
    const retry = await store.heartbeat({ ownerId: ownerA, runId: run.id });
    const finished = await store.finishRun({
      ownerId: ownerA,
      runId: run.id,
      status: "succeeded",
      receipt: "x".repeat(MAX_RECEIPT_CHARS + 100),
    });

    expect(heartbeat.idempotent).toBe(false);
    expect(retry).toEqual({ run: heartbeat.run, idempotent: true });
    expect(finished.run.receipt).toHaveLength(MAX_RECEIPT_CHARS);
    expect(await store.listRunEvents(ownerA, run.id)).toHaveLength(3);
  });

  it("links memories and bounds task and recent listings", async () => {
    let sequence = 0;
    const store = new AgentRunStore(env.DB, {
      now: () => `2026-08-24T0${sequence}:00:00.000Z`,
      newId: () => `run_list_${sequence++}`,
    });
    const first = await store.startRun({ ownerId: ownerA, correlationId: "corr_list_1", taskId, actorType: "model", client: "Codex", model: "GPT-5" });
    await store.startRun({ ownerId: ownerA, correlationId: "corr_list_2", taskId, actorType: "model", client: "Codex", model: "GPT-5" });
    await store.startRun({ ownerId: ownerA, correlationId: "corr_list_3", taskId, actorType: "model", client: "Codex", model: "GPT-5" });
    await store.linkMemory({ ownerId: ownerA, runId: first.run.id, memoryId, relation: "read" });

    expect(await store.listRunsByTask(ownerA, taskId, 2)).toHaveLength(2);
    expect(await store.listRecent(ownerA, 2)).toHaveLength(2);
    await expect(store.listRunMemories(ownerA, first.run.id)).resolves.toEqual([
      { memoryId, relation: "read", createdAt: "2026-08-24T06:00:00.000Z" },
    ]);
  });

  it("finds relevant runs per requested task beyond the global recent cap", async () => {
    let tick = 0;
    let id = 0;
    const store = new AgentRunStore(env.DB, {
      now: () => new Date(Date.UTC(2026, 7, 24, tick++)).toISOString(),
      newId: () => `run_attention_${id++}`,
    });
    const target = await store.startRun({ ownerId: ownerA, correlationId: "corr_attention_target", taskId, actorType: "model" });
    await store.finishRun({ ownerId: ownerA, runId: target.run.id, status: "failed" });
    for (let index = 0; index < 101; index += 1) {
      await store.startRun({ ownerId: ownerA, correlationId: `corr_attention_${index}`, taskId, actorType: "model" });
    }

    expect((await store.listRecent(ownerA, 100)).some((run) => run.id === target.run.id)).toBe(false);
    const relevant = await store.listLatestRelevantByTask(ownerA, [taskId], 20);
    expect(relevant.get(taskId)?.map((run) => run.id)).toContain(target.run.id);
    expect(relevant.get(taskId)).toHaveLength(1);
  });

  it("returns bounded owner-scoped memory bundles for multiple runs", async () => {
    const store = new AgentRunStore(env.DB, { newId: () => `run_bundle_${crypto.randomUUID()}` });
    const first = await store.startRun({ ownerId: ownerA, correlationId: "corr_bundle_1", taskId, actorType: "model" });
    const second = await store.startRun({ ownerId: ownerA, correlationId: "corr_bundle_2", taskId, actorType: "model" });
    await store.linkMemory({ ownerId: ownerA, runId: first.run.id, memoryId, relation: "read" });
    const bundles = await store.listRunMemoryBundles(ownerA, [first.run.id, second.run.id], 1);

    expect(bundles.get(first.run.id)).toMatchObject({ linkedMemoryCount: 1, memories: [{ memoryId }] });
    expect(bundles.has(second.run.id)).toBe(false);
    await expect(store.listRunMemoryBundles(ownerB, [first.run.id])).resolves.toEqual(new Map());
  });
});
