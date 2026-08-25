// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "./AppShell";

afterEach(cleanup);

describe("AppShell", () => {
  it("provides a keyboard skip link to the main workspace", () => {
    render(<AppShell
      activeView="command"
      user={{ id: "owner_1", login: "drew", name: "Owner", avatarUrl: null }}
      onNavigate={vi.fn()}
      onLogout={vi.fn()}
    ><h1>Command centre</h1></AppShell>);

    expect(screen.getByRole("link", { name: "Skip to main content" }).getAttribute("href")).toBe("#cloud-memory-main");
    expect(screen.getByRole("main").id).toBe("cloud-memory-main");
    expect(screen.getByRole("button", { name: /Roadmap/ })).toBeTruthy();
    expect(screen.getByText("Signal Room / v1.0")).toBeTruthy();
  });
});
