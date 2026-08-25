export type ProjectStatus = "active" | "paused" | "completed" | "archived";
export type TaskStatus =
  | "inbox"
  | "planned"
  | "in_progress"
  | "blocked"
  | "review"
  | "done";
export type TaskPriority = "low" | "medium" | "high" | "urgent";

export interface Project {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  colour: string;
  status: ProjectStatus;
  archivedAt?: string | null;
  linkedMemoryCount?: number;
  sourceUrl: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface Task {
  id: string;
  ownerId: string;
  projectId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  position: number;
  dueAt: string | null;
  blockerSummary: string | null;
  sourceType: "human" | "model" | "automation" | "import";
  sourceClient: string | null;
  sourceModel: string | null;
  sourceUrl: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  attentionReasons?: Array<
    | "blocked"
    | "review"
    | "overdue"
    | "stale_in_progress"
    | "missing_provenance"
    | "agent_failed"
    | "agent_awaiting_human"
  >;
}

export type RoadmapHorizon = "next" | "later" | "someday";
export type RoadmapStatus = "suggested" | "considering" | "planned" | "promoted" | "dismissed" | "archived";

export interface RoadmapItem {
  id: string;
  ownerId: string;
  projectId: string;
  title: string;
  description: string | null;
  horizon: RoadmapHorizon;
  status: RoadmapStatus;
  impact: "low" | "medium" | "high";
  effort: "small" | "medium" | "large";
  position: number;
  sourceType: "human" | "model" | "automation" | "import";
  sourceClient: string | null;
  sourceModel: string | null;
  sourceUrl: string | null;
  promotedTaskId: string | null;
  promotedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface SessionUser {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface Session {
  authenticated: true;
  user: SessionUser;
  exportCapabilities: {
    encryptedDownload: boolean;
    githubExport: boolean;
  };
}

export interface MemoryRecord {
  memoryNumber: number;
  id: string;
  ownerId: string;
  namespace: string;
  kind: "memory" | "directive";
  memoryType: "preference" | "decision" | "fact" | "episode" | "procedure" | "project_state" | "correction";
  scopeType: "global" | "project" | "repository" | "client";
  scopeId: string | null;
  retentionTier: "core" | "durable" | "dynamic" | "archive";
  content: string;
  contentSha256: string;
  summary: string | null;
  importance: number;
  confidence: number;
  status: "proposed" | "active" | "superseded" | "rejected" | "archived";
  sensitivity: "normal" | "private" | "sensitive";
  sourceSystem: string | null;
  sourceId: string | null;
  sourceUrl: string | null;
  sourceClient: string | null;
  sourceModel: string | null;
  conversationId: string | null;
  messageId: string | null;
  observedAt: string;
  recordedAt: string;
  reviewAt: string | null;
  expiresAt: string | null;
  vectorState: "pending" | "indexed" | "failed" | "not_required";
  createdAt: string;
  updatedAt: string;
}

export interface LibraryMemory extends MemoryRecord {
  version: number;
  labels: string[];
  archivedAt: string | null;
  purgedAt: string | null;
  lastRetrievedAt: string | null;
  retrievalCount: number;
}

export interface MemoryEvent {
  id: string;
  memoryId: string;
  eventType: string;
  actorType: string;
  client: string | null;
  model: string | null;
  sourceUrl: string | null;
  correlationId: string | null;
  previous: unknown;
  next: unknown;
  createdAt: string;
}

export interface LibraryResponse {
  items: LibraryMemory[];
  nextCursor: string | null;
  counts: {
    active: number;
    archived: number;
    memories: number;
    directives: number;
  };
}

export interface LifecycleActivity {
  id: string;
  subjectType: "memory" | "project" | "task";
  subjectId: string;
  subjectTitle: string;
  eventType: string;
  actorType: string;
  client: string | null;
  model: string | null;
  sourceUrl: string | null;
  createdAt: string;
}

export interface RankedMemory {
  memory: MemoryRecord;
  score: number;
  sources: Array<"exact" | "semantic" | "graph">;
  rerankerScore?: number;
  boosts?: {
    entity: number;
    temporal: number;
    importance: number;
    total: number;
  };
  explanation?: {
    matchSources: Array<"exact" | "semantic" | "graph">;
    rerankerScore: number | null;
    boosts: RankedMemory["boosts"] | null;
    temporalIntent: {
      kind: "current" | "historical" | "neutral";
      year: number | null;
      asOf?: string;
      before?: string;
      after?: string;
    };
    degraded: { lexical: boolean; semantic: boolean; reranking: boolean };
  };
}

export interface TaskEvent {
  id: string;
  taskId: string;
  eventType: string;
  actorType: "human" | "model" | "automation" | "import" | "system";
  client: string | null;
  model: string | null;
  sourceUrl: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  note: string | null;
  createdAt: string;
}

export interface AgentRun {
  id: string;
  taskId: string | null;
  conversationId: string | null;
  correlationId: string;
  actorType: "human" | "model" | "automation" | "import" | "system";
  client: string | null;
  model: string | null;
  sourceUrl: string | null;
  status: "running" | "succeeded" | "failed" | "awaiting_human" | "cancelled";
  receipt: string | null;
  startedAt: string;
  heartbeatAt: string | null;
  finishedAt: string | null;
  memories?: Array<{ memoryId: string; relation: "read" | "created" | "superseded"; createdAt: string }>;
  linkedMemoryCount?: number;
}

export interface TaskStructure {
  taskId: string;
  parentTaskId: string | null;
  isMilestone: boolean;
  dependencies: string[];
  progress: {
    childCount: number;
    completedChildCount: number;
    percent: number;
  };
  version: number;
  updatedAt: string;
  parentTask?: Pick<Task, "id" | "title" | "status"> | null;
  dependencyTasks?: Array<Pick<Task, "id" | "title" | "status">>;
  relatedTasks?: Array<Pick<Task, "id" | "title" | "status">>;
  linkedMemoryCount?: number;
}

export interface MemoryReview {
  id: string;
  reviewType: "probable_duplicate" | "source_conflict";
  status: "open" | "approved" | "rejected" | "dismissed";
  candidateContent: string;
  candidateSha256: string;
  candidateNamespace: string;
  candidateKind: "memory" | "directive";
  matchedMemoryId: string | null;
  similarity: number | null;
  sourceSystem: string | null;
  sourceId: string | null;
  sourceUrl: string | null;
  client: string | null;
  model: string | null;
  correlationId: string | null;
  createdAt: string;
  version: number;
}

export type ContextGraphEntityType = "person" | "organisation" | "project" | "place" | "concept" | "system";
export type ContextGraphMemoryRelation = "mentioned" | "subject" | "evidence";

export interface ContextGraphEntity {
  id: string;
  ownerId: string;
  canonicalName: string;
  entityType: ContextGraphEntityType;
  description: string | null;
  aliases?: string[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ContextGraphRelationship {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  relationshipType: string;
  validFrom: string | null;
  validUntil: string | null;
  evidenceMemoryId: string | null;
  confidence: number;
  updatedAt: string;
}

export interface ContextGraphMemoryLink {
  memoryId: string;
  entityId: string;
  relation: ContextGraphMemoryRelation;
  confidence: number;
}

export interface ContextGraphSnapshot {
  entities: ContextGraphEntity[];
  relationships: ContextGraphRelationship[];
  memoryLinks: ContextGraphMemoryLink[];
}

export interface DoctorFinding {
  id: string;
  findingType: "expired" | "review_due" | "vector_failed" | "missing_provenance";
  severity: "info" | "warning" | "critical";
  memoryId: string;
  title: string;
  detail: string;
  status: "open" | "approved" | "dismissed" | "resolved";
  createdAt: string;
  version: number;
}

export interface CapabilityReceipt {
  capability: "d1" | "vectorize" | "workers_ai" | "oauth" | "mcp" | "n8n" | "obsidian_projection";
  status: "verified" | "degraded" | "failed" | "configured" | "unknown";
  detail: string;
  evidenceSha256: string | null;
  source: string;
  checkedAt: string;
  version: number;
}

export type ConnectorAdapterId = "cloud_memory_jsonl" | "truememory_jsonl" | "markdown_bundle" | "github_markdown";
export interface ConnectorRun {
  id: string; adapterId: ConnectorAdapterId; sourceRef: string | null; status: "previewed" | "applying" | "completed" | "failed";
  examinedCount: number; importableCount: number; duplicateCount: number; rejectedCount: number; importedCount: number;
  previewSha256: string; createdAt: string; completedAt: string | null; version: number;
}
export interface ConnectorPreview {
  adapterId: ConnectorAdapterId; inputSha256: string; previewSha256: string;
  records: Array<{ sourceId: string; content: string; directive: boolean; namespace: string; memoryType: MemoryRecord["memoryType"]; sourceSystem: string; sourceUrl?: string }>;
}

export type ClientId = "codex" | "claude_code" | "opencode" | "claude_web" | "chatgpt";
export interface ClientManifestItem {
  id: ClientId; label: string; setup: "cli" | "connector_ui"; oauth: true;
  hookSupport: "native" | "plugin" | "instructions_only"; writeSupport: "full" | "read_only_plan_limit";
  expectedToolCount: 24; canary: string[];
}
export interface ClientCompatibilityReceipt {
  clientId: ClientId; clientVersion: string | null; endpoint: string;
  configuredStatus: "unknown" | "configured" | "failed";
  authenticatedStatus: "unknown" | "authenticated" | "failed" | "not_supported";
  verifiedStatus: "unknown" | "verified" | "degraded" | "failed";
  expectedToolCount: number; discoveredToolCount: number | null; model: string | null; evidence: string | null;
  checkedAt: string; updatedAt: string; version: number;
}
export interface ClientCompatibility {
  manifest: { schemaVersion: 1; endpoint: string; requiredScopes: string[]; clients: ClientManifestItem[] };
  receipts: ClientCompatibilityReceipt[];
}

export type ProfileFacetType = "identity" | "communication" | "working_style" | "preferences" | "constraints" | "goals";
export interface ProfileFacet {
  id: string; facetType: ProfileFacetType; content: string; summary: string | null;
  sensitivity: "normal" | "private" | "sensitive"; enabled: boolean; archivedAt: string | null; version: number;
}
export interface ContextPack {
  id: string; name: string; description: string | null; scopeType: "global" | "project" | "repository" | "client";
  scopeId: string | null; facetTypes: ProfileFacetType[]; memoryIds: string[]; query: string | null;
  memoryLimit: number; directiveLimit: number; enabled: boolean; archivedAt: string | null; version: number;
}

export interface ReflectionProposal {
  id: string; proposalType: "exact_duplicate" | "probable_duplicate" | "stale_dynamic" | "expiry_review" | "supersession_review";
  primaryMemoryId: string; relatedMemoryIds: string[]; evidence: Record<string, unknown>;
  suggestedAction: "review" | "keep" | "archive" | "supersede"; impact: "low" | "medium" | "high";
  status: "open" | "kept" | "dismissed" | "applied"; createdAt: string; updatedAt: string; version: number;
  primaryMemory: { version: number; status: string; summary: string | null };
}
