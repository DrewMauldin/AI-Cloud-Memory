import { useEffect, useState } from "react";
import { api } from "../api";
import type { Project, Task, TaskEvent, TaskStructure } from "../types";
import { ProjectSwatch } from "./KanbanBoard";
import { useDialog } from "./useDialog";

interface TaskDrawerProps {
  task: Task;
  project: Project;
  onClose: () => void;
  onUpdated?: (task: Task) => void;
  onArchived?: (task: Task) => void;
  agentRuns?: TaskDrawerAgentRun[];
  structure?: TaskDrawerStructure;
}

export interface TaskDrawerAgentRun {
  id: string;
  taskId: string | null;
  conversationId: string | null;
  correlationId: string;
  actorType: "human" | "model" | "automation" | "import" | "system";
  client: string | null;
  model: string | null;
  sourceUrl: string | null;
  status: "running" | "succeeded" | "failed" | "awaiting_human" | "cancelled";
  receipt: string | null;
  startedAt: string;
  finishedAt: string | null;
  linkedMemoryCount?: number;
}

interface TaskStructureNode {
  id: string;
  title: string;
  status: Task["status"];
}

interface TaskProgressRollup {
  childCount: number;
  completedChildCount: number;
  percent: number;
}

export interface TaskDrawerStructure {
  parentTaskId?: string | null;
  isMilestone?: boolean;
  parentTask?: TaskStructureNode | null;
  milestone?: string | null;
  dependencies?: TaskStructureNode[];
  dependencyIds?: string[];
  relatedTasks?: TaskStructureNode[];
  progress?: TaskProgressRollup;
  version?: number;
  linkedMemoryCount?: number;
}

