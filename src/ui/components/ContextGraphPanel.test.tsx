// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ContextGraphSnapshot } from "../types";
import { ContextGraphPanel } from "./ContextGraphPanel";

const graph: ContextGraphSnapshot = {
  entities: [
    {
      id: "entity-cloud",
      ownerId: "owner",
      canonicalName: "Cloud Memory",
      entityType: "system",
      description: "Canonical memory service.",
      aliases: ["CM", "Cloud archive"],
      createdAt: "2026-08-24T00:00:00.000Z",
      updatedAt: "2026-08-24T00:00:00.000Z",
      version: 1,
    },
    {
      id: "entity-obsidian",
      ownerId: "owner",
      canonicalName: "Obsidian",
      entityType: "system",
      description: null,
      aliases: [],
      createdAt: "2026-08-24T00:00:00.000Z",
      updatedAt: "2026-08-24T00:00:00.000Z",
      version: 1,
    },
  ],
  relationships: [{
    id: "relationship-1",
    fromEntityId: "entity-cloud",
    toEntityId: "entity-obsidian",
    relationshipType: "projects to",
    validFrom: null,
    validUntil: null,
    evidenceMemoryId: "memory-1",
    confidence: 0.88,
    updatedAt: "2026-08-24T00:00:00.000Z",
  }],
  memoryLinks: [
    { memoryId: "memory-1", entityId: "entity-cloud", relation: "subject", confidence: 1 },
    { memoryId: "memory-1", entityId: "entity-obsidian", relation: "mentioned", confidence: 0.8 },
  ],
};

describe("ContextGraphPanel", () => {
  it("shows entities, aliases, evidence counts, and one-hop relationships", () => {
    render(<ContextGraphPanel graph={graph} />);

    expect(screen.getByRole("heading", { name: "The connections behind recall." })).toBeTruthy();
    expect(screen.getAllByText("Cloud Memory").length).toBeGreaterThan(0);
    expect(screen.getByText("CM")).toBeTruthy();
    expect(screen.getAllByText("1 evidence").length).toBe(2);
    expect(screen.getAllByText("projects to").length).toBe(2);
    expect(screen.getAllByText("Obsidian").length).toBeGreaterThan(0);
    expect(screen.getAllByText("88% confidence").length).toBe(2);
  });

  it("provides loading, empty, error, and retry states", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const { rerender } = render(<ContextGraphPanel graph={null} loading />);
    expect(screen.getByLabelText("Loading context graph")).toBeTruthy();

    rerender(<ContextGraphPanel graph={{ entities: [], relationships: [], memoryLinks: [] }} />);
    expect(screen.getByRole("status").textContent).toContain("No context entities");

    rerender(<ContextGraphPanel graph={null} error={"Graph database unavailable"} onRetry={onRetry} />);
    expect(screen.getByRole("alert").textContent).toContain("Graph database unavailable");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("bounds long descriptions and keeps unknown relationship endpoints safe", () => {
    const longDescription = "d".repeat(400);
    render(<ContextGraphPanel graph={{
      ...graph,
      entities: [{ ...graph.entities[0], description: longDescription }],
      relationships: [{ ...graph.relationships[0], toEntityId: "missing-entity" }],
    }} />);

    expect(screen.getByText(`${"d".repeat(240)}…`)).toBeTruthy();
    expect(screen.getByText("Unknown entity")).toBeTruthy();
  });
});
