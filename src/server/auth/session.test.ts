import { describe, expect, it } from "vitest";

import { openSession, sealSession } from "./session";

const key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("encrypted browser sessions", () => {
  it("round-trips the minimum GitHub identity without exposing it as plaintext", async () => {
    const session = {
      userId: "123456789",
      login: "community-owner",
      avatarUrl: "https://avatars.githubusercontent.com/u/123456789",
      issuedAt: 1_777_000_000,
      expiresAt: 1_777_086_400,
    };

    const token = await sealSession(session, key);

    expect(token).not.toContain("community-owner");
    await expect(openSession(token, key, 1_777_000_001)).resolves.toEqual(session);
  });

  it("rejects tampered ciphertext", async () => {
    const token = await sealSession(
      {
        userId: "123456789",
        login: "community-owner",
        issuedAt: 1_777_000_000,
        expiresAt: 1_777_086_400,
      },
      key,
    );

    const tamperAt = "v1.".length + 20;
    const replacement = token[tamperAt] === "A" ? "B" : "A";
    const tampered = `${token.slice(0, tamperAt)}${replacement}${token.slice(tamperAt + 1)}`;

    await expect(openSession(tampered, key, 1_777_000_001)).resolves.toBeNull();
  });

  it("rejects an expired session", async () => {
    const token = await sealSession(
      {
        userId: "123456789",
        login: "community-owner",
        issuedAt: 1_777_000_000,
        expiresAt: 1_777_000_100,
      },
      key,
    );

    await expect(openSession(token, key, 1_777_000_101)).resolves.toBeNull();
  });
});
