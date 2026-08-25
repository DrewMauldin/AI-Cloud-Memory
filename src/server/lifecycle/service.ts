import type { MemorySearchResult } from "../memory/service";
import type { MemoryRecord } from "../memory/store";
import type {
  ActorType,
  ProjectRecord,
  TaskRecord,
  TaskStatus,
} from "../projects/store";
import type {
  AgentRunRecord,
  AgentRunStatus,
} from "../projects/runs";
import type { RoadmapRecord } from "../roadmaps/store";

interface MemoryReader {
  directives(ownerId: string): Promise<MemoryRecord[]>;
  search(input: {
    ownerId: string;
    query: string;
    limit: number;
    includeDirectives: boolean;
    mode: "hybrid";
  }): Promise<MemorySearchResult>;
}

interface ProjectReaderWriter {
  listProjects(ownerId: string): Promise<ProjectRecord[]>;
  listOpenTasks(ownerId: string, projectId: string | undefined, limit: number): Promise<TaskRecord[]>;
  getProject(ownerId: string, id: string): Promise<ProjectRecord | null>;
  getTask(ownerId: string, id: string): Promise<TaskRecord | null>;
  isTaskMutationReplay?(input: {
    ownerId: string;
    taskId: string;
    correlationId: string;
    status: TaskStatus;
    currentVersion: number;
  }): Promise<boolean>;
  moveTask(input: {
    ownerId: string;
    taskId: string;
    status: TaskStatus;
    expectedVersion: number;
    actorType: ActorType;
    client?: string;
    model?: string;
    sourceUrl?: string;
    correlationId?: string;
    note?: string;
  }): Promise<TaskRecord>;
}

interface AgentRunWriter {
  startRun(input: {
    ownerId: string;
    taskId: string;
    correlationId: string;
    actorType: "model";
    client: string;
    model: string;
    sourceUrl?: string;
  }): Promise<{ run: AgentRunRecord; idempotent: boolean }>;
  getRunByCorrelation(ownerId: string, correlationId: string): Promise<AgentRunRecord | null>;
  finishRun(input: {
    ownerId: string;
    runId: string;
    status: Exclude<AgentRunStatus, "running">;
    receipt?: string;
  }): Promise<{ run: AgentRunRecord; idempotent: boolean }>;
}

interface RoadmapReader {
  list(ownerId: string, input: {
    projectId?: string;
    scope: "active";
    limit: number;
  }): Promise<{ items: RoadmapRecord[]; total: number }>;
}

interface ContextProfileReader {
  buildContext(ownerId: string, packId: string): Promise<null | {
    pack: { directiveLimit: number; query?: string | null; memoryLimit?: number };
    [key: string]: unknown;
  }>;
}

interface LifecycleMutationInput {
  ownerId: string;
  taskId: string;
  expectedVersion: number;
  client: string;
  model: string;
  sourceUrl?: string;
  correlationId?: string;
  note?: string;
}

export const MAX_BRIEF_DIRECTIVES = 8;
export const MAX_BRIEF_DIRECTIVE_CONTENT = 600;
export const MAX_BRIEF_MEMORY_CONTENT = 900;

const RUN_OUTCOME_BY_TASK_STATUS: Readonly<Record<"done" | "review" | "blocked", Exclude<AgentRunStatus, "running">>> = {
  done: "succeeded",
  review: "awaiting_human",
  blocked: "failed",
};

function boundDirectives(directives: MemoryRecord[]): MemoryRecord[] {
  return directives.slice(0, MAX_BRIEF_DIRECTIVES).map((directive) => ({
    ...directive,
    content: Array.from(directive.content).slice(0, MAX_BRIEF_DIRECTIVE_CONTENT).join(""),
  }));
}

function boundMemories<T extends MemorySearchResult["results"][number]>(results: T[]) {
  return results.map((result) => {
    const content = Array.from(result.memory.content);
    const truncated = content.length > MAX_BRIEF_MEMORY_CONTENT;
    return {
      ...result,
      memory: {
        ...result.memory,
        content: content.slice(0, MAX_BRIEF_MEMORY_CONTENT).join(""),
      },
      contentTruncated: truncated,
      originalContentLength: content.length,
    };
  });
}

