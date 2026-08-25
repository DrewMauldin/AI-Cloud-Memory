import { describe, expect, it } from "vitest";

import { createAutomationToken, hashAutomationToken, isAllowedAutomationScope } from "./token";

describe("automation credentials", () => {
  it("creates a one-time token and stores only its hash", async () => {
    const token = createAutomationToken(() => new Uint8Array(32).fill(17));
    expect(token).toMatch(/^cm_auto_[A-Za-z0-9_-]{43}$/);
    expect(await hashAutomationToken(token)).toHaveLength(64);
    expect(await hashAutomationToken(token)).not.toContain(token);
  });

  it("keeps the automation scope surface narrow", () => {
    expect(isAllowedAutomationScope("projection:read")).toBe(true);
    expect(isAllowedAutomationScope("export:write")).toBe(true);
    expect(isAllowedAutomationScope("memory:write")).toBe(false);
  });
});
