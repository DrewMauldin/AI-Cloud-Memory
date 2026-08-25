import { z } from "zod";

import { parseTrueMemoryImport, sha256Text } from "../import/truememory";
import { hasSecretPattern } from "../memory/safety";

const MAX_INPUT_BYTES = 2_000_000;
const MAX_RECORDS = 500;
const memoryTypeSchema = z.enum(["preference", "decision", "fact", "episode", "procedure", "project_state", "correction"]);

const cloudMemoryRecordSchema = z.object({
  id: z.string().min(1).max(200),
  content: z.string().trim().min(1).max(12_000),
  directive: z.boolean().optional().default(false),
  namespace: z.string().min(1).max(100).optional().default("default"),
  memoryType: memoryTypeSchema.optional().default("fact"),
}).passthrough();

const markdownBundleSchema = z.object({
  files: z.array(z.object({
    path: z.string().min(1).max(500),
    content: z.string().trim().min(1).max(12_000),
  }).strict()).min(1).max(MAX_RECORDS),
}).strict();

const githubMarkdownSchema = z.object({
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  ref: z.string().min(1).max(200),
  path: z.string().min(1).max(500),
}).strict();

export type ConnectorAdapterId =
  | "cloud_memory_jsonl"
  | "truememory_jsonl"
  | "markdown_bundle"
  | "github_markdown";

export interface ConnectorRecord {
  sourceId: string;
  content: string;
  directive: boolean;
  namespace: string;
  memoryType: z.infer<typeof memoryTypeSchema>;
  sourceSystem: ConnectorAdapterId | "truememory";
  sourceUrl?: string;
}

export interface ConnectorPreview {
  adapterId: ConnectorAdapterId;
  inputSha256: string;
  previewSha256: string;
  records: ConnectorRecord[];
}

function boundedText(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (new TextEncoder().encode(text).byteLength > MAX_INPUT_BYTES) {
    throw new Error("Connector input exceeds the 2 MB request limit");
  }
  return text;
}

function assertSafePath(path: string): void {
  const segments = path.replaceAll("\\", "/").split("/");
  if (path.startsWith("/") || segments.some((segment) => segment === ".." || segment === "." || !segment)) {
    throw new Error("Connector path must be relative and cannot contain traversal segments");
  }
}

function assertSafeRecords(records: ConnectorRecord[]): void {
  if (records.length > MAX_RECORDS) throw new Error("Connector preview exceeds 500 records");
  if (records.some((record) => hasSecretPattern(record.content))) {
    throw new Error("Connector content contains secret-like material");
  }
}

async function fetchGitHubMarkdown(
  input: z.infer<typeof githubMarkdownSchema>,
  fetcher: typeof fetch,
  token?: string,
): Promise<ConnectorRecord[]> {
  assertSafePath(input.path);
  const path = input.path.split("/").map(encodeURIComponent).join("/");
  const url = new URL(`https://api.github.com/repos/${input.repository}/contents/${path}`);
  url.searchParams.set("ref", input.ref);
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Cloud-Memory",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetcher(url, { headers, redirect: "error" });
  if (!response.ok) throw new Error(`GitHub connector returned ${response.status}`);
  const payload = z.object({
    type: z.literal("file"),
    encoding: z.literal("base64"),
    content: z.string(),
    html_url: z.url(),
    sha: z.string().min(1).max(100),
  }).passthrough().parse(await response.json());
  const binary = atob(payload.content.replaceAll("\n", ""));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (new TextEncoder().encode(content).byteLength > 12_000) throw new Error("GitHub Markdown file exceeds 12 KB");
  return [{
    sourceId: payload.sha,
    content,
    directive: false,
    namespace: "markdown",
    memoryType: "fact",
    sourceSystem: "github_markdown",
    sourceUrl: payload.html_url,
  }];
}

export async function previewConnector(input: {
  adapterId: ConnectorAdapterId;
  input: unknown;
  fetcher?: typeof fetch;
  githubToken?: string;
}): Promise<ConnectorPreview> {
  const inputText = boundedText(input.input);
  let records: ConnectorRecord[];

  switch (input.adapterId) {
    case "cloud_memory_jsonl": {
      const lines = inputText.split(/\r?\n/).filter((line) => line.trim());
      if (lines.length > MAX_RECORDS) throw new Error("Connector preview exceeds 500 records");
      records = lines.map((line) => {
        const record = cloudMemoryRecordSchema.parse(JSON.parse(line));
        return { ...record, sourceId: record.id, sourceSystem: "cloud_memory_jsonl" as const };
      });
      break;
    }
    case "truememory_jsonl": {
      const parsed = await parseTrueMemoryImport(inputText);
      if (parsed.malformed.length) throw new Error("TrueMemory connector payload contains malformed records");
      records = parsed.records.map((record) => ({
        sourceId: record.sourceMemoryId,
        content: record.content,
        directive: record.directive,
        namespace: "default",
        memoryType: memoryTypeSchema.safeParse(record.category).data ?? "fact",
        sourceSystem: "truememory",
      }));
      break;
    }
    case "markdown_bundle": {
      const bundle = markdownBundleSchema.parse(input.input);
      records = bundle.files.map((file) => {
        assertSafePath(file.path);
        return {
          sourceId: file.path,
          content: file.content,
          directive: false,
          namespace: "markdown",
          memoryType: "fact",
          sourceSystem: "markdown_bundle" as const,
        };
      });
      break;
    }
    case "github_markdown":
      records = await fetchGitHubMarkdown(githubMarkdownSchema.parse(input.input), input.fetcher ?? fetch, input.githubToken);
      break;
  }

  assertSafeRecords(records);
  const previewText = JSON.stringify(records);
  return {
    adapterId: input.adapterId,
    inputSha256: await sha256Text(inputText),
    previewSha256: await sha256Text(previewText),
    records,
  };
}
