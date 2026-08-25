import { describe, expect, it } from "vitest";

import { resolvePublicOrigin } from "./origin";

describe("public origin resolution", () => {
  it("uses the deployed request origin during first-run setup", () => {
    expect(resolvePublicOrigin(new Request("https://example.workers.dev/login"), "auto"))
      .toBe("https://example.workers.dev");
  });

  it("pins an explicitly configured HTTPS origin", () => {
    expect(resolvePublicOrigin(new Request("https://alias.example/login"), "https://memory.example"))
      .toBe("https://memory.example");
  });

  it("rejects an insecure automatic production origin", () => {
    expect(() => resolvePublicOrigin(new Request("http://memory.example/login"), "auto"))
      .toThrow("requires HTTPS");
  });
});
