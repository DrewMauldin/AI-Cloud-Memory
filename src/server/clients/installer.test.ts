import { describe, expect, it } from "vitest";

import { buildPlan } from "../../../scripts/install-cloud-memory-clients.mjs";

describe("universal client installer plan", () => {
  it("uses the verified CLI syntax and leaves OAuth as a separate owner action", () => {
    const plan = buildPlan({ endpoint: "https://memory.example.com/mcp" });

    expect(plan).toEqual([
      {
        client: "codex",
        command: "codex",
        args: ["mcp", "add", "cloud-memory", "--url", "https://memory.example.com/mcp"],
        loginCommand: "codex mcp login cloud-memory",
      },
      {
        client: "claude-code",
        command: "claude",
        args: ["mcp", "add", "--transport", "http", "--scope", "user", "cloud-memory", "https://memory.example.com/mcp"],
        loginCommand: "claude mcp login cloud-memory",
      },
      {
        client: "opencode",
        command: "opencode",
        args: ["mcp", "add", "cloud-memory", "--url", "https://memory.example.com/mcp"],
        loginCommand: "opencode mcp auth cloud-memory",
      },
    ]);
  });

  it("rejects credential-bearing, non-HTTPS and non-MCP endpoints", () => {
    expect(() => buildPlan({ endpoint: "https://user:secret@memory.example.com/mcp" })).toThrow();
    expect(() => buildPlan({ endpoint: "http://memory.example.com/mcp" })).toThrow();
    expect(() => buildPlan({ endpoint: "https://memory.example.com/api" })).toThrow();
  });
});
