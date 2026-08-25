import {
  type ProjectionRoadmap,
  ROADMAPS_BASE,
  renderProjectRoadmapSection,
  renderRoadmapSummary,
  roadmapMetrics,
  roadmapSort,
} from "./roadmaps";

type ProjectionSensitivity = "normal" | "private" | "sensitive";

interface ProjectionProject {
  id: string;
  name: string;
  description: string | null;
  colour: string;
  status: string;
  archivedAt?: string | null;
  sourceUrl?: string | null;
  updatedAt: string;
  version?: number;
}

interface ProjectionTask {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  sourceType: string;
  sourceClient: string | null;
  sourceModel: string | null;
  sourceUrl: string | null;
  updatedAt: string;
  dueAt?: string | null;
  blockerSummary?: string | null;
  archivedAt?: string | null;
  version?: number;
  position?: number;
}

export interface ProjectionMemory {
  id: string;
  kind: "memory" | "directive";
  content: string;
  summary?: string | null;
  memoryNumber?: number;
  namespace?: string | null;
  memoryType?: string | null;
  status: string;
  importance?: number;
  confidence?: number;
  sensitivity?: ProjectionSensitivity;
  sourceSystem?: string | null;
  sourceId?: string | null;
  sourceUrl?: string | null;
  sourceClient?: string | null;
  sourceModel?: string | null;
  createdAt?: string;
  updatedAt: string;
  validFrom?: string | null;
  validUntil?: string | null;
  labels?: string[];
  archivedAt?: string | null;
  purgedAt?: string | null;
  version?: number;
}

