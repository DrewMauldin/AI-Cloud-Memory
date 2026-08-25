// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../api";
import type { Project, Task, TaskEvent } from "../types";
import { TaskDrawer, type TaskDrawerAgentRun } from "./TaskDrawer";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const project: Project = {
  id: "project_1",
  ownerId: "123456789",
  name: "Cloud Memory",
  description: null,
  colour: "#c9ff3b",
  status: "active",
  sourceUrl: null,
  createdAt: "2026-08-23T00:00:00.000Z",
  updatedAt: "2026-08-23T00:00:00.000Z",
  version: 1,
};

const task: Task = {
  id: "task_1",
  ownerId: "123456789",
  projectId: project.id,
  title: "Verify Cloud Memory",
  description: null,
  status: "in_progress",
  priority: "high",
  position: 1000,
  dueAt: null,
  blockerSummary: null,
  sourceType: "model",
  sourceClient: "Codex",
  sourceModel: "GPT-5",
  sourceUrl: null,
  archivedAt: null,
  createdAt: "2026-08-23T00:00:00.000Z",
  updatedAt: "2026-08-23T00:00:00.000Z",
  version: 2,
};

const event: TaskEvent = {
  id: "event_1",
  taskId: task.id,
  eventType: "moved",
  actorType: "model",
  client: "Codex",
  model: "GPT-5",
  sourceUrl: "https://chatgpt.com/c/cloud-memory",
  fromStatus: "planned",
  toStatus: "in_progress",
  note: "Started from the task brief.",
  createdAt: "2026-08-24T00:00:00.000Z",
};

