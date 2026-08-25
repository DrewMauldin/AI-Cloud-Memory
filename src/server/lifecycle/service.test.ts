import { describe, expect, it, vi } from "vitest";

import { LifecycleService } from "./service";
import type { MemoryRecord } from "../memory/store";
import type { ProjectRecord, TaskRecord } from "../projects/store";

const memory: MemoryRecord = {
  memoryNumber: 1,
  id: "mem_1",
  ownerId: "123456789",
  namespace: "default",
  kind: "memory",
  memoryType: "fact",
  scopeType: "global",
  scopeId: null,
  retentionTier: "durable",
  content: "Cloud Memory is the primary shared memory.",
  contentSha256: "hash",
  summary: null,
  importance: 0.8,
  confidence: 1,
  status: "active",
  sensitivity: "normal",
  sourceSystem: "MCP",
  sourceId: null,
  sourceUrl: null,
  sourceClient: "Codex",
  sourceModel: "GPT-5",
  conversationId: null,
  messageId: null,
  supersedesId: null,
  validFrom: "2026-08-24T00:00:00.000Z",
  validUntil: null,
  observedAt: "2026-08-24T00:00:00.000Z",
  recordedAt: "2026-08-24T00:00:00.000Z",
  reviewAt: null,
  expiresAt: null,
  vectorState: "indexed",
  createdAt: "2026-08-24T00:00:00.000Z",
  updatedAt: "2026-08-24T00:00:00.000Z",
  version: 1,
};

const project: ProjectRecord = {
  id: "project_1",
  ownerId: "123456789",
  name: "Cloud Memory",
  description: null,
  colour: "#c9ff3b",
  status: "active",
  sourceUrl: null,
  createdAt: "2026-08-24T00:00:00.000Z",
  updatedAt: "2026-08-24T00:00:00.000Z",
  version: 1,
};

const task: TaskRecord = {
  id: "task_1",
  ownerId: "123456789",
  projectId: project.id,
  title: "Roll out Cloud Memory",
  description: null,
  status: "planned",
  priority: "high",
  position: 1000,
  dueAt: null,
  blockerSummary: null,
  sourceType: "human",
  sourceClient: null,
  sourceModel: null,
  sourceUrl: null,
  archivedAt: null,
  createdAt: "2026-08-24T00:00:00.000Z",
  updatedAt: "2026-08-24T00:00:00.000Z",
  version: 1,
};

