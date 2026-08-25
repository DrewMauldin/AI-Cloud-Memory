import { useMemo, useState } from "react";

import { api } from "../api";
import type { Project, Task } from "../types";

const PRIORITY_ORDER: Record<Task["priority"], number> = { urgent: 0, high: 1, medium: 2, low: 3 };

function label(value: string) {
  return value.replaceAll("_", " ");
}

function TaskRow({ task, archived, busy, onComplete, onArchive }: {
  task: Task;
  archived: boolean;
  busy: boolean;
  onComplete: (task: Task) => void;
  onArchive: (task: Task) => void;
}) {
  const provenance = [task.sourceClient, task.sourceModel].filter(Boolean).join(" · ") || label(task.sourceType);
  return (
    <li className={`portfolio-task ${task.status === "done" ? "is-complete" : ""}`}>
      <div className="portfolio-task__copy">
        <div className="portfolio-task__meta">
          <span className={`task-status task-status--${task.status}`}>{label(task.status)}</span>
          <span>{task.priority} priority</span>
          {task.dueAt ? <time dateTime={task.dueAt}>Due {new Date(task.dueAt).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}</time> : null}
        </div>
        <strong>{task.title}</strong>
        <small>{provenance}</small>
      </div>
      {archived ? null : <div className="portfolio-task__actions">
        {task.status !== "done" ? <button className="task-complete-button" type="button" disabled={busy} aria-label={`Mark ${task.title} complete`} onClick={() => onComplete(task)}>Complete</button> : <span className="task-complete-mark" aria-label="Completed">✓ Done</span>}
        <button type="button" disabled={busy} aria-label={`Archive ${task.title}`} onClick={() => onArchive(task)}>Archive</button>
        {task.sourceUrl ? <a href={task.sourceUrl} target="_blank" rel="noreferrer">Chat ↗</a> : null}
      </div>}
    </li>
  );
}

function ProjectCard({ project, tasks, archived, busyProject, busyTaskId, expandCompletedTasks, onProjectAction, onTaskComplete, onTaskArchive }: {
  project: Project;
  tasks: Task[];
  archived: boolean;
  busyProject: boolean;
  busyTaskId: string | null;
  expandCompletedTasks: boolean;
  onProjectAction: () => void;
  onTaskComplete: (task: Task) => void;
  onTaskArchive: (task: Task) => void;
}) {
  const [referenceTime] = useState(Date.now);
  const outstanding = tasks
    .filter((task) => task.status !== "done")
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.position - b.position);
  const completed = tasks.filter((task) => task.status === "done").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const moving = outstanding.filter((task) => task.status === "in_progress").length;
  const blocked = outstanding.filter((task) => task.status === "blocked").length;
  const overdue = outstanding.filter((task) => task.dueAt && new Date(task.dueAt).getTime() < referenceTime).length;
  const percent = tasks.length ? Math.round(completed.length / tasks.length * 100) : 0;
  const latestActivity = tasks.reduce((latest, task) => task.updatedAt > latest ? task.updatedAt : latest, project.updatedAt);
  return (
    <article className="portfolio-card" style={{ "--project-colour": project.colour } as React.CSSProperties}>
      <header className="portfolio-card__header">
        <div>
          <span className={`project-status project-status--${project.status}`}>{project.status}</span>
          <span className="portfolio-card__activity">Updated <time dateTime={latestActivity}>{new Date(latestActivity).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}</time></span>
        </div>
        <strong className="portfolio-card__outstanding">{outstanding.length}<small>outstanding</small></strong>
      </header>
      <div className="portfolio-card__intro">
        <h2>{project.name}</h2>
        <p>{project.description ?? "No project description yet."}</p>
      </div>
      <dl className="portfolio-health" aria-label={`${project.name} status summary`}>
        <div><dt>Outstanding</dt><dd>{outstanding.length}</dd></div>
        <div><dt>In progress</dt><dd>{moving}</dd></div>
        <div className={blocked ? "needs-attention" : ""}><dt>Blocked</dt><dd>{blocked}</dd></div>
        <div><dt>Complete</dt><dd>{completed.length}</dd></div>
      </dl>
      <div className="portfolio-progress" aria-label={`${percent}% complete`}><i style={{ width: `${percent}%` }} /><span>{percent}% complete</span></div>
      <div className="portfolio-evidence"><span>{project.linkedMemoryCount ?? 0} linked memories</span><span>{overdue} overdue</span><span>{project.sourceUrl ? "Source linked" : "No source link"}</span></div>

      <section className="portfolio-task-section" aria-label={`${project.name} tasks`}>
        <header><div><span>{archived ? "Preserved tasks" : "Outstanding work"}</span><strong>{archived ? tasks.length : outstanding.length}</strong></div>{archived ? <p>Visible in history, excluded from routine AI context.</p> : <p>Complete or archive each task independently.</p>}</header>
        {archived ? (
          tasks.length ? <ol className="portfolio-task-list">{tasks.map((task) => <TaskRow key={task.id} task={task} archived busy={false} onComplete={onTaskComplete} onArchive={onTaskArchive} />)}</ol> : <p className="portfolio-task-empty">No preserved tasks.</p>
        ) : (
          outstanding.length ? <ol className="portfolio-task-list">{outstanding.map((task) => <TaskRow key={task.id} task={task} archived={false} busy={busyTaskId === task.id} onComplete={onTaskComplete} onArchive={onTaskArchive} />)}</ol> : <p className="portfolio-task-empty">No outstanding tasks. This project is clear.</p>
        )}
        {!archived && completed.length ? <details className="portfolio-completed" open={expandCompletedTasks}><summary>{completed.length} complete</summary><ol className="portfolio-task-list">{completed.map((task) => <TaskRow key={task.id} task={task} archived={false} busy={busyTaskId === task.id} onComplete={onTaskComplete} onArchive={onTaskArchive} />)}</ol></details> : null}
      </section>

      <footer>
        <span>{archived ? `${tasks.length} preserved task${tasks.length === 1 ? "" : "s"}` : `${outstanding.length} open · ${moving} moving · ${blocked} blocked`}</span>
        <button disabled={busyProject} onClick={onProjectAction} aria-label={`${archived ? "Restore" : "Archive"} project ${project.name}`}>{archived ? "Restore project ↗" : "Archive project"}</button>
      </footer>
    </article>
  );
}

