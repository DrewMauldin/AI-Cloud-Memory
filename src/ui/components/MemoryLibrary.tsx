import { useEffect, useMemo, useState } from "react";

import { api } from "../api";
import type { LibraryMemory, MemoryEvent, MemoryRecord, Project } from "../types";
import { MemoryInspector } from "./MemoryInspector";
import { MemoryLibraryList } from "./MemoryLibraryList";

type Collection = "all" | "memories" | "directives" | "archived";
type QuickFilter = "none" | "important" | "unlabelled" | "never" | "recent" | "outdated";
type LibrarySort = "updated" | "created" | "importance" | "retrieval";

interface SavedView {
  id: string;
  name: string;
  collection: Collection;
  query: string;
  quickFilter: QuickFilter;
  sort: LibrarySort;
  projectId: string;
}

interface UndoAction {
  records: LibraryMemory[];
  action: "archive" | "restore";
  message: string;
}

const collectionFilters: Record<Collection, { status: MemoryRecord["status"]; kind?: MemoryRecord["kind"] }> = {
  all: { status: "active" },
  memories: { status: "active", kind: "memory" },
  directives: { status: "active", kind: "directive" },
  archived: { status: "archived" },
};

function initialCollection(value: string | null): Collection {
  return value && value in collectionFilters ? value as Collection : "all";
}

function requestCollection(collection: Collection, query: string, sort: LibrarySort, projectId: string, cursor?: string) {
  return api.library({
    ...collectionFilters[collection],
    query: query || undefined,
    sort,
    ...(projectId ? { scopeType: "project" as const, scopeId: projectId } : {}),
    cursor,
    limit: 40,
  });
}

function syncLibraryUrl(collection: Collection, query: string, quickFilter: QuickFilter, sort: LibrarySort, projectId: string) {
  const params = new URLSearchParams();
  if (collection !== "all") params.set("collection", collection);
  if (query) params.set("q", query);
  if (quickFilter !== "none") params.set("quick", quickFilter);
  if (sort !== "updated") params.set("sort", sort);
  if (projectId) params.set("project", projectId);
  window.history.replaceState({}, "", `/memory${params.size ? `?${params}` : ""}`);
}

function initialQuickFilter(value: string | null): QuickFilter {
  return (["important", "unlabelled", "never", "recent", "outdated"] as const).includes(value as never)
    ? value as QuickFilter
    : "none";
}

function initialSort(value: string | null): LibrarySort {
  return (["updated", "created", "importance", "retrieval"] as const).includes(value as never)
    ? value as LibrarySort
    : "updated";
}

function readSavedViews(): SavedView[] {
  try {
    const raw = window.localStorage?.getItem("cloud-memory-library-views");
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const quickFilters: QuickFilter[] = ["none", "important", "unlabelled", "never", "recent", "outdated"];
    const sorts: LibrarySort[] = ["updated", "created", "importance", "retrieval"];
    return parsed.filter((item): item is SavedView => {
      if (!item || typeof item !== "object") return false;
      const view = item as SavedView;
      return typeof view.id === "string" && view.id.length <= 100 &&
        typeof view.name === "string" && view.name.length <= 120 &&
        typeof view.query === "string" && view.query.length <= 500 &&
        typeof view.projectId === "string" && view.projectId.length <= 200 &&
        view.collection in collectionFilters && quickFilters.includes(view.quickFilter) && sorts.includes(view.sort);
    }).slice(0, 12);
  } catch {
    return [];
  }
}

