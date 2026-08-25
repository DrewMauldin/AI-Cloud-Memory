import { describe, expect, it } from "vitest";

import { apiError, applySecurityHeaders, readJson } from "./http";

describe("applySecurityHeaders", () => {
  it("adds a restrictive browser security baseline", () => {
    const response = applySecurityHeaders(new Response("ok"));

    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'self'",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
});

describe("apiError", () => {
  it("returns one stable JSON error shape without internal details", async () => {
    const response = apiError(422, "VALIDATION_ERROR", "Invalid input");

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: { code: "VALIDATION_ERROR", message: "Invalid input" },
    });
  });
});

describe("readJson", () => {
  it("rejects a request body over the configured byte limit", async () => {
    const request = new Request("https://cloud-memory.test/api/memories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "x".repeat(100) }),
    });

    await expect(readJson(request, 32)).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
    });
  });
});
