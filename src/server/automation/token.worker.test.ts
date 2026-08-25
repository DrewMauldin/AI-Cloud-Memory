import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { authenticateAutomationToken, issueAutomationToken } from "./token";

const ownerId = "123456789";

describe("automation token storage", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM automation_tokens").run();
    await env.DB.prepare("DELETE FROM users").run();
    await env.DB.prepare(
      `INSERT INTO users (id, github_login, created_at, updated_at) VALUES (?, 'community-owner', ?, ?)`,
    ).bind(ownerId, "2026-08-23T00:00:00.000Z", "2026-08-23T00:00:00.000Z").run();
  });

  it("authenticates only the granted scope and never stores the bearer value", async () => {
    const issued = await issueAutomationToken({
      database: env.DB,
      ownerId,
      label: "n8n projection",
      scopes: ["projection:read"],
    });
    const stored = await env.DB.prepare(
      "SELECT token_hash, last_used_at FROM automation_tokens WHERE id = ?",
    ).bind(issued.id).first<{ token_hash: string; last_used_at: string | null }>();
    expect(stored?.token_hash).not.toContain(issued.token);

    await expect(authenticateAutomationToken({
      database: env.DB,
      authorization: `Bearer ${issued.token}`,
      requiredScope: "projection:read",
    })).resolves.toMatchObject({ ownerId });
    await expect(authenticateAutomationToken({
      database: env.DB,
      authorization: `Bearer ${issued.token}`,
      requiredScope: "export:write",
    })).rejects.toThrow("scope");
  });
});
