import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("encrypted export download", () => {
  it("keeps the server filename and encrypted response opaque", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"version":1}', {
      headers: {
        "content-disposition": 'attachment; filename="cloud-memory.enc.json"',
        "content-type": "application/json",
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const download = await api.downloadEncryptedExport();

    expect(fetchMock).toHaveBeenCalledWith("/api/exports/download", { method: "POST" });
    expect(download.filename).toBe("cloud-memory.enc.json");
    await expect(download.blob.text()).resolves.toBe('{"version":1}');
  });
});

describe("task mutations", () => {
  const task = {
    id: "task_1",
    version: 4,
  } as Parameters<typeof api.updateTask>[0];

  it("sends version-checked edits and explicit archive confirmation", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...task, title: "Updated" }), {
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...task, archivedAt: "now" }), {
        headers: { "content-type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await api.updateTask(task, { title: "Updated", dueAt: null });
    await api.archiveTask(task);

    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/tasks/task_1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          title: "Updated",
          dueAt: null,
          expectedVersion: 4,
          actorType: "human",
          client: "Cloud Memory dashboard",
        }),
      }),
    ]);
    expect(fetchMock.mock.calls[1]).toEqual([
      "/api/tasks/task_1/archive",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          expectedVersion: 4,
          confirm: true,
          actorType: "human",
          client: "Cloud Memory dashboard",
        }),
      }),
    ]);
  });

  it("uses the existing versioned structure APIs for hierarchy and dependencies", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ taskId: "task_1", parentTaskId: "parent_1", isMilestone: true, dependencies: [], progress: { childCount: 0, completedChildCount: 0, percent: 0 }, version: 2, updatedAt: "now" }), { headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ taskId: "task_1", parentTaskId: "parent_1", isMilestone: true, dependencies: ["dependency_1"], progress: { childCount: 0, completedChildCount: 0, percent: 0 }, version: 3, updatedAt: "now" }), { headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ taskId: "task_1", parentTaskId: "parent_1", isMilestone: true, dependencies: [], progress: { childCount: 0, completedChildCount: 0, percent: 0 }, version: 4, updatedAt: "now" }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await api.updateTaskStructure("task_1", { expectedVersion: 1, parentTaskId: "parent_1", isMilestone: true });
    await api.addTaskDependency("task_1", "dependency_1", 2);
    await api.removeTaskDependency("task_1", "dependency_1", 3);

    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/tasks/task_1/structure",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ expectedVersion: 1, parentTaskId: "parent_1", isMilestone: true }) }),
    ]);
    expect(fetchMock.mock.calls[1]).toEqual([
      "/api/tasks/task_1/dependencies",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ expectedVersion: 2, dependsOnTaskId: "dependency_1" }) }),
    ]);
    expect(fetchMock.mock.calls[2]).toEqual([
      "/api/tasks/task_1/dependencies/dependency_1?expectedVersion=3",
      { method: "DELETE" },
    ]);
  });
});
