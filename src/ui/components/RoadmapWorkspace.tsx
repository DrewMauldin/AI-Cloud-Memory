import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "../api";
import type { Project, RoadmapHorizon, RoadmapItem, Task } from "../types";
import { useDialog } from "./useDialog";

const HORIZONS: Array<{ id: RoadmapHorizon; title: string; note: string }> = [
  { id: "next", title: "Next", note: "Best candidates after current delivery" },
  { id: "later", title: "Later", note: "Valuable once nearer work settles" },
  { id: "someday", title: "Someday", note: "Keep the possibility without commitment" },
];

function safeSourceUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function provenance(item: RoadmapItem): string {
  if (item.sourceModel && item.sourceClient) return `${item.sourceModel} via ${item.sourceClient}`;
  return item.sourceModel ?? item.sourceClient ?? item.sourceType;
}

function RoadmapCard({
  item,
  project,
  archived,
  busy,
  confirming,
  onUpdate,
  onArchive,
  onRestore,
  onPromote,
  onConfirm,
}: {
  item: RoadmapItem;
  project: Project | undefined;
  archived: boolean;
  busy: boolean;
  confirming: boolean;
  onUpdate: (changes: Partial<Pick<RoadmapItem, "horizon" | "status">>) => void;
  onArchive: () => void;
  onRestore: () => void;
  onPromote: () => void;
  onConfirm: (confirming: boolean) => void;
}) {
  const source = safeSourceUrl(item.sourceUrl);
  return (
    <article className="roadmap-card" style={{ "--project-colour": project?.colour ?? "#c9ff3b" } as React.CSSProperties}>
      <header><span>{project?.name ?? "Unknown project"}</span><em>{item.status}</em></header>
      <h3>{item.title}</h3>
      {item.description ? <p>{item.description}</p> : null}
      <div className="roadmap-signals"><span>{item.impact} impact</span><span>{item.effort} effort</span></div>
      <div className="roadmap-provenance"><strong>{provenance(item)}</strong>{source ? <a href={source} target="_blank" rel="noreferrer">Open chat ↗</a> : null}</div>
      {archived ? <footer><button disabled={busy} onClick={onRestore} aria-label={`Restore ${item.title}`}>Restore idea</button></footer> : item.status === "promoted" ? <footer><span className="roadmap-history-note">Linked Inbox task created</span></footer> : <>
        <label className="roadmap-horizon-select">Horizon<select value={item.horizon} disabled={busy} onChange={(event) => onUpdate({ horizon: event.target.value as RoadmapHorizon })} aria-label={`Horizon for ${item.title}`}>{HORIZONS.map((horizon) => <option key={horizon.id} value={horizon.id}>{horizon.title}</option>)}</select></label>
        <footer>
          <button disabled={busy} onClick={() => onUpdate({ status: item.status === "planned" ? "considering" : "planned" })}>{item.status === "planned" ? "Return to review" : "Mark planned"}</button>
          <button disabled={busy} onClick={onArchive}>Archive</button>
          <button className="roadmap-promote" disabled={busy} onClick={() => onConfirm(true)} aria-label={`Promote ${item.title} to a task`}>Promote to task</button>
        </footer>
        {confirming ? <div className="roadmap-confirm" role="group" aria-label={`Confirm promotion for ${item.title}`}><p>Create one linked Inbox task?</p><button onClick={onPromote} aria-label={`Confirm Inbox task for ${item.title}`}>Confirm task</button><button onClick={() => onConfirm(false)}>Cancel</button></div> : null}
      </>}
    </article>
  );
}

