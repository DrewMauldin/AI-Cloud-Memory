import type { ActorType, TaskStatus } from "./store";

export const DEFAULT_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1_000;
export const MAX_AGENT_RUNS = 20;

const MIN_STALE_AFTER_MS = 60 * 60 * 1_000;
const MAX_STALE_AFTER_MS = 365 * 24 * 60 * 60 * 1_000;

export const ATTENTION_REASONS = [
  "blocked",
  "review",
  "overdue",
  "stale_in_progress",
  "missing_provenance",
  "agent_failed",
  "agent_awaiting_human",
] as const;

export type AttentionReason = (typeof ATTENTION_REASONS)[number];

export type AgentRunStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "awaiting_human"
  | "awaiting-human"
  | "review"
  | "blocked"
  | "cancelled";

export interface AgentRunSignal {
  status: AgentRunStatus;
}

export interface AttentionTask {
  status: TaskStatus;
  dueAt: string | null;
  archivedAt: string | null;
  updatedAt: string;
  sourceType: Exclude<ActorType, "system">;
  sourceClient: string | null;
  sourceModel: string | null;
  /** Runs are expected newest first; only the bounded prefix is inspected. */
  agentRuns?: readonly AgentRunSignal[];
}

export interface AttentionResult {
  needsMe: boolean;
  reasons: AttentionReason[];
}

export interface AttentionOptions {
  staleAfterMs?: number;
  maxAgentRuns?: number;
}

function timestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasValue(value: string | null): boolean {
  return value !== null && value.trim().length > 0;
}

function boundedStaleAfter(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_STALE_AFTER_MS;
  return Math.min(MAX_STALE_AFTER_MS, Math.max(MIN_STALE_AFTER_MS, value!));
}

function boundedRunCount(value: number | undefined): number {
  if (!Number.isFinite(value)) return MAX_AGENT_RUNS;
  return Math.max(0, Math.min(MAX_AGENT_RUNS, Math.floor(value!)));
}

export function classifyTaskAttention(
  task: AttentionTask,
  now: string,
  options: AttentionOptions = {},
): AttentionResult {
  if (task.archivedAt !== null || task.status === "done") {
    return { needsMe: false, reasons: [] };
  }

  const reasons: AttentionReason[] = [];
  const nowMs = timestamp(now);
  const dueMs = task.dueAt === null ? null : timestamp(task.dueAt);
  const updatedMs = timestamp(task.updatedAt);

  if (task.status === "blocked") reasons.push("blocked");
  if (task.status === "review") reasons.push("review");
  if (nowMs !== null && dueMs !== null && dueMs < nowMs) reasons.push("overdue");

  if (
    task.status === "in_progress" &&
    nowMs !== null &&
    updatedMs !== null &&
    updatedMs < nowMs - boundedStaleAfter(options.staleAfterMs)
  ) {
    reasons.push("stale_in_progress");
  }

  if (
    task.sourceType !== "human" &&
    (!hasValue(task.sourceClient) || !hasValue(task.sourceModel))
  ) {
    reasons.push("missing_provenance");
  }

  const runs = task.agentRuns ?? [];
  for (const run of runs.slice(0, boundedRunCount(options.maxAgentRuns))) {
    if (run.status === "failed" && !reasons.includes("agent_failed")) {
      reasons.push("agent_failed");
    }
    if (
      (run.status === "awaiting_human" || run.status === "awaiting-human") &&
      !reasons.includes("agent_awaiting_human")
    ) {
      reasons.push("agent_awaiting_human");
    }
  }

  return { needsMe: reasons.length > 0, reasons };
}
