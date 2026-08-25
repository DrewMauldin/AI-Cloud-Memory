import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { ProjectStore } from "./store";
import { TaskStructureStore } from "./structure";

const ownerId = "structure-owner";

beforeEach(async () => {
  await env.DB.prepare("INSERT OR IGNORE INTO users (id, github_login, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .bind(ownerId, "structure-owner", "2026-08-24T00:00:00.000Z", "2026-08-24T00:00:00.000Z").run();
  await env.DB.prepare("DELETE FROM task_dependencies WHERE owner_id = ?").bind(ownerId).run();
  await env.DB.prepare("DELETE FROM task_structure WHERE owner_id = ?").bind(ownerId).run();
});

describe("TaskStructureStore", () => {
  it("persists parent, milestone and dependency state with version checks", async () => {
    const projects = new ProjectStore(env.DB);
    const project = await projects.createProject({ ownerId, name: `Structure ${crypto.randomUUID()}` });
    const parent = await projects.createTask({ ownerId, projectId: project.id, title: "Parent" });
    const child = await projects.createTask({ ownerId, projectId: project.id, title: "Child" });
    const blocker = await projects.createTask({ ownerId, projectId: project.id, title: "Blocker" });
    const structure = new TaskStructureStore(env.DB);

    const updated = await structure.update({ ownerId, taskId: child.id, expectedVersion: 1, parentTaskId: parent.id, isMilestone: true });
    expect(updated).toMatchObject({ parentTaskId: parent.id, isMilestone: true, version: 2 });
    const withDependency = await structure.addDependency({ ownerId, taskId: child.id, dependsOnTaskId: blocker.id, expectedVersion: 2 });
    expect(withDependency.dependencies).toEqual([blocker.id]);
    expect(withDependency.version).toBe(3);
    await expect(structure.update({ ownerId, taskId: child.id, expectedVersion: 2, isMilestone: false })).rejects.toThrow("version conflict");
  });

  it("rejects parent and dependency cycles", async () => {
    const projects = new ProjectStore(env.DB);
    const project = await projects.createProject({ ownerId, name: `Cycles ${crypto.randomUUID()}` });
    const first = await projects.createTask({ ownerId, projectId: project.id, title: "First" });
    const second = await projects.createTask({ ownerId, projectId: project.id, title: "Second" });
    const structure = new TaskStructureStore(env.DB);
    await structure.update({ ownerId, taskId: second.id, expectedVersion: 1, parentTaskId: first.id });
    await expect(structure.update({ ownerId, taskId: first.id, expectedVersion: 1, parentTaskId: second.id })).rejects.toThrow("cycle");
    await structure.addDependency({ ownerId, taskId: second.id, dependsOnTaskId: first.id, expectedVersion: 2 });
    await expect(structure.addDependency({ ownerId, taskId: first.id, dependsOnTaskId: second.id, expectedVersion: 1 })).rejects.toThrow("cycle");
  });

  it("rolls parent progress up from child status without mutating children", async () => {
    const projects = new ProjectStore(env.DB);
    const project = await projects.createProject({ ownerId, name: `Progress ${crypto.randomUUID()}` });
    const parent = await projects.createTask({ ownerId, projectId: project.id, title: "Parent" });
    const doneChild = await projects.createTask({ ownerId, projectId: project.id, title: "Done child" });
    const openChild = await projects.createTask({ ownerId, projectId: project.id, title: "Open child" });
    const structure = new TaskStructureStore(env.DB);

    await structure.update({ ownerId, taskId: doneChild.id, expectedVersion: 1, parentTaskId: parent.id });
    await structure.update({ ownerId, taskId: openChild.id, expectedVersion: 1, parentTaskId: parent.id });
    await projects.moveTask({
      ownerId,
      taskId: doneChild.id,
      status: "done",
      expectedVersion: 1,
      actorType: "human",
    });

    const rolledUp = await structure.get(ownerId, parent.id);
    expect(rolledUp.progress).toEqual({ childCount: 2, completedChildCount: 1, percent: 50 });
    await expect(projects.getTask(ownerId, doneChild.id)).resolves.toMatchObject({ status: "done" });
    await expect(projects.getTask(ownerId, openChild.id)).resolves.toMatchObject({ status: "inbox" });
  });
});