export function ProjectPortfolio({ projects, tasks, onArchived, onRestored, onTaskCompleted, onTaskArchived, expandCompletedTasks = false }: {
  projects: Project[];
  tasks: Task[];
  onArchived: (project: Project) => void;
  onRestored: (project: Project, tasks: Task[]) => void;
  onTaskCompleted: (task: Task) => void | Promise<void>;
  onTaskArchived: (task: Task) => void | Promise<void>;
  expandCompletedTasks?: boolean;
}) {
  const [view, setView] = useState<"active" | "paused" | "completed" | "archived">("active");
  const [archivedProjects, setArchivedProjects] = useState<Project[]>([]);
  const [archivedTasks, setArchivedTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currentGroups = useMemo(() => ({
    active: projects.filter((project) => project.status === "active").length,
    paused: projects.filter((project) => project.status === "paused").length,
    completed: projects.filter((project) => project.status === "completed").length,
  }), [projects]);

  async function showArchive() {
    setView("archived"); setLoading(true); setError(null);
    try {
      const result = await api.projects("archived");
      setArchivedProjects(result.projects); setArchivedTasks(result.tasks);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Archived projects could not be loaded"); }
    finally { setLoading(false); }
  }

  async function archive(project: Project) {
    setBusyId(project.id); setError(null);
    try { onArchived(await api.archiveProject(project)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Project could not be archived"); }
    finally { setBusyId(null); }
  }

  async function restore(project: Project) {
    setBusyId(project.id); setError(null);
    try {
      const restored = await api.restoreProject(project);
      const related = archivedTasks.filter((task) => task.projectId === project.id);
      setArchivedProjects((current) => current.filter((item) => item.id !== project.id));
      setArchivedTasks((current) => current.filter((task) => task.projectId !== project.id));
      onRestored(restored, related);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Project could not be restored"); }
    finally { setBusyId(null); }
  }

  async function runTaskAction(task: Task, action: (task: Task) => void | Promise<void>) {
    setBusyTaskId(task.id); setError(null);
    try { await action(task); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Task could not be updated"); }
    finally { setBusyTaskId(null); }
  }

  const visibleProjects = view === "archived" ? archivedProjects : projects.filter((project) => project.status === view);
  const visibleTasks = view === "archived" ? archivedTasks : tasks;
  return (
    <section className="project-portfolio" aria-label="Project portfolio">
      <header>
        <div><p className="eyebrow">PROJECT STATUS</p><strong>{view === "archived" ? "Past work, still legible." : "Projects first. Outstanding work always visible."}</strong></div>
        <nav aria-label="Project portfolio views">
          <button className={view === "active" ? "is-active" : ""} onClick={() => setView("active")}>Active <span>{currentGroups.active}</span></button>
          <button className={view === "paused" ? "is-active" : ""} onClick={() => setView("paused")}>Paused <span>{currentGroups.paused}</span></button>
          <button className={view === "completed" ? "is-active" : ""} onClick={() => setView("completed")}>Completed <span>{currentGroups.completed}</span></button>
          <button className={view === "archived" ? "is-active" : ""} onClick={() => void showArchive()} aria-label="Archived projects">Archived</button>
        </nav>
      </header>
      {view !== "archived" ? <div className="portfolio-status-line"><span>{currentGroups.active} active</span><span>{currentGroups.paused} paused</span><span>{currentGroups.completed} completed</span><strong>Archived tasks stay out of routine AI context</strong></div> : null}
      {error ? <p className="error-copy" role="alert">{error}</p> : null}
      {loading ? <div className="portfolio-loading">Loading project archive…</div> : visibleProjects.length ? <div className="portfolio-grid">{visibleProjects.map((project) => <ProjectCard key={project.id} project={project} tasks={visibleTasks.filter((task) => task.projectId === project.id)} archived={view === "archived"} busyProject={busyId === project.id} busyTaskId={busyTaskId} expandCompletedTasks={expandCompletedTasks} onProjectAction={() => void (view === "archived" ? restore(project) : archive(project))} onTaskComplete={(task) => void runTaskAction(task, onTaskCompleted)} onTaskArchive={(task) => void runTaskAction(task, onTaskArchived)} />)}</div> : <div className="portfolio-empty">{view === "archived" ? "No archived projects yet." : "No projects in this view."}</div>}
    </section>
  );
}
