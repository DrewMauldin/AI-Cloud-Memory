import { describe, expect, it, vi } from "vitest";

import { deliverWebDavProjection, validateProjectionDelivery } from "./delivery";

const files = [
  { path: "Cloud Memory/Projects/Cloud Memory.md", content: "# Project\n", sha256: "a".repeat(64) },
  { path: "Cloud Memory/README.md", content: "# Cloud Memory\n", sha256: "b".repeat(64) },
  { path: "Cloud Memory/manifest.json", content: "{}\n", sha256: "c".repeat(64) },
];

describe("native projection delivery", () => {
  it("requires one exact final manifest inside the managed folder", () => {
    expect(validateProjectionDelivery(files)).toEqual({ fileCount: 3, manifestIndex: 2 });
    expect(() => validateProjectionDelivery([...files].reverse())).toThrow("manifest must be written last");
    expect(() => validateProjectionDelivery([
      ...files.slice(0, -1),
      { ...files.at(-1)!, path: "../manifest.json" },
    ])).toThrow("managed Cloud Memory folder");
  });

  it("writes content in bounded batches and commits the manifest last without redirects", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(null, { status: 204 });
    });

    const result = await deliverWebDavProjection({
      baseUrl: "https://dav.example.com/vault/",
      username: "cloud-memory-owner",
      password: "not-a-real-secret",
      files,
      fetcher: fetcher as typeof fetch,
      concurrency: 2,
    });

    expect(result).toMatchObject({ fileCount: 3, manifestPath: "Cloud Memory/manifest.json" });
    expect(calls.at(-1)?.url).toBe("https://dav.example.com/vault/Cloud%20Memory/manifest.json");
    expect(calls.every((call) => call.init.method === "PUT" && call.init.redirect === "error")).toBe(true);
    expect(calls.every((call) => String(new Headers(call.init.headers).get("authorization")).startsWith("Basic "))).toBe(true);
  });

  it("rejects unsafe targets and fails before committing the manifest", async () => {
    await expect(deliverWebDavProjection({
      baseUrl: "http://127.0.0.1/Obsidian/",
      username: "owner",
      password: "secret",
      files,
      fetcher: vi.fn() as typeof fetch,
    })).rejects.toThrow("HTTPS");

    const fetcher = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("README")
        ? new Response(null, { status: 503 })
        : new Response(null, { status: 204 }));
    await expect(deliverWebDavProjection({
      baseUrl: "https://dav.example.com/vault/",
      username: "owner",
      password: "secret",
      files,
      fetcher: fetcher as typeof fetch,
    })).rejects.toThrow("WebDAV projection failed (503)");
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith("manifest.json"))).toBe(false);
  });
});
