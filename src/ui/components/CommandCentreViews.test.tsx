// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { partitionDoneTasks } from "../doneTaskRetention";
import type { Project, Task } from "../types";
import { CommandCentreViews, type AgentRun } from "./CommandCentreViews";

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

const project: Project = {
  id: "project_1",
  ownerId: "owner_1",
  name: "Cloud Memory",
  description: null,
  colour: "#c9ff3b",
  status: "active",
  sourceUrl: null,
  createdAt: "2026-08-23T00:00:00.000Z",
  updatedAt: "2026-08-23T00:00:00.000Z",
  version: 1,
};

const otherProject: Project = { ...project, id: "project_2", name: "Home", colour: "#f2a93b" };

const task: Task = {
  id: "task_1",
  ownerId: "owner_1",
  projectId: "project_1",
  title: "Review the command centre",
  description: "Keep the task views easy to scan.",
  status: "review",
  priority: "high",
  position: 1000,
  dueAt: "2026-08-24T12:00:00.000Z",
  blockerSummary: null,
  sourceType: "model",
  sourceClient: "Codex",
  sourceModel: "GPT-5",
  sourceUrl: "https://example.com/chat",
  archivedAt: null,
  createdAt: "2026-08-23T00:00:00.000Z",
  updatedAt: "2026-08-24T00:00:00.000Z",
  version: 1,
  attentionReasons: ["review"],
};

const clearTask: Task = {
  ...task,
  id: "task_2",
  title: "Ship the board",
  projectId: "project_2",
  status: "in_progress",
  priority: "medium",
  sourceType: "human",
  sourceClient: null,
  sourceModel: null,
  sourceUrl: null,
  attentionReasons: [],
};

const run: AgentRun = {
  id: "run_1",
  taskId: "task_1",
  conversationId: "conversation_1",
  correlationId: "corr_1",
  actorType: "model",
  client: "Codex",
  model: "GPT-5",
  sourceUrl: "https://example.com/chat",
  status: "awaiting_human",
  receipt: "Needs a human review",
  startedAt: "2026-08-24T10:00:00.000Z",
  heartbeatAt: "2026-08-24T10:05:00.000Z",
  finishedAt: null,
};

