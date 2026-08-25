import { describe, expect, it } from "vitest";

import { renderObsidianProjection } from "./obsidian";

const baseInput = {
  generatedAt: "2026-08-23T00:00:00.000Z",
  projects: [{
    id: "p1",
    name: "Cloud / Memory",
    description: "Edge memory",
    colour: "#c9ff3b",
    status: "active",
    updatedAt: "2026-08-23T00:00:00.000Z",
  }],
  tasks: [{
    id: "t1",
    projectId: "p1",
    title: "Ship MCP",
    description: null,
    status: "in_progress",
    priority: "high",
    sourceType: "model",
    sourceClient: "Codex",
    sourceModel: "GPT-5",
    sourceUrl: "https://chatgpt.com/c/example",
    updatedAt: "2026-08-23T00:00:00.000Z",
  }],
};

describe("Obsidian managed projection", () => {
  it("keeps the legacy project projection and adds the managed index files", async () => {
    const files = await renderObsidianProjection(baseInput);
    const paths = files.map((file) => file.path);

    expect(paths).toContain("Cloud Memory/Projects/Cloud - Memory.md");
    expect(paths).toContain("Cloud Memory/Projects.base");
    expect(paths).toContain("Cloud Memory/README.md");
    expect(paths).toContain("Cloud Memory/System Status.md");
    expect(paths).toContain("Cloud Memory/Tasks/t1.md");
    expect(paths).toContain("Cloud Memory/Tasks.base");
    expect(paths).toContain("Cloud Memory/Memories.base");
    expect(paths).toContain("Cloud Memory/Agent Runs.base");
    expect(paths).toContain("Cloud Memory/Context Profile.md");
    expect(paths).toContain("Cloud Memory/Context Packs.md");
    expect(paths).toContain("Cloud Memory/Reflection Queue.md");
    expect(paths).toContain("Cloud Memory/Client Compatibility.md");
    expect(paths).toContain("Cloud Memory/Automation.md");
    expect(paths).toContain("Cloud Memory/Connector Runs.md");
    expect(paths).toContain("Cloud Memory/manifest.json");

    const project = files.find((file) => file.path === "Cloud Memory/Projects/Cloud - Memory.md");
    expect(project?.content).toContain("## In progress");
    expect(project?.content).toContain("GPT-5 via Codex");
    expect(project?.content).toContain("[open chat](https://chatgpt.com/c/example)");
    expect(project?.content).not.toContain("projected_at");
    expect(project?.sha256).toHaveLength(64);

    const manifest = JSON.parse(files.find((file) => file.path === "Cloud Memory/manifest.json")?.content ?? "{}") as {
      schemaVersion?: number;
      files?: Array<{ path: string; sha256: string; bytes: number }>;
    };
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.files?.every((file) => file.path.startsWith("Cloud Memory/") && file.sha256.length === 64 && file.bytes > 0)).toBe(true);
  });

  it("projects active and archived roadmap ideas without creating one file per idea", async () => {
    const files = await renderObsidianProjection({
      ...baseInput,
      roadmaps: [{
        id: "roadmap-next",
        projectId: "p1",
        title: "Add confidence trends",
        description: "Compare release evidence over time.",
        horizon: "next",
        status: "planned",
        impact: "high",
        effort: "small",
        sourceType: "model",
        sourceClient: "Codex",
        sourceModel: "GPT-5",
        sourceUrl: "https://chatgpt.com/c/roadmap",
        promotedTaskId: null,
        archivedAt: null,
        updatedAt: baseInput.generatedAt,
      }, {
        id: "roadmap-archive",
        projectId: "p1",
        title: "Explore shared workspaces",
        description: null,
        horizon: "someday",
        status: "archived",
        impact: "medium",
        effort: "large",
        sourceType: "model",
        sourceClient: "Claude Web",
        sourceModel: "Claude",
        sourceUrl: null,
        promotedTaskId: null,
        archivedAt: baseInput.generatedAt,
        updatedAt: baseInput.generatedAt,
      }],
    });
    const paths = files.map((file) => file.path);
    const roadmap = files.find((file) => file.path === "Cloud Memory/Roadmap.md")?.content ?? "";
    const project = files.find((file) => file.path === "Cloud Memory/Projects/Cloud - Memory.md")?.content ?? "";

    expect(paths).toContain("Cloud Memory/Roadmaps.base");
    expect(paths.filter((path) => path.startsWith("Cloud Memory/Roadmaps/"))).toEqual([]);
    expect(roadmap).toContain("# Project Roadmap");
    expect(roadmap).toContain("## What should I work on next?");
    expect(roadmap).toContain("GPT-5 via Codex");
    expect(roadmap).toContain("[open chat](https://chatgpt.com/c/roadmap)");
    expect(roadmap).toContain("## Archived ideas");
    expect(roadmap).toContain("Explore shared workspaces");
    expect(project).toContain("roadmap_count: 1");
    expect(project).toContain("roadmap_next_count: 1");
    expect(project).toContain("## Roadmap");
    expect(project).toContain("Add confidence trends");
  });

  it("renders bounded summaries, explicit decisions, review items and agent runs with privacy gates", async () => {
    const files = await renderObsidianProjection({
      ...baseInput,
      memories: [
        {
          id: "m-normal",
          kind: "memory",
          namespace: "default",
          content: "The normal durable fact.",
          status: "active",
          importance: 0.8,
          confidence: 0.9,
          sensitivity: "normal",
          sourceSystem: "MCP",
          updatedAt: "2026-08-23T00:00:00.000Z",
        },
        {
          id: "m-private",
          kind: "memory",
          namespace: "default",
          content: "PRIVATE MEMORY CONTENT MUST NOT APPEAR",
          status: "active",
          importance: 0.7,
          confidence: 0.8,
          sensitivity: "private",
          sourceSystem: "MCP",
          updatedAt: "2026-08-23T00:00:00.000Z",
        },
        {
          id: "m-sensitive",
          kind: "memory",
          namespace: "default",
          content: "SENSITIVE MEMORY CONTENT MUST NOT APPEAR",
          status: "active",
          importance: 0.7,
          confidence: 0.8,
          sensitivity: "sensitive",
          sourceSystem: "MCP",
          updatedAt: "2026-08-23T00:00:00.000Z",
        },
        {
          id: "d-decision",
          kind: "memory",
          namespace: "decisions",
          content: "Use encrypted backups.",
          status: "active",
          importance: 1,
          confidence: 1,
          sensitivity: "normal",
          sourceSystem: "MCP",
          updatedAt: "2026-08-23T00:00:00.000Z",
        },
      ],
      directives: [{
        id: "directive-private",
        kind: "directive",
        content: "PRIVATE DIRECTIVE CONTENT MUST NOT APPEAR",
        status: "active",
        importance: 1,
        sensitivity: "private",
        updatedAt: "2026-08-23T00:00:00.000Z",
      }],
      reviewItems: [{
        id: "review-1",
        type: "probable_duplicate",
        title: "Review normal capture",
        summary: "A bounded review item.",
        status: "open",
        sensitivity: "normal",
        updatedAt: "2026-08-23T00:00:00.000Z",
      }, {
        id: "review-private",
        type: "conflict",
        title: "PRIVATE REVIEW CONTENT MUST NOT APPEAR",
        status: "open",
        sensitivity: "private",
        updatedAt: "2026-08-23T00:00:00.000Z",
      }],
      agentRuns: [{
        id: "run-1",
        taskId: "t1",
        status: "completed",
        client: "Codex",
        model: "GPT-5",
        summary: "Verified the projection.",
        sensitivity: "normal",
        updatedAt: "2026-08-23T00:00:00.000Z",
      }],
      health: {
        status: "ok",
        service: "cloud-memory",
        version: "0.3.1",
        environment: "production",
        vectorIndex: { state: "ready", indexed: 10, pending: 0, failed: 0 },
      },
      capabilityReceipts: [{
        capability: "obsidian_projection",
        status: "configured",
        detail: "Projection source generated and hash-verified.",
        evidenceSha256: "a".repeat(64),
        source: "projection-source",
        checkedAt: "2026-08-22T00:00:00.000Z",
      }],
    });

    const content = files.map((file) => file.content).join("\n");
    expect(content).toContain("The normal durable fact.");
    expect(content).toContain("Use encrypted backups.");
    expect(content).toContain("Review normal capture");
    expect(content).toContain("Verified the projection.");
    expect(content).toContain("directive-private");
    expect(content).toContain("m-private");
    expect(content).not.toContain("PRIVATE MEMORY CONTENT MUST NOT APPEAR");
    expect(content).not.toContain("SENSITIVE MEMORY CONTENT MUST NOT APPEAR");
    expect(content).not.toContain("PRIVATE DIRECTIVE CONTENT MUST NOT APPEAR");
    expect(content).not.toContain("PRIVATE REVIEW CONTENT MUST NOT APPEAR");
    expect(files.map((file) => file.path)).toContain("Cloud Memory/Memories/m-normal.md");
    expect(files.map((file) => file.path)).not.toContain("Cloud Memory/Memories/m-sensitive.md");
    expect(files.map((file) => file.path)).toContain("Cloud Memory/Agent Runs/run-1.md");
    const status = files.find((file) => file.path === "Cloud Memory/System Status.md");
    expect(status?.content).toContain("## Capability receipts");
    expect(status?.content).toContain("obsidian_projection");
    expect(status?.content).toContain("Projection source generated and hash-verified.");
    expect(status?.content).not.toContain("2026-08-23T00:00:00.000Z");
  });

  it("redacts review and run content when sensitivity is not canonical", async () => {
    const files = await renderObsidianProjection({
      ...baseInput,
      reviewItems: [{
        id: "review-unclassified",
        type: "source_conflict",
        title: "PRIVATE REVIEW CANDIDATE",
        summary: "PRIVATE REVIEW SUMMARY",
        candidateContent: "PRIVATE REVIEW CONTENT",
        status: "open",
        updatedAt: baseInput.generatedAt,
        sourceUrl: "https://example.com/source",
      }],
      agentRuns: [{
        id: "run-unclassified",
        status: "failed",
        client: "Codex",
        model: "GPT-5",
        receipt: "PRIVATE AGENT RECEIPT",
        sourceUrl: "https://example.com/run-source",
        updatedAt: baseInput.generatedAt,
      }],
    });

    const content = files.map((file) => file.content).join("\n");
    expect(content).toContain("review-unclassified");
    expect(content).toContain("run-unclassified");
    expect(content).toContain("https://example.com/source");
    expect(content).toContain("https://example.com/run-source");
    expect(content).toContain('sensitivity: "unknown"');
    expect(content).not.toContain("PRIVATE REVIEW CANDIDATE");
    expect(content).not.toContain("PRIVATE REVIEW SUMMARY");
    expect(content).not.toContain("PRIVATE REVIEW CONTENT");
    expect(content).not.toContain("PRIVATE AGENT RECEIPT");
  });

  it("keeps deterministic task and Memory Doctor review details useful", async () => {
    const files = await renderObsidianProjection({
      ...baseInput,
      tasks: [{
        ...baseInput.tasks[0],
        status: "review",
        title: "Approve projection release",
        description: "Confirm the managed files before publishing.",
      }],
      reviewItems: [{
        id: "doctor-1",
        type: "memory_doctor",
        title: "Memory review is due",
        summary: "Confirm, correct or supersede this memory through an explicit review action.",
        contentPolicy: "derived-safe",
        status: "open",
        updatedAt: baseInput.generatedAt,
      }],
    });

    const reviewQueue = files.find((file) => file.path === "Cloud Memory/Review Queue.md")?.content;
    expect(reviewQueue).toContain("Approve projection release");
    expect(reviewQueue).toContain("Confirm the managed files before publishing.");
    expect(reviewQueue).toContain("Memory review is due");
    expect(reviewQueue).toContain("Confirm, correct or supersede this memory");
  });

  it("keeps directives bounded independently and uses typed decisions", async () => {
    const files = await renderObsidianProjection({
      ...baseInput,
      memories: Array.from({ length: 100 }, (_, index) => ({
        id: `memory-${index}`,
        kind: "memory" as const,
        memoryType: index === 0 ? "decision" : "fact",
        namespace: "default",
        content: index === 0 ? "Typed decision content" : `Memory ${index}`,
        status: "active",
        importance: 1,
        updatedAt: `2026-08-${String(23 - Math.floor(index / 24)).padStart(2, "0")}T00:00:00.000Z`,
      })),
      directives: [{
        id: "directive-independent",
        kind: "directive",
        content: "Standing directive remains visible",
        status: "active",
        importance: 1,
        updatedAt: baseInput.generatedAt,
      }],
    });

    const summary = files.find((file) => file.path === "Cloud Memory/Memory Summary.md")?.content ?? "";
    const directives = files.find((file) => file.path === "Cloud Memory/Directives.md")?.content ?? "";
    const decisions = files.find((file) => file.path === "Cloud Memory/Recent Decisions.md")?.content ?? "";
    expect(summary).toContain("Typed decision content");
    expect(directives).toContain("Standing directive remains visible");
    expect(decisions).toContain("Typed decision content");
  });

  it("keeps legacy mixed memory input separated into memory and directive summaries", async () => {
    const files = await renderObsidianProjection({
      ...baseInput,
      memories: [{
        id: "m-legacy",
        kind: "memory",
        content: "A normal memory summary.",
        status: "active",
        updatedAt: baseInput.generatedAt,
      }, {
        id: "d-legacy",
        kind: "directive",
        content: "A standing directive summary.",
        status: "active",
        updatedAt: baseInput.generatedAt,
      }],
    });
    const memorySummary = files.find((file) => file.path === "Cloud Memory/Memory Summary.md")?.content ?? "";
    const directives = files.find((file) => file.path === "Cloud Memory/Directives.md")?.content ?? "";
    expect(memorySummary).toContain("A normal memory summary.");
    expect(memorySummary).not.toContain("A standing directive summary.");
    expect(directives).toContain("A standing directive summary.");
  });

  it("projects active directives as labelled managed notes with a dedicated Base", async () => {
    const files = await renderObsidianProjection({
      ...baseInput,
      directives: [{
        id: "directive-labelled",
        kind: "directive",
        memoryType: "preference",
        content: "Use Australian English in owner-facing copy.",
        status: "active",
        labels: ["writing", "owner preference"],
        version: 4,
        sourceClient: "Codex",
        sourceUrl: "https://chatgpt.com/c/directive-source",
        updatedAt: baseInput.generatedAt,
      }],
    });

    const note = files.find((file) => file.path === "Cloud Memory/Directives/directive-labelled.md");
    expect(note?.content).toContain('record_type: "directive"');
    expect(note?.content).toContain('labels: ["owner preference","writing"]');
    expect(note?.content).toContain("cloud_memory_managed: true");
    expect(note?.content).toContain("Use Australian English");
    expect(files.map((file) => file.path)).toContain("Cloud Memory/Directives.base");
  });

  it("renders archived records in exact archive folders with restore guidance and privacy gates", async () => {
    const files = await renderObsidianProjection({
      ...baseInput,
      archivedProjects: [{
        ...baseInput.projects[0],
        id: "p-archived",
        name: "Finished rollout",
        status: "archived",
        archivedAt: "2026-08-22T00:00:00.000Z",
      }],
      archivedTasks: [{
        ...baseInput.tasks[0],
        id: "t-archived",
        projectId: "p-archived",
        archivedAt: "2026-08-22T01:00:00.000Z",
      }],
      archivedMemories: [{
        id: "m-archived",
        kind: "memory",
        content: "A retained archived memory.",
        status: "archived",
        labels: ["historical"],
        sensitivity: "normal",
        archivedAt: "2026-08-22T02:00:00.000Z",
        updatedAt: "2026-08-22T02:00:00.000Z",
      }, {
        id: "m-archived-private",
        kind: "memory",
        content: "PRIVATE ARCHIVED CONTENT MUST NOT APPEAR",
        status: "archived",
        sensitivity: "private",
        archivedAt: "2026-08-22T03:00:00.000Z",
        updatedAt: "2026-08-22T03:00:00.000Z",
      }],
      archivedDirectives: [{
        id: "d-archived",
        kind: "directive",
        content: "A retired directive.",
        status: "archived",
        sensitivity: "normal",
        archivedAt: "2026-08-22T04:00:00.000Z",
        updatedAt: "2026-08-22T04:00:00.000Z",
      }],
    });

    const paths = files.map((file) => file.path);
    expect(paths).toContain("Cloud Memory/Archive/Projects/Finished rollout.md");
    expect(paths).toContain("Cloud Memory/Archive/Tasks/t-archived.md");
    expect(paths).toContain("Cloud Memory/Archive/Memories/m-archived.md");
    expect(paths).toContain("Cloud Memory/Archive/Directives/d-archived.md");
    expect(paths).toContain("Cloud Memory/Archive/Archive Index.md");
    expect(paths).toContain("Cloud Memory/Archive.base");
    const content = files.map((file) => file.content).join("\n");
    expect(content).toContain("Restore records in Cloud Memory");
    expect(content).toContain("A retained archived memory.");
    expect(content).not.toContain("PRIVATE ARCHIVED CONTENT MUST NOT APPEAR");
  });

  it("stays under the global file budget and reports omitted detail", async () => {
    const memories = Array.from({ length: 100 }, (_, index) => ({
      id: `active-memory-${index}`,
      kind: "memory" as const,
      content: `Active memory ${index}`,
      status: "active",
      updatedAt: baseInput.generatedAt,
    }));
    const archivedMemories = Array.from({ length: 100 }, (_, index) => ({
      id: `archived-memory-${index}`,
      kind: "memory" as const,
      content: `Archived memory ${index}`,
      status: "archived",
      archivedAt: baseInput.generatedAt,
      updatedAt: baseInput.generatedAt,
    }));
    const directives = Array.from({ length: 100 }, (_, index) => ({
      id: `active-directive-${index}`,
      kind: "directive" as const,
      content: `Active directive ${index}`,
      status: "active",
      updatedAt: baseInput.generatedAt,
    }));
    const archivedDirectives = directives.map((directive, index) => ({
      ...directive,
      id: `archived-directive-${index}`,
      status: "archived",
      archivedAt: baseInput.generatedAt,
    }));
    const files = await renderObsidianProjection({
      ...baseInput,
      memories,
      directives,
      archivedMemories,
      archivedDirectives,
      agentRuns: Array.from({ length: 100 }, (_, index) => ({
        id: `run-${index}`,
        status: "completed",
        sensitivity: "normal" as const,
        updatedAt: baseInput.generatedAt,
      })),
    });

    expect(files.length).toBeLessThan(500);
    const readme = files.find((file) => file.path === "Cloud Memory/README.md")?.content ?? "";
    expect(readme).toContain("detail files omitted");
    const manifest = JSON.parse(files.at(-1)?.content ?? "{}") as { files?: unknown[] };
    expect(manifest.files).toHaveLength(files.length - 1);
  });

  it("is stable when only the projection timestamp changes", async () => {
    const first = await renderObsidianProjection(baseInput);
    const second = await renderObsidianProjection({
      ...baseInput,
      generatedAt: "2026-08-24T00:00:00.000Z",
    });
    const firstStable = new Map(first
      .filter((file) => !["Cloud Memory/README.md", "Cloud Memory/manifest.json"].includes(file.path))
      .map((file) => [file.path, file.sha256]));
    const secondStable = new Map(second
      .filter((file) => !["Cloud Memory/README.md", "Cloud Memory/manifest.json"].includes(file.path))
      .map((file) => [file.path, file.sha256]));

    expect([...firstStable.entries()]).toEqual([...secondStable.entries()]);
    expect(first.find((file) => file.path === "Cloud Memory/README.md")?.content)
      .toContain("2026-08-23T00:00:00.000Z");
    expect(first.find((file) => file.path === "Cloud Memory/manifest.json")?.content)
      .toContain("2026-08-23T00:00:00.000Z");
  });

  it("keeps colliding project and task names on unique safe paths", async () => {
    const files = await renderObsidianProjection({
      ...baseInput,
      projects: [
        ...baseInput.projects,
        { ...baseInput.projects[0], id: "p2", name: "Cloud : Memory" },
      ],
      tasks: [
        ...baseInput.tasks,
        { ...baseInput.tasks[0], id: "t2", projectId: "p2" },
      ],
    });
    const paths = files.map((file) => file.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.filter((path) => path.includes("Projects/")).every((path) => !path.includes("/../"))).toBe(true);
    expect(paths.filter((path) => path.includes("Tasks/")).every((path) => !path.includes("/../"))).toBe(true);
    expect(paths.filter((path) => path.startsWith("Cloud Memory/")).length).toBe(paths.length);
  });
});
