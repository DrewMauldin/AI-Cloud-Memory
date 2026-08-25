import { describe, expect, it, vi } from "vitest";

import { sha256Text } from "../import/truememory";
import { previewConnector } from "./registry";

describe("source connector registry", () => {
  it("normalises bounded Cloud Memory JSONL and Markdown bundles", async () => {
    const cloud = await previewConnector({
      adapterId: "cloud_memory_jsonl",
      input: `${JSON.stringify({ id: "m-1", content: "D1 is canonical.", memoryType: "decision" })}\n`,
    });
    const markdown = await previewConnector({
      adapterId: "markdown_bundle",
      input: { files: [{ path: "Projects/Cloud Memory.md", content: "# Cloud Memory\n\nKeep projections bounded." }] },
    });

    expect(cloud.records[0]).toMatchObject({ sourceId: "m-1", content: "D1 is canonical.", memoryType: "decision" });
    expect(markdown.records[0]).toMatchObject({ sourceId: "Projects/Cloud Memory.md", namespace: "markdown" });
    expect(cloud.previewSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reuses the authoritative TrueMemory manifest and checksum validation", async () => {
    const record = JSON.stringify({ type: "memory", sourceMemoryId: "tm-1", content: "A portable memory.", directive: false });
    const payload = `${record}\n`;
    const manifest = JSON.stringify({
      type: "manifest",
      schemaVersion: 2,
      sourceSystem: "truememory",
      snapshotSha256: "a".repeat(64),
      payloadSha256: await sha256Text(payload),
      recordCount: 1,
      exportedAt: "2026-08-25T00:00:00.000Z",
    });
    const preview = await previewConnector({ adapterId: "truememory_jsonl", input: `${manifest}\n${payload}` });

    expect(preview.records).toHaveLength(1);
    expect(preview.records[0]).toMatchObject({ sourceId: "tm-1", sourceSystem: "truememory" });
  });

  it("fetches one GitHub Markdown file without following redirects", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      return Response.json({
        type: "file",
        encoding: "base64",
        content: "IyBQcm9qZWN0CgpBIHNvdXJjZS1iYWNrZWQgQ2Fmw6kgZGVjaXNpb24u",
        html_url: "https://github.com/example/notes/blob/main/decision.md",
        sha: "abc123",
      });
    });
    const preview = await previewConnector({
      adapterId: "github_markdown",
      input: { repository: "example/notes", ref: "main", path: "decision.md" },
      fetcher: fetcher as typeof fetch,
    });

    expect(preview.records[0]).toMatchObject({ sourceId: "abc123", sourceSystem: "github_markdown" });
    expect(preview.records[0]?.content).toContain("Café");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects traversal, oversized input and secret-bearing content", async () => {
    await expect(previewConnector({
      adapterId: "markdown_bundle",
      input: { files: [{ path: "../Secrets.md", content: "hello" }] },
    })).rejects.toThrow();
    await expect(previewConnector({
      adapterId: "cloud_memory_jsonl",
      input: `${JSON.stringify({ id: "secret", content: `ghp_${"a".repeat(40)}` })}\n`,
    })).rejects.toThrow("secret-like");
  });
});