const MAX_AGENT_RECEIPT_CHARS = 2_000;

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function localDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function displayStatus(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function boundedReceipt(value: string | null): string | null {
  if (!value) return null;
  const characters = Array.from(value.trim());
  if (!characters.length) return null;
  return characters.length > MAX_AGENT_RECEIPT_CHARS
    ? `${characters.slice(0, MAX_AGENT_RECEIPT_CHARS - 1).join("")}…`
    : characters.join("");
}

function orderedAgentRuns(runs: TaskDrawerAgentRun[]): TaskDrawerAgentRun[] {
  return [...runs].sort((left, right) => right.startedAt.localeCompare(left.startedAt) || right.id.localeCompare(left.id));
}

function memoryLabel(count: number): string {
  return `${count} linked memor${count === 1 ? "y" : "ies"}`;
}

function toDrawerStructure(value: TaskStructure): TaskDrawerStructure {
  return {
    parentTaskId: value.parentTaskId,
    isMilestone: value.isMilestone,
    parentTask: value.parentTask,
    milestone: value.isMilestone ? "This task is a milestone" : null,
    dependencies: value.dependencyTasks,
    dependencyIds: value.dependencies,
    relatedTasks: value.relatedTasks,
    progress: value.progress,
    version: value.version,
    linkedMemoryCount: value.linkedMemoryCount,
  };
}

export function TaskDrawer({ task, project, onClose, onUpdated, onArchived, agentRuns, structure }: TaskDrawerProps) {
  const [current, setCurrent] = useState(task);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [runLedger, setRunLedger] = useState<TaskDrawerAgentRun[]>(agentRuns ?? []);
  const [structureDetails, setStructureDetails] = useState<TaskDrawerStructure | undefined>(structure);
  const [structureSaving, setStructureSaving] = useState(false);
  const [structureError, setStructureError] = useState<string | null>(null);
  const dialogRef = useDialog(onClose);

  useEffect(() => {
    let active = true;
    api.task(task.id)
      .then((result) => {
        if (!active) return;
        setCurrent(result.task);
        setEvents(result.events);
        if (result.runs) setRunLedger(result.runs);
        if (result.structure) setStructureDetails(toDrawerStructure(result.structure));
      })
      .catch((reason: unknown) => active && setError(reason instanceof Error ? reason.message : "History unavailable"));
    return () => { active = false; };
  }, [task.id]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const dueValue = String(data.get("dueAt") ?? "");
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateTask(current, {
        title: String(data.get("title") ?? "").trim(),
        description: String(data.get("description") ?? "").trim() || null,
        priority: String(data.get("priority")) as Task["priority"],
        dueAt: dueValue ? new Date(dueValue).toISOString() : null,
        blockerSummary: String(data.get("blockerSummary") ?? "").trim() || null,
      });
      setCurrent(updated);
      setEditing(false);
      onUpdated?.(updated);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Task update failed");
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!window.confirm("Archive this task? It will leave the active board but remain in the audit trail.")) return;
    setSaving(true);
    setError(null);
    try {
      const archived = await api.archiveTask(current);
      onArchived?.(archived);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Task archive failed");
      setSaving(false);
    }
  }

  function applyStructureResult(next: TaskStructure) {
    setStructureDetails((currentStructure) => {
      const relatedTasks = currentStructure?.relatedTasks ?? next.relatedTasks ?? [];
      const taskById = new Map(relatedTasks.map((relatedTask) => [relatedTask.id, relatedTask]));
      return {
        ...currentStructure,
        parentTaskId: next.parentTaskId,
        isMilestone: next.isMilestone,
        parentTask: next.parentTaskId ? taskById.get(next.parentTaskId) ?? null : null,
        milestone: next.isMilestone ? "This task is a milestone" : null,
        dependencyIds: next.dependencies,
        dependencies: next.dependencies.map((dependencyId) => taskById.get(dependencyId) ?? { id: dependencyId, title: dependencyId, status: "inbox" }),
        relatedTasks,
        progress: next.progress,
        version: next.version,
        linkedMemoryCount: next.linkedMemoryCount ?? currentStructure?.linkedMemoryCount,
      };
    });
  }

  async function saveStructure(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!structureDetails?.version) return;
    const data = new FormData(event.currentTarget);
    setStructureSaving(true);
    setStructureError(null);
    try {
      const updated = await api.updateTaskStructure(current.id, {
        expectedVersion: structureDetails.version,
        parentTaskId: String(data.get("parentTaskId") ?? "") || null,
        isMilestone: data.get("isMilestone") === "on",
      });
      applyStructureResult(updated);
    } catch (reason) {
      setStructureError(reason instanceof Error ? reason.message : "Task structure update failed");
    } finally {
      setStructureSaving(false);
    }
  }

  async function addDependency(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!structureDetails?.version) return;
    const dependencyId = String(new FormData(event.currentTarget).get("dependsOnTaskId") ?? "");
    if (!dependencyId) return;
    setStructureSaving(true);
    setStructureError(null);
    try {
      const updated = await api.addTaskDependency(current.id, dependencyId, structureDetails.version);
      applyStructureResult(updated);
      event.currentTarget.reset();
    } catch (reason) {
      setStructureError(reason instanceof Error ? reason.message : "Task dependency could not be added");
    } finally {
      setStructureSaving(false);
    }
  }

  async function removeDependency(dependencyId: string) {
    if (!structureDetails?.version) return;
    setStructureSaving(true);
    setStructureError(null);
    try {
      const updated = await api.removeTaskDependency(current.id, dependencyId, structureDetails.version);
      applyStructureResult(updated);
    } catch (reason) {
      setStructureError(reason instanceof Error ? reason.message : "Task dependency could not be removed");
    } finally {
      setStructureSaving(false);
    }
  }

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside ref={dialogRef} className="task-drawer" role="dialog" aria-modal="true" aria-labelledby="task-drawer-title">
        <header>
          <p className="eyebrow">TASK / {current.id.slice(0, 8)}</p>
          <div className="drawer-header-actions"><button className="text-button" type="button" onClick={() => setEditing((value) => !value)}>{editing ? "Cancel edit" : "Edit task"}</button><button className="icon-button" type="button" onClick={onClose} aria-label="Close task">×</button></div>
        </header>
        <span className="task-card__project"><ProjectSwatch colour={project.colour} />{project.name}</span>
        <h2 id="task-drawer-title">{current.title}</h2>
        <p className="drawer-description">{current.description ?? "No additional description."}</p>

        {editing ? <form className="task-edit-form" onSubmit={save}>
          <label>Title<input name="title" defaultValue={current.title} required maxLength={240} /></label>
          <label>Description<textarea name="description" defaultValue={current.description ?? ""} maxLength={4_000} /></label>
          <div className="form-row"><label>Priority<select name="priority" defaultValue={current.priority}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></label><label>Due date<input name="dueAt" type="datetime-local" defaultValue={localDateTime(current.dueAt)} /></label></div>
          <label>Blocker<textarea name="blockerSummary" defaultValue={current.blockerSummary ?? ""} maxLength={2_000} /></label>
          {error ? <p className="error-copy" role="alert">{error}</p> : null}
          <div className="drawer-form-actions"><button className="primary-button" disabled={saving}>{saving ? "Saving" : "Save changes"}</button><button className="danger-button" type="button" onClick={archive} disabled={saving}>Archive task</button></div>
        </form> : null}

        <dl className="detail-grid">
          <div><dt>Status</dt><dd>{current.status.replace("_", " ")}</dd></div>
          <div><dt>Priority</dt><dd>{current.priority}</dd></div>
          <div><dt>Due</dt><dd>{current.dueAt ? formatDate(current.dueAt) : "No deadline"}</dd></div>
          <div><dt>Created by</dt><dd>{current.sourceModel ?? current.sourceType}</dd></div>
          <div><dt>Client</dt><dd>{current.sourceClient ?? "Unspecified"}</dd></div>
        </dl>

        {structureDetails ? <section className="drawer-section task-structure" aria-labelledby="task-structure-title">
          <h3 id="task-structure-title">Work structure</h3>
          <dl className="task-structure__summary">
            {structureDetails.parentTask ? <div><dt>Parent</dt><dd><strong>{structureDetails.parentTask.title}</strong><span>{displayStatus(structureDetails.parentTask.status)}</span></dd></div> : null}
            {structureDetails.milestone ? <div><dt>Milestone</dt><dd>{structureDetails.milestone}</dd></div> : null}
            {structureDetails.linkedMemoryCount !== undefined ? <div><dt>Linked memory</dt><dd>{memoryLabel(structureDetails.linkedMemoryCount)}</dd></div> : null}
            {structureDetails.progress ? <div><dt>Child progress</dt><dd>{structureDetails.progress.completedChildCount} of {structureDetails.progress.childCount} complete ({structureDetails.progress.percent}%)</dd></div> : null}
          </dl>
          {structureDetails.version !== undefined ? <>
            <form className="task-structure-form" onSubmit={saveStructure} key={`structure-${structureDetails.version}`}>
              <label>Parent task<select name="parentTaskId" aria-label="Parent task" defaultValue={structureDetails.parentTaskId ?? ""}><option value="">No parent</option>{structureDetails.relatedTasks?.filter((relatedTask) => relatedTask.id !== current.id).map((relatedTask) => <option value={relatedTask.id} key={relatedTask.id}>{relatedTask.title}</option>)}</select></label>
              <label className="task-structure-form__checkbox"><input name="isMilestone" type="checkbox" defaultChecked={structureDetails.isMilestone ?? false} aria-label="Milestone" /> Milestone</label>
              {structureError ? <p className="error-copy" role="alert">{structureError}</p> : null}
              <button className="secondary-button" disabled={structureSaving}>{structureSaving ? "Saving structure" : "Save structure"}</button>
            </form>
            <form className="task-structure-form task-structure-form--dependency" onSubmit={addDependency} key={`dependencies-${structureDetails.version}`}>
              <label>Add dependency<select name="dependsOnTaskId" aria-label="Add dependency" defaultValue=""><option value="">Choose a task</option>{structureDetails.relatedTasks?.filter((relatedTask) => relatedTask.id !== current.id && !(structureDetails.dependencyIds ?? []).includes(relatedTask.id)).map((relatedTask) => <option value={relatedTask.id} key={relatedTask.id}>{relatedTask.title}</option>)}</select></label>
              <button className="secondary-button" disabled={structureSaving}>Add dependency</button>
            </form>
          </> : null}
          <h4>Dependencies</h4>
          {structureDetails.dependencies?.length ? <ul className="task-structure__dependencies">{structureDetails.dependencies.map((dependency) => <li key={dependency.id}><span>{dependency.title}</span><strong>{displayStatus(dependency.status)}</strong>{structureDetails.version !== undefined ? <button type="button" className="task-structure__remove" onClick={() => void removeDependency(dependency.id)} disabled={structureSaving}>Remove</button> : null}</li>)}</ul> : <p className="muted-copy">No task dependencies recorded.</p>}
        </section> : null}

        <section className="drawer-section">
          <h3>Conversation source</h3>
          {current.sourceUrl ? <a className="primary-link" href={current.sourceUrl} target="_blank" rel="noreferrer">Open original chat ↗</a> : <p className="muted-copy">Chat unavailable. Provenance is retained without a source URL.</p>}
        </section>

        {runLedger.length ? <section className="drawer-section agent-run-section" aria-labelledby="agent-run-ledger-title">
          <h3 id="agent-run-ledger-title">Agent run ledger</h3>
          <ol className="agent-run-ledger" aria-label="Agent runs">
            {orderedAgentRuns(runLedger).map((run) => {
              const receipt = boundedReceipt(run.receipt);
              return <li key={run.id}>
                <header><strong>{displayStatus(run.status)}</strong><time dateTime={run.startedAt}>{formatDate(run.startedAt)}</time></header>
                <p className="agent-run-ledger__provenance">{run.client ?? "Unknown client"} · {run.model ?? "Unknown model"}</p>
                {receipt ? <p className="agent-run-ledger__receipt">{receipt}</p> : <p className="muted-copy">No completion receipt.</p>}
                <footer><span>{memoryLabel(run.linkedMemoryCount ?? 0)}</span>{run.sourceUrl ? <a href={run.sourceUrl} target="_blank" rel="noreferrer" aria-label={`Open agent source for ${run.id}`}>Open source ↗</a> : <span>Source unavailable</span>}</footer>
              </li>;
            })}
          </ol>
        </section> : null}

        <section className="drawer-section">
          <h3>Activity ledger</h3>
          {error ? <p className="error-copy">{error}</p> : null}
          <ol className="event-ledger">
            {events.map((event) => {
              const eventLabel = event.eventType.replaceAll("_", " ");
              return (
                <li key={event.id}>
                  <span className="event-dot" aria-hidden="true" />
                  <div>
                    <strong>{eventLabel}</strong>
                    <p>{event.fromStatus && event.toStatus ? `${event.fromStatus} → ${event.toStatus}` : `${event.actorType} · ${event.model ?? event.client ?? "Cloud Memory"}`}</p>
                    <time>{formatDate(event.createdAt)}</time>
                    {event.sourceUrl ? <a className="source-link" href={event.sourceUrl} target="_blank" rel="noreferrer" aria-label={`Open chat for ${eventLabel}`}>Open activity chat ↗</a> : null}
                  </div>
                </li>
              );
            })}
          </ol>
          {!error && events.length === 0 ? <p className="muted-copy">Loading verified task history…</p> : null}
        </section>
      </aside>
    </div>
  );
}
