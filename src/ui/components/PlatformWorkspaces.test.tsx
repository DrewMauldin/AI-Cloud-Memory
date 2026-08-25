// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryIntelligencePanel, parseConnectorInput } from "./PlatformWorkspaces";

const apiMocks = vi.hoisted(() => ({
  contextProfile: vi.fn(),
  reflection: vi.fn(),
  archiveProfileFacet: vi.fn(),
  saveProfileFacet: vi.fn(),
  saveContextPack: vi.fn(),
  restoreContextPack: vi.fn(),
}));

vi.mock("../api", () => ({
  api: {
    ...apiMocks,
    createContextPack: vi.fn(),
    previewContextPack: vi.fn(),
    updateContextPack: vi.fn(),
    archiveContextPack: vi.fn(),
    saveContextPack: apiMocks.saveContextPack,
    restoreContextPack: apiMocks.restoreContextPack,
    runReflection: vi.fn(),
    decideReflection: vi.fn(),
    applyReflectionArchive: vi.fn(),
    saveProfileFacet: apiMocks.saveProfileFacet,
  },
}));

beforeEach(() => {
  apiMocks.contextProfile.mockResolvedValue({ facets: [], packs: [] });
  apiMocks.reflection.mockResolvedValue({ proposals: [] });
  apiMocks.archiveProfileFacet.mockReset();
  apiMocks.saveProfileFacet.mockReset();
  apiMocks.saveContextPack.mockReset();
  apiMocks.restoreContextPack.mockReset();
});

afterEach(() => cleanup());

describe("platform workspace connector parser", () => {
  it("preserves JSONL and parses structured connector payloads", () => {
    expect(parseConnectorInput("cloud_memory_jsonl", "{\"id\":\"1\"}\n")).toBe("{\"id\":\"1\"}\n");
    expect(parseConnectorInput("github_markdown", '{"repository":"owner/repo","ref":"main","path":"note.md"}')).toEqual({
      repository: "owner/repo", ref: "main", path: "note.md",
    });
  });
});

describe("MemoryIntelligencePanel", () => {
  it("archives a profile facet through the versioned profile API", async () => {
    const facet = {
      id: "facet-communication", facetType: "communication" as const,
      content: "Use Australian English.", summary: null, sensitivity: "normal" as const,
      enabled: true, archivedAt: null, version: 3,
    };
    apiMocks.contextProfile.mockResolvedValue({ facets: [facet], packs: [] });
    apiMocks.archiveProfileFacet.mockResolvedValue({ ...facet, archivedAt: "2026-08-25T00:00:00.000Z", version: 4 });
    const user = userEvent.setup();

    render(<MemoryIntelligencePanel onNotice={vi.fn()} />);
    await screen.findByDisplayValue("Use Australian English.");
    await user.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() => expect(apiMocks.archiveProfileFacet).toHaveBeenCalledWith(facet));
  });

  it("restores an archived facet as enabled with its current version", async () => {
    const facet = {
      id: "facet-constraints", facetType: "constraints" as const,
      content: "Keep credentials out of Git.", summary: null, sensitivity: "normal" as const,
      enabled: false, archivedAt: "2026-08-25T00:00:00.000Z", version: 4,
    };
    apiMocks.contextProfile.mockResolvedValue({ facets: [facet], packs: [] });
    apiMocks.saveProfileFacet.mockResolvedValue({ ...facet, enabled: true, archivedAt: null, version: 5 });
    const user = userEvent.setup();

    render(<MemoryIntelligencePanel onNotice={vi.fn()} />);
    await screen.findByDisplayValue("Keep credentials out of Git.");
    await user.click(screen.getByRole("button", { name: "Restore facet" }));

    await waitFor(() => expect(apiMocks.saveProfileFacet).toHaveBeenCalledWith("constraints", {
      content: facet.content,
      sensitivity: "normal",
      enabled: true,
      expectedVersion: 4,
    }));
  });
});