describe("TaskDrawer", () => {
  it("renders the ordered agent run ledger with bounded receipts and memory counts", async () => {
    vi.spyOn(api, "task").mockResolvedValue({ task, events: [] });
    const longReceipt = `${"receipt ".repeat(400)}end`;
    const runs: TaskDrawerAgentRun[] = [
      {
        id: "run_old",
        taskId: task.id,
        conversationId: null,
        correlationId: "corr_old",
        actorType: "model",
        client: "Claude Code",
        model: "Sonnet",
        sourceUrl: null,
        status: "succeeded",
        receipt: "Older result",
        startedAt: "2026-08-23T12:00:00.000Z",
        finishedAt: "2026-08-23T12:03:00.000Z",
        linkedMemoryCount: 1,
      },
      {
        id: "run_new",
        taskId: task.id,
        conversationId: "conversation_1",
        correlationId: "corr_new",
        actorType: "model",
        client: "Codex",
        model: "GPT-5",
        sourceUrl: "https://chatgpt.com/c/run-new",
        status: "awaiting_human",
        receipt: longReceipt,
        startedAt: "2026-08-24T12:00:00.000Z",
        finishedAt: null,
        linkedMemoryCount: 3,
      },
    ];

    render(<TaskDrawer task={task} project={project} agentRuns={runs} onClose={vi.fn()} />);

    const ledger = await screen.findByRole("list", { name: "Agent runs" });
    expect(ledger.textContent?.indexOf("GPT-5")).toBeLessThan(ledger.textContent?.indexOf("Sonnet") ?? -1);
    expect(within(ledger).getByText("Awaiting Human")).toBeTruthy();
    expect(within(ledger).getByText("Codex · GPT-5")).toBeTruthy();
    expect(within(ledger).getByText("3 linked memories")).toBeTruthy();
    expect(within(ledger).getByRole("link", { name: "Open agent source for run_new" }).getAttribute("href")).toBe(runs[1].sourceUrl);
    expect(within(ledger).getByText(/^receipt receipt/).textContent?.length).toBeLessThanOrEqual(2_001);
    expect(screen.queryByText(/transcript/i)).toBeNull();
  });

  it("summarises parent, milestone, dependencies and linked memories", async () => {
    vi.spyOn(api, "task").mockResolvedValue({ task, events: [] });

    render(<TaskDrawer
      task={task}
      project={project}
      structure={{
        parentTask: { id: "parent_1", title: "Ship Cloud Memory", status: "in_progress" },
        milestone: "Private beta",
        dependencies: [{ id: "dependency_1", title: "Verify D1 backup", status: "done" }],
        linkedMemoryCount: 4,
      }}
      onClose={vi.fn()}
    />);

    expect(await screen.findByText("Ship Cloud Memory")).toBeTruthy();
    expect(screen.getByText("Private beta")).toBeTruthy();
    expect(screen.getByText("Verify D1 backup")).toBeTruthy();
    expect(screen.getByText("4 linked memories")).toBeTruthy();
  });

  it("edits hierarchy fields and dependency links through versioned structure APIs", async () => {
    const structure = {
      taskId: task.id,
      parentTaskId: null,
      isMilestone: false,
      dependencies: [],
      progress: { childCount: 0, completedChildCount: 0, percent: 0 },
      version: 2,
      updatedAt: "2026-08-24T00:00:00.000Z",
      parentTask: null,
      dependencyTasks: [],
      relatedTasks: [
        { id: "parent_1", title: "Ship Cloud Memory", status: "in_progress" as const },
        { id: "dependency_1", title: "Verify D1 backup", status: "done" as const },
      ],
    };
    vi.spyOn(api, "task").mockResolvedValue({ task, events: [], structure });
    vi.spyOn(api, "updateTaskStructure").mockResolvedValue({
      ...structure,
      parentTaskId: "parent_1",
      isMilestone: true,
      version: 3,
      parentTask: structure.relatedTasks[0],
    });
    vi.spyOn(api, "addTaskDependency").mockResolvedValue({
      ...structure,
      parentTaskId: "parent_1",
      isMilestone: true,
      dependencies: ["dependency_1"],
      dependencyTasks: [structure.relatedTasks[1]],
      version: 4,
      parentTask: structure.relatedTasks[0],
    });

    render(<TaskDrawer task={task} project={project} onClose={vi.fn()} />);

    await screen.findByText("Work structure");
    await userEvent.selectOptions(screen.getByLabelText("Parent task"), "parent_1");
    await userEvent.click(screen.getByLabelText("Milestone"));
    await userEvent.click(screen.getByRole("button", { name: "Save structure" }));

    expect(api.updateTaskStructure).toHaveBeenCalledWith(task.id, {
      expectedVersion: 2,
      parentTaskId: "parent_1",
      isMilestone: true,
    });

    await userEvent.selectOptions(screen.getByLabelText("Add dependency"), "dependency_1");
    await userEvent.click(screen.getByRole("button", { name: "Add dependency" }));
    expect(api.addTaskDependency).toHaveBeenCalledWith(task.id, "dependency_1", 3);
  });

  it("links each activity event back to its source chat", async () => {
    vi.spyOn(api, "task").mockResolvedValue({ task, events: [event] });

    render(<TaskDrawer task={task} project={project} onClose={vi.fn()} />);

    const link = await screen.findByRole("link", { name: "Open chat for moved" });
    expect(link.getAttribute("href")).toBe(event.sourceUrl);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer");
  });

  it("does not show a chat link for events without a source URL", async () => {
    vi.spyOn(api, "task").mockResolvedValue({
      task,
      events: [{ ...event, sourceUrl: null }],
    });

    render(<TaskDrawer task={task} project={project} onClose={vi.fn()} />);

    await screen.findByText("moved");
    expect(screen.queryByRole("link", { name: "Open chat for moved" })).toBeNull();
  });

  it("edits task details and clears a due date through the canonical API", async () => {
    const dueTask = { ...task, dueAt: "2026-08-30T10:00:00.000Z" };
    const updated = { ...dueTask, title: "Verify the live rollout", dueAt: null, version: 3 };
    vi.spyOn(api, "task").mockResolvedValue({ task: dueTask, events: [] });
    vi.spyOn(api, "updateTask").mockResolvedValue(updated);
    const onUpdated = vi.fn();
    render(<TaskDrawer task={dueTask} project={project} onClose={vi.fn()} onUpdated={onUpdated} />);

    await userEvent.click(screen.getByRole("button", { name: "Edit task" }));
    const title = screen.getByLabelText("Title");
    await userEvent.clear(title);
    await userEvent.type(title, "Verify the live rollout");
    await userEvent.clear(screen.getByLabelText("Due date"));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(api.updateTask).toHaveBeenCalledWith(dueTask, expect.objectContaining({
      title: "Verify the live rollout",
      dueAt: null,
    }));
    expect(onUpdated).toHaveBeenCalledWith(updated);
  });
});