export interface ProjectionReviewItem {
  id: string;
  type?: string;
  reviewType?: string;
  title?: string;
  summary?: string | null;
  candidateContent?: string | null;
  candidateNamespace?: string | null;
  candidateKind?: string | null;
  matchedMemoryId?: string | null;
  similarity?: number | null;
  category?: string;
  reason?: string | null;
  memoryId?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  status?: string;
  sensitivity?: ProjectionSensitivity;
  contentPolicy?: "canonical" | "derived-safe";
  sourceUrl?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProjectionAgentRun {
  id: string;
  taskId?: string | null;
  projectId?: string | null;
  conversationId?: string | null;
  correlationId?: string | null;
  actorType?: string | null;
  status?: string | null;
  client?: string | null;
  model?: string | null;
  summary?: string | null;
  receipt?: string | null;
  sourceUrl?: string | null;
  sensitivity?: ProjectionSensitivity;
  startedAt?: string | null;
  heartbeatAt?: string | null;
  finishedAt?: string | null;
  outcome?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProjectionHealth {
  status?: string;
  service?: string;
  version?: string;
  environment?: string;
  vectorIndex?: {
    state?: string;
    indexed?: number;
    pending?: number;
    failed?: number;
  };
  vector_index?: {
    state?: string;
    indexed?: number;
    pending?: number;
    failed?: number;
  };
}

export interface ProjectionCapabilityReceipt {
  capability: string;
  status: string;
  detail: string;
  evidenceSha256?: string | null;
  source?: string | null;
  checkedAt?: string | null;
}

export interface ProjectionProfileFacet {
  facetType: string; content: string; summary?: string | null; sensitivity: ProjectionSensitivity;
  enabled: boolean; archivedAt?: string | null; updatedAt: string; version: number;
}

export interface ProjectionContextPack {
  id: string; name: string; description?: string | null; scopeType: string; scopeId?: string | null;
  facetTypes: string[]; memoryIds: string[]; query?: string | null; memoryLimit: number; directiveLimit: number;
  enabled: boolean; archivedAt?: string | null; updatedAt: string; version: number;
}

export interface ProjectionReflectionProposal {
  id: string; proposalType: string; primaryMemoryId: string; relatedMemoryIds: string[];
  suggestedAction: string; impact: string; status: string; updatedAt: string;
}

export interface ProjectionOperationalRun {
  id: string; status: string; createdAt?: string; startedAt?: string; completedAt?: string | null;
  adapterId?: string; operation?: string; itemCount?: number; examinedCount?: number;
  importedCount?: number; duplicateCount?: number; rejectedCount?: number;
}

export interface ProjectionClientReceipt {
  clientId: string; configuredStatus: string; authenticatedStatus: string; verifiedStatus: string;
  discoveredToolCount?: number | null; expectedToolCount: number; evidence?: string | null; checkedAt: string;
}

export interface ObsidianProjectionFile {
  path: string;
  content: string;
  sha256: string;
}

const MAX_PROJECTED_ITEMS = 100;
const MAX_PROJECTION_FILES = 450;
const DETAIL_LIMITS = {
  projects: 60,
  tasks: 90,
  memories: 90,
  directives: 50,
  archivedProjects: 35,
  archivedTasks: 35,
  archivedMemories: 40,
  archivedDirectives: 20,
  agentRuns: 13,
} as const;
const MAX_EXCERPT_CHARS = 320;
const STATUS_HEADINGS: ReadonlyArray<[string, string]> = [
  ["inbox", "Inbox"],
  ["planned", "Planned"],
  ["in_progress", "In progress"],
  ["blocked", "Blocked"],
  ["review", "Review"],
  ["done", "Done"],
];

function safeFileName(value: string): string {
  return value
    .replaceAll(/[\\/:*?"<>|]/g, " - ")
    .replaceAll(/\s+/g, " ")
    .replace(/^\.+|\.+$/g, "")
    .trim()
    .slice(0, 120) || "Untitled";
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function boundedText(value: string, limit = MAX_EXCERPT_CHARS): string {
  const normalized = value.replaceAll("\n", " ").replaceAll("\r", " ").trim();
  const characters = Array.from(normalized);
  return characters.length > limit
    ? `${characters.slice(0, limit).join("")}…`
    : normalized;
}

function markdownText(value: string, limit = MAX_EXCERPT_CHARS): string {
  return boundedText(value, limit).replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString().replaceAll(")", "%29");
  } catch {
    return null;
  }
}

function sensitivityOf(record: { sensitivity?: ProjectionSensitivity }): ProjectionSensitivity {
  return record.sensitivity ?? "normal";
}

function projectable(record: { sensitivity?: ProjectionSensitivity }): boolean {
  return sensitivityOf(record) !== "sensitive";
}

function memoryDisplayText(memory: ProjectionMemory): string {
  return memory.summary?.trim() || memory.content;
}

function healthVector(health: ProjectionHealth | undefined): ProjectionHealth["vectorIndex"] {
  return health?.vectorIndex ?? health?.vector_index;
}

function boundedCount(value: number | undefined): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? Math.min(Math.floor(value as number), 1_000_000) : 0;
}

function uniquePath(
  folder: string,
  preferred: string,
  id: string,
  used: Set<string>,
): string {
  const base = safeFileName(preferred);
  let fileName = base;
  let suffix = 0;
  while (used.has(fileName.toLocaleLowerCase())) {
    suffix += 1;
    fileName = `${base} - ${safeFileName(id).slice(0, 24)}${suffix > 1 ? `-${suffix}` : ""}`;
  }
  used.add(fileName.toLocaleLowerCase());
  return `${folder}/${fileName}.md`;
}

function taskSort(left: ProjectionTask, right: ProjectionTask): number {
  return (right.updatedAt || "").localeCompare(left.updatedAt || "") || left.id.localeCompare(right.id);
}

function memorySort(left: ProjectionMemory, right: ProjectionMemory): number {
  return (right.importance ?? 0) - (left.importance ?? 0)
    || (right.updatedAt || "").localeCompare(left.updatedAt || "")
    || left.id.localeCompare(right.id);
}

function reviewSort(left: ProjectionReviewItem, right: ProjectionReviewItem): number {
  return (right.updatedAt || "").localeCompare(left.updatedAt || "") || left.id.localeCompare(right.id);
}

function runSort(left: ProjectionAgentRun, right: ProjectionAgentRun): number {
  return (right.updatedAt || "").localeCompare(left.updatedAt || "") || left.id.localeCompare(right.id);
}

function sourceLink(url: string | null | undefined, label = "open source"): string {
  const safe = safeUrl(url);
  return safe ? ` · [${label}](${safe})` : "";
}

function projectNote(project: ProjectionProject, tasks: ProjectionTask[], roadmaps: ProjectionRoadmap[]): string {
  const roadmap = roadmapMetrics(roadmaps);
  const lines = [
    "---",
    `title: ${yamlString(boundedText(project.name, 120))}`,
    `cloud_memory_id: ${yamlString(project.id)}`,
    `record_type: "project"`,
    `status: ${yamlString(project.status)}`,
    ...(project.archivedAt ? [`archived_at: ${yamlString(project.archivedAt)}`] : []),
    `colour: ${yamlString(project.colour)}`,
    `updated: ${yamlString(project.updatedAt)}`,
    `version: ${project.version ?? 1}`,
    `task_count: ${tasks.length}`,
    `roadmap_count: ${roadmap.active}`,
    `roadmap_next_count: ${roadmap.next}`,
    "cloud_memory_managed: true",
    "managed: true",
    "tags:",
    "  - cloud-memory/project",
    `  - cloud-memory/${project.status}`,
    "---",
    "",
    `# ${boundedText(project.name, 120)}`,
    "",
    "> [!warning] Managed Cloud Memory projection",
    "> This note is generated from D1 and will be replaced by the managed projection. Edit the project in Cloud Memory, not here.",
    "",
  ];
  if (project.description) lines.push(markdownText(project.description), "");

  for (const [status, heading] of STATUS_HEADINGS) {
    lines.push(`## ${heading}`, "");
    const statusTasks = tasks.filter((task) => task.status === status).sort(taskSort);
    if (!statusTasks.length) {
      lines.push("_No tasks._", "");
      continue;
    }
    for (const task of statusTasks) {
      const checked = task.status === "done" ? "x" : " ";
      const provenance = [task.sourceModel ?? task.sourceType, task.sourceClient ? `via ${task.sourceClient}` : null]
        .filter(Boolean)
        .join(" ");
      lines.push(`- [${checked}] **${markdownText(task.title, 240)}** · ${task.priority} · ${provenance}${sourceLink(task.sourceUrl, "open chat")}`);
      if (task.description) lines.push(`  - ${markdownText(task.description)}`);
      lines.push(`  ^cm-task-${task.id.replaceAll(/[^A-Za-z0-9-]/g, "-")}`, "");
    }
  }
  lines.push(...renderProjectRoadmapSection(roadmaps));
  return `${lines.join("\n")}\n`;
}

function taskNote(task: ProjectionTask, project: ProjectionProject | undefined, projectPath?: string): string {
  const lines = [
    "---",
    `cloud_memory_id: ${yamlString(task.id)}`,
    `record_type: "task"`,
    `project_id: ${yamlString(task.projectId)}`,
    `project: ${yamlString(project?.name ?? "Unknown project")}`,
    `title: ${yamlString(boundedText(task.title, 240))}`,
    `status: ${yamlString(task.status)}`,
    `priority: ${yamlString(task.priority)}`,
    `updated: ${yamlString(task.updatedAt)}`,
    `version: ${task.version ?? 1}`,
    ...(task.dueAt ? [`due_at: ${yamlString(task.dueAt)}`] : []),
    ...(task.archivedAt ? [`archived_at: ${yamlString(task.archivedAt)}`] : []),
    "cloud_memory_managed: true",
    "managed: true",
    "tags:",
    "  - cloud-memory/task",
    `  - cloud-memory/task-${task.status}`,
    ...(task.archivedAt ? ["  - cloud-memory/archived"] : []),
    "---",
    "",
    `# ${boundedText(task.title, 240)}`,
    "",
    "> [!warning] Managed Cloud Memory projection",
    "> Edit this task in Cloud Memory. Changes here will be replaced by the managed projection.",
    "",
    `- Project: ${project && projectPath ? `[[${projectPath.slice(0, -3)}|${markdownText(project.name, 120)}]]` : "Unknown project"}`,
    `- Status: ${task.status}`,
    `- Priority: ${task.priority}`,
    `- Provenance: ${task.sourceModel ?? task.sourceType}${task.sourceClient ? ` via ${task.sourceClient}` : ""}${sourceLink(task.sourceUrl) || ""}`,
  ];
  if (task.description) lines.push(`- Description: ${markdownText(task.description)}`);
  if (task.blockerSummary) lines.push(`- Blocker: ${markdownText(task.blockerSummary)}`);
  return `${lines.join("\n")}\n`;
}

function memoryFrontmatter(memory: ProjectionMemory): string[] {
  return [
    "---",
    `cloud_memory_id: ${yamlString(memory.id)}`,
    `record_type: ${yamlString(memory.kind)}`,
    `kind: ${yamlString(memory.kind)}`,
    ...(memory.memoryType ? [`memory_type: ${yamlString(memory.memoryType)}`] : []),
    `namespace: ${yamlString(memory.namespace ?? "default")}`,
    `status: ${yamlString(memory.status)}`,
    `labels: ${JSON.stringify((memory.labels ?? []).slice().sort())}`,
    `importance: ${memory.importance ?? 0}`,
    `confidence: ${memory.confidence ?? 0}`,
    `sensitivity: ${yamlString(sensitivityOf(memory))}`,
    ...(memory.sourceSystem ? [`source_system: ${yamlString(memory.sourceSystem)}`] : []),
    ...(memory.sourceId ? [`source_id: ${yamlString(memory.sourceId)}`] : []),
    ...(memory.sourceClient ? [`source_client: ${yamlString(memory.sourceClient)}`] : []),
    ...(memory.sourceModel ? [`source_model: ${yamlString(memory.sourceModel)}`] : []),
    ...(safeUrl(memory.sourceUrl) ? [`source_url: ${yamlString(safeUrl(memory.sourceUrl) as string)}`] : []),
    ...(memory.validFrom ? [`valid_from: ${yamlString(memory.validFrom)}`] : []),
    ...(memory.validUntil ? [`valid_until: ${yamlString(memory.validUntil)}`] : []),
    ...(memory.archivedAt ? [`archived_at: ${yamlString(memory.archivedAt)}`] : []),
    ...(memory.purgedAt ? [`purged_at: ${yamlString(memory.purgedAt)}`] : []),
    `updated: ${yamlString(memory.updatedAt)}`,
    `version: ${memory.version ?? 1}`,
    "cloud_memory_managed: true",
    "managed: true",
    "tags:",
    "  - cloud-memory/memory",
    `  - cloud-memory/${memory.kind}`,
    `  - cloud-memory/${memory.status}`,
    "---",
    "",
  ];
}

function memoryNote(memory: ProjectionMemory): string {
  const lines = memoryFrontmatter(memory);
  lines.push(`# ${memory.kind === "directive" ? "Directive" : "Memory"} ${memory.id}`, "");
  if (sensitivityOf(memory) === "private") {
    lines.push("> Private content omitted from the managed projection.", "");
  } else {
    lines.push(markdownText(memoryDisplayText(memory)), "");
    if (memory.sourceUrl) lines.push(`Source${sourceLink(memory.sourceUrl)}`, "");
  }
  return `${lines.join("\n")}\n`;
}

function reviewItemLines(item: ProjectionReviewItem): string[] {
  const type = item.type ?? item.reviewType ?? item.category ?? "review";
  const title = item.title ?? item.candidateContent ?? "Review item";
  const summary = item.summary ?? item.reason;
  const lines = [`- **${type}** · ${item.id} · ${item.status ?? "open"}`];
  if (item.candidateKind) lines.push(`  - Kind: ${markdownText(item.candidateKind, 80)}`);
  if (item.matchedMemoryId) lines.push(`  - Matched memory: ${markdownText(item.matchedMemoryId, 120)}`);
  if (item.similarity !== null && item.similarity !== undefined) lines.push(`  - Similarity: ${item.similarity}`);
  const contentIsProjectable = item.sensitivity === "normal" || item.contentPolicy === "derived-safe";
  if (!contentIsProjectable) {
    lines.push("  - Review content omitted because sensitivity is not canonical.");
  } else {
    lines.push(`  - ${markdownText(title, 240)}${summary ? `: ${markdownText(summary)}` : ""}${sourceLink(item.sourceUrl)}`);
  }
  if (!contentIsProjectable && item.sourceUrl) lines.push(`  - Provenance${sourceLink(item.sourceUrl)}`);
  return lines;
}

function agentRunNote(run: ProjectionAgentRun): string {
  const lines = [
    "---",
    `agent_run_id: ${yamlString(run.id)}`,
    ...(run.taskId ? [`task_id: ${yamlString(run.taskId)}`] : []),
    ...(run.projectId ? [`project_id: ${yamlString(run.projectId)}`] : []),
    ...(run.conversationId ? [`conversation_id: ${yamlString(run.conversationId)}`] : []),
    ...(run.actorType ? [`actor_type: ${yamlString(run.actorType)}`] : []),
    ...(run.status ? [`status: ${yamlString(run.status)}`] : []),
    ...(run.client ? [`client: ${yamlString(run.client)}`] : []),
    ...(run.model ? [`model: ${yamlString(run.model)}`] : []),
    ...(run.correlationId ? [`correlation_id: ${yamlString(run.correlationId)}`] : []),
    ...(run.outcome ? [`outcome: ${yamlString(run.outcome)}`] : []),
    ...(run.startedAt ? [`started_at: ${yamlString(run.startedAt)}`] : []),
    ...(run.heartbeatAt ? [`heartbeat_at: ${yamlString(run.heartbeatAt)}`] : []),
    ...(run.finishedAt ? [`finished_at: ${yamlString(run.finishedAt)}`] : []),
    ...(run.createdAt ? [`created_at: ${yamlString(run.createdAt)}`] : []),
    ...(run.updatedAt ? [`updated: ${yamlString(run.updatedAt)}`] : []),
    `sensitivity: ${yamlString(run.sensitivity ?? "unknown")}`,
    "managed: true",
    "tags:",
    "  - cloud-memory/agent-run",
    "---",
    "",
    `# Agent run ${run.id}`,
    "",
  ];
  if (run.sourceUrl) lines.push(`- Provenance${sourceLink(run.sourceUrl)}`, "");
  if (sensitivityOf(run) === "private") {
    lines.push("> Private run content omitted from the managed projection.");
  } else if (run.sensitivity === "normal" && (run.summary || run.receipt)) {
    lines.push(markdownText(run.summary ?? run.receipt ?? ""));
  } else if (run.summary || run.receipt) {
    lines.push("> Run content omitted because sensitivity is not canonical.");
  }
  return `${lines.join("\n")}\n`;
}

const PROJECTS_BASE = `filters:
  and:
    - 'file.inFolder("Cloud Memory/Projects")'
    - 'file.ext == "md"'
    - 'managed == true'
formulas:
  active_tasks: 'if(task_count, task_count, 0)'
properties:
  status:
    displayName: "Status"
  formula.active_tasks:
    displayName: "Tasks"
  updated:
    displayName: "Last changed"
views:
  - type: cards
    name: "Project gallery"
    order:
      - file.name
      - status
      - formula.active_tasks
      - updated
  - type: table
    name: "Project register"
    order:
      - file.name
      - status
      - formula.active_tasks
      - updated
    groupBy:
      property: status
      direction: ASC
`;

const TASKS_BASE = `filters:
  and:
    - 'file.inFolder("Cloud Memory/Tasks")'
    - 'file.ext == "md"'
    - 'managed == true'
properties:
  project:
    displayName: "Project"
  status:
    displayName: "Status"
  priority:
    displayName: "Priority"
  due_at:
    displayName: "Due"
  updated:
    displayName: "Last changed"
views:
  - type: table
    name: "Task register"
    order:
      - file.name
      - project
      - status
      - priority
      - due_at
      - updated
    groupBy:
      property: status
      direction: ASC
`;

const MEMORIES_BASE = `filters:
  and:
    - 'file.inFolder("Cloud Memory/Memories")'
    - 'file.ext == "md"'
    - 'managed == true'
    - 'sensitivity != "sensitive"'
properties:
  namespace:
    displayName: "Namespace"
  status:
    displayName: "Status"
  importance:
    displayName: "Importance"
  confidence:
    displayName: "Confidence"
  sensitivity:
    displayName: "Sensitivity"
  updated:
    displayName: "Last changed"
views:
  - type: table
    name: "Memory register"
    order:
      - file.name
      - namespace
      - status
      - importance
      - confidence
      - sensitivity
      - updated
`;

const DIRECTIVES_BASE = `filters:
  and:
    - 'file.inFolder("Cloud Memory/Directives")'
    - 'file.ext == "md"'
    - 'cloud_memory_managed == true'
    - 'record_type == "directive"'
properties:
  labels:
    displayName: "Labels"
  importance:
    displayName: "Importance"
  source_model:
    displayName: "Model"
  source_client:
    displayName: "Client"
  updated:
    displayName: "Last changed"
views:
  - type: table
    name: "Active directives"
    order:
      - file.name
      - labels
      - importance
      - source_model
      - source_client
      - updated
`;

const ARCHIVE_BASE = `filters:
  and:
    - 'file.inFolder("Cloud Memory/Archive")'
    - 'file.ext == "md"'
    - 'cloud_memory_managed == true'
    - 'record_type != "archive_index"'
formulas:
  archive_age_days: 'if(archived_at, (now() - date(archived_at)).days.round(0), "")'
properties:
  record_type:
    displayName: "Type"
  status:
    displayName: "Status"
  labels:
    displayName: "Labels"
  archived_at:
    displayName: "Archived"
  formula.archive_age_days:
    displayName: "Days archived"
views:
  - type: table
    name: "Archive register"
    order:
      - file.name
      - record_type
      - status
      - labels
      - archived_at
      - formula.archive_age_days
    groupBy:
      property: record_type
      direction: ASC
  - type: cards
    name: "Archive gallery"
    order:
      - file.name
      - record_type
      - archived_at
`;

const AGENT_RUNS_BASE = `filters:
  and:
    - 'file.inFolder("Cloud Memory/Agent Runs")'
    - 'file.ext == "md"'
    - 'managed == true'
properties:
  task_id:
    displayName: "Task"
  status:
    displayName: "Status"
  client:
    displayName: "Client"
  model:
    displayName: "Model"
  updated:
    displayName: "Last changed"
views:
  - type: table
    name: "Agent run register"
    order:
      - file.name
      - task_id
      - status
      - client
      - model
      - updated
`;

function summaryLines(title: string, items: string[], omitted = 0): string {
  const omission = omitted > 0 ? `\n_${omitted} detail files omitted by the projection budget._\n` : "";
  return `# ${title}\n\n> [!warning] Managed Cloud Memory projection\n> This note is generated from D1 and will be replaced by the managed projection.\n\n${items.length ? `${items.join("\n")}\n` : "_No records._\n"}${omission}`;
}

function healthLines(health: ProjectionHealth | undefined, generatedAt: string): string[] {
  const vector = healthVector(health);
  return [
    "## Live health receipt",
    "",
    `- Checked at: ${generatedAt}`,
    `- Status: ${boundedText(health?.status ?? "not supplied", 120)}`,
    `- Service: ${boundedText(health?.service ?? "not supplied", 120)}`,
    `- Version: ${boundedText(health?.version ?? "not supplied", 120)}`,
    `- Environment: ${boundedText(health?.environment ?? "not supplied", 120)}`,
    ...(vector ? [
      `- Vector index: ${vector.state ?? "unknown"}`,
      `- Vector counts: indexed ${boundedCount(vector.indexed)}, pending ${boundedCount(vector.pending)}, failed ${boundedCount(vector.failed)}`,
    ] : []),
    "",
  ];
}

function systemStatusLines(
  health: ProjectionHealth | undefined,
  capabilityReceipts: ProjectionCapabilityReceipt[],
): string[] {
  const vector = healthVector(health);
  const lines = [
    "# System Status",
    "",
    "> [!warning] Managed Cloud Memory projection",
    "> This page is a bounded D1 status receipt. D1 remains canonical; it is not a deployment or delivery canary claim.",
    "",
    `- Status: ${boundedText(health?.status ?? "not supplied", 120)}`,
    `- Service: ${boundedText(health?.service ?? "not supplied", 120)}`,
    `- Version: ${boundedText(health?.version ?? "not supplied", 120)}`,
    `- Environment: ${boundedText(health?.environment ?? "not supplied", 120)}`,
    `- Vector index: ${boundedText(vector?.state ?? "not supplied", 120)}`,
    ...(vector ? [
      `- Vector counts: indexed ${boundedCount(vector.indexed)}, pending ${boundedCount(vector.pending)}, failed ${boundedCount(vector.failed)}`,
    ] : []),
    "",
    "## Capability receipts",
    "",
  ];
  if (!capabilityReceipts.length) {
    lines.push("_No capability receipts supplied by the projection source._", "");
    return lines;
  }
  for (const receipt of capabilityReceipts.slice(0, MAX_PROJECTED_ITEMS)) {
    const evidence = receipt.evidenceSha256 && /^[a-f0-9]{64}$/iu.test(receipt.evidenceSha256)
      ? ` · evidence ${receipt.evidenceSha256}`
      : "";
    const checked = receipt.checkedAt ? ` · checked ${boundedText(receipt.checkedAt, 80)}` : "";
    const source = receipt.source ? ` · source ${boundedText(receipt.source, 100)}` : "";
    lines.push(`- **${markdownText(receipt.capability, 100)}** · ${markdownText(receipt.status, 80)} · ${markdownText(receipt.detail, 320)}${source}${checked}${evidence}`);
  }
  lines.push("");
  return lines;
}

async function contentSha256(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const buffer = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function renderObsidianProjection(input: {
  generatedAt: string;
  projects: ProjectionProject[];
  tasks: ProjectionTask[];
  memories?: ProjectionMemory[];
  directives?: ProjectionMemory[];
  archivedProjects?: ProjectionProject[];
  archivedTasks?: ProjectionTask[];
  archivedMemories?: ProjectionMemory[];
  archivedDirectives?: ProjectionMemory[];
  roadmaps?: ProjectionRoadmap[];
  reviewItems?: ProjectionReviewItem[];
  agentRuns?: ProjectionAgentRun[];
  health?: ProjectionHealth;
  capabilityReceipts?: ProjectionCapabilityReceipt[];
  profileFacets?: ProjectionProfileFacet[];
  contextPacks?: ProjectionContextPack[];
  reflectionProposals?: ProjectionReflectionProposal[];
  automationRuns?: ProjectionOperationalRun[];
  connectorRuns?: ProjectionOperationalRun[];
  clientReceipts?: ProjectionClientReceipt[];
}): Promise<ObsidianProjectionFile[]> {
  const availableProjects = input.projects.slice().sort((left, right) =>
    left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  const availableTasks = input.tasks
    .filter((task) => !task.archivedAt)
    .sort(taskSort);
  const availableMemories = (input.memories ?? []).filter(projectable).sort(memorySort);
  const availableDirectives = (input.directives ?? input.memories?.filter((memory) => memory.kind === "directive") ?? [])
    .filter(projectable).sort(memorySort);
  const availableArchivedProjects = (input.archivedProjects ?? []).slice().sort((left, right) =>
    (right.archivedAt ?? right.updatedAt).localeCompare(left.archivedAt ?? left.updatedAt) || left.id.localeCompare(right.id));
  const availableArchivedTasks = (input.archivedTasks ?? []).slice().sort(taskSort);
  const availableArchivedMemories = (input.archivedMemories ?? []).filter(projectable).sort(memorySort);
  const availableArchivedDirectives = (input.archivedDirectives ?? []).filter(projectable).sort(memorySort);
  const availableAgentRuns = (input.agentRuns ?? []).filter(projectable).sort(runSort);
  const availableRoadmaps = (input.roadmaps ?? []).slice().sort(roadmapSort);
  const projects = availableProjects.slice(0, DETAIL_LIMITS.projects);
  const tasks = availableTasks.slice(0, DETAIL_LIMITS.tasks);
  const memories = availableMemories.slice(0, DETAIL_LIMITS.memories);
  const directives = availableDirectives.slice(0, DETAIL_LIMITS.directives);
  const archivedProjects = availableArchivedProjects.slice(0, DETAIL_LIMITS.archivedProjects);
  const archivedTasks = availableArchivedTasks.slice(0, DETAIL_LIMITS.archivedTasks);
  const archivedMemories = availableArchivedMemories.slice(0, DETAIL_LIMITS.archivedMemories);
  const archivedDirectives = availableArchivedDirectives.slice(0, DETAIL_LIMITS.archivedDirectives);
  const agentRuns = availableAgentRuns.slice(0, DETAIL_LIMITS.agentRuns);
  const roadmaps = availableRoadmaps.slice(0, MAX_PROJECTED_ITEMS);
  const omittedDetail = availableProjects.length - projects.length
    + availableTasks.length - tasks.length
    + availableMemories.length - memories.length
    + availableDirectives.length - directives.length
    + availableArchivedProjects.length - archivedProjects.length
    + availableArchivedTasks.length - archivedTasks.length
    + availableArchivedMemories.length - archivedMemories.length
    + availableArchivedDirectives.length - archivedDirectives.length
    + availableAgentRuns.length - agentRuns.length;
  const reviewItems = (input.reviewItems ?? []).filter(projectable).sort(reviewSort).slice(0, MAX_PROJECTED_ITEMS);
  const capabilityReceipts = (input.capabilityReceipts ?? []).slice().sort((left, right) =>
    (right.checkedAt ?? "").localeCompare(left.checkedAt ?? "") || left.capability.localeCompare(right.capability)).slice(0, MAX_PROJECTED_ITEMS);
  const profileFacets = (input.profileFacets ?? []).filter((facet) => !facet.archivedAt).slice(0, 6);
  const contextPacks = (input.contextPacks ?? []).filter((pack) => !pack.archivedAt).slice(0, 50);
  const reflectionProposals = (input.reflectionProposals ?? []).slice(0, 100);
  const automationRuns = (input.automationRuns ?? []).slice(0, 50);
  const connectorRuns = (input.connectorRuns ?? []).slice(0, 50);
  const clientReceipts = (input.clientReceipts ?? []).slice(0, 10);
  const rawFiles: Array<{ path: string; content: string }> = [];
  const add = (path: string, content: string) => rawFiles.push({ path, content });

  const projectPaths = new Map<string, string>();
  const projectNames = new Set<string>();
  for (const project of projects) {
    const path = uniquePath("Cloud Memory/Projects", project.name, project.id, projectNames);
    projectPaths.set(project.id, path);
    add(path, projectNote(
      project,
      tasks.filter((task) => task.projectId === project.id),
      roadmaps.filter((item) => item.projectId === project.id),
    ));
  }

  const taskNames = new Set<string>();
  for (const task of tasks) {
    add(uniquePath("Cloud Memory/Tasks", task.id, task.id, taskNames), taskNote(
      task,
      projects.find((project) => project.id === task.projectId),
      projectPaths.get(task.projectId),
    ));
  }

  const memoryNames = new Set<string>();
  for (const memory of memories.filter((record) => record.kind === "memory")) {
    add(uniquePath("Cloud Memory/Memories", memory.id, memory.id, memoryNames), memoryNote(memory));
  }

  const directiveNames = new Set<string>();
  for (const directive of directives) {
    add(uniquePath("Cloud Memory/Directives", directive.id, directive.id, directiveNames), memoryNote(directive));
  }

  const archiveProjectPaths = new Map<string, string>();
  const archiveProjectNames = new Set<string>();
  for (const project of archivedProjects) {
    const path = uniquePath("Cloud Memory/Archive/Projects", project.name, project.id, archiveProjectNames);
    archiveProjectPaths.set(project.id, path);
    add(path, projectNote(
      project,
      archivedTasks.filter((task) => task.projectId === project.id),
      roadmaps.filter((item) => item.projectId === project.id),
    ));
  }

  const archiveTaskNames = new Set<string>();
  const allProjects = [...projects, ...archivedProjects];
  const allProjectPaths = new Map([...projectPaths, ...archiveProjectPaths]);
  for (const task of archivedTasks) {
    const project = allProjects.find((candidate) => candidate.id === task.projectId);
    const projectedTask = task.archivedAt ? task : { ...task, archivedAt: project?.archivedAt ?? task.updatedAt };
    add(uniquePath("Cloud Memory/Archive/Tasks", task.id, task.id, archiveTaskNames), taskNote(
      projectedTask,
      project,
      allProjectPaths.get(task.projectId),
    ));
  }

  const archiveMemoryNames = new Set<string>();
  for (const memory of archivedMemories) {
    add(uniquePath("Cloud Memory/Archive/Memories", memory.id, memory.id, archiveMemoryNames), memoryNote(memory));
  }

  const archiveDirectiveNames = new Set<string>();
  for (const directive of archivedDirectives) {
    add(uniquePath("Cloud Memory/Archive/Directives", directive.id, directive.id, archiveDirectiveNames), memoryNote(directive));
  }

  const runNames = new Set<string>();
  for (const run of agentRuns) {
    add(uniquePath("Cloud Memory/Agent Runs", run.id, run.id, runNames), agentRunNote(run));
  }

  const activeProjects = projects.filter((project) => project.status === "active" || project.status === "paused");
  const roadmapProjectNames = new Map([...projects, ...archivedProjects].map((project) => [project.id, project.name]));
  add("Cloud Memory/Roadmap.md", renderRoadmapSummary(roadmaps, roadmapProjectNames));
  add("Cloud Memory/Active Projects.md", summaryLines("Active Projects", activeProjects.map((project) => {
    const path = projectPaths.get(project.id);
    const link = path ? `[[${path.slice(0, -3)}|${markdownText(project.name, 120)}]]` : markdownText(project.name, 120);
    const count = tasks.filter((task) => task.projectId === project.id && task.status !== "done").length;
    return `- ${link} · ${project.status} · ${count} open task${count === 1 ? "" : "s"}`;
  }), availableProjects.length - projects.length));

  const normalMemories = memories.filter((memory) => memory.kind === "memory");
  add("Cloud Memory/Memory Summary.md", summaryLines("Memory Summary", normalMemories.map((memory) => {
    const metadata = `${memory.id} · ${memory.namespace ?? "default"} · ${memory.status} · importance ${memory.importance ?? 0}`;
    return sensitivityOf(memory) === "private"
      ? `- **Private memory** · ${metadata}`
      : `- **${memory.id}** · ${markdownText(memoryDisplayText(memory))} · ${metadata}`;
  }), availableMemories.length - memories.length));

  add("Cloud Memory/Directives.md", summaryLines("Directives", directives.map((directive) => {
    const metadata = `${directive.id} · ${directive.status} · importance ${directive.importance ?? 0}`;
    return sensitivityOf(directive) === "private"
      ? `- **Private directive** · ${metadata}`
      : `- **${directive.id}** · ${markdownText(memoryDisplayText(directive))} · ${metadata}`;
  }), availableDirectives.length - directives.length));

  const decisions = normalMemories.filter((memory) => memory.memoryType === "decision"
    || ["decision", "decisions"].includes((memory.namespace ?? "").toLocaleLowerCase()));
  add("Cloud Memory/Recent Decisions.md", summaryLines("Recent Decisions", decisions.map((decision) => {
    const metadata = `${decision.id} · updated ${decision.updatedAt}`;
    return sensitivityOf(decision) === "private"
      ? `- **Private decision** · ${metadata}`
      : `- **${decision.id}** · ${markdownText(memoryDisplayText(decision))} · ${metadata}`;
  })));

  const taskReviews: ProjectionReviewItem[] = tasks
    .filter((task) => task.status === "review")
    .map((task) => ({
      id: `task-${task.id}`,
      type: "task_review",
      title: task.title,
      summary: task.description,
      status: task.status,
      contentPolicy: "derived-safe",
      updatedAt: task.updatedAt,
    }));
  add("Cloud Memory/Review Queue.md", summaryLines("Review Queue", [...reviewItems, ...taskReviews].sort(reviewSort).map((item) => reviewItemLines(item).join("\n"))));

  const attention: string[] = [];
  for (const task of tasks.filter((record) => record.status === "blocked" || record.status === "review")) {
    attention.push(`- **${task.status}** · ${task.id} · ${markdownText(task.title, 240)}${task.blockerSummary ? ` · ${markdownText(task.blockerSummary)}` : ""}`);
  }
  for (const task of tasks.filter((record) => record.dueAt && record.status !== "done" && Date.parse(record.dueAt) < Date.parse(input.generatedAt))) {
    attention.push(`- **overdue** · ${task.id} · ${markdownText(task.title, 240)} · due ${task.dueAt}`);
  }
  for (const item of reviewItems) attention.push(...reviewItemLines(item));
  const vector = healthVector(input.health);
  if (input.health?.status && input.health.status !== "ok") attention.push(`- **health** · ${input.health.status}`);
  if (vector?.failed) attention.push(`- **vector** · ${vector.failed} failed records`);
  if (vector?.pending) attention.push(`- **vector** · ${vector.pending} pending records`);
  add("Cloud Memory/Needs Attention.md", summaryLines("Needs Attention", attention.slice(0, MAX_PROJECTED_ITEMS)));

  add("Cloud Memory/Agent Runs.md", summaryLines("Agent Runs", agentRuns.map((run) => {
    const metadata = [run.id, run.taskId ? `task ${run.taskId}` : null, run.status, run.client, run.model].filter(Boolean).join(" · ");
    const provenance = sourceLink(run.sourceUrl);
    return run.sensitivity === "normal"
      ? `- **${metadata}**${run.summary || run.receipt ? ` · ${markdownText(run.summary ?? run.receipt ?? "")}` : ""}${provenance}`
      : `- **${metadata}**${run.summary || run.receipt ? " · content omitted" : ""}${provenance}`;
  }), availableAgentRuns.length - agentRuns.length));

  add("Cloud Memory/System Status.md", systemStatusLines(input.health, capabilityReceipts).join("\n"));

  add("Cloud Memory/Context Profile.md", summaryLines("Context Profile", profileFacets.map((facet) => {
    const metadata = `${facet.facetType.replaceAll("_", " ")} · ${facet.enabled ? "enabled" : "disabled"} · ${facet.sensitivity} · v${facet.version}`;
    if (facet.sensitivity !== "normal") return `- **${markdownText(metadata)}** · content omitted`;
    return `- **${markdownText(metadata)}** · ${markdownText(facet.summary?.trim() || facet.content, 500)}`;
  })));
  add("Cloud Memory/Context Packs.md", summaryLines("Context Packs", contextPacks.map((pack) => {
    const scope = pack.scopeId ? `${pack.scopeType}:${pack.scopeId}` : pack.scopeType;
    return `- **${markdownText(pack.name, 120)}** · ${pack.enabled ? "enabled" : "paused"} · ${markdownText(scope, 220)} · ${pack.facetTypes.length} facets · ${pack.memoryIds.length} linked memories · limits ${pack.memoryLimit}/${pack.directiveLimit}`;
  })));
  add("Cloud Memory/Reflection Queue.md", summaryLines("Reflection Queue", reflectionProposals.map((proposal) =>
    `- **${markdownText(proposal.impact)} · ${markdownText(proposal.proposalType.replaceAll("_", " "))}** · memory ${markdownText(proposal.primaryMemoryId, 120)} · ${markdownText(proposal.suggestedAction)} · ${proposal.relatedMemoryIds.length} related`,
  )));
  add("Cloud Memory/Client Compatibility.md", summaryLines("Client Compatibility", clientReceipts.map((receipt) =>
    `- **${markdownText(receipt.clientId.replaceAll("_", " "))}** · configured ${markdownText(receipt.configuredStatus)} · auth ${markdownText(receipt.authenticatedStatus)} · verified ${markdownText(receipt.verifiedStatus)} · tools ${receipt.discoveredToolCount ?? "?"}/${receipt.expectedToolCount} · checked ${markdownText(receipt.checkedAt, 80)}`,
  )));
  add("Cloud Memory/Automation.md", summaryLines("Automation", automationRuns.map((run) =>
    `- **${markdownText(run.operation ?? "automation")}** · ${markdownText(run.status)} · ${run.itemCount ?? 0} items · ${markdownText(run.completedAt ?? run.startedAt ?? run.createdAt ?? "unknown", 80)}`,
  )));
  add("Cloud Memory/Connector Runs.md", summaryLines("Connector Runs", connectorRuns.map((run) =>
    `- **${markdownText((run.adapterId ?? "connector").replaceAll("_", " "))}** · ${markdownText(run.status)} · examined ${run.examinedCount ?? 0} · imported ${run.importedCount ?? 0} · duplicate ${run.duplicateCount ?? 0} · rejected ${run.rejectedCount ?? 0}`,
  )));

  const archiveActivity = [
    ...archivedProjects.map((record) => ({ id: record.id, type: "project", at: record.archivedAt ?? record.updatedAt })),
    ...archivedTasks.map((record) => ({
      id: record.id,
      type: "task",
      at: record.archivedAt
        ?? archivedProjects.find((project) => project.id === record.projectId)?.archivedAt
        ?? record.updatedAt,
    })),
    ...archivedMemories.map((record) => ({ id: record.id, type: "memory", at: record.archivedAt ?? record.updatedAt })),
    ...archivedDirectives.map((record) => ({ id: record.id, type: "directive", at: record.archivedAt ?? record.updatedAt })),
  ].sort((left, right) => right.at.localeCompare(left.at) || left.id.localeCompare(right.id)).slice(0, 20);
  const archiveIndex = [
    "---",
    `record_type: "archive_index"`,
    "cloud_memory_managed: true",
    "managed: true",
    "tags:",
    "  - cloud-memory/archive",
    "---",
    "",
    "# Cloud Memory Archive",
    "",
    "> [!warning] Managed Cloud Memory projection",
    "> D1 is canonical. Restore records in Cloud Memory; edits in this folder will be replaced by the managed projection.",
    "",
    "## Archive register",
    "",
    `- Projects shown: ${archivedProjects.length} of ${availableArchivedProjects.length}`,
    `- Tasks shown: ${archivedTasks.length} of ${availableArchivedTasks.length}`,
    `- Memories shown: ${archivedMemories.length} of ${availableArchivedMemories.length}`,
    `- Directives shown: ${archivedDirectives.length} of ${availableArchivedDirectives.length}`,
    `- Detail files omitted: ${availableArchivedProjects.length - archivedProjects.length + availableArchivedTasks.length - archivedTasks.length + availableArchivedMemories.length - archivedMemories.length + availableArchivedDirectives.length - archivedDirectives.length}`,
    "",
    "## Recent lifecycle activity",
    "",
    ...(archiveActivity.length
      ? archiveActivity.map((item) => `- **${item.type} archived** · ${item.id} · ${item.at}`)
      : ["_No archived records._"]),
    "",
    "Open [[Cloud Memory/Archive.base|Archive register]] to filter and browse archived records.",
    "",
  ].join("\n");
  add("Cloud Memory/Archive/Archive Index.md", archiveIndex);

  add("Cloud Memory/Projects.base", PROJECTS_BASE);
  add("Cloud Memory/Roadmaps.base", ROADMAPS_BASE);
  add("Cloud Memory/Tasks.base", TASKS_BASE);
  add("Cloud Memory/Memories.base", MEMORIES_BASE);
  add("Cloud Memory/Directives.base", DIRECTIVES_BASE);
  add("Cloud Memory/Archive.base", ARCHIVE_BASE);
  add("Cloud Memory/Agent Runs.base", AGENT_RUNS_BASE);

  const initialFiles = await Promise.all(rawFiles.map(async (file) => ({
    ...file,
    sha256: await contentSha256(file.content),
  })));
  initialFiles.sort((left, right) => left.path.localeCompare(right.path));

  const readme = [
    "# Cloud Memory",
    "",
    "> [!warning] Managed projection",
    "> D1 is canonical. This folder is replaced by the managed projection; edit canonical records in Cloud Memory.",
    "",
    `- Generated at: ${input.generatedAt}`,
    `- Projects shown: ${projects.length}`,
    `- Tasks shown: ${tasks.length}`,
    `- Memories shown: ${normalMemories.length}`,
    `- Directives shown: ${directives.length}`,
    `- Archived projects shown: ${archivedProjects.length}`,
    `- Archived tasks shown: ${archivedTasks.length}`,
    `- Archived memories shown: ${archivedMemories.length}`,
    `- Archived directives shown: ${archivedDirectives.length}`,
    `- Review items shown: ${reviewItems.length + taskReviews.length}`,
    `- Agent runs shown: ${agentRuns.length}`,
    `- Roadmap ideas shown: ${roadmaps.length}`,
    `- Profile facets shown: ${profileFacets.length}`,
    `- Context packs shown: ${contextPacks.length}`,
    `- Reflection proposals shown: ${reflectionProposals.length}`,
    `- Client receipts shown: ${clientReceipts.length}`,
    `- ${omittedDetail} detail files omitted by the global projection budget`,
    "",
    ...healthLines(input.health, input.generatedAt),
  ].join("\n");
  const readmeFile = {
    path: "Cloud Memory/README.md",
    content: `${readme}\n`,
    sha256: await contentSha256(`${readme}\n`),
  };
  const manifestContent = `${JSON.stringify({
    schemaVersion: 2,
    mode: "managed-read-only",
    generatedAt: input.generatedAt,
    files: [...initialFiles, readmeFile]
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((file) => ({ path: file.path, sha256: file.sha256, bytes: new TextEncoder().encode(file.content).byteLength })),
    health: input.health ? {
      status: input.health.status ?? "unknown",
      service: input.health.service ?? "unknown",
      version: input.health.version ?? "unknown",
      environment: input.health.environment ?? "unknown",
      vectorState: healthVector(input.health)?.state ?? "unknown",
    } : null,
  }, null, 2)}\n`;
  const manifestFile = {
    path: "Cloud Memory/manifest.json",
    content: manifestContent,
    sha256: await contentSha256(manifestContent),
  };

  const files: ObsidianProjectionFile[] = [
    ...[...initialFiles, readmeFile].sort((left, right) => left.path.localeCompare(right.path)),
    manifestFile,
  ];
  if (files.some((file) => !file.path.startsWith("Cloud Memory/") || file.path.includes("/../"))) {
    throw new Error("Projection path escaped the managed Cloud Memory directory");
  }
  if (new Set(files.map((file) => file.path.toLocaleLowerCase())).size !== files.length) {
    throw new Error("Projection contains duplicate managed paths");
  }
  if (files.length > MAX_PROJECTION_FILES) {
    throw new Error("Projection exceeded the global managed-file budget");
  }
  return files;
}
