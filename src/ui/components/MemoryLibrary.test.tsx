// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../api";
import type { LibraryMemory } from "../types";
import { MemoryLibrary } from "./MemoryLibrary";

const memory = (overrides: Partial<LibraryMemory> = {}): LibraryMemory => ({
  memoryNumber: 42,
  id: "memory-42",
  ownerId: "123456789",
  namespace: "default",
  kind: "memory",
  memoryType: "decision",
  scopeType: "project",
  scopeId: "cloud-memory",
  retentionTier: "core",
  content: "D1 remains the canonical source while every projection stays rebuildable.",
  contentSha256: "hash",
  summary: "D1 is canonical.",
  importance: 0.9,
  confidence: 1,
  status: "active",
  sensitivity: "normal",
  sourceSystem: "Codex",
  sourceId: null,
  sourceUrl: "https://chatgpt.com/c/cloud-memory",
  sourceClient: "Codex",
  sourceModel: "GPT-5",
  conversationId: null,
  messageId: null,
  observedAt: "2026-08-24T00:00:00.000Z",
  recordedAt: "2026-08-24T00:00:00.000Z",
  reviewAt: null,
  expiresAt: null,
  vectorState: "indexed",
  archivedAt: null,
  purgedAt: null,
  lastRetrievedAt: null,
  retrievalCount: 0,
  labels: ["architecture"],
  createdAt: "2026-08-24T00:00:00.000Z",
  updatedAt: "2026-08-24T00:00:00.000Z",
  version: 3,
  ...overrides,
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage?.clear();
  window.history.replaceState({}, "", "/memory");
});

describe("MemoryLibrary", () => {
  it("keeps a large directive set inside a compact independently browsable list", async () => {
    const directives = Array.from({ length: 16 }, (_, index) => memory({
      id: `directive-${index}`,
      memoryNumber: index + 1,
      kind: "directive",
      memoryType: "preference",
      content: `Standing directive ${index + 1}`,
      summary: null,
      labels: [],
    }));
    vi.spyOn(api, "library").mockResolvedValue({
      items: directives,
      nextCursor: null,
      counts: { active: 16, archived: 2, memories: 0, directives: 16 },
    });

    render(<MemoryLibrary reviewCount={2} />);

    expect(await screen.findByText("Standing directive 1")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Memory records" }).className).toContain("library-records");
    expect(screen.getByRole("button", { name: /Directives 16/ })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Open Standing directive/ })).toHaveLength(16);
  });

  it("opens provenance and archives a selected record without leaving the Library", async () => {
    const record = memory();
    vi.spyOn(api, "library").mockResolvedValue({
      items: [record],
      nextCursor: null,
      counts: { active: 1, archived: 0, memories: 1, directives: 0 },
    });
    vi.spyOn(api, "memoryHistory").mockResolvedValue({ events: [] });
    vi.spyOn(api, "relatedMemories").mockResolvedValue({ items: [] });
    vi.spyOn(api, "archiveMemory").mockResolvedValue({
      ...record,
      status: "archived",
      archivedAt: "2026-08-24T01:00:00.000Z",
      version: 4,
    });

    render(<MemoryLibrary reviewCount={0} />);
    await userEvent.click(await screen.findByRole("button", { name: /D1 is canonical/ }));

    expect(screen.getByRole("heading", { name: "D1 is canonical." })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open source chat/ })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Archive record" }));

    expect(api.archiveMemory).toHaveBeenCalledWith(record);
    await waitFor(() => expect(screen.queryByRole("button", { name: /D1 is canonical/ })).toBeNull());
    expect(screen.getByRole("status").textContent).toContain("Archived");
  });

  it("saves and exports a bounded view and offers one-step lifecycle undo", async () => {
    const record = memory();
    const archived = { ...record, status: "archived" as const, archivedAt: "2026-08-24T01:00:00.000Z", version: 4 };
    vi.spyOn(api, "library").mockResolvedValue({
      items: [record], nextCursor: null,
      counts: { active: 1, archived: 1, memories: 1, directives: 0 },
    });
    vi.spyOn(api, "memoryHistory").mockResolvedValue({ events: [] });
    vi.spyOn(api, "relatedMemories").mockResolvedValue({ items: [] });
    vi.spyOn(api, "archiveMemory").mockResolvedValue(archived);
    vi.spyOn(api, "bulkLibrary").mockResolvedValue({
      results: [{ id: record.id, outcome: "changed", memory: { ...record, version: 5 } }],
    });
    const createObjectUrl = vi.fn(() => "blob:library-export");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<MemoryLibrary reviewCount={0} />);
    await screen.findByText("D1 is canonical.");
    await userEvent.click(screen.getByRole("button", { name: "Save current Library view" }));
    expect(screen.getByRole("button", { name: /Saved view All active/ })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Export current Library results as JSON" }));
    expect(createObjectUrl).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole("button", { name: /D1 is canonical/ }));
    await userEvent.click(screen.getByRole("button", { name: "Archive record" }));
    await userEvent.click(await screen.findByRole("button", { name: "Undo last Library lifecycle action" }));
    expect(api.bulkLibrary).toHaveBeenCalledWith("restore", [archived]);
  });

  it("switches to the archive and requires exact typed confirmation before purge", async () => {
    const archived = memory({
      id: "archived-42",
      status: "archived",
      archivedAt: "2026-08-24T01:00:00.000Z",
      version: 7,
    });
    vi.spyOn(api, "library")
      .mockResolvedValueOnce({
        items: [], nextCursor: null,
        counts: { active: 0, archived: 1, memories: 0, directives: 0 },
      })
      .mockResolvedValueOnce({
        items: [archived], nextCursor: null,
        counts: { active: 0, archived: 1, memories: 0, directives: 0 },
      });
    vi.spyOn(api, "memoryHistory").mockResolvedValue({ events: [] });
    vi.spyOn(api, "relatedMemories").mockResolvedValue({ items: [] });
    vi.spyOn(api, "purgeMemory").mockResolvedValue({
      ...archived,
      content: "[Permanently purged]",
      purgedAt: "2026-08-24T02:00:00.000Z",
      version: 8,
    });

    render(<MemoryLibrary reviewCount={0} />);
    await userEvent.click(await screen.findByRole("button", { name: /Archived 1/ }));
    await userEvent.click(await screen.findByRole("button", { name: /D1 is canonical/ }));
    await userEvent.click(screen.getByRole("button", { name: "Permanently purge" }));

    const purgeButton = screen.getByRole("button", { name: "Confirm permanent purge" });
    expect(purgeButton.hasAttribute("disabled")).toBe(true);
    await userEvent.type(screen.getByLabelText("Type purge confirmation"), "PURGE archived-42");
    expect(purgeButton.hasAttribute("disabled")).toBe(false);
    await userEvent.click(purgeButton);

    expect(api.purgeMemory).toHaveBeenCalledWith(archived, "PURGE archived-42");
  });
});
