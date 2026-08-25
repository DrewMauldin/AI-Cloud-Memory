import { describe, expect, it, vi } from "vitest";

import {
  authenticateGitHubCode,
  buildGitHubAuthorizationUrl,
  GitHubIdentityError,
  pkceChallenge,
} from "./github";

describe("buildGitHubAuthorizationUrl", () => {
  it("requests identity-only access with PKCE and disables account creation", () => {
    const url = buildGitHubAuthorizationUrl({
      clientId: "client-id",
      callbackUrl: "https://cloud-memory.example/callback",
      state: "opaque-state",
      codeChallenge: "challenge-value",
    });

    expect(url.origin).toBe("https://github.com");
    expect(url.searchParams.get("scope")).toBe("read:user");
    expect(url.searchParams.get("allow_signup")).toBe("false");
    expect(url.searchParams.get("state")).toBe("opaque-state");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-value");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("creates a URL-safe SHA-256 PKCE challenge", async () => {
    const challenge = await pkceChallenge("a".repeat(64));
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("authenticateGitHubCode", () => {
  it("returns only the validated immutable GitHub identity", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ access_token: "upstream-token", token_type: "bearer" }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: 123456789,
          login: "community-owner",
          avatar_url: "https://avatars.githubusercontent.com/u/123456789",
        }),
      );

    const identity = await authenticateGitHubCode({
      code: "one-time-code",
      clientId: "client-id",
      clientSecret: "client-secret",
      callbackUrl: "https://cloud-memory.example/callback",
      codeVerifier: "v".repeat(64),
      allowedUserId: "123456789",
      fetcher,
    });

    expect(identity).toEqual({
      userId: "123456789",
      login: "community-owner",
      avatarUrl: "https://avatars.githubusercontent.com/u/123456789",
    });
    expect(JSON.stringify(identity)).not.toContain("upstream-token");
    const tokenBody = new URLSearchParams(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(tokenBody.get("code_verifier")).toBe("v".repeat(64));
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
      "content-type": "application/x-www-form-urlencoded",
    });
    expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe("manual");
  });

  it("rejects a valid GitHub user who is not allowlisted", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: "token" }))
      .mockResolvedValueOnce(Response.json({ id: 2, login: "someone-else" }));

    await expect(
      authenticateGitHubCode({
        code: "one-time-code",
        clientId: "client-id",
        clientSecret: "client-secret",
        callbackUrl: "https://cloud-memory.example/callback",
        codeVerifier: "v".repeat(64),
        allowedUserId: "123456789",
        fetcher,
      }),
    ).rejects.toBeInstanceOf(GitHubIdentityError);
  });

  it("maps a token endpoint network failure to a bounded identity error", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"));

    await expect(
      authenticateGitHubCode({
        code: "one-time-code",
        clientId: "client-id",
        clientSecret: "client-secret",
        callbackUrl: "https://cloud-memory.example/callback",
        codeVerifier: "v".repeat(64),
        allowedUserId: "123456789",
        fetcher,
      }),
    ).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
  });
});