describe("LifecycleService", () => {
  it("builds a bounded brief with directives separated from ranked memories", async () => {
    const memoryService = {
      directives: vi.fn().mockResolvedValue(Array.from({ length: 20 }, (_, index) => ({
        ...memory,
        id: `directive_${index}`,
        kind: "directive" as const,
        content: "D".repeat(2_000),
      }))),
      search: vi.fn().mockResolvedValue({
        results: [{
          memory: { ...memory, content: "M".repeat(12_000) },
          score: 0.9,
          sources: ["semantic"],
        }],
        temporalIntent: { kind: "neutral", year: null },
        lexicalDegraded: false,
        semanticDegraded: false,
        rerankingDegraded: false,
      }),
    };
    const projectStore = {
      listProjects: vi.fn().mockResolvedValue([project]),
      listOpenTasks: vi.fn().mockResolvedValue([task]),
      getProject: vi.fn(),
      getTask: vi.fn(),
      moveTask: vi.fn(),
    };
    const roadmap = { id: "roadmap_1", projectId: project.id, title: "Tune retrieval evidence", horizon: "next" };
    const roadmapStore = { list: vi.fn().mockResolvedValue({ items: [roadmap], total: 1 }) };
    const profileContext = { pack: { id: "pack_1", directiveLimit: 4 }, facets: [{ facetType: "communication", reason: "selected_by_context_pack" }] };
    const profileStore = { buildContext: vi.fn().mockResolvedValue(profileContext) };

    const brief = await new LifecycleService(memoryService, projectStore, undefined, roadmapStore, profileStore).contextBrief({
      ownerId: "123456789",
      query: "Cloud Memory rollout",
      memoryLimit: 5,
      projectLimit: 5,
      taskLimit: 10,
      roadmapLimit: 5,
      contextPackId: "pack_1",
    });

    expect(brief.directives).toHaveLength(4);
    expect(brief.directives.every((directive) => directive.content.length <= 600)).toBe(true);
    expect(brief.memories).toHaveLength(1);
    expect(brief.memories[0]?.memory.content.length).toBeLessThanOrEqual(900);
    expect(brief.memories[0]?.contentTruncated).toBe(true);
    expect(brief.projects).toEqual([project]);
    expect(brief.tasks).toEqual([task]);
    expect(brief.roadmapItems).toEqual([roadmap]);
    expect(brief.profileContext).toEqual(profileContext);
    expect(profileStore.buildContext).toHaveBeenCalledWith("123456789", "pack_1");
    expect(roadmapStore.list).toHaveBeenCalledWith("123456789", { projectId: undefined, scope: "active", limit: 25 });
    expect(brief.retrieval).toEqual({
      lexicalDegraded: false,
      semanticDegraded: false,
      rerankingDegraded: false,
      temporalIntent: { kind: "neutral", year: null },
    });

    projectStore.getProject.mockResolvedValue(project);
    roadmapStore.list.mockClear();
    await new LifecycleService(memoryService, projectStore, undefined, roadmapStore).contextBrief({
      ownerId: "123456789",
      query: "Cloud Memory next work",
      projectId: project.id,
      memoryLimit: 3,
      projectLimit: 5,
      taskLimit: 5,
      roadmapLimit: 3,
    });
    expect(roadmapStore.list).toHaveBeenCalledWith("123456789", {
      projectId: project.id,
      scope: "active",
      limit: 3,
    });
  });

  it("runs and explains a distinct bounded context-pack retrieval query", async () => {
    const packMemory = { ...memory, id: "mem_pack", content: "The release uses a native projection schedule." };
    const memoryService = {
      directives: vi.fn().mockResolvedValue([]),
      search: vi.fn()
        .mockResolvedValueOnce({
          results: [{ memory, score: 0.9, sources: ["exact"] }],
          temporalIntent: { kind: "neutral", year: null },
          lexicalDegraded: false, semanticDegraded: false, rerankingDegraded: false,
        })
        .mockResolvedValueOnce({
          results: [{ memory: packMemory, score: 0.8, sources: ["semantic"] }],
          temporalIntent: { kind: "neutral", year: null },
          lexicalDegraded: false, semanticDegraded: true, rerankingDegraded: false,
        }),
    };
    const projectStore = {
      listProjects: vi.fn().mockResolvedValue([project]),
      listOpenTasks: vi.fn().mockResolvedValue([task]),
      getProject: vi.fn(), getTask: vi.fn(), moveTask: vi.fn(),
    };
    const profileStore = { buildContext: vi.fn().mockResolvedValue({
      pack: { id: "pack_1", directiveLimit: 4, memoryLimit: 2, query: "native projection schedule" },
      facets: [], linkedMemories: [],
    }) };

    const brief = await new LifecycleService(memoryService, projectStore, undefined, undefined, profileStore).contextBrief({
      ownerId: "123456789", query: "current release state", memoryLimit: 5,
      projectLimit: 5, taskLimit: 5, roadmapLimit: 5, contextPackId: "pack_1",
    });

    expect(memoryService.search).toHaveBeenNthCalledWith(2, {
      ownerId: "123456789", query: "native projection schedule", limit: 2,
      includeDirectives: false, mode: "hybrid",
    });
    expect(brief.memories.map((item) => ({ id: item.memory.id, reasons: item.briefReasons }))).toEqual([
      { id: memory.id, reasons: ["matched_request_query"] },
      { id: packMemory.id, reasons: ["matched_context_pack_query"] },
    ]);
    expect(brief.retrieval.semanticDegraded).toBe(true);
  });

  it("does not run a context-pack query when its memory limit is zero", async () => {
    const memoryService = {
      directives: vi.fn().mockResolvedValue([]),
      search: vi.fn().mockResolvedValue({
        results: [], temporalIntent: { kind: "neutral", year: null },
        lexicalDegraded: false, semanticDegraded: false, rerankingDegraded: false,
      }),
    };
    const projectStore = {
      listProjects: vi.fn().mockResolvedValue([project]),
      listOpenTasks: vi.fn().mockResolvedValue([task]),
      getProject: vi.fn(), getTask: vi.fn(), moveTask: vi.fn(),
    };
    const profileStore = { buildContext: vi.fn().mockResolvedValue({
      pack: { id: "pack_1", directiveLimit: 4, memoryLimit: 0, query: "disabled pack query" },
      facets: [], linkedMemories: [],
    }) };

    await new LifecycleService(memoryService, projectStore, undefined, undefined, profileStore).contextBrief({
      ownerId: "123456789", query: "current release state", memoryLimit: 5,
      projectLimit: 5, taskLimit: 5, roadmapLimit: 5, contextPackId: "pack_1",
    });

    expect(memoryService.search).toHaveBeenCalledTimes(1);
  });

  it("does not claim an uncorrelated same-state start as its own replay", async () => {
    const inProgress = { ...task, status: "in_progress" as const, version: 2 };
    const projectStore = {
      listProjects: vi.fn(),
      listOpenTasks: vi.fn(),
      getProject: vi.fn(),
      getTask: vi.fn().mockResolvedValue(inProgress),
      moveTask: vi.fn(),
    };

    const result = await new LifecycleService({} as never, projectStore).startTask({
      ownerId: "123456789",
      taskId: task.id,
      expectedVersion: 1,
      client: "Codex",
      model: "GPT-5",
      sourceUrl: "https://chatgpt.com/c/example",
    });

    expect(result).toEqual({ task: inProgress, idempotent: false, alreadyInState: true });
    expect(projectStore.moveTask).not.toHaveBeenCalled();
  });

  it("only treats a correlated same-state start as a replay of that operation", async () => {
    const inProgress = { ...task, status: "in_progress" as const, version: 2 };
    const projectStore = {
      listProjects: vi.fn(),
      listOpenTasks: vi.fn(),
      getProject: vi.fn(),
      getTask: vi.fn().mockResolvedValue(inProgress),
      isTaskMutationReplay: vi.fn().mockResolvedValue(false),
      moveTask: vi.fn(),
    };

    const result = await new LifecycleService({} as never, projectStore).startTask({
      ownerId: "123456789",
      taskId: task.id,
      expectedVersion: 1,
      client: "Codex",
      model: "GPT-5",
      correlationId: "run-new",
    });

    expect(projectStore.isTaskMutationReplay).toHaveBeenCalledWith({
      ownerId: "123456789",
      taskId: task.id,
      correlationId: "run-new",
      status: "in_progress",
      currentVersion: 2,
    });
    expect(result).toEqual({ task: inProgress, idempotent: false, alreadyInState: true });
    expect(projectStore.moveTask).not.toHaveBeenCalled();
  });

  it("reports a matching correlated same-state start as an idempotent replay", async () => {
    const inProgress = { ...task, status: "in_progress" as const, version: 2 };
    const projectStore = {
      listProjects: vi.fn(),
      listOpenTasks: vi.fn(),
      getProject: vi.fn(),
      getTask: vi.fn().mockResolvedValue(inProgress),
      isTaskMutationReplay: vi.fn().mockResolvedValue(true),
      moveTask: vi.fn(),
    };

    const result = await new LifecycleService({} as never, projectStore).startTask({
      ownerId: "123456789",
      taskId: task.id,
      expectedVersion: 1,
      client: "Codex",
      model: "GPT-5",
      correlationId: "run-start-1",
    });

    expect(result).toEqual({ task: inProgress, idempotent: true });
    expect(projectStore.moveTask).not.toHaveBeenCalled();
  });

  it("starts an agent run only after a correlated task transition", async () => {
    const inProgress = { ...task, status: "in_progress" as const, version: 2 };
    const projectStore = {
      listProjects: vi.fn(),
      listOpenTasks: vi.fn(),
      getProject: vi.fn(),
      getTask: vi.fn().mockResolvedValue(task),
      moveTask: vi.fn().mockResolvedValue(inProgress),
    };
    const runStore = {
      startRun: vi.fn().mockResolvedValue({ run: {}, idempotent: false }),
      getRunByCorrelation: vi.fn(),
      finishRun: vi.fn(),
    };

    const service = new LifecycleService({} as never, projectStore, runStore);
    await service.startTask({
      ownerId: "123456789",
      taskId: task.id,
      expectedVersion: 1,
      client: "Codex",
      model: "GPT-5",
      sourceUrl: "https://chatgpt.com/c/example",
      correlationId: "run-start-1",
    });
    await service.startTask({
      ownerId: "123456789",
      taskId: task.id,
      expectedVersion: 1,
      client: "Codex",
      model: "GPT-5",
    });

    expect(runStore.startRun).toHaveBeenCalledWith({
      ownerId: "123456789",
      taskId: task.id,
      correlationId: "run-start-1",
      actorType: "model",
      client: "Codex",
      model: "GPT-5",
      sourceUrl: "https://chatgpt.com/c/example",
    });
    expect(runStore.startRun).toHaveBeenCalledTimes(1);
  });

  it("finishes the correlated agent run with an outcome and bounded lifecycle receipt", async () => {
    const review = { ...task, status: "review" as const, version: 2 };
    const projectStore = {
      listProjects: vi.fn(),
      listOpenTasks: vi.fn(),
      getProject: vi.fn(),
      getTask: vi.fn().mockResolvedValue(task),
      moveTask: vi.fn().mockResolvedValue(review),
    };
    const runStore = {
      startRun: vi.fn(),
      getRunByCorrelation: vi.fn().mockResolvedValue({ id: "run-review-1" }),
      finishRun: vi.fn().mockResolvedValue({ run: {}, idempotent: false }),
    };

    await new LifecycleService({} as never, projectStore, runStore).finishTask({
      ownerId: "123456789",
      taskId: task.id,
      expectedVersion: 1,
      status: "review",
      client: "Codex",
      model: "GPT-5",
      correlationId: "run-review-1",
      note: "Awaiting owner verification.",
    });

    expect(runStore.getRunByCorrelation).toHaveBeenCalledWith("123456789", "run-review-1");
    expect(runStore.finishRun).toHaveBeenCalledWith({
      ownerId: "123456789",
      runId: "run-review-1",
      status: "awaiting_human",
      receipt: "Awaiting owner verification.",
    });
  });

  it("repairs a correlated ledger start on an idempotent task replay", async () => {
    const inProgress = { ...task, status: "in_progress" as const, version: 2 };
    const projectStore = {
      listProjects: vi.fn(),
      listOpenTasks: vi.fn(),
      getProject: vi.fn(),
      getTask: vi.fn().mockResolvedValue(inProgress),
      isTaskMutationReplay: vi.fn().mockResolvedValue(true),
      moveTask: vi.fn(),
    };
    const runStore = {
      startRun: vi.fn().mockResolvedValue({ run: {}, idempotent: false }),
      getRunByCorrelation: vi.fn(),
      finishRun: vi.fn(),
    };

    const result = await new LifecycleService({} as never, projectStore, runStore).startTask({
      ownerId: "123456789",
      taskId: task.id,
      expectedVersion: 1,
      client: "Codex",
      model: "GPT-5",
      correlationId: "run-replay-1",
    });

    expect(result).toEqual({ task: inProgress, idempotent: true });
    expect(runStore.startRun).toHaveBeenCalledTimes(1);
    expect(projectStore.moveTask).not.toHaveBeenCalled();
  });

  it("finishes a task with optimistic concurrency and complete provenance", async () => {
    const done = { ...task, status: "done" as const, version: 2 };
    const projectStore = {
      listProjects: vi.fn(),
      listOpenTasks: vi.fn(),
      getProject: vi.fn(),
      getTask: vi.fn().mockResolvedValue(task),
      moveTask: vi.fn().mockResolvedValue(done),
    };

    const result = await new LifecycleService({} as never, projectStore).finishTask({
      ownerId: "123456789",
      taskId: task.id,
      expectedVersion: 1,
      status: "done",
      client: "Codex",
      model: "GPT-5",
      sourceUrl: "https://chatgpt.com/c/example",
      correlationId: "run-finish-1",
      note: "Deployment canaries passed.",
    });

    expect(projectStore.moveTask).toHaveBeenCalledWith({
      ownerId: "123456789",
      taskId: task.id,
      expectedVersion: 1,
      status: "done",
      actorType: "model",
      client: "Codex",
      model: "GPT-5",
      sourceUrl: "https://chatgpt.com/c/example",
      correlationId: "run-finish-1",
      note: "Deployment canaries passed.",
    });
    expect(result).toEqual({ task: done, idempotent: false });
  });
});
