import { describe, expect, it } from "vitest";

import {
  CONSENT_SUBMIT_PATH,
  escapeHtml,
  filterScopes,
  hasSameOrigin,
  unsupportedScopes,
} from "./consent";

describe("OAuth consent helpers", () => {
  it("uses a browser-compatible internal submit path", () => {
    expect(CONSENT_SUBMIT_PATH).toBe("/bridge/finish");
  });

  it("escapes untrusted client metadata before rendering", () => {
    expect(escapeHtml(`<img src=x onerror="alert(1)">`)).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
  });

  it("grants only explicitly supported scopes", () => {
    expect(
      filterScopes(
        ["memory:read", "admin:everything", "memory:write"],
        ["memory:read", "memory:write"],
      ),
    ).toEqual(["memory:read", "memory:write"]);
  });

  it("identifies unsupported scopes instead of silently granting less access", () => {
    expect(unsupportedScopes(
      ["memory:read", "admin:everything"],
      ["memory:read", "memory:write"],
    )).toEqual(["admin:everything"]);
  });

  it("requires a matching Origin on state-changing browser requests", () => {
    expect(
      hasSameOrigin(
        new Request("https://cloud-memory.example/authorize/consent", {
          method: "POST",
          headers: { origin: "https://cloud-memory.example" },
        }),
      ),
    ).toBe(true);
    expect(
      hasSameOrigin(
        new Request("https://cloud-memory.example/authorize/consent", {
          method: "POST",
          headers: { origin: "https://attacker.example" },
        }),
      ),
    ).toBe(false);
  });
});
