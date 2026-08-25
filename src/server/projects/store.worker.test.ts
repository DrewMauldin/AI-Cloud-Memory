import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { ProjectStore, VersionConflictError } from "./store";

const ownerId = "123456789";

describe("ProjectStore", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM project_events").run();
    await env.DB.prepare("DELETE FROM task_events").run();
    await env.DB.prepare("DELETE FROM tasks").run();
    await env.DB.prepare("DELETE FROM projects").run();
    await env.DB.prepare("DELETE FROM users").run();
    await env.DB.prepare(
      `INSERT INTO users (id, github_login, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
    )
      .bind(ownerId, "community-owner", "2026-08-23T00:00:00.000Z", "2026-08-23T00:00:00.000Z")
      .run();
  });

  it("creates a project and task with visible source provenance", async () => {
    const ids = ["project_1", "task_1", "event_1"];
    const store = new ProjectStore(env.DB, {
      now: () => "2026-08-23T02:00:00.000Z",
      newId: () => ids.shift()!,
    });
    const project = await store.createProject({ ownerId, name: "Cloud Memory" });
    const task = await store.createTask({
      ownerId,
      projectId: project.id,
      title: "Build the dashboard",
      sourceType: "model",
      client: "Codex",
      model: "GPT-5",
      sourceUrl: "https://chatgpt.com/c/example",
    });

    expect(task).toMatchObject({
      id: "task_1",
      projectId: "project_1",
      status: "inbox",
      sourceType: "model",
      sourceClient: "Codex",
      sourceModel: "GPT-5",
      sourceUrl: "https://chatgpt.com/c/example",
      version: 1,
    });
  });

  it("atomically moves a task and appends the exact status transition", async () => {
    const ids = ["project_1", "task_1", "event_1", "event_2"];
    const store = new ProjectStore(env.DB, {
      now: () => "2026-08-23T02:00:00.000Z",
      newId: () => ids.shift()!,
    });
    const project = await store.createProject({ ownerId, name: "Cloud Memory" });
    const task = await store.createTask({
      ownerId,
      projectId: project.id,
      title: "Build the dashboard",
    });

    const moved = await store.moveTask({
      ownerId,
      taskId: task.id,
      status: "in_progress",
      expectedVersion: 1,
      actorType: "model",
      client: "Codex",
      model: "GPT-5",
      sourceUrl: "https://chatgpt.com/c/example",
      correlationId: "run-start-1",
    });

    expect(moved).toMatchObject({ status: "in_progress", version: 2 });
    const event = await env.DB.prepare(
      `SELECT event_type, from_status, to_status, client, model, source_url,
         correlation_id
       FROM task_events WHERE id = 'event_2'`,
    ).first<Record<string, string>>();
    expect(event).toEqual({
      event_type: "moved",
      from_status: "inbox",
      to_status: "in_progress",
      client: "Codex",
      model: "GPT-5",
      source_url: "https://chatgpt.com/c/example",
      correlation_id: "run-start-1",
    });

    expect(await store.isTaskMutationReplay({
      ownerId,
      taskId: task.id,
      correlationId: "run-start-1",
      status: "in_progress",
      currentVersion: 2,
    })).toBe(true);
    expect(await store.isTaskMutationReplay({
      ownerId,
      taskId: task.id,
      correlationId: "run-start-1",
      status: "in_progress",
      currentVersion: 3,
    })).toBe(false);

    await expect(
      store.moveTask({
        ownerId,
        taskId: task.id,
        status: "review",
        expectedVersion: 1,
        actorType: "human",
      }),
    ).rejects.toBeInstanceOf(VersionConflictError);
  });

  it("updates and explicitly archives records with versioned provenance", async () => {
    const ids = ["project_1", "task_1", "event_create", "event_update", "event_archive"];
    const store = new ProjectStore(env.DB, {
      now: () => "2026-08-23T02:00:00.000Z",
      newId: () => ids.shift()!,
    });
    const project = await store.createProject({ ownerId, name: "Cloud Memory" });
    const task = await store.createTask({ ownerId, projectId: project.id, title: "Draft title" });

    const updatedProject = await store.updateProject({
      ownerId, projectId: project.id, expectedVersion: 1, status: "paused", description: "Waiting for OAuth",
    });
    const updatedTask = await store.updateTask({
      ownerId, taskId: task.id, expectedVersion: 1, title: "Final title",
      blockerSummary: "Waiting for OAuth", actorType: "human", client: "Cloud Memory dashboard",
    });
    const archivedTask = await store.archiveTask({
      ownerId, taskId: task.id, expectedVersion: 2, actorType: "human", note: "Confirmed in dashboard",
    });

    expect(updatedProject).toMatchObject({ status: "paused", description: "Waiting for OAuth", version: 2 });
    expect(updatedTask).toMatchObject({ title: "Final title", blockerSummary: "Waiting for OAuth", version: 2 });
    expect(archivedTask).toMatchObject({ archivedAt: "2026-08-23T02:00:00.000Z", version: 3 });
    expect((await store.listTasks(ownerId)).map((item) => item.id)).not.toContain(task.id);
    const events = await store.listTaskEvents(ownerId, task.id);
    expect(events.map((event) => event.eventType).sort()).toEqual(["archived", "created", "updated"]);

    const archivedProject = await store.archiveProject({ ownerId, projectId: project.id, expectedVersion: 2 });
    expect(archivedProject).toMatchObject({ status: "archived", version: 3 });
    expect(await store.listProjects(ownerId)).toEqual([]);
    expect(await store.listArchivedTasks(ownerId)).toEqual([archivedTask]);
  });

  it("restores archived projects while keeping their tasks off the active board", async () => {
    let now = "2026-08-24T05:00:00.000Z";
    const store = new ProjectStore(env.DB, {
      now: () => now,
      newId: () => crypto.randomUUID(),
    });
    const project = await store.createProject({ ownerId, name: "Archive example" });
    const task = await store.createTask({ ownerId, projectId: project.id, title: "Preserved task" });

    const archived = await store.archiveProject({ ownerId, projectId: project.id, expectedVersion: project.version });

    expect(archived).toMatchObject({ status: "archived", archivedAt: now });
    expect(await store.listProjects(ownerId, "archived")).toEqual([archived]);
    expect((await store.listTasks(ownerId)).map((item) => item.id)).not.toContain(task.id);
    expect(await store.listTasksByProject(ownerId, project.id, 100)).toEqual([task]);
    expect(await store.listArchivedTasks(ownerId)).toEqual([task]);

    now = "2026-08-24T06:00:00.000Z";
    const restored = await store.restoreProject({ ownerId, projectId: project.id, expectedVersion: archived.version });
    expect(restored).toMatchObject({ status: "active", archivedAt: null, version: archived.version + 1 });
    expect((await store.listTasks(ownerId)).map((item) => item.id)).toContain(task.id);
    await expect(store.restoreProject({
      ownerId: "other-owner",
      projectId: project.id,
      expectedVersion: restored.version,
    })).rejects.toBeInstanceOf(VersionConflictError);
  });

  it("returns only outstanding tasks from active or paused projects", async () => {
    let counter = 0;
    const store = new ProjectStore(env.DB, {
      now: () => "2026-08-24T01:00:00.000Z",
      newId: () => `open_${++counter}`,
    });
    const active = await store.createProject({ ownerId, name: "Active" });
    const open = await store.createTask({
      ownerId,
      projectId: active.id,
      title: "Outstanding",
      priority: "urgent",
    });
    const done = await store.createTask({
      ownerId,
      projectId: active.id,
      title: "Finished",
    });
    await store.moveTask({
      ownerId,
      taskId: done.id,
      status: "done",
      expectedVersion: done.version,
      actorType: "model",
      client: "Codex",
      model: "GPT-5",
    });
    const archived = await store.createTask({
      ownerId,
      projectId: active.id,
      title: "Incomplete but archived",
      priority: "high",
    });
    const archivedResult = await store.archiveTask({
      ownerId,
      taskId: archived.id,
      expectedVersion: archived.version,
      actorType: "human",
    });

    expect(await store.listOpenTasks(ownerId, active.id, 10)).toEqual([open]);
    expect(archivedResult).toMatchObject({ status: "inbox", archivedAt: expect.any(String) });
  });

  it("lists bounded active tasks for one project without loading unrelated projects", async () => {
    const store = new ProjectStore(env.DB);
    const firstProject = await store.createProject({ ownerId, name: "First" });
    const secondProject = await store.createProject({ ownerId, name: "Second" });
    const related = await store.createTask({ ownerId, projectId: firstProject.id, title: "Related" });
    await store.createTask({ ownerId, projectId: secondProject.id, title: "Unrelated" });
    const archived = await store.createTask({ ownerId, projectId: firstProject.id, title: "Archived" });
    await store.archiveTask({ ownerId, taskId: archived.id, expectedVersion: archived.version, actorType: "human" });

    expect(await store.listTasksByProject(ownerId, firstProject.id, 10)).toEqual([related]);
  });
});