function mergeBriefMemories(
  requestResults: MemorySearchResult["results"],
  packResults: MemorySearchResult["results"],
  limit: number,
) {
  const merged = new Map<string, MemorySearchResult["results"][number] & {
    briefReasons: Array<"matched_request_query" | "matched_context_pack_query">;
  }>();
  const add = (result: MemorySearchResult["results"][number], reason: "matched_request_query" | "matched_context_pack_query") => {
    const existing = merged.get(result.memory.id);
    if (existing) {
      if (!existing.briefReasons.includes(reason)) existing.briefReasons.push(reason);
    } else merged.set(result.memory.id, { ...result, briefReasons: [reason] });
  };
  for (let index = 0; merged.size < limit && (index < requestResults.length || index < packResults.length); index += 1) {
    const requestResult = requestResults[index];
    const packResult = packResults[index];
    if (requestResult) add(requestResult, "matched_request_query");
    if (packResult && merged.size < limit) add(packResult, "matched_context_pack_query");
  }
  return [...merged.values()].slice(0, limit);
}

export class LifecycleNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LifecycleNotFoundError";
  }
}

export class LifecycleTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LifecycleTransitionError";
  }
}

export class LifecycleService {
  constructor(
    private readonly memoryService: MemoryReader,
    private readonly projectStore: ProjectReaderWriter,
    private readonly runStore?: AgentRunWriter,
    private readonly roadmapStore?: RoadmapReader,
    private readonly contextProfiles?: ContextProfileReader,
  ) {}

  private async startAgentRun(input: LifecycleMutationInput): Promise<void> {
    if (!this.runStore || !input.correlationId) return;
    await this.runStore.startRun({
      ownerId: input.ownerId,
      taskId: input.taskId,
      correlationId: input.correlationId,
      actorType: "model",
      client: input.client,
      model: input.model,
      sourceUrl: input.sourceUrl,
    });
  }

  private async finishAgentRun(
    input: LifecycleMutationInput,
    status: "done" | "review" | "blocked",
  ): Promise<void> {
    if (!this.runStore || !input.correlationId) return;
    const run = await this.runStore.getRunByCorrelation(input.ownerId, input.correlationId);
    if (!run) return;
    await this.runStore.finishRun({
      ownerId: input.ownerId,
      runId: run.id,
      status: RUN_OUTCOME_BY_TASK_STATUS[status],
      receipt: input.note,
    });
  }

  async contextBrief(input: {
    ownerId: string;
    query: string;
    projectId?: string;
    taskId?: string;
    memoryLimit: number;
    projectLimit: number;
    taskLimit: number;
    roadmapLimit: number;
    contextPackId?: string;
  }) {
    const profileContext = input.contextPackId && this.contextProfiles
      ? await this.contextProfiles.buildContext(input.ownerId, input.contextPackId)
      : null;
    if (input.contextPackId && !profileContext) throw new LifecycleNotFoundError("Context pack not found");
    const packQuery = profileContext?.pack.query?.trim();
    const packMemoryLimit = Math.min(input.memoryLimit, profileContext?.pack.memoryLimit ?? input.memoryLimit);
    const shouldRunPackQuery = Boolean(
      packQuery && packMemoryLimit > 0 && packQuery.toLocaleLowerCase() !== input.query.toLocaleLowerCase(),
    );
    const [directives, search, packSearch] = await Promise.all([
      this.memoryService.directives(input.ownerId),
      this.memoryService.search({
        ownerId: input.ownerId,
        query: input.query,
        limit: input.memoryLimit,
        includeDirectives: false,
        mode: "hybrid",
      }),
      shouldRunPackQuery ? this.memoryService.search({
        ownerId: input.ownerId,
        query: packQuery!,
        limit: packMemoryLimit,
        includeDirectives: false,
        mode: "hybrid",
      }) : null,
    ]);

    let projects: ProjectRecord[];
    let tasks: TaskRecord[];
    if (input.taskId) {
      const task = await this.projectStore.getTask(input.ownerId, input.taskId);
      if (!task || task.archivedAt) throw new LifecycleNotFoundError("Task not found");
      const project = await this.projectStore.getProject(input.ownerId, task.projectId);
      if (!project || project.status === "archived") {
        throw new LifecycleNotFoundError("Project not found");
      }
      projects = [project];
      tasks = await this.projectStore.listOpenTasks(
        input.ownerId,
        project.id,
        input.taskLimit,
      );
      if (!tasks.some((candidate) => candidate.id === task.id)) {
        tasks = [task, ...tasks].slice(0, input.taskLimit);
      }
    } else if (input.projectId) {
      const project = await this.projectStore.getProject(input.ownerId, input.projectId);
      if (!project || project.status === "archived") {
        throw new LifecycleNotFoundError("Project not found");
      }
      projects = [project];
      tasks = await this.projectStore.listOpenTasks(
        input.ownerId,
        project.id,
        input.taskLimit,
      );
    } else {
      projects = (await this.projectStore.listProjects(input.ownerId))
        .filter((project) => project.status === "active" || project.status === "paused")
        .slice(0, input.projectLimit);
      tasks = await this.projectStore.listOpenTasks(
        input.ownerId,
        undefined,
        input.taskLimit,
      );
    }

    const projectIds = new Set(projects.map((project) => project.id));
    const focusedProjectId = input.projectId || input.taskId ? projects[0]?.id : undefined;
    const roadmapItems = this.roadmapStore
      ? (await this.roadmapStore.list(input.ownerId, {
          projectId: focusedProjectId,
          scope: "active",
          limit: focusedProjectId
            ? input.roadmapLimit
            : Math.min(100, input.projectLimit * input.roadmapLimit),
        })).items
          .filter((item) => projectIds.has(item.projectId))
          .slice(0, input.roadmapLimit)
      : [];
    return {
      directives: boundDirectives(directives).slice(0, profileContext?.pack.directiveLimit ?? MAX_BRIEF_DIRECTIVES),
      memories: boundMemories(mergeBriefMemories(search.results, packSearch?.results ?? [], input.memoryLimit)),
      projects,
      tasks,
      roadmapItems,
      profileContext,
      retrieval: {
        lexicalDegraded: search.lexicalDegraded || Boolean(packSearch?.lexicalDegraded),
        semanticDegraded: search.semanticDegraded || Boolean(packSearch?.semanticDegraded),
        rerankingDegraded: search.rerankingDegraded || Boolean(packSearch?.rerankingDegraded),
        temporalIntent: search.temporalIntent,
      },
    };
  }

