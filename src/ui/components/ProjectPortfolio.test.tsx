// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../api";
import type { Project, Task } from "../types";
import { ProjectPortfolio } from "./ProjectPortfolio";

const project: Project = {
  id: "project-1", ownerId: "123456789", name: "Cloud Memory", description: "Shared context edge",
  colour: "#c9ff3b", status: "active", archivedAt: null, sourceUrl: null,
  createdAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:00.000Z", version: 2,
};
const task: Task = {
  id: "task-1", ownerId: "123456789", projectId: project.id, title: "Polish the Library",
  description: null, status: "in_progress", priority: "high", position: 1, dueAt: null,
  blockerSummary: null, sourceType: "model", sourceClient: "Codex", sourceModel: "GPT-5",
  sourceUrl: null, archivedAt: null, createdAt: project.createdAt, updatedAt: project.updatedAt, version: 1,
};
const completedTask: Task = {
  ...task,
  id: "task-2",
  title: "Ship the archive",
  status: "done",
  priority: "medium",
  position: 2,
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("ProjectPortfolio", () => {
  it("shows useful project health and archives without discarding its tasks", async () => {
    const onArchived = vi.fn();
    vi.spyOn(api, "archiveProject").mockResolvedValue({ ...project, status: "archived", archivedAt: "2026-08-24T01:00:00.000Z", version: 3 });
    render(<ProjectPortfolio projects={[project]} tasks={[task]} onArchived={onArchived} onRestored={vi.fn()} onTaskCompleted={vi.fn()} onTaskArchived={vi.fn()} />);

    expect(screen.getByText("1 open · 1 moving · 0 blocked")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Archive project Cloud Memory" }));

    expect(api.archiveProject).toHaveBeenCalledWith(project);
    expect(onArchived).toHaveBeenCalledWith(expect.objectContaining({ status: "archived" }));
  });

  it("keeps outstanding work visible and offers separate complete and archive actions", async () => {
    const onTaskCompleted = vi.fn();
    const onTaskArchived = vi.fn();
    render(
      <ProjectPortfolio
        projects={[project]}
        tasks={[task, completedTask]}
        onArchived={vi.fn()}
        onRestored={vi.fn()}
        onTaskCompleted={onTaskCompleted}
        onTaskArchived={onTaskArchived}
      />,
    );

    expect(screen.getByText("Polish the Library")).toBeTruthy();
    expect(screen.getByLabelText("Cloud Memory status summary").textContent).toContain("Outstanding1");
    expect(screen.getByText("1 complete")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Mark Polish the Library complete" }));
    expect(onTaskCompleted).toHaveBeenCalledWith(task);

    await userEvent.click(screen.getByRole("button", { name: "Archive Polish the Library" }));
    expect(onTaskArchived).toHaveBeenCalledWith(task);
  });

  it("browses archived projects with preserved tasks and restores them", async () => {
    const archived = { ...project, status: "archived" as const, archivedAt: "2026-08-24T01:00:00.000Z", version: 3 };
    vi.spyOn(api, "projects").mockResolvedValue({ projects: [archived], tasks: [task] });
    vi.spyOn(api, "restoreProject").mockResolvedValue({ ...archived, status: "active", archivedAt: null, version: 4 });
    const onRestored = vi.fn();
    render(<ProjectPortfolio projects={[]} tasks={[]} onArchived={vi.fn()} onRestored={onRestored} onTaskCompleted={vi.fn()} onTaskArchived={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Archived projects" }));
    expect(await screen.findByText("1 preserved task")).toBeTruthy();
    expect(screen.getByText("Polish the Library")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Restore project Cloud Memory" }));

    expect(onRestored).toHaveBeenCalledWith(expect.objectContaining({ status: "active" }), [task]);
  });
});