function NewRoadmapPanel({ projects, onCreated, onClose }: { projects: Project[]; onCreated: (item: RoadmapItem) => void; onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceType, setSourceType] = useState<RoadmapItem["sourceType"]>("human");
  const [correlationId] = useState(() => crypto.randomUUID());
  const dialogRef = useDialog(onClose);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(null);
    const data = new FormData(event.currentTarget);
    try {
      onCreated(await api.createRoadmap({
        projectId: String(data.get("projectId")),
        title: String(data.get("title")),
        description: String(data.get("description") || "") || undefined,
        horizon: String(data.get("horizon")) as RoadmapHorizon,
        impact: String(data.get("impact")) as RoadmapItem["impact"],
        effort: String(data.get("effort")) as RoadmapItem["effort"],
        sourceType,
        client: String(data.get("client") || "") || undefined,
        model: String(data.get("model") || "") || undefined,
        sourceUrl: String(data.get("sourceUrl") || "") || undefined,
        correlationId,
      }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Roadmap idea could not be saved"); setSaving(false); }
  }
  return <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside ref={dialogRef} className="task-drawer form-drawer roadmap-drawer" role="dialog" aria-modal="true" aria-labelledby="new-roadmap-title"><header><p className="eyebrow">NEW / ROADMAP</p><button className="icon-button" onClick={onClose} aria-label="Close roadmap form">×</button></header><h2 id="new-roadmap-title">Save the next good idea.</h2><form className="editor-form" onSubmit={submit}>
    <label>Project<select name="projectId" required>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
    <label>Idea title<input name="title" required maxLength={240} autoFocus /></label>
    <label>Description<textarea name="description" rows={4} maxLength={5000} /></label>
    <div className="form-row"><label>Horizon<select name="horizon" defaultValue="later"><option value="next">Next</option><option value="later">Later</option><option value="someday">Someday</option></select></label><label>Idea origin<select aria-label="Idea origin" value={sourceType} onChange={(event) => setSourceType(event.target.value as RoadmapItem["sourceType"])}><option value="human">Human</option><option value="model">AI model</option></select></label></div>
    <div className="form-row"><label>Impact<select name="impact" defaultValue="medium"><option>low</option><option>medium</option><option>high</option></select></label><label>Effort<select name="effort" defaultValue="medium"><option>small</option><option>medium</option><option>large</option></select></label></div>
    {sourceType === "model" ? <div className="form-row"><label>Client<input name="client" required maxLength={100} /></label><label>Model<input name="model" required maxLength={100} /></label></div> : null}
    <label>Original chat URL <span aria-hidden="true">(optional)</span><input aria-label="Original chat URL" name="sourceUrl" type="url" /></label>
    {error ? <p className="error-copy" role="alert">{error}</p> : null}<button className="primary-button" disabled={saving}>{saving ? "Saving…" : "Save to roadmap"}</button>
  </form></aside></div>;
}

export function RoadmapWorkspace({ projects, onTaskPromoted }: { projects: Project[]; onTaskPromoted: (task: Task) => void }) {
  const [scope, setScope] = useState<"active" | "promoted" | "archived">("active");
  const [projectId, setProjectId] = useState("");
  const [items, setItems] = useState<RoadmapItem[]>([]);
  const [total, setTotal] = useState(0);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const result = await api.roadmaps({ scope, projectId: projectId || undefined }); setItems(result.items); setTotal(result.total); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Roadmap could not be loaded"); }
    finally { setLoading(false); }
  }, [projectId, scope]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const projectsById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const recommended = items.filter((item) => item.horizon === "next").slice(0, 3);

  async function mutate(item: RoadmapItem, action: () => Promise<RoadmapItem>, message: string) {
    setBusyId(item.id); setError(null);
    try {
      const updated = await action();
      setItems((current) => scope === "active" && ["suggested", "considering", "planned"].includes(updated.status)
        ? current.map((candidate) => candidate.id === updated.id ? updated : candidate)
        : current.filter((candidate) => candidate.id !== updated.id));
      setNotice(message);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Roadmap change failed"); }
    finally { setBusyId(null); }
  }

  async function promote(item: RoadmapItem) {
    setBusyId(item.id); setError(null);
    try {
      const result = await api.promoteRoadmap(item, crypto.randomUUID());
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
      setConfirmId(null); onTaskPromoted(result.task); setNotice(`Promoted “${item.title}” to Inbox.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Roadmap idea could not be promoted"); }
    finally { setBusyId(null); }
  }

  if (!projects.length) return <section className="roadmap-empty"><h2>Create a project first.</h2><p>Roadmap ideas need a stable project home.</p></section>;
  return <section className="roadmap-workspace" aria-label="Project roadmaps">
    <header className="roadmap-toolbar"><div><p className="eyebrow">LONG-TERM / PROJECT MEMORY</p><strong>{total} idea{total === 1 ? "" : "s"} in view</strong></div><div><label>Project<select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">All projects</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><button className="primary-button" onClick={() => setAdding(true)}>Add roadmap idea</button></div></header>
    <nav className="roadmap-tabs" aria-label="Roadmap lifecycle"><button className={scope === "active" ? "is-active" : ""} onClick={() => setScope("active")}>Active ideas</button><button className={scope === "promoted" ? "is-active" : ""} onClick={() => setScope("promoted")}>Promoted</button><button className={scope === "archived" ? "is-active" : ""} onClick={() => setScope("archived")} aria-label="Archived roadmap ideas">Archived</button></nav>
    {error ? <p className="error-copy" role="alert">{error}</p> : null}{notice ? <p className="roadmap-notice" role="status">{notice}</p> : null}
    {loading ? <div className="portfolio-loading">Loading the longer view…</div> : scope === "active" ? <>
      {recommended.length ? <section className="roadmap-recommended"><header><div><p className="eyebrow">WHAT SHOULD I WORK ON NEXT?</p><h2>Recommended next</h2></div><span>High impact and lower effort rise first</span></header><ol>{recommended.map((item, index) => <li key={item.id}><span>0{index + 1}</span><div><strong>{item.title}</strong><small>{projectsById.get(item.projectId)?.name} · {item.impact} impact · {item.effort} effort</small></div></li>)}</ol></section> : null}
      {items.length ? <div className="roadmap-horizons">{HORIZONS.map((horizon) => <section key={horizon.id} className="roadmap-horizon" aria-label={`${horizon.title} roadmap horizon`}><header><div><h2>{horizon.title}</h2><p>{horizon.note}</p></div><span>{items.filter((item) => item.horizon === horizon.id).length}</span></header><div>{items.filter((item) => item.horizon === horizon.id).map((item) => <RoadmapCard key={item.id} item={item} project={projectsById.get(item.projectId)} archived={false} busy={busyId === item.id} confirming={confirmId === item.id} onConfirm={(value) => setConfirmId(value ? item.id : null)} onPromote={() => void promote(item)} onUpdate={(changes) => void mutate(item, () => api.updateRoadmap(item, changes), `Updated “${item.title}”.`)} onArchive={() => void mutate(item, () => api.archiveRoadmap(item), `Archived “${item.title}”.`)} onRestore={() => undefined} />)}{items.every((item) => item.horizon !== horizon.id) ? <p className="roadmap-column-empty">No ideas in this horizon.</p> : null}</div></section>)}</div> : <div className="portfolio-empty">No ideas in this horizon.</div>}
    </> : items.length ? <div className="roadmap-register">{items.map((item) => <RoadmapCard key={item.id} item={item} project={projectsById.get(item.projectId)} archived={scope === "archived"} busy={busyId === item.id} confirming={false} onConfirm={() => undefined} onPromote={() => undefined} onUpdate={() => undefined} onArchive={() => undefined} onRestore={() => void mutate(item, () => api.restoreRoadmap(item), `Restored “${item.title}”.`)} />)}</div> : <div className="portfolio-empty">No {scope} roadmap ideas yet.</div>}
    {adding ? <NewRoadmapPanel projects={projects} onCreated={(item) => { if (scope === "active" && (!projectId || projectId === item.projectId)) setItems((current) => [item, ...current]); setTotal((value) => value + 1); setAdding(false); setNotice(`Saved “${item.title}” for later.`); }} onClose={() => setAdding(false)} /> : null}
  </section>;
}
