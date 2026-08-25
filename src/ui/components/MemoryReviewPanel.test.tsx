// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemoryReviewPanel, type MemoryReviewItem } from "./MemoryReviewPanel";

const review: MemoryReviewItem = {
  id: "review-1",
  reviewType: "source_conflict",
  status: "open",
  candidateContent: "The candidate memory content stays bounded in the review surface.",
  candidateSha256: "a".repeat(64),
  candidateNamespace: "default",
  candidateKind: "memory",
  matchedMemoryId: "memory-42",
  similarity: 0.94,
  sourceSystem: "MCP",
  sourceId: "capture-1",
  sourceUrl: "https://chatgpt.com/c/example",
  client: "Codex",
  model: "GPT-5",
  correlationId: "capture-1",
  createdAt: "2026-08-24T01:02:03.000Z",
  version: 3,
};

describe("MemoryReviewPanel", () => {
  afterEach(() => cleanup());

  it("renders candidate and match provenance and passes the current version to each decision", async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const onDismiss = vi.fn();
    render(<MemoryReviewPanel reviews={[review]} onApprove={onApprove} onReject={onReject} onDismiss={onDismiss} />);

    expect(screen.getByText("The candidate memory content stays bounded in the review surface.")).toBeTruthy();
    expect(screen.getByText("memory-42")).toBeTruthy();
    expect(screen.getByText("MCP · capture-1")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open source" }).getAttribute("href")).toBe("https://chatgpt.com/c/example");

    await user.click(screen.getByRole("button", { name: "Mark approved" }));
    await user.click(screen.getByRole("button", { name: "Reject" }));
    await user.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(onApprove).toHaveBeenCalledWith("review-1", 3);
    expect(onReject).toHaveBeenCalledWith("review-1", 3);
    expect(onDismiss).toHaveBeenCalledWith("review-1", 3);
  });

  it("shows an explicit empty state and truncates oversized candidate content", () => {
    const oversized = { ...review, candidateContent: "x".repeat(1_500) };
    const { rerender } = render(<MemoryReviewPanel reviews={[]} onApprove={vi.fn()} onReject={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toContain("No open review items.");

    rerender(<MemoryReviewPanel reviews={[oversized]} onApprove={vi.fn()} onReject={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText(`${"x".repeat(1_200)}…`)).toBeTruthy();
  });

  it("does not create an unsafe source link", () => {
    render(<MemoryReviewPanel reviews={[{ ...review, sourceUrl: "javascript:alert(1)" }]} onApprove={vi.fn()} onReject={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.queryByRole("link", { name: "Open source" })).toBeNull();
    expect(screen.getByText("Source unavailable")).toBeTruthy();
  });
});
