import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";

import { partitionDoneTasks } from "../doneTaskRetention";
import type { DoneBoardRetentionDays } from "../preferences";
import type { Project, Task, TaskPriority, TaskStatus } from "../types";

export type CommandCentreView = "needs_me" | "board" | "done" | "table" | "timeline" | "agent_activity";

export interface AgentRun {
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
  heartbeatAt: string | null;
  finishedAt: string | null;
}

interface CommandCentreViewsProps {
  projects: Project[];
  tasks: Task[];
  agentRuns?: AgentRun[];
  initialView?: CommandCentreView;
  onOpenTask?: (task: Task) => void;
  onMoveTask?: (task: Task, status: TaskStatus, position?: number) => void;
  syncUrl?: boolean;
  doneBoardRetentionDays?: DoneBoardRetentionDays;
  referenceTime?: number;
}

type FilterValue = "all" | string;
type AttentionFilter = "all" | "needs_me" | "clear";
type SourceFilter = "all" | "available" | "missing";

const VIEW_OPTIONS: Array<{ id: CommandCentreView; label: string }> = [
  { id: "needs_me", label: "Needs Me" },
  { id: "board", label: "Board" },
  { id: "done", label: "Done" },
  { id: "table", label: "Table" },
  { id: "timeline", label: "Timeline" },
  { id: "agent_activity", label: "Agent Activity" },
];

