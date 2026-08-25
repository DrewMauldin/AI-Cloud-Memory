import { useCallback, useEffect, useMemo, useState } from "react";
import { SERVICE_RELEASE } from "../server/version";

import { ApiError, api } from "./api";
import { AppShell, type ViewId } from "./components/AppShell";
import { CommandCentreViews } from "./components/CommandCentreViews";
import { ContextGraphPanel } from "./components/ContextGraphPanel";
import { LifecycleActivityPanel } from "./components/LifecycleActivityPanel";
import { MemoryLibrary } from "./components/MemoryLibrary";
import { MemoryResultCard } from "./components/MemoryResultCard";
import { MemoryReviewPanel, type MemoryReviewDecision } from "./components/MemoryReviewPanel";
import { ProjectPortfolio } from "./components/ProjectPortfolio";
import { CompatibilityCentre, ConnectorWorkbench, MemoryIntelligencePanel } from "./components/PlatformWorkspaces";
import { RoadmapWorkspace } from "./components/RoadmapWorkspace";
import { TaskDrawer } from "./components/TaskDrawer";
import { useDialog } from "./components/useDialog";
import { applyUiPreferences, DEFAULT_UI_PREFERENCES, loadUiPreferences, saveUiPreferences, type UiPreferences } from "./preferences";
import type { AgentRun, CapabilityReceipt, ContextGraphSnapshot, DoctorFinding, MemoryReview, Project, RankedMemory, Session, Task, TaskStatus } from "./types";

interface ServiceHealth {
  status: "ok" | "degraded";
  environment: string;
  checkedAt: string;
  checks?: { worker: string; d1: string; vectorize: string; workersAi: string };
}

const VIEW_PATHS: Record<ViewId, string> = {
  command: "/",
  projects: "/projects",
  roadmap: "/roadmap",
  memory: "/memory",
  migration: "/migration",
  connections: "/connections",
  settings: "/settings",
};

function viewFromPath(path: string): ViewId {
  if (path.startsWith("/projects")) return "projects";
  if (path.startsWith("/roadmap")) return "roadmap";
  if (path.startsWith("/memory")) return "memory";
  if (path.startsWith("/migration")) return "migration";
  if (path.startsWith("/connections")) return "connections";
  if (path.startsWith("/settings")) return "settings";
  return "command";
}

export function LoginScreen() {
  return (
    <main className="login-screen">
      <div className="login-grid" aria-hidden="true" />
      <header className="login-header">
        <span className="login-brand"><span className="wordmark__mark" aria-hidden="true">CM</span><strong>AI Cloud Memory</strong></span>
        <span>Community Edition · owner-only infrastructure</span>
      </header>
      <section className="login-stage">
        <div className="login-hero">
          <p className="eyebrow">PRIVATE CONTEXT / EVERY MODEL</p>
          <h1>Your work has context.<br /><em>Keep it in reach.</em></h1>
          <p className="login-deck">A private memory and project command centre that gives every approved AI client the same trusted context, provenance and next action.</p>
          <a className="login-action" href="/login"><span>Enter with GitHub</span><strong aria-hidden="true">↗</strong></a>
          <a className="login-setup-link" href="/setup.html">Set up this instance →</a>
          <p className="login-auth-note">Immutable owner allowlist · scoped OAuth · no public workspace</p>
        </div>
        <aside className="login-signal" aria-label="Cloud Memory architecture">
          <header><p className="eyebrow">LIVE ARCHITECTURE</p><span>{SERVICE_RELEASE}</span></header>
          <div className="login-signal__core" aria-hidden="true"><span>CM</span><i /><i /><i /></div>
          <ol>
            <li><span>01</span><div><strong>Remember</strong><small>D1 canonical truth</small></div><em>LOCKED</em></li>
            <li><span>02</span><div><strong>Retrieve</strong><small>Explainable ranked context</small></div><em>BOUNDED</em></li>
            <li><span>03</span><div><strong>Act</strong><small>Projects with receipts</small></div><em>TRACEABLE</em></li>
          </ol>
        </aside>
      </section>
      <section className="login-capabilities" aria-label="Cloud Memory capabilities">
        <article><span>01 / RECALL</span><strong>Context with reasons.</strong><p>Lexical and temporal ranking works by default; semantic search is an optional enhancement.</p></article>
        <article><span>02 / COMMAND</span><strong>Work with provenance.</strong><p>Projects, Kanban and agent runs retain their model, client and source chat.</p></article>
        <article><span>03 / PORTABILITY</span><strong>Canonical, not captive.</strong><p>Encrypted exports and a managed Obsidian projection keep the system portable.</p></article>
      </section>
      <footer className="login-footer"><span>ChatGPT / Codex / Claude / OpenCode</span><span>Cloudflare Worker + D1 · optional Vectorize + Workers AI</span></footer>
    </main>
  );
}

function PageHeader({ eyebrow, title, deck, action }: { eyebrow: string; title: string; deck: string; action?: React.ReactNode }) {
  return (
    <header className="page-header">
      <div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{deck}</p></div>
      {action}
    </header>
  );
}

function Metric({ number, label, annotation }: { number: string | number; label: string; annotation: string }) {
  return <article className="metric"><p>{label}</p><strong>{number}</strong><span>{annotation}</span></article>;
}

