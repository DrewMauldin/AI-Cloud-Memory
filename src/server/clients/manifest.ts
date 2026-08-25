export const CLIENT_IDS = ["codex", "claude_code", "opencode", "claude_web", "chatgpt"] as const;
export type ClientId = typeof CLIENT_IDS[number];

export interface ClientCompatibilityManifest {
  schemaVersion: 1;
  endpoint: string;
  requiredScopes: readonly string[];
  clients: Array<{
    id: ClientId;
    label: string;
    setup: "cli" | "connector_ui";
    oauth: true;
    hookSupport: "native" | "plugin" | "instructions_only";
    writeSupport: "full" | "read_only_plan_limit";
    expectedToolCount: 24;
    canary: readonly string[];
  }>;
}

export function buildClientCompatibilityManifest(publicOrigin: string): ClientCompatibilityManifest {
  const origin = new URL(publicOrigin);
  if (origin.protocol !== "https:" || origin.origin !== publicOrigin) throw new Error("Public origin must be a canonical HTTPS origin");
  const shared = {
    oauth: true as const,
    expectedToolCount: 24 as const,
    canary: ["configured", "authenticated", "cloudmemory_health", "cloudmemory_board", "tool_count_24"] as const,
  };
  return {
    schemaVersion: 1,
    endpoint: `${origin.origin}/mcp`,
    requiredScopes: ["memory:read", "memory:write", "projects:read", "projects:write"],
    clients: [
      { id: "codex", label: "Codex", setup: "cli", hookSupport: "native", writeSupport: "full", ...shared },
      { id: "claude_code", label: "Claude Code", setup: "cli", hookSupport: "native", writeSupport: "full", ...shared },
      { id: "opencode", label: "OpenCode", setup: "cli", hookSupport: "plugin", writeSupport: "full", ...shared },
      { id: "claude_web", label: "Claude Web", setup: "connector_ui", hookSupport: "instructions_only", writeSupport: "full", ...shared },
      { id: "chatgpt", label: "ChatGPT", setup: "connector_ui", hookSupport: "instructions_only", writeSupport: "read_only_plan_limit", ...shared },
    ],
  };
}
