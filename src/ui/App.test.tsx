// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "./api";
import { App, LoginScreen, NewProjectPanel, SettingsView, trueMemoryApplyBatches } from "./App";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("LoginScreen", () => {
  it("presents one owner-only entry action without exposing workspace data", () => {
    render(<LoginScreen />);

    expect(screen.getByRole("heading", { level: 1, name: /Your work has context/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Enter with GitHub/ }).getAttribute("href")).toBe("/login");
    expect(screen.getByText(/no public workspace/i)).toBeTruthy();
    expect(screen.getByText("v1.0")).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});

describe("App session boundary", () => {
  it("shows a retryable error instead of leaving a failed session request loading forever", async () => {
    vi.spyOn(api, "session").mockRejectedValue(new Error("Edge connection unavailable"));
    vi.spyOn(api, "health").mockRejectedValue(new Error("Health unavailable"));

    render(<App />);

    expect(await screen.findByRole("heading", { name: "The Signal Room could not open." })).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/No project or memory data was loaded/)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Try again/ }));
  });

  it("recovers from a failed session request when retry reaches the login boundary", async () => {
    vi.spyOn(api, "session")
      .mockRejectedValueOnce(new Error("Edge connection unavailable"))
      .mockRejectedValueOnce(new ApiError(401, "Not authenticated"));
    vi.spyOn(api, "health").mockRejectedValue(new Error("Health unavailable"));
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: /Try again/ }));

    expect(await screen.findByRole("link", { name: /Enter with GitHub/ })).toBeTruthy();
    expect(api.session).toHaveBeenCalledTimes(2);
  });
});

describe("NewProjectPanel", () => {
  it("creates the first project and returns the canonical API record", async () => {
    const project = {
      id: "project_1", ownerId: "123456789", name: "Cloud Memory", description: null,
      colour: "#c9ff3b", status: "active" as const, sourceUrl: null,
      createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T00:00:00.000Z", version: 1,
    };
    vi.spyOn(api, "createProject").mockResolvedValue(project);
    const onCreated = vi.fn();
    render(<NewProjectPanel onCreated={onCreated} onClose={vi.fn()} />);

    await userEvent.type(screen.getByLabelText("Name"), "Cloud Memory");
    await userEvent.click(screen.getByRole("button", { name: "Create project" }));

    expect(api.createProject).toHaveBeenCalledWith({
      name: "Cloud Memory", description: undefined, colour: "#c9ff3b",
    });
    expect(onCreated).toHaveBeenCalledWith(project);
  });

  it("keeps an API failure visible inside the project form", async () => {
    vi.spyOn(api, "createProject").mockRejectedValue(new Error("Project name already exists"));
    render(<NewProjectPanel onCreated={vi.fn()} onClose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Name"), "Cloud Memory");
    await userEvent.click(screen.getByRole("button", { name: "Create project" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Project name already exists");
  });
});

describe("trueMemoryApplyBatches", () => {
  it("sends only memory records in free-tier-sized batches", () => {
    const records = Array.from({ length: 12 }, (_, index) => JSON.stringify({
      type: "memory",
      sourceMemoryId: String(index + 1),
      content: `Memory ${index + 1}`,
    }));
    const jsonl = [
      JSON.stringify({ type: "manifest" }),
      ...records.slice(0, 5),
      "{malformed",
      ...records.slice(5),
      "",
    ].join("\n");

    const batches = trueMemoryApplyBatches(jsonl);

    expect(batches.map((batch) => batch.length)).toEqual([10, 2]);
    expect(batches.flat()).toHaveLength(12);
    expect(batches.flat()).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceMemoryId: "1", content: "Memory 1" }),
      expect.objectContaining({ sourceMemoryId: "12", content: "Memory 12" }),
    ]));
  });
});

describe("SettingsView", () => {
  it("persists meaningful workspace display preferences through one settings surface", async () => {
    const onPreferencesChange = vi.fn();
    const preferences = {
      textScale: "large" as const,
      density: "comfortable" as const,
      reduceMotion: false,
      highContrast: false,
      showMemoryExcerpts: true,
      expandCompletedTasks: false,
      doneBoardRetentionDays: 3 as const,
    };
    render(<SettingsView
      onNotice={vi.fn()}
      health={null}
      exportCapabilities={{ encryptedDownload: false, githubExport: false }}
      preferences={preferences}
      onPreferencesChange={onPreferencesChange}
    />);

    await userEvent.selectOptions(screen.getByLabelText("Workspace density"), "compact");
    expect(onPreferencesChange).toHaveBeenCalledWith({ ...preferences, density: "compact" });
    await userEvent.click(screen.getByRole("checkbox", { name: /Stronger contrast/ }));
    expect(onPreferencesChange).toHaveBeenCalledWith({ ...preferences, highContrast: true });
    await userEvent.selectOptions(screen.getByLabelText("Done task board retention"), "7");
    expect(onPreferencesChange).toHaveBeenCalledWith({ ...preferences, doneBoardRetentionDays: 7 });
  });

  it("offers an encrypted download without implying GitHub push is configured", () => {
    render(<SettingsView
      onNotice={vi.fn()}
      health={{ status: "ok", environment: "production", checkedAt: "2026-08-24T00:00:00.000Z" }}
      exportCapabilities={{ encryptedDownload: true, githubExport: false }}
    />);

    expect(screen.getByText("GITHUB PUSH OFF")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download encrypted backup" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Export to GitHub" })).toBeNull();
  });

  it("fails closed when export encryption is unavailable", () => {
    render(<SettingsView
      onNotice={vi.fn()}
      health={null}
      exportCapabilities={{ encryptedDownload: false, githubExport: false }}
    />);

    expect(screen.getByText("NOT CONFIGURED")).toBeTruthy();
    expect(screen.getByText(/Export encryption is not configured/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download encrypted backup" }).hasAttribute("disabled")).toBe(true);
  });

  it("offers GitHub push only when the repository credential is configured", () => {
    render(<SettingsView
      onNotice={vi.fn()}
      health={null}
      exportCapabilities={{ encryptedDownload: true, githubExport: true }}
    />);

    expect(screen.getByText("GITHUB CONFIGURED")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Export to GitHub" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Download encrypted backup" })).toBeNull();
  });

  it("shows a dated Vectorize receipt and never fabricates a canary badge", () => {
    render(<SettingsView
      onNotice={vi.fn()}
      health={{ status: "ok", environment: "production", checkedAt: "2026-08-24T00:00:00.000Z" }}
      exportCapabilities={{ encryptedDownload: true, githubExport: false }}
      receipts={[{
        capability: "vectorize",
        status: "verified",
        detail: "Live semantic search passed",
        evidenceSha256: null,
        source: "release canary",
        checkedAt: "2026-08-24T03:00:00.000Z",
        version: 1,
      }]}
    />);

    expect(screen.getAllByText("VERIFIED · 2026-08-24")).toHaveLength(2);
    expect(screen.queryByText("CANARY VERIFIED")).toBeNull();
  });
});