function CommandCentre({ projects, tasks, memoryReviewCount, onNavigate, health }: { projects: Project[]; tasks: Task[]; memoryReviewCount: number; onNavigate: (view: ViewId) => void; health: ServiceHealth | null }) {
  const activeProjects = projects.filter((project) => project.status === "active");
  const active = tasks.filter((task) => task.status === "in_progress").length;
  const needsAttention = tasks.filter((task) => (task.attentionReasons?.length ?? 0) > 0);
  const totalAttention = needsAttention.length + memoryReviewCount;
  const review = tasks.filter((task) => task.status === "review").length;
  return (
    <>
      <PageHeader eyebrow="01 / COMMAND CENTRE" title="Your context, in motion." deck="A live read on the work, decisions and connections moving through your private memory." action={<button className="secondary-button" onClick={() => onNavigate("projects")}>Open task board ↗</button>} />
      <section className="metric-grid" aria-label="Workspace summary">
        <Metric number={activeProjects.length} label="Active projects" annotation="Paused and completed projects excluded" />
        <Metric number={active} label="In motion" annotation="Tasks being actively progressed" />
        <Metric number={totalAttention} label="Needs attention" annotation={totalAttention === 0 ? "No known attention signals" : "Tasks and memory reviews awaiting you"} />
        <Metric number={review} label="Awaiting review" annotation="Ready for a human checkpoint" />
      </section>
      <section className="command-grid">
        <article className="signal-panel signal-panel--large">
          <header><p className="eyebrow">LIVE SIGNAL</p><span className={health?.status === "ok" ? "live-indicator" : "status-unknown"}>● {health?.status === "ok" ? "WORKER + D1 VERIFIED" : health ? "SERVICE DEGRADED" : "STATUS NOT CHECKED"}</span></header>
          <h2>{active ? `${active} task${active === 1 ? " is" : "s are"} moving now.` : "The board is quiet."}</h2>
          <p>{totalAttention ? `${totalAttention} item${totalAttention === 1 ? " needs" : "s need"} a decision or checkpoint.` : "There are no recorded attention signals. New work lands in Inbox before it enters the plan."}</p>
          <button className="text-button" onClick={() => onNavigate("projects")}>Inspect the workflow →</button>
        </article>
        <article className="signal-panel attention-panel">
          <header><p className="eyebrow">NEEDS ME</p><span>{totalAttention}</span></header>
          {totalAttention ? <ol>{memoryReviewCount ? <li><button onClick={() => onNavigate("memory")}><strong>{memoryReviewCount} memory review{memoryReviewCount === 1 ? "" : "s"}</strong><span>Review queue · explicit decision required</span></button></li> : null}{needsAttention.slice(0, memoryReviewCount ? 4 : 5).map((task) => <li key={task.id}><button onClick={() => onNavigate("projects")}><strong>{task.title}</strong><span>{task.attentionReasons?.join(" · ").replaceAll("_", " ")}</span></button></li>)}</ol> : <div className="attention-clear"><span>✓</span><p>No blocked, overdue, stale or review work.</p></div>}
        </article>
        <article className="signal-panel">
          <header><p className="eyebrow">MEMORY FABRIC</p><span>HYBRID</span></header>
          <div className="orbital-mark" aria-hidden="true"><span /><i /></div>
          <h3>Meaning, not just keywords.</h3><p>D1 remains canonical while Vectorize provides a rebuildable semantic index.</p>
        </article>
        <article className="signal-panel">
          <header><p className="eyebrow">TRUST BOUNDARY</p><span>OWNER ONLY</span></header>
          <ul className="status-list"><li><span>GitHub identity</span><strong>Locked</strong></li><li><span>MCP authorisation</span><strong>Scoped</strong></li><li><span>Export format</span><strong>Encrypted</strong></li></ul>
        </article>
      </section>
    </>
  );
}

