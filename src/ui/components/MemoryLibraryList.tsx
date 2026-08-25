import type { LibraryMemory } from "../types";

export function memoryTitle(memory: LibraryMemory): string {
  return memory.summary?.trim() || memory.content.split(/\r?\n/, 1)[0]?.slice(0, 120) || "Untitled memory";
}

function relativeDate(value: string): string {
  const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(value).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

export function MemoryLibraryList({
  items,
  selectedId,
  selectedIds,
  onOpen,
  onSelect,
}: {
  items: LibraryMemory[];
  selectedId?: string;
  selectedIds: Set<string>;
  onOpen: (memory: LibraryMemory) => void;
  onSelect: (memoryId: string, selected: boolean) => void;
}) {
  return (
    <div className="library-record-list">
      {items.map((memory) => (
        <article className={selectedId === memory.id ? "library-row is-open" : "library-row"} key={memory.id}>
          <label className="library-row__select">
            <span className="sr-only">Select {memoryTitle(memory)}</span>
            <input
              type="checkbox"
              checked={selectedIds.has(memory.id)}
              onChange={(event) => onSelect(memory.id, event.target.checked)}
            />
          </label>
          <button type="button" className="library-row__open" onClick={() => onOpen(memory)} aria-label={`Open ${memoryTitle(memory)}`}>
            <header>
              <span className={`record-kind record-kind--${memory.kind}`}>{memory.kind}</span>
              <span>#{memory.memoryNumber.toString().padStart(4, "0")}</span>
              <time dateTime={memory.updatedAt}>{relativeDate(memory.updatedAt)}</time>
            </header>
            <strong>{memoryTitle(memory)}</strong>
            {memory.summary ? <p>{memory.content}</p> : null}
            <footer>
              <span>{memory.sourceModel ?? memory.sourceClient ?? memory.sourceSystem ?? "Human"}</span>
              <em>{Math.round(memory.importance * 100)}% importance</em>
              {memory.labels.slice(0, 3).map((label) => <em key={label}>{label}</em>)}
              {memory.retrievalCount === 0 ? <em className="is-muted">never retrieved</em> : <em className="is-muted">used {memory.retrievalCount}×</em>}
            </footer>
          </button>
        </article>
      ))}
    </div>
  );
}
