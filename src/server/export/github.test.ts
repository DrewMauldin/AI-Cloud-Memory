import { describe, expect, it, vi } from "vitest";

import { pushEncryptedExport } from "./github";

describe("GitHub encrypted export adapter", () => {
  it("writes only the encrypted envelope through a separately supplied token", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return new Response(JSON.stringify({ content: { sha: "commit-sha" } }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    });
    const encrypted = JSON.stringify({ format: "cloud-memory-encrypted-jsonl", ciphertext: "opaque" });

    const result = await pushEncryptedExport({
      repository: "community-owner/ai-cloud-memory",
      path: "exports/2026-08-23/snapshot.enc.json",
      encrypted,
      token: "fine-grained-token",
      fetcher,
    });

    expect(result.commitSha).toBe("commit-sha");
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toContain("/repos/community-owner/ai-cloud-memory/contents/exports/");
    expect(init?.headers).toMatchObject({ authorization: "Bearer fine-grained-token" });
    expect(JSON.stringify(init?.body)).not.toContain("Remember this plaintext");
  });

  it("rejects repository and path values outside the narrow contract", async () => {
    await expect(
      pushEncryptedExport({
        repository: "not valid",
        path: "../secret",
        encrypted: "{}",
        token: "token",
      }),
    ).rejects.toThrow("repository");
  });
});