export function NewProjectPanel({ onCreated, onClose }: { onCreated: (project: Project) => void; onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useDialog(onClose);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    try {
      onCreated(await api.createProject({
        name: String(data.get("name")),
        description: String(data.get("description") || "") || undefined,
        colour: String(data.get("colour") || "#c9ff3b"),
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Project could not be created");
      setSaving(false);
    }
  }
  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside ref={dialogRef} className="task-drawer form-drawer" role="dialog" aria-modal="true" aria-labelledby="new-project-title">
        <header><p className="eyebrow">NEW / PROJECT</p><button className="icon-button" onClick={onClose} aria-label="Close project form">×</button></header>
        <h2 id="new-project-title">Give the work a home.</h2>
        <form className="editor-form" onSubmit={submit}>
          <label>Name<input name="name" required maxLength={120} autoFocus /></label>
          <label>Description<textarea name="description" rows={4} maxLength={2000} /></label>
          <label>Signal colour<input name="colour" type="color" defaultValue="#c9ff3b" /></label>
          {error ? <p className="error-copy" role="alert">{error}</p> : null}
          <button className="primary-button" disabled={saving}>{saving ? "Creating…" : "Create project"}</button>
        </form>
      </aside>
    </div>
  );
}

function NewTaskPanel({ projects, onCreated, onClose }: { projects: Project[]; onCreated: (task: Task) => void; onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceType, setSourceType] = useState<Task["sourceType"]>("human");
  const dialogRef = useDialog(onClose);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(null);
    const data = new FormData(event.currentTarget);
    try {
      const dueAt = String(data.get("dueAt") || "");
      const task = await api.createTask({
        projectId: String(data.get("projectId")), title: String(data.get("title")),
        description: String(data.get("description") || "") || undefined,
        priority: String(data.get("priority")) as Task["priority"], sourceType,
        dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
        client: String(data.get("client") || "") || undefined,
        model: String(data.get("model") || "") || undefined,
        sourceUrl: String(data.get("sourceUrl") || "") || undefined,
      });
      onCreated(task);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Task could not be created"); setSaving(false); }
  }
  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside ref={dialogRef} className="task-drawer form-drawer" role="dialog" aria-modal="true" aria-labelledby="new-task-title">
        <header><p className="eyebrow">NEW / TASK</p><button className="icon-button" onClick={onClose} aria-label="Close task form">×</button></header>
        <h2 id="new-task-title">Put work into motion.</h2>
        <form className="editor-form" onSubmit={submit}>
          <label>Project<select name="projectId" required>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>
          <label>Title<input name="title" required maxLength={240} autoFocus /></label>
          <label>Description<textarea name="description" rows={4} maxLength={5000} /></label>
          <div className="form-row"><label>Priority<select name="priority" defaultValue="medium"><option>low</option><option>medium</option><option>high</option><option>urgent</option></select></label><label>Origin<select value={sourceType} onChange={(event) => setSourceType(event.target.value as Task["sourceType"])}><option value="human">Human</option><option value="model">AI model</option><option value="automation">Automation</option><option value="import">Import</option></select></label></div>
          <label>Due date <span>(optional)</span><input name="dueAt" type="datetime-local" /></label>
          {sourceType !== "human" ? <div className="form-row"><label>Client<input name="client" maxLength={100} placeholder="Codex" /></label><label>Model<input name="model" maxLength={100} placeholder="GPT-5" /></label></div> : null}
          <label>Original chat URL <span>(optional)</span><input name="sourceUrl" type="url" /></label>
          {error ? <p className="error-copy" role="alert">{error}</p> : null}
          <button className="primary-button" disabled={saving}>{saving ? "Creating…" : "Create in Inbox"}</button>
        </form>
      </aside>
    </div>
  );
}

function ProjectsView({ projects, tasks, agentRuns, expandCompletedTasks, doneBoardRetentionDays, onMove, onOpen, onTaskArchived, onTaskCreated, onProjectCreated, onProjectArchived, onProjectRestored }: { projects: Project[]; tasks: Task[]; agentRuns: AgentRun[]; expandCompletedTasks: boolean; doneBoardRetentionDays: UiPreferences["doneBoardRetentionDays"]; onMove: (task: Task, status: TaskStatus, position?: number) => void | Promise<void>; onOpen: (task: Task) => void; onTaskArchived: (task: Task) => void | Promise<void>; onTaskCreated: (task: Task) => void; onProjectCreated: (project: Project) => void; onProjectArchived: (project: Project) => void; onProjectRestored: (project: Project, tasks: Task[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [addingProject, setAddingProject] = useState(false);
  return <><PageHeader eyebrow="02 / PROJECTS" title="Work, with receipts." deck="See every project’s status and outstanding work at a glance, with model, client and conversation provenance close at hand." action={<div className="page-actions"><button className="secondary-button" onClick={() => setAddingProject(true)}>+ New project</button><button className="primary-button" disabled={!projects.length} onClick={() => setAdding(true)}>+ New task</button></div>} /><ProjectPortfolio projects={projects} tasks={tasks} onArchived={onProjectArchived} onRestored={onProjectRestored} onTaskCompleted={(task) => onMove(task, "done")} onTaskArchived={onTaskArchived} expandCompletedTasks={expandCompletedTasks} />{projects.length ? <CommandCentreViews projects={projects} tasks={tasks} agentRuns={agentRuns} initialView="needs_me" syncUrl onMoveTask={onMove} onOpenTask={onOpen} doneBoardRetentionDays={doneBoardRetentionDays} /> : <section className="empty-state first-project"><span>01</span><h2>Create your first project.</h2><p>A project gives tasks, provenance and Obsidian projections a stable home.</p><button className="primary-button" onClick={() => setAddingProject(true)}>Create project</button></section>}{adding ? <NewTaskPanel projects={projects} onCreated={(task) => { onTaskCreated(task); setAdding(false); }} onClose={() => setAdding(false)} /> : null}{addingProject ? <NewProjectPanel onCreated={(project) => { onProjectCreated(project); setAddingProject(false); }} onClose={() => setAddingProject(false)} /> : null}</>;
}

function MemoryView({ projects }: { projects: Project[] }) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"exact" | "semantic" | "hybrid">("hybrid");
  const [results, setResults] = useState<RankedMemory[]>([]);
  const [searching, setSearching] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviews, setReviews] = useState<MemoryReview[]>([]);
  const [doctorFindings, setDoctorFindings] = useState<DoctorFinding[]>([]);
  const [contextGraph, setContextGraph] = useState<ContextGraphSnapshot | null>(null);
  const [graphLoading, setGraphLoading] = useState(true);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [resolvingReviewId, setResolvingReviewId] = useState<string | null>(null);
  const [trustNotice, setTrustNotice] = useState<string | null>(null);
  useEffect(() => {
    void api.memoryReviews().then((result) => setReviews(result.reviews)).catch(() => undefined);
    void api.memoryDoctor().then((result) => setDoctorFindings(result.findings)).catch(() => undefined);
    void api.contextGraph()
      .then(setContextGraph)
      .catch((reason: unknown) => setGraphError(reason instanceof Error ? reason.message : "Context graph could not be loaded"))
      .finally(() => setGraphLoading(false));
  }, []);
  async function search(event: React.FormEvent) { event.preventDefault(); if (!query.trim()) return; setSearching(true); setError(null); try { const data = await api.searchMemories(query, mode); setResults(data.results); setDegraded(data.semanticDegraded); } catch (reason) { setError(reason instanceof Error ? reason.message : "Search failed"); } finally { setSearching(false); } }
  async function resolveReview(reviewId: string, expectedVersion: number, status: MemoryReviewDecision) {
    const review = reviews.find((item) => item.id === reviewId && item.version === expectedVersion);
    if (!review) return;
    setResolvingReviewId(reviewId);
    try {
      await api.resolveMemoryReview(review, status);
      setReviews((current) => current.filter((item) => item.id !== reviewId));
      setTrustNotice(`Review marked ${status}. Canonical memory was not changed.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Review could not be resolved");
    } finally {
      setResolvingReviewId(null);
    }
  }
  async function rate(result: RankedMemory, rank: number, label: "helpful" | "not_helpful" | "outdated" | "incorrect") {
    try {
      await api.memoryFeedback({ memoryId: result.memory.id, query, label, mode, rank, score: result.score, correlationId: crypto.randomUUID() });
      setTrustNotice("Feedback saved as a query hash. The raw query was not retained.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Feedback could not be saved");
    }
  }
  async function runDoctor() {
    try {
      const result = await api.runMemoryDoctor();
      setDoctorFindings(result.findings);
      setTrustNotice(`Memory Doctor examined ${result.examined} active memories and changed none.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Memory Doctor could not run");
    }
  }
  async function reloadGraph() {
    setGraphLoading(true);
    setGraphError(null);
    try {
      setContextGraph(await api.contextGraph());
    } catch (reason) {
      setGraphError(reason instanceof Error ? reason.message : "Context graph could not be loaded");
    } finally {
      setGraphLoading(false);
    }
  }
  return <>
    <PageHeader
      eyebrow="03 / MEMORY LIBRARY"
      title="Every useful truth, in reach."
      deck="Browse, label and maintain memories and directives without losing provenance, history or the source conversation."
      action={<button className="secondary-button" onClick={runDoctor}>Run Memory Doctor ↗</button>}
    />
    <MemoryLibrary reviewCount={reviews.length} projects={projects} />
    <LifecycleActivityPanel />
    <details className="trust-lab" open={results.length > 0}>
      <summary><span><small>SEMANTIC RECALL</small><strong>Ask by meaning, then inspect the evidence.</strong></span><em>Open Trust Lab</em></summary>
      <form className="memory-search" onSubmit={search}>
        <label className="search-field"><span className="sr-only">Search memory semantically</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="What do I remember about…" /><button disabled={searching}>{searching ? "Searching" : "Recall ↗"}</button></label>
        <div className="mode-switch" aria-label="Search mode">{(["exact", "semantic", "hybrid"] as const).map((item) => <button type="button" className={mode === item ? "is-active" : ""} aria-pressed={mode === item} onClick={() => setMode(item)} key={item}>{item}</button>)}</div>
      </form>
      {degraded ? <p className="warning-banner">Semantic search is temporarily unavailable. Exact D1 results are shown.</p> : null}
      {trustNotice ? <p className="success-banner" role="status">{trustNotice}</p> : null}
      {error ? <p className="error-copy" role="alert">{error}</p> : null}
      <section className="memory-results" aria-live="polite">{results.length ? results.map((result, index) => <MemoryResultCard key={result.memory.id} result={result} onFeedback={(label) => rate(result, index + 1, label)} />) : <div className="empty-state"><span>⌁</span><h2>Ask by meaning.</h2><p>Hybrid recall explains the exact, semantic and temporal signals behind every result.</p></div>}</section>
      <MemoryReviewPanel reviews={reviews} resolvingReviewId={resolvingReviewId} onApprove={(id, version) => resolveReview(id, version, "approved")} onReject={(id, version) => resolveReview(id, version, "rejected")} onDismiss={(id, version) => resolveReview(id, version, "dismissed")} />
      {doctorFindings.length ? <section className="doctor-panel"><header><p className="eyebrow">MEMORY DOCTOR / PROPOSALS ONLY</p><span>{doctorFindings.length}</span></header>{doctorFindings.map((finding) => <article key={finding.id}><div><strong>{finding.title}</strong><p>{finding.detail}</p></div><span>{finding.severity}</span></article>)}</section> : null}
      <ContextGraphPanel graph={contextGraph} loading={graphLoading} error={graphError} onRetry={() => void reloadGraph()} />
    </details>
  </>;
}

interface ImportDryRun {
  runId: string;
  manifestSha256: string;
  counts: { examined: number; new: number; duplicate: number; probableDuplicate: number; conflict: number; malformed: number; sensitive: number };
}

export function trueMemoryApplyBatches(jsonl: string): unknown[][] {
  const records: unknown[] = [];
  const lines = jsonl.split(/\r?\n/).filter((line) => line.trim().length > 0);
  for (const line of lines.slice(1)) {
    try {
      const value = JSON.parse(line) as unknown;
      if (value && typeof value === "object" && "type" in value && value.type === "memory") {
        records.push(value);
      }
    } catch {
      // Malformed records are quarantined by the approved dry run.
    }
  }
  const batches: unknown[][] = [];
  for (let offset = 0; offset < records.length; offset += 10) {
    batches.push(records.slice(offset, offset + 10));
  }
  return batches;
}

function MigrationView({ onNotice }: { onNotice: (notice: string) => void }) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [jsonl, setJsonl] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState<ImportDryRun | null>(null);
  const [working, setWorking] = useState(false);

  async function selectFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 5_000_000) {
      onNotice("That import is larger than the 5 MB safety limit.");
      return;
    }
    setFileName(file.name);
    setJsonl(await file.text());
    setDryRun(null);
  }

  async function validate() {
    if (!jsonl) return;
    setWorking(true);
    onNotice("Validating without writing memories…");
    try {
      const result = await api.dryRunTrueMemory(jsonl);
      setDryRun(result);
      onNotice(`Dry run examined ${result.counts.examined} records. No memories were written.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Dry run failed");
    } finally {
      setWorking(false);
    }
  }

  async function apply() {
    if (!jsonl || !dryRun) return;
    setWorking(true);
    let total = 0;
    let remaining = dryRun.counts.new;
    try {
      for (const records of trueMemoryApplyBatches(jsonl)) {
        if (remaining === 0) break;
        const result = await api.applyTrueMemory(records, dryRun.runId, dryRun.manifestSha256);
        total += result.imported;
        remaining = result.remaining;
        if (result.failed > 0) throw new Error(`${result.failed} record${result.failed === 1 ? "" : "s"} failed and remain available for a safe retry.`);
        onNotice(`Imported ${total} safe records. ${remaining} remaining…`);
      }
      if (remaining > 0) throw new Error(`${remaining} approved records remain pending.`);
      onNotice(`Migration complete. ${total} new memories imported with fresh embeddings.`);
    } catch (error) {
      onNotice(`${error instanceof Error ? error.message : "Import paused"} You can safely resume this run.`);
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="05 / MIGRATION"
        title="Move deliberately."
        deck="Import TrueMemory through a dry-run, checksum and idempotent apply. Original vectors are discarded and rebuilt at the edge."
        action={
          <label className="primary-button file-button">
            Choose JSONL
            <input type="file" accept=".jsonl,application/x-ndjson" onChange={selectFile} />
          </label>
        }
      />
      <section className="migration-track">
        <article className="migration-step is-ready">
          <span>01</span>
          <div>
            <p className="eyebrow">SOURCE</p>
            <h2>{fileName ?? "Fresh TrueMemory snapshot"}</h2>
            <p>{fileName ? "Selected locally. The file is sent only to your authenticated Worker for validation." : "A fresh, integrity-checked Mac Mini SQLite backup is required. Documentation counts are not treated as migration proof."}</p>
          </div>
          <strong>{fileName ? "SOURCE READY" : "WAITING FOR BACKUP"}</strong>
        </article>
        <article className={dryRun ? "migration-step is-ready" : "migration-step"}>
          <span>02</span>
          <div>
            <p className="eyebrow">VALIDATE</p>
            <h2>Dry-run manifest</h2>
            <p>{dryRun ? `${dryRun.counts.new} new · ${dryRun.counts.duplicate} duplicate · ${dryRun.counts.probableDuplicate} probable · ${dryRun.counts.conflict} conflict · ${dryRun.counts.sensitive} sensitive · ${dryRun.counts.malformed} malformed` : "Schema checks, duplicate hashes and rejected records will be visible before D1 changes."}</p>
          </div>
          {dryRun ? <strong>APPROVED HASH</strong> : <button className="secondary-button" disabled={!jsonl || working} onClick={validate}>{working ? "VALIDATING" : "RUN DRY CHECK"}</button>}
        </article>
        <article className={dryRun ? "migration-step is-ready" : "migration-step"}>
          <span>03</span>
          <div>
            <p className="eyebrow">APPLY</p>
            <h2>Canonical import</h2>
            <p>Only records classified as new are imported. Sensitive, malformed, conflicting and probable duplicate records remain quarantined in the receipt.</p>
          </div>
          {dryRun ? <button className="primary-button" disabled={working || dryRun.counts.new === 0} onClick={apply}>{working ? "IMPORTING" : `IMPORT ${dryRun.counts.new} SAFE RECORDS`}</button> : <strong>LOCKED</strong>}
        </article>
      </section>
      <div className="notice-panel">
        <p className="eyebrow">PRIVACY GATE</p>
        <h3>No plaintext memory export will enter Git.</h3>
        <p>Repository snapshots are AES-256-GCM encrypted. Local import staging paths are ignored, and dry runs never write memories or vectors.</p>
      </div>
      <ConnectorWorkbench onNotice={onNotice} />
    </>
  );
}

function AutomationTokenControl({ onNotice }: { onNotice: (notice: string) => void }) {
  const [token, setToken] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  async function issue() {
    setWorking(true);
    try {
      const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
      const result = await api.createAutomationToken({
        label: "Optional Obsidian projection",
        scopes: ["projection:read"],
        expiresAt,
      });
      setToken(result.token);
      onNotice("One-time automation credential created. Copy it now; only its hash is stored.");
    } catch (error) { onNotice(error instanceof Error ? error.message : "Credential could not be created"); }
    finally { setWorking(false); }
  }
  async function copy() {
    if (!token) return;
    await navigator.clipboard.writeText(token);
    onNotice("Automation bearer token copied to the clipboard.");
  }
  return <section className="automation-panel"><div><p className="eyebrow">OPTIONAL AUTOMATION / LEAST PRIVILEGE</p><h2>Project the vault.</h2><p>This 90-day credential can read only the managed Obsidian projection. Use it with any WebDAV automation tool. It cannot search or write memories, trigger exports, or change projects.</p></div>{token ? <div className="one-time-token"><p>Shown once</p><code>{token}</code><button className="primary-button" onClick={copy}>Copy token</button></div> : <button className="primary-button" disabled={working} onClick={issue}>{working ? "GENERATING" : "GENERATE AUTOMATION TOKEN"}</button>}</section>;
}

function receiptFor(receipts: CapabilityReceipt[], capability: CapabilityReceipt["capability"]): CapabilityReceipt | undefined {
  return receipts.find((receipt) => receipt.capability === capability);
}

function receiptLabel(receipt: CapabilityReceipt | undefined): string {
  return receipt ? `${receipt.status.toUpperCase()} · ${receipt.checkedAt.slice(0, 10)}` : "NO DATED RECEIPT";
}

export function SettingsView({ onNotice, health, exportCapabilities, receipts = [], preferences = DEFAULT_UI_PREFERENCES, onPreferencesChange }: {
  onNotice: (notice: string) => void;
  health: ServiceHealth | null;
  exportCapabilities: Session["exportCapabilities"];
  receipts?: CapabilityReceipt[];
  preferences?: UiPreferences;
  onPreferencesChange?: (preferences: UiPreferences) => void;
}) {
  const [exporting, setExporting] = useState(false);
  async function exportNow() {
    setExporting(true);
    onNotice("Encrypting the canonical snapshot…");
    try {
      const receipt = await api.exportToGitHub();
      onNotice(`Encrypted ${receipt.recordCount} records and pushed ${receipt.path}.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Encrypted export failed");
    } finally {
      setExporting(false);
    }
  }
  async function downloadNow() {
    setExporting(true);
    onNotice("Encrypting a portable backup…");
    try {
      const receipt = await api.downloadEncryptedExport();
      const url = URL.createObjectURL(receipt.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = receipt.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      onNotice(`Downloaded ${receipt.filename}. Store the encryption key separately.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Encrypted download failed");
    } finally {
      setExporting(false);
    }
  }
  async function repairIndex() {
    onNotice("Repairing up to 25 pending or failed vectors…");
    try {
      const receipt = await api.repairMemoryIndex();
      onNotice(`Vector repair examined ${receipt.examined}, indexed ${receipt.indexed}, failed ${receipt.failed}.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Vector repair failed");
    }
  }
  const backupDescription = exportCapabilities.githubExport
    ? "A separate repository-scoped credential is configured to write versioned encrypted artefacts. Plaintext never crosses the GitHub API boundary."
    : exportCapabilities.encryptedDownload
      ? "Encryption is ready. Automatic GitHub push remains off until a separate repository-scoped contents-write token is added; encrypted downloads remain available now."
      : "Export encryption is not configured. Add a valid 64-character EXPORT_ENCRYPTION_KEY before creating portable backups.";
  const backupStatus = exportCapabilities.githubExport
    ? "GITHUB CONFIGURED"
    : exportCapabilities.encryptedDownload
      ? "GITHUB PUSH OFF"
      : "NOT CONFIGURED";
  const vectorReceipt = receiptFor(receipts, "vectorize");
  const semanticDisabled = health?.checks?.vectorize === "disabled";
  const updatePreferences = (change: Partial<UiPreferences>) => onPreferencesChange?.({ ...preferences, ...change });
  return <>
    <PageHeader eyebrow="07 / SETTINGS" title="Make it yours." deck="Tune how Cloud Memory reads and feels on this browser, then inspect the security boundary underneath." />
    <section className="preference-panel" aria-labelledby="preference-title">
      <header><div><p className="eyebrow">WORKSPACE PREFERENCES</p><h2 id="preference-title">A calmer, more legible workspace.</h2></div><span>Saved on this browser</span></header>
      <div className="preference-grid">
        <label className="preference-select"><span><strong>Text size</strong><small>Increase interface and task text without browser zoom.</small></span><select name="ui-text-size" aria-label="Text size" value={preferences.textScale} onChange={(event) => updatePreferences({ textScale: event.target.value as UiPreferences["textScale"] })}><option value="large">Large</option><option value="standard">Standard</option></select></label>
        <label className="preference-select"><span><strong>Workspace density</strong><small>Choose roomy cards or a more compact overview.</small></span><select name="ui-workspace-density" aria-label="Workspace density" value={preferences.density} onChange={(event) => updatePreferences({ density: event.target.value as UiPreferences["density"] })}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label>
        <label className="preference-toggle"><span><strong>Reduce motion</strong><small>Disable decorative transitions and smooth scrolling.</small></span><input name="ui-reduce-motion" type="checkbox" checked={preferences.reduceMotion} onChange={(event) => updatePreferences({ reduceMotion: event.target.checked })} /></label>
        <label className="preference-toggle"><span><strong>Stronger contrast</strong><small>Darken borders and secondary text for easier scanning.</small></span><input name="ui-high-contrast" type="checkbox" checked={preferences.highContrast} onChange={(event) => updatePreferences({ highContrast: event.target.checked })} /></label>
        <label className="preference-toggle"><span><strong>Memory excerpts</strong><small>Show a content preview under each Memory Library title.</small></span><input name="ui-memory-excerpts" type="checkbox" checked={preferences.showMemoryExcerpts} onChange={(event) => updatePreferences({ showMemoryExcerpts: event.target.checked })} /></label>
        <label className="preference-toggle"><span><strong>Expanded completed tasks</strong><small>Keep completed project work open instead of collapsed.</small></span><input name="ui-expand-completed-tasks" type="checkbox" checked={preferences.expandCompletedTasks} onChange={(event) => updatePreferences({ expandCompletedTasks: event.target.checked })} /></label>
        <label className="preference-select"><span><strong>Done task board retention</strong><small>Keep recent completions on the Kanban before moving them to Done history.</small></span><select name="ui-done-retention" aria-label="Done task board retention" value={preferences.doneBoardRetentionDays} onChange={(event) => updatePreferences({ doneBoardRetentionDays: Number(event.target.value) as UiPreferences["doneBoardRetentionDays"] })}><option value="0">Move immediately</option><option value="3">3 days</option><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option></select></label>
      </div>
    </section>
    <MemoryIntelligencePanel onNotice={onNotice} />
    <section className="settings-list" aria-label="System settings">
      <article><div><p className="eyebrow">IDENTITY</p><h2>Single-owner mode</h2><p>This session passed the configured immutable GitHub user ID allowlist.</p></div><strong>SESSION VERIFIED</strong></article>
      <article><div><p className="eyebrow">CANONICAL STORE</p><h2>Cloudflare D1</h2><p>Memories, tasks and append-only provenance events live in owner-scoped rows.</p></div><strong>{health?.status === "ok" ? `VERIFIED · ${health.checkedAt.slice(0, 10)}` : health ? "DEGRADED" : "NOT CHECKED"}</strong></article>
      <article><div><p className="eyebrow">SEMANTIC INDEX</p><h2>Vectorize / BGE base</h2><p>{semanticDisabled ? "Optional semantic search is off. Lexical and temporal retrieval remain available without AI calls." : "768-dimensional cosine index, rebuildable from D1 through the bounded repair operation."}</p></div><div className="settings-control"><strong>{semanticDisabled ? "DISABLED BY CONFIG" : receiptLabel(vectorReceipt)}</strong><button className="secondary-button" disabled={semanticDisabled} onClick={repairIndex}>Repair index ↗</button></div></article>
      <article><div><p className="eyebrow">BACKUPS</p><h2>Encrypted portable exports</h2><p>{backupDescription}</p></div><div className="settings-control"><strong>{backupStatus}</strong>{exportCapabilities.githubExport ? <button className="secondary-button" disabled={exporting} onClick={exportNow}>{exporting ? "EXPORTING" : "Export to GitHub"}</button> : <button className="secondary-button" disabled={exporting || !exportCapabilities.encryptedDownload} onClick={downloadNow}>{exporting ? "ENCRYPTING" : "Download encrypted backup"}</button>}</div></article>
    </section>
  </>;
}

function StaticView({ view, onNotice, health, exportCapabilities, receipts, preferences, onPreferencesChange }: { view: "migration" | "connections" | "settings"; onNotice: (notice: string) => void; health: ServiceHealth | null; exportCapabilities: Session["exportCapabilities"]; receipts: CapabilityReceipt[]; preferences: UiPreferences; onPreferencesChange: (preferences: UiPreferences) => void }) {
  if (view === "migration") return <MigrationView onNotice={onNotice} />;
  if (view === "connections") return <><PageHeader eyebrow="06 / CONNECTIONS" title="One memory. Many clients." deck="Registration, OAuth and live tool verification are separate states. Record only the canaries that actually passed." /><CompatibilityCentre onNotice={onNotice} /><AutomationTokenControl onNotice={onNotice} /></>;
  return <SettingsView onNotice={onNotice} health={health} exportCapabilities={exportCapabilities} receipts={receipts} preferences={preferences} onPreferencesChange={onPreferencesChange} />;
}

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([]);
  const [receipts, setReceipts] = useState<CapabilityReceipt[]>([]);
  const [memoryReviewCount, setMemoryReviewCount] = useState(0);
  const [view, setView] = useState<ViewId>(() => viewFromPath(window.location.pathname));
  const [openTaskId, setOpenTaskId] = useState<string | null>(() => window.location.pathname.match(/\/tasks\/([^/]+)/)?.[1] ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  const [health, setHealth] = useState<ServiceHealth | null>(null);
  const [preferences, setPreferences] = useState<UiPreferences>(loadUiPreferences);

  const handleSessionFailure = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.status === 401) setSession(null);
    else setSessionError(error instanceof Error ? error.message : "Cloud Memory is unavailable");
  }, []);
  async function retrySession() {
    setSession(undefined);
    setSessionError(null);
    try { setSession(await api.session()); }
    catch (error) { handleSessionFailure(error); }
  }
  useEffect(() => { api.session().then(setSession).catch(handleSessionFailure); }, [handleSessionFailure]);
  useEffect(() => { api.health().then(setHealth).catch(() => setHealth(null)); }, []);
  useEffect(() => { applyUiPreferences(preferences); saveUiPreferences(preferences); }, [preferences]);
  const reload = useCallback(async () => {
    const data = await api.projects();
    setProjects(data.projects);
    setTasks(data.tasks);
    const [runData, receiptData, reviewData] = await Promise.all([
      api.agentRuns().catch(() => ({ runs: [] })),
      api.capabilityReceipts().catch(() => ({ receipts: [] })),
      api.memoryReviews().catch(() => ({ reviews: [] })),
    ]);
    setAgentRuns(runData.runs);
    setReceipts(receiptData.receipts);
    setMemoryReviewCount(reviewData.reviews.length);
  }, []);
  useEffect(() => {
    if (!session) return;
    const timer = window.setTimeout(() => {
      void reload().catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Projects could not be loaded"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [session, reload]);
  useEffect(() => { const update = () => { setView(viewFromPath(window.location.pathname)); setOpenTaskId(window.location.pathname.match(/\/tasks\/([^/]+)/)?.[1] ?? null); }; window.addEventListener("popstate", update); return () => window.removeEventListener("popstate", update); }, []);

  const selectedTask = useMemo(() => tasks.find((task) => task.id === openTaskId) ?? null, [tasks, openTaskId]);
  const selectedProject = selectedTask ? projects.find((project) => project.id === selectedTask.projectId) ?? null : null;
  function navigate(next: ViewId) { history.pushState({}, "", VIEW_PATHS[next]); setView(next); setOpenTaskId(null); }
  function openTask(task: Task) { history.pushState({}, "", `/projects/${task.projectId}/tasks/${task.id}`); setView("projects"); setOpenTaskId(task.id); }
  function closeTask() { history.pushState({}, "", "/projects"); setOpenTaskId(null); }
  async function moveTask(task: Task, status: TaskStatus, position?: number) {
    if (task.status === status && position === undefined) return;
    const previous = tasks;
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status, position: position ?? item.position } : item));
    setNotice(`Moving “${task.title}” to ${status.replace("_", " ")}…`);
    try { const updated = await api.moveTask(task, status, position); setTasks((current) => current.map((item) => item.id === updated.id ? updated : item)); setNotice(`Moved “${task.title}”.`); }
    catch (error) { setTasks(previous); setNotice(error instanceof ApiError && error.status === 409 ? "That task changed elsewhere. The board has been refreshed." : error instanceof Error ? error.message : "Task move failed"); if (error instanceof ApiError && error.status === 409) await reload(); }
  }
  async function archiveTask(task: Task) {
    const previous = tasks;
    setNotice(`Archiving “${task.title}”…`);
    try {
      const archived = await api.archiveTask(task);
      setTasks((current) => current.filter((item) => item.id !== archived.id));
      setNotice(`Archived “${task.title}”. Its ${task.status.replaceAll("_", " ")} status is preserved outside routine AI context.`);
    } catch (error) {
      setTasks(previous);
      setNotice(error instanceof ApiError && error.status === 409 ? "That task changed elsewhere. The project view has been refreshed." : error instanceof Error ? error.message : "Task archive failed");
      if (error instanceof ApiError && error.status === 409) await reload();
    }
  }

  if (sessionError) return <main className="auth-error-screen"><section role="alert"><p className="eyebrow">CONNECTION / INTERRUPTED</p><h1>The Signal Room could not open.</h1><p>{sessionError} No project or memory data was loaded.</p><button className="primary-button" autoFocus onClick={() => void retrySession()}>Try again ↗</button></section></main>;
  if (session === undefined) return <main className="loading-screen"><span className="wordmark__mark">CM</span><p className="eyebrow">OPENING SIGNAL ROOM</p></main>;
  if (!session) return <LoginScreen />;
  return <AppShell activeView={view} user={session.user} onNavigate={navigate} onLogout={() => api.logout().then(() => location.assign("/"))}><div className="workspace-inner">{view === "command" ? <CommandCentre projects={projects} tasks={tasks} memoryReviewCount={memoryReviewCount} onNavigate={navigate} health={health} /> : null}{view === "projects" ? <ProjectsView projects={projects} tasks={tasks} agentRuns={agentRuns} expandCompletedTasks={preferences.expandCompletedTasks} doneBoardRetentionDays={preferences.doneBoardRetentionDays} onMove={moveTask} onOpen={openTask} onTaskArchived={archiveTask} onTaskCreated={(task) => setTasks((current) => [task, ...current])} onProjectCreated={(project) => setProjects((current) => [project, ...current])} onProjectArchived={(project) => { setProjects((current) => current.filter((item) => item.id !== project.id)); setTasks((current) => current.filter((task) => task.projectId !== project.id)); setNotice(`Archived “${project.name}” with its task history intact.`); }} onProjectRestored={(project, restoredTasks) => { setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)]); setTasks((current) => [...restoredTasks, ...current.filter((task) => task.projectId !== project.id)]); setNotice(`Restored “${project.name}” and ${restoredTasks.length} task${restoredTasks.length === 1 ? "" : "s"}.`); }} /> : null}{view === "roadmap" ? <><PageHeader eyebrow="03 / ROADMAP" title="The longer view." deck="Keep the best future bets visible without pretending they are committed work." /><RoadmapWorkspace projects={projects} onTaskPromoted={(task) => setTasks((current) => [task, ...current])} /></> : null}{view === "memory" ? <MemoryView projects={projects} /> : null}{view === "migration" || view === "connections" || view === "settings" ? <StaticView view={view} onNotice={setNotice} health={health} exportCapabilities={session.exportCapabilities} receipts={receipts} preferences={preferences} onPreferencesChange={setPreferences} /> : null}</div>{notice ? <div className="toast" role="status"><span>{notice}</span><button onClick={() => setNotice(null)} aria-label="Dismiss notification">×</button></div> : null}{selectedTask && selectedProject ? <TaskDrawer task={selectedTask} project={selectedProject} onClose={closeTask} onUpdated={(updated) => { setTasks((current) => current.map((item) => item.id === updated.id ? updated : item)); setNotice(`Updated “${updated.title}”.`); }} onArchived={(archived) => { setTasks((current) => current.filter((item) => item.id !== archived.id)); setNotice(`Archived “${archived.title}”.`); }} /> : null}</AppShell>;
}
