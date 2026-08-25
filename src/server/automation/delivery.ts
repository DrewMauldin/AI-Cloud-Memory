import type { ObsidianProjectionFile } from "../projection/obsidian";

const MANIFEST_PATH = "Cloud Memory/manifest.json";
const MAX_FILES = 450;
const MAX_FILE_BYTES = 256_000;
const MAX_TOTAL_BYTES = 8_000_000;

function encodedPath(path: string): string {
  return path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function basicAuthorization(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

function targetBaseUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("WebDAV projection target must use HTTPS");
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("WebDAV projection target must not contain credentials, query or fragment");
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

export function validateProjectionDelivery(files: ObsidianProjectionFile[]): {
  fileCount: number;
  manifestIndex: number;
} {
  if (files.length < 2 || files.length > MAX_FILES) {
    throw new Error("Projection file count is outside the managed bound");
  }
  const paths = new Set<string>();
  let totalBytes = 0;
  for (const file of files) {
    if (!file.path.startsWith("Cloud Memory/") || file.path.includes("..") || file.path.includes("\\")) {
      throw new Error("Projection path escaped the managed Cloud Memory folder");
    }
    const normalised = file.path.toLocaleLowerCase();
    if (paths.has(normalised)) throw new Error("Projection contains duplicate managed paths");
    paths.add(normalised);
    const bytes = new TextEncoder().encode(file.content).byteLength;
    if (bytes > MAX_FILE_BYTES) throw new Error("Projection file exceeds the delivery byte bound");
    totalBytes += bytes;
  }
  if (totalBytes > MAX_TOTAL_BYTES) throw new Error("Projection exceeds the aggregate delivery byte bound");
  const manifestIndex = files.findIndex((file) => file.path === MANIFEST_PATH);
  if (manifestIndex !== files.length - 1) throw new Error("Projection manifest must be written last");
  return { fileCount: files.length, manifestIndex };
}

async function putFile(input: {
  baseUrl: URL;
  authorization: string;
  file: ObsidianProjectionFile;
  fetcher: typeof fetch;
}): Promise<void> {
  const url = new URL(encodedPath(input.file.path), input.baseUrl);
  const response = await input.fetcher(url, {
    method: "PUT",
    redirect: "error",
    headers: {
      authorization: input.authorization,
      "content-type": input.file.path.endsWith(".json")
        ? "application/json; charset=utf-8"
        : "text/markdown; charset=utf-8",
      "x-cloud-memory-sha256": input.file.sha256,
    },
    body: input.file.content,
  });
  if (!response.ok) throw new Error(`WebDAV projection failed (${response.status})`);
}

export async function deliverWebDavProjection(input: {
  baseUrl: string;
  username: string;
  password: string;
  files: ObsidianProjectionFile[];
  concurrency?: number;
  fetcher?: typeof fetch;
}): Promise<{ fileCount: number; manifestPath: string }> {
  validateProjectionDelivery(input.files);
  if (!input.username || !input.password) throw new Error("WebDAV projection credentials are not configured");
  const baseUrl = targetBaseUrl(input.baseUrl);
  const authorization = basicAuthorization(input.username, input.password);
  const fetcher = input.fetcher ?? fetch;
  const concurrency = Math.max(1, Math.min(Math.floor(input.concurrency ?? 4), 8));
  const contentFiles = input.files.slice(0, -1);
  for (let offset = 0; offset < contentFiles.length; offset += concurrency) {
    await Promise.all(contentFiles.slice(offset, offset + concurrency).map((file) =>
      putFile({ baseUrl, authorization, file, fetcher })));
  }
  await putFile({ baseUrl, authorization, file: input.files.at(-1)!, fetcher });
  return { fileCount: input.files.length, manifestPath: MANIFEST_PATH };
}
