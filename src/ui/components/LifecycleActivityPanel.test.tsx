// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../api";
import { LifecycleActivityPanel } from "./LifecycleActivityPanel";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("LifecycleActivityPanel", () => {
  it("renders memory, project and task lifecycle evidence in one feed", async () => {
    vi.spyOn(api, "lifecycleActivity").mockResolvedValue({ events: [
      {
        id: "event-1", subjectType: "memory", subjectId: "memory-1",
        subjectTitle: "D1 is canonical", eventType: "archived", actorType: "human",
        client: "Cloud Memory dashboard", model: null, sourceUrl: null,
        createdAt: "2026-08-24T00:00:00.000Z",
      },
    ] });

    render(<LifecycleActivityPanel />);

    expect(await screen.findByText("D1 is canonical")).toBeTruthy();
    expect(screen.getByText("memory · archived")).toBeTruthy();
  });
});
