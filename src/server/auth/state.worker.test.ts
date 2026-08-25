import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { readOAuthState, storeOAuthState, takeOAuthState } from "./state";

describe("OAuth state storage", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM oauth_states").run();
  });

  it("makes a freshly written state immediately readable exactly once", async () => {
    await storeOAuthState(env.DB, "login:state-1", { purpose: "dashboard" }, 600);

    await expect(readOAuthState<{ purpose: string }>(env.DB, "login:state-1"))
      .resolves.toEqual({ purpose: "dashboard" });
    await expect(takeOAuthState<{ purpose: string }>(env.DB, "login:state-1"))
      .resolves.toEqual({ purpose: "dashboard" });
    await expect(takeOAuthState(env.DB, "login:state-1")).resolves.toBeNull();
  });

  it("does not return expired state", async () => {
    await env.DB.prepare(
      `INSERT INTO oauth_states (key, payload_json, expires_at, created_at)
       VALUES (?, ?, ?, ?)`,
    ).bind(
      "login:expired",
      JSON.stringify({ purpose: "dashboard" }),
      "2026-08-23T00:00:00.000Z",
      "2026-08-22T23:00:00.000Z",
    ).run();

    await expect(takeOAuthState(env.DB, "login:expired")).resolves.toBeNull();
  });

  it("allows only one concurrent consumer to take a state", async () => {
    await storeOAuthState(env.DB, "login:single-use", { purpose: "dashboard" }, 600);

    const results = await Promise.all([
      takeOAuthState<{ purpose: string }>(env.DB, "login:single-use"),
      takeOAuthState<{ purpose: string }>(env.DB, "login:single-use"),
    ]);

    expect(results.filter((result) => result !== null)).toEqual([
      { purpose: "dashboard" },
    ]);
  });
});