describe("CommandCentreViews", () => {
  it("offers the six built-in views and scopes Needs Me to attention tasks", () => {
    render(<CommandCentreViews projects={[project, otherProject]} tasks={[task, clearTask]} />);

    expect(screen.getByRole("tab", { name: "Needs Me" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Board" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Done" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Table" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Timeline" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Agent Activity" })).toBeTruthy();
    expect(screen.getByText(task.title)).toBeTruthy();
    expect(screen.queryByText(clearTask.title)).toBeNull();
    expect(screen.getByText("Review", { selector: "span" })).toBeTruthy();
  });

  it("keeps invalid completion timestamps out of the active board", () => {
    const invalid = { ...task, id: "done-invalid", status: "done" as const, updatedAt: "not-a-date" };
    const valid = { ...task, id: "done-valid", status: "done" as const, updatedAt: "2026-08-24T12:00:00.000Z" };

    expect(partitionDoneTasks([invalid, valid], 3, Date.parse("2026-08-25T12:00:00.000Z"))).toEqual({
      recent: [valid],
      history: [invalid],
    });
  });

  it("moves every completed task to history when retention is immediate", () => {
    const completed = { ...task, id: "done-now", status: "done" as const, updatedAt: "2026-08-25T12:00:00.000Z" };

    expect(partitionDoneTasks([completed], 0, Date.parse("2026-08-25T12:00:00.000Z"))).toEqual({
      recent: [],
      history: [completed],
    });
  });

  it("applies project, priority, model, client, attention and source filters", async () => {
    const user = userEvent.setup();
    render(<CommandCentreViews projects={[project, otherProject]} tasks={[task, clearTask]} />);

    await user.selectOptions(screen.getByLabelText("Project"), "project_1");
    await user.selectOptions(screen.getByLabelText("Status"), "review");
    await user.selectOptions(screen.getByLabelText("Priority"), "high");
    await user.selectOptions(screen.getByLabelText("Model"), "GPT-5");
    await user.selectOptions(screen.getByLabelText("Client"), "Codex");
    await user.selectOptions(screen.getByLabelText("Attention"), "needs_me");
    await user.selectOptions(screen.getByLabelText("Source"), "available");

    expect(screen.getByText(task.title)).toBeTruthy();
    expect(screen.queryByText(clearTask.title)).toBeNull();
  });

  it("supports accessible task opening and status movement from the board", async () => {
    const user = userEvent.setup();
    const onOpenTask = vi.fn();
    const onMoveTask = vi.fn();
    render(<CommandCentreViews projects={[project]} tasks={[task]} onOpenTask={onOpenTask} onMoveTask={onMoveTask} initialView="board" />);

    await user.click(screen.getByRole("button", { name: new RegExp(`^${task.title}\\s*${project.name}$`) }));
    await user.selectOptions(screen.getByLabelText(`Move ${task.title}`), "done");

    expect(onOpenTask).toHaveBeenCalledWith(task);
    expect(onMoveTask).toHaveBeenCalledWith(task, "done");
  });

  it("keeps recent completions on the board and moves older ones into Done history", async () => {
    const user = userEvent.setup();
    const onMoveTask = vi.fn();
    const recentDone = {
      ...task,
      id: "task_recent_done",
      title: "Recent completion",
      status: "done" as const,
      updatedAt: "2026-08-24T12:00:00.000Z",
      attentionReasons: [],
    };
    const historicalDone = {
      ...recentDone,
      id: "task_historical_done",
      title: "Historical completion",
      updatedAt: "2026-08-20T12:00:00.000Z",
    };
    render(<CommandCentreViews
      projects={[project]}
      tasks={[recentDone, historicalDone]}
      onMoveTask={onMoveTask}
      initialView="board"
      doneBoardRetentionDays={3}
      referenceTime={Date.parse("2026-08-25T12:00:00.000Z")}
    />);

    expect(screen.getByText("Recent completion")).toBeTruthy();
    expect(screen.queryByText("Historical completion")).toBeNull();

    await user.click(screen.getByRole("tab", { name: "Done" }));
    expect(screen.getByRole("heading", { name: "Recent completions" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Done history" })).toBeTruthy();
    expect(screen.getByText("Recent completion")).toBeTruthy();
    expect(screen.getByText("Historical completion")).toBeTruthy();

    await user.selectOptions(screen.getByLabelText("Move Historical completion"), "in_progress");
    expect(onMoveTask).toHaveBeenCalledWith(historicalDone, "in_progress");
  });

  it("renders timeline and bounded agent activity without transcript content", async () => {
    const user = userEvent.setup();
    render(<CommandCentreViews projects={[project]} tasks={[task]} agentRuns={[run]} />);

    await user.click(screen.getByRole("tab", { name: "Timeline" }));
    expect(screen.getByText("24 Aug 2026")).toBeTruthy();
    expect(screen.getByText(task.title)).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: "Agent Activity" }));
    expect(screen.getByText("Needs a human review")).toBeTruthy();
    expect(screen.getByText("Awaiting Human")).toBeTruthy();
    expect(screen.queryByText(/transcript/i)).toBeNull();
  });

  it("supports arrow, Home and End keyboard navigation across the task views", async () => {
    const user = userEvent.setup();
    render(<CommandCentreViews projects={[project]} tasks={[task]} />);
    const needsMe = screen.getByRole("tab", { name: "Needs Me" });
    needsMe.focus();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Board" }).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Board" }));

    await user.keyboard("{End}");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Agent Activity" }));

    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(needsMe);
  });

  it("reorders tasks within a column through accessible controls", async () => {
    const user = userEvent.setup();
    const onMoveTask = vi.fn();
    const second = { ...task, id: "task_3", title: "Second review", position: 2_000 };
    render(<CommandCentreViews projects={[project]} tasks={[task, second]} onMoveTask={onMoveTask} initialView="board" />);

    await user.click(screen.getByRole("button", { name: "Move Second review up" }));

    expect(onMoveTask).toHaveBeenCalledWith(second, "review", 0);
  });

  it("restores and updates shareable view filters in the URL", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/projects?view=table&status=review&attention=needs_me");
    render(<CommandCentreViews projects={[project, otherProject]} tasks={[task, clearTask]} syncUrl />);

    expect(screen.getByRole("tab", { name: "Table" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText(task.title)).toBeTruthy();
    expect(screen.queryByText(clearTask.title)).toBeNull();

    await user.selectOptions(screen.getByLabelText("Priority"), "high");

    expect(window.location.search).toContain("view=table");
    expect(window.location.search).toContain("status=review");
    expect(window.location.search).toContain("priority=high");
  });

  it("warns without blocking when a WIP limit is exceeded", () => {
    const busyTasks = Array.from({ length: 6 }, (_, index) => ({
      ...clearTask,
      id: `busy_${index}`,
      title: `Busy task ${index + 1}`,
      position: (index + 1) * 1_000,
    }));
    render(<CommandCentreViews projects={[otherProject]} tasks={busyTasks} initialView="board" />);

    expect(screen.getByRole("status", { name: "Work in progress warning" }).textContent).toContain("In Progress has 6 tasks, above its warning limit of 5.");
    expect(screen.getAllByRole("combobox", { name: /^Move Busy task \d+$/ })).toHaveLength(6);
  });
});