export function MemoryLibrary({ reviewCount, projects = [] }: { reviewCount: number; projects?: Project[] }) {
  const initial = new URLSearchParams(window.location.search);
  const [collection, setCollection] = useState<Collection>(() => initialCollection(initial.get("collection")));
  const [query, setQuery] = useState(initial.get("q") ?? "");
  const [submittedQuery, setSubmittedQuery] = useState(query);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(() => initialQuickFilter(initial.get("quick")));
  const [sort, setSort] = useState<LibrarySort>(() => initialSort(initial.get("sort")));
  const [projectId, setProjectId] = useState(initial.get("project") ?? "");
  const [savedViews, setSavedViews] = useState<SavedView[]>(readSavedViews);
  const [items, setItems] = useState<LibraryMemory[]>([]);
  const [counts, setCounts] = useState({ active: 0, archived: 0, memories: 0, directives: 0 });
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<LibraryMemory | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [events, setEvents] = useState<MemoryEvent[]>([]);
  const [related, setRelated] = useState<LibraryMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoAction | null>(null);
  const [bulkLabel, setBulkLabel] = useState("");
  const [referenceTime] = useState(Date.now);

  useEffect(() => {
    let current = true;
    void requestCollection(collection, submittedQuery, sort, projectId)
      .then((result) => {
        if (!current) return;
        setItems(result.items);
        setCounts(result.counts);
        setNextCursor(result.nextCursor);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (current) setError(reason instanceof Error ? reason.message : "The Library could not be loaded");
      })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [collection, submittedQuery, sort, projectId]);

  useEffect(() => {
    syncLibraryUrl(collection, submittedQuery, quickFilter, sort, projectId);
  }, [collection, submittedQuery, quickFilter, sort, projectId]);

  async function load(cursor?: string) {
    setLoading(true); setError(null);
    try {
      const result = await requestCollection(collection, submittedQuery, sort, projectId, cursor);
      setItems((current) => cursor ? [...current, ...result.items] : result.items);
      setCounts(result.counts); setNextCursor(result.nextCursor);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The Library could not be loaded"); }
    finally { setLoading(false); }
  }

  const visibleItems = useMemo(() => items.filter((memory) => {
    if (quickFilter === "important") return memory.importance >= 0.8;
    if (quickFilter === "unlabelled") return memory.labels.length === 0;
    if (quickFilter === "never") return memory.retrievalCount === 0;
    if (quickFilter === "recent") return referenceTime - new Date(memory.createdAt).getTime() < 7 * 86_400_000;
    if (quickFilter === "outdated") {
      const boundary = memory.expiresAt ?? memory.reviewAt;
      return boundary !== null && new Date(boundary).getTime() < referenceTime;
    }
    return true;
  }), [items, quickFilter, referenceTime]);

  const labelSuggestions = useMemo(() => {
    if (!selected) return [];
    const counts = new Map<string, number>();
    for (const memory of items) for (const label of memory.labels) {
      if (!selected.labels.includes(label)) counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, 4).map(([label]) => label);
  }, [items, selected]);

  async function open(memory: LibraryMemory) {
    setSelected(memory);
    setHistoryLoading(true);
    try {
      const [history, relatedRecords] = await Promise.all([
        api.memoryHistory(memory.id),
        api.relatedMemories(memory.id),
      ]);
      setEvents(history.events);
      setRelated(relatedRecords.items);
    } catch { setEvents([]); setRelated([]); }
    finally { setHistoryLoading(false); }
  }

  function replace(updated: LibraryMemory) {
    setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
    setSelected(updated);
  }

  async function mutate(action: () => Promise<LibraryMemory>, success: string, remove = false) {
    setBusy(true); setError(null);
    try {
      const updated = await action();
      if (remove) {
        setItems((current) => current.filter((item) => item.id !== updated.id));
        setSelected(null);
      } else replace(updated);
      setNotice(success);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The record could not be changed"); }
    finally { setBusy(false); }
  }

  async function bulkArchive() {
    const records = items.filter((item) => selectedIds.has(item.id)).slice(0, 50);
    if (!records.length) return;
    setBusy(true);
    try {
      const action = collection === "archived" ? "restore" : "archive";
      const results = await api.bulkLibrary(action, records);
      const changed = results.results.flatMap((result) => result.outcome === "changed" && result.memory ? [result.memory] : []);
      const changedIds = new Set(changed.map((memory) => memory.id));
      const failed = records.length - changedIds.size;
      setItems((current) => current.filter((item) => !changedIds.has(item.id)));
      setSelectedIds(new Set(records.filter((memory) => !changedIds.has(memory.id)).map((memory) => memory.id)));
      setSelected((current) => current && changedIds.has(current.id) ? null : current);
      if (changedIds.size) setNotice(`${collection === "archived" ? "Restored" : "Archived"} ${changedIds.size} record${changedIds.size === 1 ? "" : "s"}.`);
      if (changed.length) setUndo({ records: changed, action: action === "archive" ? "restore" : "archive", message: `${changed.length} lifecycle change${changed.length === 1 ? "" : "s"} can be undone.` });
      if (failed) setError(`${failed} record${failed === 1 ? "" : "s"} changed elsewhere and remain selected.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Bulk action failed"); }
    finally { setBusy(false); }
  }

  async function bulkAddLabel() {
    const records = items.filter((item) => selectedIds.has(item.id)).slice(0, 50);
    if (!records.length || !bulkLabel.trim()) return;
    setBusy(true); setError(null);
    try {
      const result = await api.bulkLibrary("label", records, bulkLabel.trim());
      const changed = result.results.flatMap((item) => item.outcome === "changed" && item.memory ? [item.memory] : []);
      const byId = new Map(changed.map((memory) => [memory.id, memory]));
      setItems((current) => current.map((memory) => byId.get(memory.id) ?? memory));
      setSelectedIds(new Set(result.results.filter((item) => item.outcome !== "changed").map((item) => item.id)));
      setBulkLabel("");
      setNotice(`Labelled ${changed.length} record${changed.length === 1 ? "" : "s"}.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Bulk label failed"); }
    finally { setBusy(false); }
  }

  async function lifecycle(memory: LibraryMemory, action: "archive" | "restore") {
    setBusy(true); setError(null);
    try {
      const updated = action === "archive" ? await api.archiveMemory(memory) : await api.restoreMemory(memory);
      setItems((current) => current.filter((item) => item.id !== updated.id));
      setSelected(null);
      setUndo({ records: [updated], action: action === "archive" ? "restore" : "archive", message: `${action === "archive" ? "Archived" : "Restored"} record. Undo available.` });
      setNotice(`${action === "archive" ? "Archived" : "Restored"} “${memory.summary ?? memory.content.slice(0, 40)}”.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The record could not be changed"); }
    finally { setBusy(false); }
  }

  async function undoLifecycle() {
    if (!undo) return;
    setBusy(true); setError(null);
    try {
      const results = await api.bulkLibrary(undo.action, undo.records);
      const failed = results.results.filter((result) => result.outcome !== "changed").length;
      if (failed) setError(`${failed} record${failed === 1 ? "" : "s"} changed elsewhere and could not be undone.`);
      await load();
      setNotice(failed ? "Undo completed with conflicts." : "Lifecycle change undone.");
      setUndo(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Undo failed"); }
    finally { setBusy(false); }
  }

  function saveView() {
    const name = submittedQuery ? `Search: ${submittedQuery}` : collection === "all" ? "All active" : collection[0]!.toUpperCase() + collection.slice(1);
    const view: SavedView = { id: crypto.randomUUID(), name, collection, query: submittedQuery, quickFilter, sort, projectId };
    const next = [view, ...savedViews].slice(0, 12);
    setSavedViews(next);
    try { window.localStorage?.setItem("cloud-memory-library-views", JSON.stringify(next)); } catch { /* Private browsing can disable storage. */ }
    setNotice(`Saved “${name}” in this browser.`);
  }

  function applySavedView(view: SavedView) {
    setLoading(true); setCollection(view.collection); setQuery(view.query); setSubmittedQuery(view.query);
    setQuickFilter(view.quickFilter); setSort(view.sort); setProjectId(view.projectId); setSelected(null); setSelectedIds(new Set());
  }

  function exportVisible() {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), collection, query: submittedQuery, quickFilter, sort, projectId: projectId || null, records: visibleItems }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `cloud-memory-library-${new Date().toISOString().slice(0, 10)}.json`; link.click();
    URL.revokeObjectURL(url);
    setNotice(`Exported ${visibleItems.length} bounded record${visibleItems.length === 1 ? "" : "s"}.`);
  }

  return (
    <section className="memory-library" aria-label="Cloud Memory Library">
      <header className="library-toolbar">
        <form onSubmit={(event) => { event.preventDefault(); setLoading(true); setSubmittedQuery(query.trim()); }}>
          <label><span className="sr-only">Search the Library</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search memories, directives and decisions…" /></label>
          <button>Search ↗</button>
        </form>
        <div className="library-toolbar__actions">
          <button type="button" onClick={saveView} aria-label="Save current Library view">Save view</button>
          <button type="button" onClick={exportVisible} aria-label="Export current Library results as JSON">Export JSON</button>
          <span>{counts.active} active</span><span>{counts.archived} archived</span>
        </div>
      </header>
      <div className="library-workspace">
        <nav className="library-collections" aria-label="Memory collections">
          <p className="eyebrow">COLLECTIONS</p>
          {([
            ["all", "All active", counts.active], ["memories", "Memories", counts.memories],
            ["directives", "Directives", counts.directives], ["archived", "Archived", counts.archived],
          ] as Array<[Collection, string, number]>).map(([id, label, count]) => <button aria-label={`${label} ${count}`} className={collection === id ? "is-active" : ""} onClick={() => { setLoading(true); setCollection(id); setSelected(null); setSelectedIds(new Set()); }} key={id}><span>{label}</span><strong>{count}</strong></button>)}
          <button aria-label={`Needs review ${reviewCount}`} onClick={() => document.getElementById("memory-review-workbench")?.scrollIntoView({ behavior: "smooth", block: "start" })}><span>Needs review</span><strong>{reviewCount}</strong></button>
          <p className="eyebrow library-collections__secondary">QUICK FILTERS</p>
          {(["important", "unlabelled", "never", "recent", "outdated"] as QuickFilter[]).map((filter) => <button className={quickFilter === filter ? "is-active" : ""} onClick={() => setQuickFilter(quickFilter === filter ? "none" : filter)} key={filter}><span>{filter === "never" ? "Never retrieved" : filter}</span></button>)}
          {projects.length ? <label className="library-project-filter"><span className="eyebrow">PROJECT</span><select aria-label="Filter Library by project" value={projectId} onChange={(event) => { setLoading(true); setProjectId(event.target.value); }}><option value="">Every project</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label> : null}
          {savedViews.length ? <><p className="eyebrow library-collections__secondary">SAVED VIEWS</p>{savedViews.map((view) => <button aria-label={`Saved view ${view.name}`} onClick={() => applySavedView(view)} key={view.id}><span>{view.name}</span></button>)}</> : null}
        </nav>
        <section className="library-records" aria-label="Memory records">
          <header><div><p className="eyebrow">{collection.replaceAll("_", " ")} / {visibleItems.length}</p><strong>{submittedQuery ? `Results for “${submittedQuery}”` : "Canonical records"}</strong></div><label className="library-sort"><span className="sr-only">Sort Library records</span><select aria-label="Sort Library records" value={sort} onChange={(event) => { setLoading(true); setSort(event.target.value as LibrarySort); }}><option value="updated">Recently changed</option><option value="created">Recently added</option><option value="importance">Importance</option><option value="retrieval">Most retrieved</option></select></label></header>
          {selectedIds.size ? <div className="library-bulk-bar"><span>{selectedIds.size} selected</span><label><span className="sr-only">Label selected records</span><input maxLength={40} value={bulkLabel} onChange={(event) => setBulkLabel(event.target.value)} placeholder="Add label" /></label><button disabled={busy || !bulkLabel.trim()} onClick={() => void bulkAddLabel()}>Label</button><button disabled={busy} onClick={() => void bulkArchive()}>{collection === "archived" ? "Restore" : "Archive"}</button></div> : null}
          {loading ? <div className="library-skeleton" aria-label="Loading records"><i /><i /><i /><i /></div> : error ? <div className="library-empty" role="alert"><strong>Library unavailable</strong><p>{error}</p><button onClick={() => void load()}>Try again</button></div> : visibleItems.length ? <MemoryLibraryList items={visibleItems} selectedId={selected?.id} selectedIds={selectedIds} onOpen={(memory) => void open(memory)} onSelect={(id, checked) => setSelectedIds((current) => { const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next; })} /> : <div className="library-empty"><strong>Nothing in this collection.</strong><p>Try another collection or clear the current search.</p></div>}
          {nextCursor ? <button className="library-load-more" disabled={loading} onClick={() => void load(nextCursor)}>Load older records</button> : null}
        </section>
        {selected ? <MemoryInspector key={selected.id} memory={selected} events={events} related={related} labelSuggestions={labelSuggestions} historyLoading={historyLoading} busy={busy} onClose={() => setSelected(null)} onOpenRelated={(memory) => void open(memory)} onAddLabel={(label) => mutate(() => api.addMemoryLabel(selected, label), "Label added.")} onRemoveLabel={(label) => mutate(() => api.removeMemoryLabel(selected, label), "Label removed.")} onArchive={() => lifecycle(selected, "archive")} onRestore={() => lifecycle(selected, "restore")} onPurge={(confirmation) => mutate(() => api.purgeMemory(selected, confirmation), "Content permanently purged; audit tombstone retained.")} /> : <aside className="library-inspector library-inspector--empty"><span>⌁</span><strong>Select a record.</strong><p>Content, provenance, labels, retrieval history and lifecycle controls will appear here.</p></aside>}
      </div>
      {notice || undo ? <div className="library-toast" role="status"><span>{undo?.message ?? notice}</span>{undo ? <button disabled={busy} onClick={() => void undoLifecycle()} aria-label="Undo last Library lifecycle action">Undo</button> : null}<button onClick={() => { setNotice(null); setUndo(null); }} aria-label="Dismiss Library notification">×</button></div> : null}
    </section>
  );
}
