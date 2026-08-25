import { useState } from "react";

import type { LibraryMemory, MemoryEvent } from "../types";
import { memoryTitle } from "./MemoryLibraryList";

function dateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" }) : "Never";
}

function safeSourceUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function MemoryInspector({
  memory,
  events,
  related,
  labelSuggestions,
  historyLoading,
  busy,
  onClose,
  onOpenRelated,
  onAddLabel,
  onRemoveLabel,
  onArchive,
  onRestore,
  onPurge,
}: {
  memory: LibraryMemory;
  events: MemoryEvent[];
  related: LibraryMemory[];
  labelSuggestions: string[];
  historyLoading: boolean;
  busy: boolean;
  onClose: () => void;
  onOpenRelated: (memory: LibraryMemory) => void;
  onAddLabel: (label: string) => Promise<void>;
  onRemoveLabel: (label: string) => Promise<void>;
  onArchive: () => Promise<void>;
  onRestore: () => Promise<void>;
  onPurge: (confirmation: string) => Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [showPurge, setShowPurge] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const purgePhrase = `PURGE ${memory.id}`;
  const sourceUrl = safeSourceUrl(memory.sourceUrl);
  return (
    <aside className="library-inspector" aria-label="Record details">
      <header className="library-inspector__top">
        <div><span>{memory.kind}</span><span>v{memory.version}</span></div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close record details">×</button>
      </header>
      <div className="library-inspector__body">
        <p className="eyebrow">{memory.memoryType.replaceAll("_", " ")} / {memory.status}</p>
        <h2>{memoryTitle(memory)}</h2>
        <p className="inspector-content">{memory.content}</p>
        <div className="inspector-labels" aria-label="Labels">
          {memory.labels.map((item) => (
            <button type="button" key={item} disabled={busy} onClick={() => void onRemoveLabel(item)} aria-label={`Remove label ${item}`}>
              {item}<span aria-hidden="true">×</span>
            </button>
          ))}
          <form onSubmit={(event) => {
            event.preventDefault();
            if (!label.trim()) return;
            void onAddLabel(label).then(() => setLabel(""));
          }}>
            <label><span className="sr-only">New label</span><input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={40} placeholder="Add label" /></label>
            <button type="submit" disabled={busy || !label.trim()}>+</button>
          </form>
        </div>
        {labelSuggestions.length ? <section className="inspector-suggestions"><p className="eyebrow">SUGGESTED LABELS</p><div>{labelSuggestions.map((item) => <button type="button" disabled={busy} onClick={() => void onAddLabel(item)} key={item}>+ {item}</button>)}</div></section> : null}
        <dl className="inspector-grid">
          <div><dt>Importance</dt><dd>{Math.round(memory.importance * 100)}%</dd></div>
          <div><dt>Confidence</dt><dd>{Math.round(memory.confidence * 100)}%</dd></div>
          <div><dt>Scope</dt><dd>{memory.scopeId ?? memory.scopeType}</dd></div>
          <div><dt>Retrieved</dt><dd>{memory.retrievalCount ? `${memory.retrievalCount}× · ${dateTime(memory.lastRetrievedAt)}` : "Never"}</dd></div>
          <div><dt>Observed</dt><dd>{dateTime(memory.observedAt)}</dd></div>
          <div><dt>Recorded</dt><dd>{dateTime(memory.recordedAt)}</dd></div>
        </dl>
        <section className="inspector-provenance">
          <p className="eyebrow">PROVENANCE</p>
          <strong>{memory.sourceModel ?? memory.sourceClient ?? memory.sourceSystem ?? "Human"}</strong>
          {sourceUrl ? <a href={sourceUrl} target="_blank" rel="noreferrer">Open source chat ↗</a> : <span>Source chat unavailable</span>}
        </section>
        <section className="inspector-history">
          <p className="eyebrow">RECORD HISTORY / {events.length}</p>
          {historyLoading ? <p className="muted-copy">Loading history…</p> : (
            <ol>{events.map((event) => <li key={event.id}><i /><div><strong>{event.eventType.replaceAll("_", " ")}</strong><span>{event.model ?? event.client ?? event.actorType} · {dateTime(event.createdAt)}</span></div></li>)}</ol>
          )}
        </section>
        <section className="inspector-related">
          <p className="eyebrow">RELATED RECORDS / {related.length}</p>
          {related.length ? <ol>{related.map((item) => <li key={item.id}><button type="button" onClick={() => onOpenRelated(item)}><strong>{memoryTitle(item)}</strong><span>{item.kind} · {item.labels.slice(0, 2).join(" · ") || item.scopeId || item.scopeType}</span></button></li>)}</ol> : <p className="muted-copy">No bounded lineage, scope or label relationship found.</p>}
        </section>
        <section className="inspector-actions">
          {memory.status === "archived" && !memory.purgedAt
            ? <button className="primary-button" type="button" disabled={busy} onClick={() => void onRestore()}>Restore record</button>
            : memory.status === "active"
              ? <button className="secondary-button" type="button" disabled={busy} onClick={() => void onArchive()}>Archive record</button>
              : null}
          {memory.status === "archived" && !memory.purgedAt ? <button className="danger-button" type="button" disabled={busy} onClick={() => setShowPurge(true)}>Permanently purge</button> : null}
          {showPurge ? <div className="purge-confirmation"><p>This removes content and its vector. The audit tombstone remains.</p><code>{purgePhrase}</code><label>Type purge confirmation<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label><button className="danger-button" disabled={busy || confirmation !== purgePhrase} onClick={() => void onPurge(confirmation)}>Confirm permanent purge</button></div> : null}
        </section>
      </div>
    </aside>
  );
}
