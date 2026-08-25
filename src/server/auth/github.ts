import { z } from "zod";

const tokenResponseSchema = z.object({
  access_token: z.string().min(1).max(512),
});

const userResponseSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1).max(100),
  avatar_url: z.url().max(500).optional(),
});

export interface GitHubIdentity {
  userId: string;
  login: string;
  avatarUrl?: string;
}

type GitHubIdentityStage =
  | "token_request"
  | "token_response"
  | "user_request"
  | "user_response";

export class GitHubIdentityError extends Error {
  constructor(
    public readonly code: "UPSTREAM_ERROR" | "IDENTITY_DENIED",
    public readonly stage?: GitHubIdentityStage,
  ) {
    super(
      code === "IDENTITY_DENIED"
        ? "This GitHub identity is not authorised"
        : "GitHub authentication could not be completed",
    );
    this.name = "GitHubIdentityError";
  }
}

export function buildGitHubAuthorizationUrl(input: {
  clientId: string;
  callbackUrl: string;
  state: string;
  codeChallenge: string;
}): URL {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.callbackUrl);
  url.searchParams.set("scope", "read:user");
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("allow_signup", "false");
  return url;
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const bytes = Array.from(new Uint8Array(digest), (byte) => String.fromCharCode(byte)).join("");
  return btoa(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export async function authenticateGitHubCode(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  codeVerifier: string;
  allowedUserId: string;
  fetcher?: typeof fetch;
}): Promise<GitHubIdentity> {
  const fetcher = input.fetcher ?? fetch;
  const tokenBody = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    redirect_uri: input.callbackUrl,
    code_verifier: input.codeVerifier,
  });
  let tokenResponse: Response;
  try {
    tokenResponse = await fetcher("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": "cloud-memory-worker",
      },
      body: tokenBody.toString(),
      redirect: "manual",
    });
  } catch {
    throw new GitHubIdentityError("UPSTREAM_ERROR", "token_request");
  }

  if (!tokenResponse.ok) throw new GitHubIdentityError("UPSTREAM_ERROR", "token_response");
  let tokenJson: unknown;
  try {
    tokenJson = await tokenResponse.json();
  } catch {
    throw new GitHubIdentityError("UPSTREAM_ERROR", "token_response");
  }
  const token = tokenResponseSchema.safeParse(tokenJson);
  if (!token.success) throw new GitHubIdentityError("UPSTREAM_ERROR", "token_response");

  let userResponse: Response;
  try {
    userResponse = await fetcher("https://api.github.com/user", {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token.data.access_token}`,
        "user-agent": "cloud-memory-worker",
        "x-github-api-version": "2022-11-28",
      },
      redirect: "manual",
    });
  } catch {
    throw new GitHubIdentityError("UPSTREAM_ERROR", "user_request");
  }

  if (!userResponse.ok) throw new GitHubIdentityError("UPSTREAM_ERROR", "user_response");
  let userJson: unknown;
  try {
    userJson = await userResponse.json();
  } catch {
    throw new GitHubIdentityError("UPSTREAM_ERROR", "user_response");
  }
  const user = userResponseSchema.safeParse(userJson);
  if (!user.success) throw new GitHubIdentityError("UPSTREAM_ERROR", "user_response");
  if (String(user.data.id) !== input.allowedUserId) {
    throw new GitHubIdentityError("IDENTITY_DENIED");
  }

  return {
    userId: String(user.data.id),
    login: user.data.login,
    ...(user.data.avatar_url ? { avatarUrl: user.data.avatar_url } : {}),
  };
}
