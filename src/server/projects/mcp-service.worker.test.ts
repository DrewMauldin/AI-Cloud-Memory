import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { Env } from "../env";
import { ProjectMcpNotFoundError, ProjectMcpService } from "./mcp-service";
import { VersionConflictError } from "./store";
import { RoadmapStore } from "../roadmaps/store";

const testEnv = env as unknown as Env;

async function ensureUser(userId: string): Promise<void> {
  const now = new Date().toISOString();
  await testEnv.DB.prepare(
    `INSERT OR IGNORE INTO users (id, github_login, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
  ).bind(userId, userId, now, now).run();
}

describe("ProjectMcpService", () => {
  it("returns only the authenticated owner's bounded board", async () => {
    const ownerId = `mcp-board-${crypto.randomUUID()}`;
    const otherOwnerId = `mcp-board-other-${crypto.randomUUID()}`;
    await Promise.all([ensureUser(ownerId), ensureUser(otherOwnerId)]);
    const service = new ProjectMcpService(testEnv.DB, ownerId);
    const other = new ProjectMcpService(testEnv.DB, otherOwnerId);
    const project = await service.createProject({ name: "Owner board" });
    const task = await service.createTask({
      projectId: project.id,
      title: "Owner task",
      client: "Codex",
      model: "GPT-5.6",
    });
    const otherProject = await other.createProject({ name: "Other board" });
    const otherTask = await other.createTask({
      projectId: otherProject.id,
      title: "Other task",
      client: "Claude Code",
      model: "Claude",
    });
    const roadmap = await new RoadmapStore(testEnv.DB).create({
      ownerId,
      projectId: project.id,
      title: "Next project bet",
      horizon: "next",
      sourceType: "model",
      client: "Codex",
      model: "GPT-5.6",
    });

    const board = await service.board();

    expect(board.projects.map((item) => item.id)).toContain(project.id);
    expect(board.projects.map((item) => item.id)).not.toContain(otherProject.id);
    expect(board.tasks.map((item) => item.id)).toContain(task.id);
    expect(board.tasks.map((item) => item.id)).not.toContain(otherTask.id);
    expect(board.tasks.find((item) => item.id === task.id)?.attentionReasons).toEqual([]);
    expect(board.roadmapItems).toEqual([roadmap]);

    await service.archiveProject({ projectId: project.id, expectedVersion: project.version });
    expect((await service.board()).roadmapItems.map((item) => item.id)).not.toContain(roadmap.id);
  });

  it("records model provenance through task create, update, move and archive", async () => {
    const ownerId = `mcp-mutate-${crypto.randomUUID()}`;
    await ensureUser(ownerId);
    const service = new ProjectMcpService(testEnv.DB, ownerId);
    const project = await service.createProject({
      name: "MCP canary",
      sourceUrl: "https://chat.example/project",
    });
    const created = await service.createTask({
      projectId: project.id,
      title: "Verify direct MCP mutations",
      priority: "high",
      client: "Codex",
      model: "GPT-5.6",
      sourceUrl: "https://chat.example/task",
    });

    expect(created).toMatchObject({
      sourceType: "model",
      sourceClient: "Codex",
      sourceModel: "GPT-5.6",
      sourceUrl: "https://chat.example/task",
      version: 1,
    });

    const updated = await service.updateTask({
      taskId: created.id,
      expectedVersion: created.version,
      priority: "urgent",
      client: "Codex",
      model: "GPT-5.6",
      sourceUrl: "https://chat.example/task",
      note: "Raised after review",
    });
    const moved = await service.moveTask({
      taskId: updated.id,
      expectedVersion: updated.version,
      status: "review",
      client: "Codex",
      model: "GPT-5.6",
      sourceUrl: "https://chat.example/task",
      correlationId: `move-${crypto.randomUUID()}`,
      note: "Ready for human review",
    });
    const structureBefore = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS count FROM task_structure WHERE owner_id = ? AND task_id = ?",
    ).bind(ownerId, moved.id).first<{ count: number }>();
    const detail = await service.taskDetail(moved.id);
    const structureAfter = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS count FROM task_structure WHERE owner_id = ? AND task_id = ?",
    ).bind(ownerId, moved.id).first<{ count: number }>();

    expect(moved).toMatchObject({ status: "review", version: 3 });
    expect(detail.events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(["created", "updated", "moved"]),
    );
    expect(detail.events.filter((event) => event.eventType !== "created")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ client: "Codex", model: "GPT-5.6" }),
      ]),
    );
    expect(detail.structure).toBeNull();
    expect(structureAfter?.count).toBe(structureBefore?.count);

    await expect(service.updateTask({
      taskId: moved.id,
      expectedVersion: 1,
      title: "Stale write",
      client: "Codex",
      model: "GPT-5.6",
    })).rejects.toBeInstanceOf(VersionConflictError);

    const archived = await service.archiveTask({
      taskId: moved.id,
      expectedVersion: moved.version,
      client: "Codex",
      model: "GPT-5.6",
      sourceUrl: "https://chat.example/task",
      note: "Canary complete",
    });
    expect(archived.archivedAt).not.toBeNull();
    expect((await service.board()).tasks.map((task) => task.id)).not.toContain(archived.id);
    await expect(service.moveTask({
      taskId: archived.id,
      expectedVersion: archived.version,
      status: "planned",
      client: "Codex",
      model: "GPT-5.6",
    })).rejects.toBeInstanceOf(VersionConflictError);
  });

  it("fails closed for cross-owner task reads and project writes", async () => {
    const ownerId = `mcp-owner-${crypto.randomUUID()}`;
    const otherOwnerId = `mcp-owner-other-${crypto.randomUUID()}`;
    await Promise.all([ensureUser(ownerId), ensureUser(otherOwnerId)]);
    const owner = new ProjectMcpService(testEnv.DB, ownerId);
    const other = new ProjectMcpService(testEnv.DB, otherOwnerId);
    const project = await other.createProject({ name: "Other project" });
    const task = await other.createTask({
      projectId: project.id,
      title: "Other task",
      client: "OpenCode",
      model: "Claude",
    });

    await expect(owner.taskDetail(task.id)).rejects.toBeInstanceOf(ProjectMcpNotFoundError);
    await expect(owner.updateProject({
      projectId: project.id,
      expectedVersion: project.version,
      status: "paused",
    })).rejects.toBeInstanceOf(VersionConflictError);

    const archivedProject = await owner.createProject({ name: "Archived project" });
    await owner.archiveProject({
      projectId: archivedProject.id,
      expectedVersion: archivedProject.version,
    });
    await expect(owner.createTask({
      projectId: archivedProject.id,
      title: "Must not be created",
      client: "Codex",
      model: "GPT-5.6",
    })).rejects.toBeInstanceOf(ProjectMcpNotFoundError);
  });
});
