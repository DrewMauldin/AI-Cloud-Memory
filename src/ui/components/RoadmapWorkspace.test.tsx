// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../api";
import type { Project, RoadmapItem, Task } from "../types";
import { RoadmapWorkspace } from "./RoadmapWorkspace";

const project: Project = {
  id: "project-1", ownerId: "123456789", name: "Cloud Memory", description: "Shared context edge",
  colour: "#c9ff3b", status: "active", archivedAt: null, sourceUrl: null,
  createdAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:00.000Z", version: 1,
};

const idea = (overrides: Partial<RoadmapItem> = {}): RoadmapItem => ({
  id: "roadmap-1",
  ownerId: "123456789",
  projectId: project.id,
  title: "Add confidence trends",
  description: "Make release evidence comparable over time.",
  horizon: "next",
  status: "suggested",
  impact: "high",
  effort: "small",
  position: 1000,
  sourceType: "model",
  sourceClient: "Codex",
  sourceModel: "GPT-5",
  sourceUrl: "https://chatgpt.com/c/roadmap",
  promotedTaskId: null,
  promotedAt: null,
  archivedAt: null,
  createdAt: "2026-08-24T00:00:00.000Z",
  updatedAt: "2026-08-24T00:00:00.000Z",
  version: 1,
  ...overrides,
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("RoadmapWorkspace", () => {
  it("shows recommended next bets and separates future horizons from tasks", async () => {
    vi.spyOn(api, "roadmaps").mockResolvedValue({
      total: 2,
      items: [idea(), idea({ id: "roadmap-2", title: "Explore team sharing", horizon: "later", effort: "large" })],
    });

    render(<RoadmapWorkspace projects={[project]} onTaskPromoted={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "Recommended next" })).toBeTruthy();
    expect(screen.getAllByText("Add confidence trends")).toHaveLength(2);
    expect(screen.getByText("Explore team sharing")).toBeTruthy();
    expect(screen.getAllByText("GPT-5 via Codex")).toHaveLength(2);
    expect(screen.getByRole("region", { name: "Next roadmap horizon" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Later roadmap horizon" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Someday roadmap horizon" })).toBeTruthy();
  });

  it("creates a durable AI-suggested idea with source-chat provenance", async () => {
    vi.spyOn(api, "roadmaps").mockResolvedValue({ total: 0, items: [] });
    vi.spyOn(api, "createRoadmap").mockResolvedValue(idea());
    render(<RoadmapWorkspace projects={[project]} onTaskPromoted={vi.fn()} />);

    await screen.findByText("No ideas in this horizon.");
    await userEvent.click(screen.getByRole("button", { name: "Add roadmap idea" }));
    await userEvent.type(screen.getByLabelText("Idea title"), "Add confidence trends");
    await userEvent.selectOptions(screen.getByLabelText("Idea origin"), "model");
    await userEvent.type(screen.getByLabelText("Client"), "Codex");
    await userEvent.type(screen.getByLabelText("Model"), "GPT-5");
    await userEvent.type(screen.getByLabelText("Original chat URL"), "https://chatgpt.com/c/roadmap");
    await userEvent.click(screen.getByRole("button", { name: "Save to roadmap" }));

    expect(api.createRoadmap).toHaveBeenCalledWith(expect.objectContaining({
      projectId: project.id,
      title: "Add confidence trends",
      sourceType: "model",
      client: "Codex",
      model: "GPT-5",
      sourceUrl: "https://chatgpt.com/c/roadmap",
    }));
    expect(await screen.findAllByText("Add confidence trends")).toHaveLength(2);
  });

  it("requires a second explicit action before promoting exactly one Inbox task", async () => {
    const promotedTask = {
      id: "task-1", ownerId: "123456789", projectId: project.id, title: idea().title,
      description: idea().description, status: "inbox", priority: "high", position: 1000,
      dueAt: null, blockerSummary: null, sourceType: "model", sourceClient: "Codex",
      sourceModel: "GPT-5", sourceUrl: idea().sourceUrl, archivedAt: null,
      createdAt: idea().createdAt, updatedAt: idea().updatedAt, version: 1,
    } satisfies Task;
    vi.spyOn(api, "roadmaps").mockResolvedValue({ total: 1, items: [idea()] });
    vi.spyOn(api, "promoteRoadmap").mockResolvedValue({
      roadmap: idea({ status: "promoted", promotedTaskId: promotedTask.id, version: 2 }),
      task: promotedTask,
      replayed: false,
    });
    const onTaskPromoted = vi.fn();
    render(<RoadmapWorkspace projects={[project]} onTaskPromoted={onTaskPromoted} />);

    await userEvent.click(await screen.findByRole("button", { name: "Promote Add confidence trends to a task" }));
    expect(api.promoteRoadmap).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Confirm Inbox task for Add confidence trends" }));

    await waitFor(() => expect(api.promoteRoadmap).toHaveBeenCalledWith(idea(), expect.any(String)));
    expect(onTaskPromoted).toHaveBeenCalledWith(promotedTask);
    expect(screen.getByRole("status").textContent).toContain("Promoted");
  });

  it("browses archived ideas and restores them without creating a task", async () => {
    const archived = idea({ status: "archived", archivedAt: "2026-08-24T01:00:00.000Z", version: 2 });
    vi.spyOn(api, "roadmaps")
      .mockResolvedValueOnce({ total: 0, items: [] })
      .mockResolvedValueOnce({ total: 1, items: [archived] });
    vi.spyOn(api, "restoreRoadmap").mockResolvedValue(idea({ version: 3 }));
    render(<RoadmapWorkspace projects={[project]} onTaskPromoted={vi.fn()} />);

    await userEvent.click(await screen.findByRole("button", { name: "Archived roadmap ideas" }));
    await userEvent.click(await screen.findByRole("button", { name: "Restore Add confidence trends" }));

    expect(api.restoreRoadmap).toHaveBeenCalledWith(archived);
    expect(screen.getByRole("status").textContent).toContain("Restored");
  });

  it("shows promoted ideas as read-only history", async () => {
    const promoted = idea({
      status: "promoted",
      promotedTaskId: "task-1",
      promotedAt: "2026-08-24T01:00:00.000Z",
      version: 2,
    });
    vi.spyOn(api, "roadmaps")
      .mockResolvedValueOnce({ total: 0, items: [] })
      .mockResolvedValueOnce({ total: 1, items: [promoted] });
    render(<RoadmapWorkspace projects={[project]} onTaskPromoted={vi.fn()} />);

    await userEvent.click(await screen.findByRole("button", { name: "Promoted" }));

    expect(await screen.findByText("Linked Inbox task created")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Mark planned" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Promote Add confidence trends to a task" })).toBeNull();
  });
});
