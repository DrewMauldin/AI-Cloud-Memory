import { classifyTaskAttention } from "./attention";
import { AgentRunStore } from "./runs";
import { ProjectStore } from "./store";
import { TaskStructureStore } from "./structure";
import { RoadmapStore } from "../roadmaps/store";

export class ProjectMcpNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectMcpNotFoundError";
  }
}

export class ProjectMcpService {
  private readonly projects: ProjectStore;
  private readonly runs: AgentRunStore;
  private readonly structure: TaskStructureStore;
  private readonly roadmaps: RoadmapStore;

  constructor(
    database: D1Database,
    private readonly ownerId: string,
  ) {
    this.projects = new ProjectStore(database);
    this.runs = new AgentRunStore(database);
    this.structure = new TaskStructureStore(database);
    this.roadmaps = new RoadmapStore(database);
  }

  async board(taskLimit = 100) {
    const [projects, tasks, roadmap] = await Promise.all([
      this.projects.listProjects(this.ownerId),
      this.projects.listTasks(this.ownerId),
      this.roadmaps.list(this.ownerId, { scope: "active", limit: 10 }),
    ]);
    const boundedTasks = tasks.slice(0, Math.max(1, Math.min(taskLimit, 100)));
    const runsByTask = await this.runs.listLatestRelevantByTask(
      this.ownerId,
      boundedTasks.filter((task) => task.status !== "done").map((task) => task.id),
      20,
    );
    const now = new Date().toISOString();
    return {
      projects,
      tasks: boundedTasks.map((task) => ({
        ...task,
        attentionReasons: classifyTaskAttention({
          ...task,
          agentRuns: runsByTask.get(task.id),
        }, now).reasons,
      })),
      roadmapItems: roadmap.items,
    };
  }

  async createProject(input: {
    name: string;
    description?: string;
    colour?: string;
    sourceUrl?: string;
  }) {
    return this.projects.createProject({ ownerId: this.ownerId, ...input });
  }

  async updateProject(input: {
    projectId: string;
    expectedVersion: number;
    name?: string;
    description?: string | null;
    colour?: string;
    status?: "active" | "paused" | "completed";
  }) {
    return this.projects.updateProject({ ownerId: this.ownerId, ...input });
  }

  async archiveProject(input: { projectId: string; expectedVersion: number }) {
    return this.projects.archiveProject({ ownerId: this.ownerId, ...input });
  }

  async taskDetail(taskId: string) {
    const task = await this.projects.getTask(this.ownerId, taskId);
    if (!task) throw new ProjectMcpNotFoundError("Task not found");
    const [events, runs, structure] = await Promise.all([
      this.projects.listTaskEvents(this.ownerId, task.id),
      this.runs.listRunsByTask(this.ownerId, task.id, 20),
      this.structure.read(this.ownerId, task.id),
    ]);
    const bundles = await this.runs.listRunMemoryBundles(
      this.ownerId,
      runs.map((run) => run.id),
      20,
    );
    return {
      task,
      events,
      runs: runs.map((run) => ({
        ...run,
        memories: bundles.get(run.id)?.memories ?? [],
        linkedMemoryCount: bundles.get(run.id)?.linkedMemoryCount ?? 0,
      })),
      structure,
    };
  }

  async createTask(input: {
    projectId: string;
    title: string;
    description?: string;
    priority?: "low" | "medium" | "high" | "urgent";
    dueAt?: string;
    client: string;
    model: string;
    sourceUrl?: string;
  }) {
    const project = await this.projects.getProject(this.ownerId, input.projectId);
    if (!project || project.status === "archived") {
      throw new ProjectMcpNotFoundError("Project not found");
    }
    return this.projects.createTask({
      ownerId: this.ownerId,
      ...input,
      sourceType: "model",
    });
  }

  async updateTask(input: {
    taskId: string;
    expectedVersion: number;
    title?: string;
    description?: string | null;
    priority?: "low" | "medium" | "high" | "urgent";
    dueAt?: string | null;
    blockerSummary?: string | null;
    client: string;
    model: string;
    sourceUrl?: string;
    note?: string;
  }) {
    return this.projects.updateTask({
      ownerId: this.ownerId,
      ...input,
      actorType: "model",
    });
  }

  async moveTask(input: {
    taskId: string;
    expectedVersion: number;
    status: "inbox" | "planned" | "in_progress" | "blocked" | "review" | "done";
    position?: number;
    client: string;
    model: string;
    sourceUrl?: string;
    correlationId?: string;
    note?: string;
  }) {
    return this.projects.moveTask({
      ownerId: this.ownerId,
      ...input,
      actorType: "model",
    });
  }

  async archiveTask(input: {
    taskId: string;
    expectedVersion: number;
    client: string;
    model: string;
    sourceUrl?: string;
    note?: string;
  }) {
    return this.projects.archiveTask({
      ownerId: this.ownerId,
      ...input,
      actorType: "model",
    });
  }
}