const STATUSES: TaskStatus[] = ["inbox", "planned", "in_progress", "blocked", "review", "done"];
const PRIORITIES: TaskPriority[] = ["low", "medium", "high", "urgent"];
const WIP_LIMITS: Partial<Record<TaskStatus, number>> = { in_progress: 5, review: 5 };
function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string | null): string {
  if (!value) return "No date";
  const datePart = value.slice(0, 10);
  const date = new Date(`${datePart}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return "No date";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function taskHasAttention(task: Task): boolean {
  return (task.attentionReasons?.length ?? 0) > 0;
}

function isSourceAvailable(value: string | null): boolean {
  return Boolean(value?.trim());
}

function matchesSource(value: string | null, source: SourceFilter): boolean {
  return source === "all" || (source === "available" ? isSourceAvailable(value) : !isSourceAvailable(value));
}

function matchesAttention(task: Task | undefined, attention: AttentionFilter): boolean {
  if (attention === "all") return true;
  const needsMe = task ? taskHasAttention(task) : false;
  return attention === "needs_me" ? needsMe : !needsMe;
}

function initialAttentionFilter(params: URLSearchParams | null): AttentionFilter {
  const value = params?.get("attention");
  return value === "needs_me" || value === "clear" ? value : "all";
}

function initialSourceFilter(params: URLSearchParams | null): SourceFilter {
  const value = params?.get("source");
  return value === "available" || value === "missing" ? value : "all";
}

function emptyState(message: string) {
  return <p className="command-centre-views__empty" role="status">{message}</p>;
}

function TaskSummary({ task, project, onOpenTask }: { task: Task; project: Project | undefined; onOpenTask?: (task: Task) => void }) {
  return (
    <div className="command-centre-views__task-summary">
      <button className="command-centre-views__task-link" type="button" onClick={() => onOpenTask?.(task)}>
        <strong>{task.title}</strong>
        <span>{project?.name ?? "Unassigned project"}</span>
      </button>
      <div className="command-centre-views__task-meta">
        <span className={`command-centre-views__priority command-centre-views__priority--${task.priority}`}>{task.priority}</span>
        {task.attentionReasons?.map((reason) => <span className="command-centre-views__attention" key={reason}>{titleCase(reason)}</span>)}
      </div>
    </div>
  );
}

function TaskMove({ task, onMoveTask }: { task: Task; onMoveTask?: (task: Task, status: TaskStatus, position?: number) => void }) {
  return (
    <label className="command-centre-views__move">
      <span className="sr-only">Move {task.title}</span>
      <select name={`task-status-${task.id}`} aria-label={`Move ${task.title}`} value={task.status} onChange={(event) => onMoveTask?.(task, event.target.value as TaskStatus)}>
        {STATUSES.map((status) => <option value={status} key={status}>{titleCase(status)}</option>)}
      </select>
    </label>
  );
}

function reorderPosition(tasks: Task[], index: number, direction: -1 | 1): number | null {
  if (direction === -1) {
    if (index <= 0) return null;
    return index === 1
      ? tasks[0].position - 1_000
      : (tasks[index - 2].position + tasks[index - 1].position) / 2;
  }
  if (index >= tasks.length - 1) return null;
  return index === tasks.length - 2
    ? tasks.at(-1)!.position + 1_000
    : (tasks[index + 1].position + tasks[index + 2].position) / 2;
}

function TaskList({ tasks, projectById, onOpenTask }: { tasks: Task[]; projectById: Map<string, Project>; onOpenTask?: (task: Task) => void }) {
  if (!tasks.length) return emptyState("No tasks match the current view.");
  return <div className="command-centre-views__task-list">{tasks.map((task) => <TaskSummary key={task.id} task={task} project={projectById.get(task.projectId)} onOpenTask={onOpenTask} />)}</div>;
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: FilterValue; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <label className="command-centre-views__filter">
      <span>{label}</span>
      <select name={`task-filter-${label.toLowerCase().replaceAll(" ", "-")}`} aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="all">All</option>
        {options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function NeedsMeView({ tasks, projectById, onOpenTask }: { tasks: Task[]; projectById: Map<string, Project>; onOpenTask?: (task: Task) => void }) {
  return (
    <section aria-labelledby="command-centre-needs-me-title" className="command-centre-views__panel">
      <header className="command-centre-views__panel-header"><div><p className="eyebrow">ATTENTION QUEUE</p><h2 id="command-centre-needs-me-title">Needs Me</h2></div><span>{tasks.length} item{tasks.length === 1 ? "" : "s"}</span></header>
      <TaskList tasks={tasks.filter(taskHasAttention)} projectById={projectById} onOpenTask={onOpenTask} />
    </section>
  );
}

function BoardView({ tasks, projectById, onOpenTask, onMoveTask }: { tasks: Task[]; projectById: Map<string, Project>; onOpenTask?: (task: Task) => void; onMoveTask?: (task: Task, status: TaskStatus, position?: number) => void }) {
  return (
    <section aria-label="Task board" className="command-centre-views__board">
      {STATUSES.map((status) => {
        const columnTasks = tasks.filter((task) => task.status === status).sort((left, right) => left.position - right.position);
        return <article className="command-centre-views__column" data-status={status} key={status}>
          <header><h2>{titleCase(status)}</h2><span>{columnTasks.length}</span></header>
          <div className="command-centre-views__column-body">
            {columnTasks.length ? columnTasks.map((task, index) => <div className="command-centre-views__board-card" key={task.id}><TaskSummary task={task} project={projectById.get(task.projectId)} onOpenTask={onOpenTask} /><div className="command-centre-views__card-controls"><TaskMove task={task} onMoveTask={onMoveTask} /><div><button type="button" disabled={index === 0} aria-label={`Move ${task.title} up`} onClick={() => { const position = reorderPosition(columnTasks, index, -1); if (position !== null) onMoveTask?.(task, task.status, position); }}>↑</button><button type="button" disabled={index === columnTasks.length - 1} aria-label={`Move ${task.title} down`} onClick={() => { const position = reorderPosition(columnTasks, index, 1); if (position !== null) onMoveTask?.(task, task.status, position); }}>↓</button></div></div></div>) : <p className="command-centre-views__column-empty">Empty</p>}
          </div>
        </article>;
      })}
    </section>
  );
}

function DoneGroup({ title, description, tasks, projectById, onOpenTask, onMoveTask }: {
  title: string;
  description: string;
  tasks: Task[];
  projectById: Map<string, Project>;
  onOpenTask?: (task: Task) => void;
  onMoveTask?: (task: Task, status: TaskStatus, position?: number) => void;
}) {
  return <section className="command-centre-views__done-group" aria-labelledby={`done-${title.toLowerCase().replaceAll(" ", "-")}`}>
    <header><div><h2 id={`done-${title.toLowerCase().replaceAll(" ", "-")}`}>{title}</h2><p>{description}</p></div><strong aria-label={`${tasks.length} completed ${tasks.length === 1 ? "task" : "tasks"}`}>{tasks.length}</strong></header>
    {tasks.length ? <div className="command-centre-views__done-list">{tasks.map((task) => <article key={task.id}><TaskSummary task={task} project={projectById.get(task.projectId)} onOpenTask={onOpenTask} /><TaskMove task={task} onMoveTask={onMoveTask} /></article>)}</div> : emptyState("No completed tasks in this section.")}
  </section>;
}

function DoneView({ recent, history, retentionDays, projectById, onOpenTask, onMoveTask }: {
  recent: Task[];
  history: Task[];
  retentionDays: DoneBoardRetentionDays;
  projectById: Map<string, Project>;
  onOpenTask?: (task: Task) => void;
  onMoveTask?: (task: Task, status: TaskStatus, position?: number) => void;
}) {
  const recentDescription = retentionDays === 0
    ? "Completed tasks leave the Kanban immediately."
    : `Still visible in the Kanban for ${retentionDays} days.`;
  const historyDescription = retentionDays === 0
    ? "Completed tasks kept off the active Kanban."
    : `Completed more than ${retentionDays} days ago and kept off the active Kanban.`;
  return <div className="command-centre-views__done" aria-label="Completed task history">
    <DoneGroup title="Recent completions" description={recentDescription} tasks={recent} projectById={projectById} onOpenTask={onOpenTask} onMoveTask={onMoveTask} />
    <DoneGroup title="Done history" description={historyDescription} tasks={history} projectById={projectById} onOpenTask={onOpenTask} onMoveTask={onMoveTask} />
  </div>;
}

function TableView({ tasks, projectById, onOpenTask }: { tasks: Task[]; projectById: Map<string, Project>; onOpenTask?: (task: Task) => void }) {
  if (!tasks.length) return <section className="command-centre-views__panel">{emptyState("No tasks match the current filters.")}</section>;
  return <section className="command-centre-views__table-wrap" aria-label="Task table"><table><caption className="sr-only">Filtered tasks</caption><thead><tr><th scope="col">Task</th><th scope="col">Project</th><th scope="col">Status</th><th scope="col">Priority</th><th scope="col">Source</th><th scope="col">Due</th></tr></thead><tbody>{tasks.map((task) => <tr key={task.id}><th scope="row"><button type="button" className="command-centre-views__table-link" onClick={() => onOpenTask?.(task)}>{task.title}</button></th><td>{projectById.get(task.projectId)?.name ?? "Unassigned"}</td><td>{titleCase(task.status)}</td><td>{titleCase(task.priority)}</td><td>{isSourceAvailable(task.sourceUrl) ? "Available" : "Missing"}</td><td>{formatDate(task.dueAt)}</td></tr>)}</tbody></table></section>;
}

function TimelineView({ tasks, projectById, onOpenTask }: { tasks: Task[]; projectById: Map<string, Project>; onOpenTask?: (task: Task) => void }) {
  const sortedTasks = [...tasks].sort((left, right) => (left.dueAt ?? left.createdAt).localeCompare(right.dueAt ?? right.createdAt));
  if (!sortedTasks.length) return <section className="command-centre-views__panel">{emptyState("No tasks have timeline activity.")}</section>;
  return <section aria-label="Task timeline" className="command-centre-views__timeline">{sortedTasks.map((task) => <article key={task.id}><time dateTime={task.dueAt ?? task.createdAt}>{formatDate(task.dueAt ?? task.createdAt)}</time><div><TaskSummary task={task} project={projectById.get(task.projectId)} onOpenTask={onOpenTask} /><span className="command-centre-views__timeline-status">{titleCase(task.status)}</span></div></article>)}</section>;
}

function AgentActivityView({ runs, taskById, projectById, onOpenTask }: { runs: AgentRun[]; taskById: Map<string, Task>; projectById: Map<string, Project>; onOpenTask?: (task: Task) => void }) {
  if (!runs.length) return <section className="command-centre-views__panel">{emptyState("No agent activity matches the current filters.")}</section>;
  return <section aria-label="Agent activity" className="command-centre-views__activity">{runs.map((run) => { const task = run.taskId ? taskById.get(run.taskId) : undefined; return <article key={run.id}><header><span className={`command-centre-views__run-status command-centre-views__run-status--${run.status}`}>{titleCase(run.status)}</span><time dateTime={run.startedAt}>{formatDate(run.startedAt)}</time></header><h2>{task ? <button type="button" className="command-centre-views__table-link" onClick={() => onOpenTask?.(task)}>{task.title}</button> : "Unlinked agent run"}</h2><p>{run.client ?? "Unknown client"} · {run.model ?? "Unknown model"}</p>{run.receipt ? <blockquote>{run.receipt}</blockquote> : null}<footer>{task ? projectById.get(task.projectId)?.name ?? "Unassigned project" : "No task link"}<span>{run.sourceUrl ? "Source available" : "Source unavailable"}</span></footer></article>; })}</section>;
}

export function CommandCentreViews({ projects, tasks, agentRuns = [], initialView = "needs_me", onOpenTask, onMoveTask, syncUrl = false, doneBoardRetentionDays = 3, referenceTime }: CommandCentreViewsProps) {
  const initialParams = useMemo(() => syncUrl ? new URLSearchParams(window.location.search) : null, [syncUrl]);
  const [view, setView] = useState<CommandCentreView>(() => {
    const value = initialParams?.get("view") as CommandCentreView | null;
    return value && VIEW_OPTIONS.some((option) => option.id === value) ? value : initialView;
  });
  const [projectId, setProjectId] = useState<FilterValue>(() => initialParams?.get("project") ?? "all");
  const [status, setStatus] = useState<FilterValue>(() => initialParams?.get("status") ?? "all");
  const [priority, setPriority] = useState<FilterValue>(() => initialParams?.get("priority") ?? "all");
  const [model, setModel] = useState<FilterValue>(() => initialParams?.get("model") ?? "all");
  const [client, setClient] = useState<FilterValue>(() => initialParams?.get("client") ?? "all");
  const [attention, setAttention] = useState<AttentionFilter>(() => initialAttentionFilter(initialParams));
  const [source, setSource] = useState<SourceFilter>(() => initialSourceFilter(initialParams));
  const [partitionReferenceTime] = useState(() => referenceTime ?? Date.now());

  useEffect(() => {
    if (!syncUrl) return;
    const url = new URL(window.location.href);
    const values = { view, project: projectId, status, priority, model, client, attention, source };
    for (const [key, value] of Object.entries(values)) {
      if (value === "all" || (key === "view" && value === "needs_me")) url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    }
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, [attention, client, model, priority, projectId, source, status, syncUrl, view]);

  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const modelOptions = useMemo(() => [...new Set([...tasks.map((task) => task.sourceModel), ...agentRuns.map((run) => run.model)].filter((value): value is string => Boolean(value)))].sort().map((value) => ({ value, label: value })), [agentRuns, tasks]);
  const clientOptions = useMemo(() => [...new Set([...tasks.map((task) => task.sourceClient), ...agentRuns.map((run) => run.client)].filter((value): value is string => Boolean(value)))].sort().map((value) => ({ value, label: value })), [agentRuns, tasks]);

  const filteredTasks = useMemo(() => tasks.filter((task) => task.archivedAt === null
    && (projectId === "all" || task.projectId === projectId)
    && (status === "all" || task.status === status)
    && (priority === "all" || task.priority === priority)
    && (model === "all" || task.sourceModel === model)
    && (client === "all" || task.sourceClient === client)
    && matchesAttention(task, attention)
    && matchesSource(task.sourceUrl, source)), [attention, client, model, priority, projectId, source, status, tasks]);

  const filteredRuns = useMemo(() => agentRuns.filter((run) => {
    const task = run.taskId ? taskById.get(run.taskId) : undefined;
    return (projectId === "all" || task?.projectId === projectId)
      && (status === "all" || task?.status === status)
      && (priority === "all" || task?.priority === priority)
      && (model === "all" || run.model === model)
      && (client === "all" || run.client === client)
      && matchesAttention(task, attention)
      && matchesSource(run.sourceUrl, source);
  }), [agentRuns, attention, client, model, priority, projectId, source, status, taskById]);

  const needsMeTasks = filteredTasks.filter(taskHasAttention);
  const doneTasks = useMemo(
    () => partitionDoneTasks(filteredTasks, doneBoardRetentionDays, partitionReferenceTime),
    [doneBoardRetentionDays, filteredTasks, partitionReferenceTime],
  );
  const recentDoneIds = new Set(doneTasks.recent.map((task) => task.id));
  const boardTasks = filteredTasks.filter((task) => task.status !== "done" || recentDoneIds.has(task.id));
  const wipWarnings = Object.entries(WIP_LIMITS).flatMap(([taskStatus, limit]) => {
    const count = filteredTasks.filter((task) => task.status === taskStatus).length;
    return limit !== undefined && count > limit
      ? [`${titleCase(taskStatus)} has ${count} tasks, above its warning limit of ${limit}.`]
      : [];
  });
  const viewContent = view === "needs_me"
    ? <NeedsMeView tasks={needsMeTasks} projectById={projectById} onOpenTask={onOpenTask} />
    : view === "board"
      ? <BoardView tasks={boardTasks} projectById={projectById} onOpenTask={onOpenTask} onMoveTask={onMoveTask} />
      : view === "done"
        ? <DoneView recent={doneTasks.recent} history={doneTasks.history} retentionDays={doneBoardRetentionDays} projectById={projectById} onOpenTask={onOpenTask} onMoveTask={onMoveTask} />
        : view === "table"
          ? <TableView tasks={filteredTasks} projectById={projectById} onOpenTask={onOpenTask} />
        : view === "timeline"
          ? <TimelineView tasks={filteredTasks} projectById={projectById} onOpenTask={onOpenTask} />
          : <AgentActivityView runs={filteredRuns} taskById={taskById} projectById={projectById} onOpenTask={onOpenTask} />;

  function moveViewFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % VIEW_OPTIONS.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + VIEW_OPTIONS.length) % VIEW_OPTIONS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = VIEW_OPTIONS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    setView(VIEW_OPTIONS[nextIndex].id);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]")[nextIndex]?.focus();
  }

  return (
    <section className="command-centre-views" aria-label="Command centre task views">
      <nav className="command-centre-views__tabs" aria-label="Task views" role="tablist">
        {VIEW_OPTIONS.map((option, index) => <button id={`command-centre-tab-${option.id}`} type="button" role="tab" aria-controls="command-centre-view-panel" aria-selected={view === option.id} tabIndex={view === option.id ? 0 : -1} className={view === option.id ? "is-active" : ""} onClick={() => setView(option.id)} onKeyDown={(event) => moveViewFocus(event, index)} key={option.id}>{option.label}</button>)}
      </nav>
      <div className="command-centre-views__filters" aria-label="Task filters">
        <FilterSelect label="Project" value={projectId} onChange={setProjectId} options={projects.map((project) => ({ value: project.id, label: project.name }))} />
        <FilterSelect label="Status" value={status} onChange={setStatus} options={STATUSES.map((value) => ({ value, label: titleCase(value) }))} />
        <FilterSelect label="Priority" value={priority} onChange={setPriority} options={PRIORITIES.map((value) => ({ value, label: titleCase(value) }))} />
        <FilterSelect label="Model" value={model} onChange={setModel} options={modelOptions} />
        <FilterSelect label="Client" value={client} onChange={setClient} options={clientOptions} />
        <FilterSelect label="Attention" value={attention} onChange={(value) => setAttention(value as AttentionFilter)} options={[{ value: "needs_me", label: "Needs Me" }, { value: "clear", label: "Clear" }]} />
        <FilterSelect label="Source" value={source} onChange={(value) => setSource(value as SourceFilter)} options={[{ value: "available", label: "Available" }, { value: "missing", label: "Missing" }]} />
      </div>
      {wipWarnings.length ? <aside className="command-centre-views__wip-warning" role="status" aria-label="Work in progress warning"><strong>WIP signal</strong>{wipWarnings.map((warning) => <span key={warning}>{warning}</span>)}</aside> : null}
      <div id="command-centre-view-panel" className="command-centre-views__content" role="tabpanel" aria-labelledby={`command-centre-tab-${view}`}>{viewContent}</div>
    </section>
  );
}
