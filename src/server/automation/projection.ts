import type { Env } from "../env";
import { AutomationRunStore } from "./runs";
import { ClientCompatibilityStore } from "../clients/receipts";
import { ConnectorRunStore } from "../connectors/runs";
import { MemoryDoctor } from "../memory/doctor";
import { MemoryReviewStore } from "../memory/review";
import { MemoryStore } from "../memory/store";
import { CapabilityReceiptStore } from "../operations/receipts";
import { AgentRunStore } from "../projects/runs";
import { ProjectStore } from "../projects/store";
import { ContextProfileStore } from "../profiles/store";
import { renderObsidianProjection, type ObsidianProjectionFile } from "../projection/obsidian";
import { RoadmapStore } from "../roadmaps/store";
import { ReflectionStore } from "../reflection/store";
import { SERVICE_VERSION } from "../version";

export interface OwnerProjection {
  schemaVersion: 2;
  mode: "managed-read-only";
  generatedAt: string;
  files: ObsidianProjectionFile[];
}

export async function buildOwnerProjection(input: {
  env: Env;
  ownerId: string;
  generatedAt?: string;
}): Promise<OwnerProjection> {
  const store = new ProjectStore(input.env.DB);
  const memories = new MemoryStore(input.env.DB);
  const [
    projects,
    tasks,
    projectedMemories,
    projectedDirectives,
    archivedProjects,
    archivedTasks,
    archivedMemories,
    archivedDirectives,
    memoryCounts,
    reviews,
    doctorFindings,
    agentRuns,
    capabilityReceipts,
    roadmaps,
    profileContext,
    reflectionProposals,
    automationRuns,
    connectorRuns,
    clientReceipts,
  ] = await Promise.all([
    store.listProjects(input.ownerId, "active"),
    store.listTasks(input.ownerId, "active"),
    memories.listLibrary({ ownerId: input.ownerId, status: "active", kind: "memory", limit: 100 }),
    memories.listLibrary({ ownerId: input.ownerId, status: "active", kind: "directive", limit: 100 }),
    store.listProjects(input.ownerId, "archived"),
    store.listArchivedTasks(input.ownerId, 100),
    memories.listLibrary({ ownerId: input.ownerId, status: "archived", kind: "memory", limit: 100 }),
    memories.listLibrary({ ownerId: input.ownerId, status: "archived", kind: "directive", limit: 100 }),
    memories.counts(input.ownerId),
    new MemoryReviewStore(input.env.DB).listReviews({ ownerId: input.ownerId, status: "open", limit: 100 }),
    new MemoryDoctor(input.env.DB).list(input.ownerId, "open", 100),
    new AgentRunStore(input.env.DB).listRecent(input.ownerId, 100),
    new CapabilityReceiptStore(input.env.DB).list(input.ownerId),
    new RoadmapStore(input.env.DB).list(input.ownerId, { scope: "all", limit: 100 }),
    new ContextProfileStore(input.env.DB).list(input.ownerId),
    new ReflectionStore(input.env.DB).list(input.ownerId, "open", 100),
    new AutomationRunStore(input.env.DB).list(input.ownerId, 50),
    new ConnectorRunStore(input.env.DB).list(input.ownerId, 50),
    new ClientCompatibilityStore(input.env.DB).list(input.ownerId),
  ]);
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const files = await renderObsidianProjection({
    generatedAt,
    projects,
    tasks,
    memories: projectedMemories.items,
    directives: projectedDirectives.items,
    archivedProjects,
    archivedTasks,
    archivedMemories: archivedMemories.items,
    archivedDirectives: archivedDirectives.items,
    roadmaps: roadmaps.items,
    reviewItems: [
      ...reviews,
      ...doctorFindings.map((finding) => ({
        ...finding,
        type: "memory_doctor",
        contentPolicy: "derived-safe" as const,
        reviewType: finding.findingType,
        reason: finding.detail,
        updatedAt: finding.createdAt,
      })),
    ],
    agentRuns: agentRuns.map((run) => ({
      ...run,
      projectId: run.taskId ? taskById.get(run.taskId)?.projectId ?? null : null,
    })),
    health: {
      status: memoryCounts.failed > 0 ? "degraded" : "ok",
      service: "Cloud Memory projection source",
      version: SERVICE_VERSION,
      environment: input.env.APP_ENV,
      vectorIndex: {
        state: memoryCounts.failed > 0 ? "repair-needed" : "healthy",
        indexed: memoryCounts.indexed,
        pending: memoryCounts.pending,
        failed: memoryCounts.failed,
      },
    },
    capabilityReceipts,
    profileFacets: profileContext.facets,
    contextPacks: profileContext.packs,
    reflectionProposals,
    automationRuns,
    connectorRuns,
    clientReceipts,
  });
  return { schemaVersion: 2, mode: "managed-read-only", generatedAt, files };
}