  async startTask(input: LifecycleMutationInput) {
    const current = await this.projectStore.getTask(input.ownerId, input.taskId);
    if (!current || current.archivedAt) throw new LifecycleNotFoundError("Task not found");
    if (current.status === "in_progress") {
      const replay = input.correlationId && this.projectStore.isTaskMutationReplay
        ? await this.projectStore.isTaskMutationReplay({
            ownerId: input.ownerId,
            taskId: input.taskId,
            correlationId: input.correlationId,
            status: "in_progress",
            currentVersion: current.version,
          })
        : false;
      if (replay) await this.startAgentRun(input);
      return replay
        ? { task: current, idempotent: true }
        : { task: current, idempotent: false, alreadyInState: true };
    }
    if (current.status === "done") {
      throw new LifecycleTransitionError("Completed tasks cannot be started");
    }
    const moved = await this.projectStore.moveTask({
      ownerId: input.ownerId,
      taskId: input.taskId,
      expectedVersion: input.expectedVersion,
      status: "in_progress",
      actorType: "model",
      client: input.client,
      model: input.model,
      sourceUrl: input.sourceUrl,
      correlationId: input.correlationId,
      note: input.note,
    });
    await this.startAgentRun(input);
    return {
      task: moved,
      idempotent: false,
    };
  }

  async finishTask(input: LifecycleMutationInput & { status: "done" | "review" | "blocked" }) {
    const current = await this.projectStore.getTask(input.ownerId, input.taskId);
    if (!current || current.archivedAt) throw new LifecycleNotFoundError("Task not found");
    if (current.status === input.status) {
      const replay = input.correlationId && this.projectStore.isTaskMutationReplay
        ? await this.projectStore.isTaskMutationReplay({
            ownerId: input.ownerId,
            taskId: input.taskId,
            correlationId: input.correlationId,
            status: input.status,
            currentVersion: current.version,
          })
        : false;
      if (replay) await this.finishAgentRun(input, input.status);
      return replay
        ? { task: current, idempotent: true }
        : { task: current, idempotent: false, alreadyInState: true };
    }
    const moved = await this.projectStore.moveTask({
      ownerId: input.ownerId,
      taskId: input.taskId,
      expectedVersion: input.expectedVersion,
      status: input.status,
      actorType: "model",
      client: input.client,
      model: input.model,
      sourceUrl: input.sourceUrl,
      correlationId: input.correlationId,
      note: input.note,
    });
    await this.finishAgentRun(input, input.status);
    return {
      task: moved,
      idempotent: false,
    };
  }
}
