import { describe, expect, it } from "vitest";

import { buildClientCompatibilityManifest } from "./manifest";

describe("client compatibility manifest", () => {
  it("publishes five bounded clients against the canonical MCP endpoint", () => {
    const manifest = buildClientCompatibilityManifest("https://memory.example.com");

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.endpoint).toBe("https://memory.example.com/mcp");
    expect(manifest.clients.map((client) => client.id)).toEqual([
      "codex", "claude_code", "opencode", "claude_web", "chatgpt",
    ]);
    expect(manifest.clients.every((client) => client.expectedToolCount === 24)).toBe(true);
    expect(manifest.clients.find((client) => client.id === "chatgpt")?.writeSupport).toBe("read_only_plan_limit");
  });
});
