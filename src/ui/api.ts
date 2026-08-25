import type {
  AgentRun,
  CapabilityReceipt,
  ClientCompatibility,
  ClientCompatibilityReceipt,
  ClientId,
  ConnectorAdapterId,
  ConnectorPreview,
  ConnectorRun,
  ContextPack,
  ContextGraphSnapshot,
  DoctorFinding,
  LibraryMemory,
  LibraryResponse,
  LifecycleActivity,
  MemoryEvent,
  MemoryRecord,
  MemoryReview,
  Project,
  ProfileFacet,
  ProfileFacetType,
  RankedMemory,
  RoadmapHorizon,
  RoadmapItem,
  ReflectionProposal,
  Session,
  Task,
  TaskEvent,
  TaskStructure,
  TaskStatus,
} from "./types";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body
      ? { "content-type": "application/json", ...init.headers }
      : init?.headers,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    throw new ApiError(response.status, body?.error?.message ?? `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function download(path: string): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(path, { method: "POST" });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    throw new ApiError(response.status, body?.error?.message ?? `Request failed (${response.status})`);
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const filename = disposition.match(/filename="([^"]+)"/)?.[1]
    ?? "cloud-memory-export.enc.json";
  return { blob: await response.blob(), filename };
}

export const api = {
  health: () => request<{
    status: "ok" | "degraded";
    service: string;
    version: string;
    environment: string;
    checkedAt: string;
    checks: { worker: string; d1: string; vectorize: string; workersAi: string };
  }>("/api/health"),
  session: () => request<Session>("/api/session"),
  projects: (scope: "active" | "archived" | "all" = "active") =>
    request<{ projects: Project[]; tasks: Task[] }>(`/api/projects?scope=${scope}`),
  createProject: (input: { name: string; description?: string; colour: string }) =>
    request<Project>("/api/projects", { method: "POST", body: JSON.stringify(input) }),
  archiveProject: (project: Project) => request<Project>(
    `/api/projects/${encodeURIComponent(project.id)}/archive`,
    { method: "POST", body: JSON.stringify({ expectedVersion: project.version, confirm: true }) },
  ),
  restoreProject: (project: Project) => request<Project>(
    `/api/projects/${encodeURIComponent(project.id)}/restore`,
    { method: "POST", body: JSON.stringify({ expectedVersion: project.version }) },
  ),
  roadmaps: (input: {
    projectId?: string;
    scope?: "active" | "promoted" | "archived" | "all";
    horizon?: RoadmapHorizon;
    limit?: number;
  } = {}) => {
    const params = new URLSearchParams({
      scope: input.scope ?? "active",
      limit: String(input.limit ?? 100),
    });
    if (input.projectId) params.set("projectId", input.projectId);
    if (input.horizon) params.set("horizon", input.horizon);
    return request<{ items: RoadmapItem[]; total: number }>(`/api/roadmaps?${params}`);
  },
  createRoadmap: (input: {
    projectId: string;
    title: string;
    description?: string;
    horizon: RoadmapHorizon;
    impact: RoadmapItem["impact"];
    effort: RoadmapItem["effort"];
    sourceType: RoadmapItem["sourceType"];
    client?: string;
    model?: string;
    sourceUrl?: string;
    correlationId: string;
  }) => request<RoadmapItem>("/api/roadmaps", { method: "POST", body: JSON.stringify(input) }),
  updateRoadmap: (
    item: RoadmapItem,
    input: Partial<Pick<RoadmapItem, "title" | "description" | "horizon" | "status" | "impact" | "effort">>,
  ) => request<RoadmapItem>(`/api/roadmaps/${encodeURIComponent(item.id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      ...input,
      expectedVersion: item.version,
      actorType: "human",
      client: "Cloud Memory dashboard",
    }),
  }),
  archiveRoadmap: (item: RoadmapItem) => request<RoadmapItem>(
    `/api/roadmaps/${encodeURIComponent(item.id)}/archive`,
    { method: "POST", body: JSON.stringify({ expectedVersion: item.version, confirm: true, actorType: "human", client: "Cloud Memory dashboard" }) },
  ),
  restoreRoadmap: (item: RoadmapItem) => request<RoadmapItem>(
    `/api/roadmaps/${encodeURIComponent(item.id)}/restore`,
    { method: "POST", body: JSON.stringify({ expectedVersion: item.version, actorType: "human", client: "Cloud Memory dashboard" }) },
  ),
  promoteRoadmap: (item: RoadmapItem, correlationId: string) => request<{
    roadmap: RoadmapItem;
    task: Task;
    replayed: boolean;
  }>(`/api/roadmaps/${encodeURIComponent(item.id)}/promote`, {
    method: "POST",
    body: JSON.stringify({
      expectedVersion: item.version,
      correlationId,
      confirm: true,
      actorType: "human",
      client: "Cloud Memory dashboard",
    }),
  }),
  createTask: (input: {
    projectId: string;
    title: string;
    description?: string;
    priority: Task["priority"];
    dueAt?: string;
    sourceType: Task["sourceType"];
    client?: string;
    model?: string;
    sourceUrl?: string;
  }) => request<Task>("/api/tasks", { method: "POST", body: JSON.stringify(input) }),
  moveTask: (task: Task, status: TaskStatus, position?: number) =>
    request<Task>(`/api/tasks/${encodeURIComponent(task.id)}/move`, {
      method: "PATCH",
      body: JSON.stringify({
        status,
        ...(position === undefined ? {} : { position }),
        expectedVersion: task.version,
        actorType: "human",
        client: "Cloud Memory dashboard",
      }),
    }),
  updateTask: (
    task: Task,
    input: Partial<Pick<Task, "title" | "description" | "priority" | "dueAt" | "blockerSummary">>,
  ) => request<Task>(`/api/tasks/${encodeURIComponent(task.id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      ...input,
      expectedVersion: task.version,
      actorType: "human",
      client: "Cloud Memory dashboard",
    }),
  }),
  archiveTask: (task: Task) =>
    request<Task>(`/api/tasks/${encodeURIComponent(task.id)}/archive`, {
      method: "POST",
      body: JSON.stringify({
        expectedVersion: task.version,
        confirm: true,
        actorType: "human",
        client: "Cloud Memory dashboard",
      }),
    }),
  task: (taskId: string) =>
    request<{ task: Task; events: TaskEvent[]; runs?: AgentRun[]; structure?: TaskStructure }>(`/api/tasks/${encodeURIComponent(taskId)}`),
  updateTaskStructure: (taskId: string, input: { expectedVersion: number; parentTaskId?: string | null; isMilestone?: boolean }) =>
    request<TaskStructure>(`/api/tasks/${encodeURIComponent(taskId)}/structure`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  addTaskDependency: (taskId: string, dependsOnTaskId: string, expectedVersion: number) =>
    request<TaskStructure>(`/api/tasks/${encodeURIComponent(taskId)}/dependencies`, {
      method: "POST",
      body: JSON.stringify({ expectedVersion, dependsOnTaskId }),
    }),
  removeTaskDependency: (taskId: string, dependsOnTaskId: string, expectedVersion: number) =>
    request<TaskStructure>(`/api/tasks/${encodeURIComponent(taskId)}/dependencies/${encodeURIComponent(dependsOnTaskId)}?expectedVersion=${expectedVersion}`, {
      method: "DELETE",
    }),
  agentRuns: () => request<{ runs: AgentRun[] }>("/api/agent-runs"),
  directives: () => request<{ directives: MemoryRecord[] }>("/api/memories/directives"),
  library: (filters: {
    query?: string;
    cursor?: string;
    limit?: number;
    status?: MemoryRecord["status"] | "all";
    kind?: MemoryRecord["kind"];
    label?: string;
    scopeType?: MemoryRecord["scopeType"];
    scopeId?: string;
    minimumImportance?: number;
    sort?: "updated" | "created" | "importance" | "retrieval";
  } = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== "") params.set(key, String(value));
    }
    return request<LibraryResponse>(`/api/library?${params}`);
  },
  memoryHistory: (memoryId: string) => request<{ events: MemoryEvent[] }>(
    `/api/memories/${encodeURIComponent(memoryId)}/history?limit=100`,
  ),
  relatedMemories: (memoryId: string) => request<{ items: LibraryMemory[] }>(
    `/api/memories/${encodeURIComponent(memoryId)}/related?limit=8`,
  ),
  bulkLibrary: (
    action: "archive" | "restore" | "label",
    records: LibraryMemory[],
    label?: string,
  ) => request<{
    results: Array<{ id: string; outcome: "changed" | "conflict" | "failed"; memory?: LibraryMemory }>;
  }>("/api/library/bulk", {
    method: "POST",
    body: JSON.stringify({
      action,
      ...(action === "label" ? { label } : {}),
      records: records.slice(0, 50).map((memory) => ({ id: memory.id, expectedVersion: memory.version })),
    }),
  }),
  lifecycleActivity: () => request<{ events: LifecycleActivity[] }>("/api/activity?limit=60"),
  addMemoryLabel: (memory: LibraryMemory, label: string) => request<LibraryMemory>(
    `/api/memories/${encodeURIComponent(memory.id)}/labels`,
    { method: "POST", body: JSON.stringify({ label, expectedVersion: memory.version }) },
  ),
  removeMemoryLabel: (memory: LibraryMemory, label: string) => request<LibraryMemory>(
    `/api/memories/${encodeURIComponent(memory.id)}/labels/${encodeURIComponent(label)}?expectedVersion=${memory.version}`,
    { method: "DELETE" },
  ),
  archiveMemory: (memory: LibraryMemory) => request<LibraryMemory>(
    `/api/memories/${encodeURIComponent(memory.id)}/archive`,
    { method: "POST", body: JSON.stringify({ expectedVersion: memory.version }) },
  ),
  restoreMemory: (memory: LibraryMemory) => request<LibraryMemory>(
    `/api/memories/${encodeURIComponent(memory.id)}/restore`,
    { method: "POST", body: JSON.stringify({ expectedVersion: memory.version }) },
  ),
  purgeMemory: (memory: LibraryMemory, confirmation: string) => request<LibraryMemory>(
    `/api/memories/${encodeURIComponent(memory.id)}/purge`,
    { method: "POST", body: JSON.stringify({ expectedVersion: memory.version, confirmation }) },
  ),
  searchMemories: (query: string, mode: "exact" | "semantic" | "hybrid") => {
    const params = new URLSearchParams({ query, mode, limit: "30" });
    return request<{ results: RankedMemory[]; semanticDegraded: boolean }>(
      `/api/memories/search?${params}`,
    );
  },
  memoryReviews: () => request<{ reviews: MemoryReview[] }>("/api/memories/reviews?status=open&limit=100"),
  contextGraph: () => request<ContextGraphSnapshot>("/api/context-graph"),
  resolveMemoryReview: (review: MemoryReview, status: "approved" | "rejected" | "dismissed") =>
    request<{ review: MemoryReview }>(`/api/memories/reviews/${encodeURIComponent(review.id)}/resolve`, {
      method: "POST",
      body: JSON.stringify({ status, expected_version: review.version }),
    }),
  memoryFeedback: (input: {
    memoryId: string;
    query: string;
    label: "helpful" | "not_helpful" | "outdated" | "incorrect";
    mode: "exact" | "semantic" | "hybrid";
    rank: number;
    score: number;
    correlationId: string;
  }) => request("/api/memories/feedback", {
    method: "POST",
    body: JSON.stringify({
      memory_id: input.memoryId,
      query: input.query,
      label: input.label,
      mode: input.mode,
      rank: input.rank,
      score: input.score,
      correlation_id: input.correlationId,
      client: "Cloud Memory dashboard",
    }),
  }),
  memoryDoctor: () => request<{ findings: DoctorFinding[] }>("/api/memory-doctor"),
  runMemoryDoctor: () => request<{ examined: number; open: number; findings: DoctorFinding[] }>(
    "/api/memory-doctor/run",
    { method: "POST" },
  ),
  decideDoctorFinding: (finding: DoctorFinding, status: "approved" | "dismissed") =>
    request<{ finding: DoctorFinding }>(`/api/memory-doctor/${encodeURIComponent(finding.id)}/decision`, {
      method: "POST",
      body: JSON.stringify({ expectedVersion: finding.version, status }),
    }),
  capabilityReceipts: () => request<{ receipts: CapabilityReceipt[] }>("/api/capability-receipts"),
  connectors: () => request<{ adapters: Array<{ id: ConnectorAdapterId; label: string; remote: boolean }>; runs: ConnectorRun[] }>("/api/connectors"),
  previewConnector: (adapterId: ConnectorAdapterId, input: unknown, sourceRef?: string) => request<{ run: ConnectorRun; preview: ConnectorPreview }>(
    "/api/connectors/preview",
    { method: "POST", body: JSON.stringify({ adapterId, input, sourceRef }) },
  ),
  applyConnector: (run: ConnectorRun, adapterId: ConnectorAdapterId, input: unknown) => request<ConnectorRun>(
    `/api/connectors/${encodeURIComponent(run.id)}/apply`,
    { method: "POST", body: JSON.stringify({ adapterId, input, expectedVersion: run.version, previewSha256: run.previewSha256 }) },
  ),
  clientCompatibility: () => request<ClientCompatibility>("/api/client-compatibility"),
  saveClientReceipt: (clientId: ClientId, input: {
    clientVersion?: string; endpoint: string;
    configuredStatus: ClientCompatibilityReceipt["configuredStatus"];
    authenticatedStatus: ClientCompatibilityReceipt["authenticatedStatus"];
    verifiedStatus: ClientCompatibilityReceipt["verifiedStatus"];
    expectedToolCount: number; discoveredToolCount?: number; model?: string;
    evidence?: string; expectedVersion?: number;
  }) =>
    request<ClientCompatibilityReceipt>(`/api/client-compatibility/${clientId}`, { method: "PUT", body: JSON.stringify(input) }),
  contextProfile: () => request<{ facets: ProfileFacet[]; packs: ContextPack[] }>("/api/context-profile"),
  saveProfileFacet: (facetType: ProfileFacetType, input: { content: string; summary?: string; sensitivity: ProfileFacet["sensitivity"]; enabled: boolean; expectedVersion?: number }) =>
    request<ProfileFacet>(`/api/context-profile/facets/${facetType}`, { method: "PUT", body: JSON.stringify(input) }),
  archiveProfileFacet: (facet: ProfileFacet) => request<ProfileFacet>(`/api/context-profile/facets/${facet.id}/archive`, {
    method: "POST", body: JSON.stringify({ expectedVersion: facet.version, confirm: true }),
  }),
  createContextPack: (input: { name: string; description?: string; scopeType: ContextPack["scopeType"]; scopeId?: string; facetTypes: ProfileFacetType[]; memoryIds: string[]; query?: string; memoryLimit: number; directiveLimit: number }) =>
    request<ContextPack>("/api/context-packs", { method: "POST", body: JSON.stringify(input) }),
  updateContextPack: (pack: ContextPack, enabled: boolean) => request<ContextPack>(`/api/context-packs/${pack.id}`, {
    method: "PUT", body: JSON.stringify({
      name: pack.name, description: pack.description ?? undefined, scopeType: pack.scopeType, scopeId: pack.scopeId ?? undefined,
      facetTypes: pack.facetTypes, memoryIds: pack.memoryIds, query: pack.query ?? undefined,
      memoryLimit: pack.memoryLimit, directiveLimit: pack.directiveLimit, enabled, expectedVersion: pack.version,
    }),
  }),
  saveContextPack: (pack: ContextPack, input: {
    name: string; facetTypes: ProfileFacetType[]; query?: string; memoryLimit: number; directiveLimit: number;
  }) => request<ContextPack>(`/api/context-packs/${pack.id}`, {
    method: "PUT", body: JSON.stringify({
      ...input, description: pack.description ?? undefined, scopeType: pack.scopeType, scopeId: pack.scopeId ?? undefined,
      memoryIds: pack.memoryIds, enabled: pack.enabled, expectedVersion: pack.version,
    }),
  }),
  archiveContextPack: (pack: ContextPack) => request<ContextPack>(`/api/context-packs/${pack.id}/archive`, {
    method: "POST", body: JSON.stringify({ expectedVersion: pack.version, confirm: true }),
  }),
  restoreContextPack: (pack: ContextPack) => request<ContextPack>(`/api/context-packs/${pack.id}/restore`, {
    method: "POST", body: JSON.stringify({ expectedVersion: pack.version, confirm: true }),
  }),
  previewContextPack: (pack: ContextPack) => request<Record<string, unknown>>(`/api/context-packs/${pack.id}/preview`),
  reflection: () => request<{ proposals: ReflectionProposal[] }>("/api/reflection?status=open&limit=100"),
  runReflection: () => request<{ examined: number; proposals: ReflectionProposal[]; truncated: boolean }>("/api/reflection/run", { method: "POST" }),
  decideReflection: (proposal: ReflectionProposal, decision: "kept" | "dismissed") => request<ReflectionProposal>(
    `/api/reflection/${proposal.id}/decision`, { method: "POST", body: JSON.stringify({ expectedVersion: proposal.version, decision }) },
  ),
  applyReflectionArchive: (proposal: ReflectionProposal) => request<{ proposal: ReflectionProposal; memory: MemoryRecord }>(
    `/api/reflection/${proposal.id}/archive`, {
      method: "POST",
      body: JSON.stringify({ expectedProposalVersion: proposal.version, expectedMemoryVersion: proposal.primaryMemory.version, confirm: true }),
    },
  ),
  createMemory: (input: {
    content: string;
    directive: boolean;
    source: string;
    client?: string;
    model?: string;
    source_url?: string;
  }) => request<MemoryRecord>("/api/memories", { method: "POST", body: JSON.stringify(input) }),
  repairMemoryIndex: () => request<{ examined: number; indexed: number; failed: number }>(
    "/api/memories/repair-index",
    { method: "POST" },
  ),
  exportToGitHub: () => request<{
    runId: string;
    path: string;
    recordCount: number;
    contentSha256: string;
    commitSha: string;
  }>("/api/exports/github", { method: "POST" }),
  downloadEncryptedExport: () => download("/api/exports/download"),
  dryRunTrueMemory: (jsonl: string) => request<{
    runId: string;
    manifestSha256: string;
    counts: {
      examined: number;
      new: number;
      duplicate: number;
      probableDuplicate: number;
      conflict: number;
      malformed: number;
      sensitive: number;
    };
  }>("/api/imports/truememory/dry-run", {
    method: "POST",
    headers: { "content-type": "application/x-ndjson" },
    body: jsonl,
  }),
  applyTrueMemory: (records: unknown[], runId: string, manifestSha256: string) =>
    request<{ imported: number; remaining: number; failed: number; completed: boolean }>(
      "/api/imports/truememory/apply",
      {
        method: "POST",
        headers: {
          "x-import-run-id": runId,
          "x-import-manifest-sha256": manifestSha256,
        },
        body: JSON.stringify({ records }),
      },
    ),
  createAutomationToken: (input: {
    label: string;
    scopes: Array<"projection:read" | "export:write">;
    expiresAt: string;
  }) => request<{
    id: string;
    token: string;
    createdAt: string;
    label: string;
    scopes: string[];
  }>("/api/automation-tokens", { method: "POST", body: JSON.stringify(input) }),
  logout: () => request<void>("/logout", { method: "POST" }),
};
