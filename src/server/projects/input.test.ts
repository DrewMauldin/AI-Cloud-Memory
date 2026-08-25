import { describe, expect, it } from "vitest";

import { archiveRecordInput, createTaskInput, moveTaskInput, updateProjectInput, updateTaskInput } from "./input";

describe("project boundary schemas", () => {
  it("trims task titles and keeps explicit model provenance", () => {
    expect(
      createTaskInput.parse({
        projectId: "project_1",
        title: "  Build the dashboard  ",
        sourceType: "model",
        client: "Codex",
        model: "GPT-5",
      }),
    ).toMatchObject({
      title: "Build the dashboard",
      sourceType: "model",
      client: "Codex",
      model: "GPT-5",
    });
  });

  it("rejects unknown Kanban statuses and missing versions", () => {
    expect(
      moveTaskInput.safeParse({ status: "almost_done", expectedVersion: 1 }).success,
    ).toBe(false);
    expect(moveTaskInput.safeParse({ status: "review" }).success).toBe(false);
  });

  it("requires a real field change and explicit archive confirmation", () => {
    expect(updateProjectInput.safeParse({ expectedVersion: 1 }).success).toBe(false);
    expect(updateTaskInput.safeParse({ expectedVersion: 1, title: "Renamed" }).success).toBe(true);
    expect(archiveRecordInput.safeParse({ expectedVersion: 1, confirm: false }).success).toBe(false);
    expect(archiveRecordInput.safeParse({ expectedVersion: 1, confirm: true }).success).toBe(true);
  });
});
