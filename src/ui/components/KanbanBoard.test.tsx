// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Project, Task } from "../types";
import { KanbanBoard, TaskCard } from "./KanbanBoard";

afterEach(cleanup);

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
  projectId: "project_1",
  title: "Verify keyboard task movement",
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
  version: 1,
};

describe("TaskCard", () => {
  it("shows provenance and an explicit unavailable chat-link state", () => {
    const { container } = render(<TaskCard project={project} task={task} onMove={vi.fn()} />);

    expect(screen.getByText("GPT-5")).toBeTruthy();
    expect(screen.getByText("Codex")).toBeTruthy();
    expect(screen.getByText("Chat unavailable")).toBeTruthy();
    expect(container.querySelector("[style]")).toBeNull();
  });

  it("offers a keyboard-accessible status move using the shared callback", async () => {
    const onMove = vi.fn();
    render(<TaskCard project={project} task={task} onMove={onMove} />);

    await userEvent.selectOptions(screen.getByLabelText(`Move ${task.title}`), "review");

    expect(onMove).toHaveBeenCalledWith(task, "review");
  });
});

describe("KanbanBoard drag movement", () => {
  it("uses the same move callback for a pointer drop", () => {
    const onMove = vi.fn();
    const { container } = render(
      <KanbanBoard projects={[project]} tasks={[task]} onMove={onMove} onOpenTask={vi.fn()} />,
    );
    const reviewColumn = container.querySelector<HTMLElement>('[data-column-status="review"]');
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn().mockReturnValue(reviewColumn),
    });

    fireEvent.pointerDown(screen.getByLabelText(`Drag ${task.title}`), { pointerId: 1 });
    fireEvent.pointerUp(screen.getByLabelText(`Drag ${task.title}`), { pointerId: 1, clientX: 10, clientY: 10 });

    expect(onMove).toHaveBeenCalledWith(task, "review");
  });

  it("uses the same move callback for native desktop drag and drop", () => {
    const onMove = vi.fn();
    const { container } = render(
      <KanbanBoard projects={[project]} tasks={[task]} onMove={onMove} onOpenTask={vi.fn()} />,
    );
    fireEvent.dragStart(container.querySelector('[data-task-id="task_1"]') as Element);
    fireEvent.drop(container.querySelector('[data-column-status="done"]') as Element);
    expect(onMove).toHaveBeenCalledWith(task, "done");
  });
});
