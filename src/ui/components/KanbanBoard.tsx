import { useState } from "react";

import type { Project, Task, TaskStatus } from "../types";

export const KANBAN_COLUMNS: ReadonlyArray<{
  status: TaskStatus;
  label: string;
  marker: string;
}> = [
  { status: "inbox", label: "Inbox", marker: "01" },
  { status: "planned", label: "Planned", marker: "02" },
  { status: "in_progress", label: "In progress", marker: "03" },
  { status: "blocked", label: "Blocked", marker: "04" },
  { status: "review", label: "Review", marker: "05" },
  { status: "done", label: "Done", marker: "06" },
];

interface TaskCardProps {
  project: Project;
  task: Task;
  onMove: (task: Task, status: TaskStatus) => void;
  onOpen?: (task: Task) => void;
  onDragStart?: (task: Task) => void;
  onDragEnd?: () => void;
  onPointerDrop?: (task: Task, event: React.PointerEvent<HTMLButtonElement>) => void;
  dragging?: boolean;
}

export function ProjectSwatch({ colour }: { colour: string }) {
  return (
    <svg className="project-swatch" viewBox="0 0 8 8" aria-hidden="true">
      <circle cx="4" cy="4" r="3.5" fill={colour} stroke="currentColor" strokeWidth="0.5" />
    </svg>
  );
}

export function TaskCard({ project, task, onMove, onOpen, onDragStart, onDragEnd, onPointerDrop, dragging }: TaskCardProps) {
  return (
    <article
      className={`task-card priority-${task.priority}`}
      data-task-id={task.id}
      data-dragging={dragging ? "true" : undefined}
      draggable
      onDragStart={() => onDragStart?.(task)}
      onDragEnd={onDragEnd}
    >
      <button
        className="drag-handle"
        type="button"
        aria-label={`Drag ${task.title}`}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture?.(event.pointerId);
          onDragStart?.(task);
        }}
        onPointerUp={(event) => onPointerDrop?.(task, event)}
        onPointerCancel={onDragEnd}
      >
        <span aria-hidden="true">⠿</span>
      </button>
      <button
        className="task-card__open"
        type="button"
        onClick={() => onOpen?.(task)}
        aria-label={`Open ${task.title}`}
      >
        <span className="task-card__project">
          <ProjectSwatch colour={project.colour} />
          {project.name}
        </span>
        <strong>{task.title}</strong>
        {task.description ? <span className="task-card__description">{task.description}</span> : null}
      </button>

      <div className="provenance-row" aria-label="Task provenance">
        <span className="provenance-chip">{task.sourceModel ?? task.sourceType}</span>
        {task.sourceClient ? <span className="provenance-chip is-muted">{task.sourceClient}</span> : null}
      </div>

      {task.blockerSummary ? (
        <p className="blocker-note">
          <span>Blocked</span> {task.blockerSummary}
        </p>
      ) : null}

      <div className="task-card__footer">
        {task.sourceUrl ? (
          <a className="source-link" href={task.sourceUrl} target="_blank" rel="noreferrer">
            Open chat <span aria-hidden="true">↗</span>
          </a>
        ) : (
          <span className="source-link is-unavailable">Chat unavailable</span>
        )}

        <label className="move-control">
          <span className="sr-only">Move {task.title}</span>
          <select
            aria-label={`Move ${task.title}`}
            value={task.status}
            onChange={(event) => onMove(task, event.target.value as TaskStatus)}
          >
            {KANBAN_COLUMNS.map((column) => (
              <option key={column.status} value={column.status}>
                {column.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </article>
  );
}

interface KanbanBoardProps {
  projects: Project[];
  tasks: Task[];
  onMove: (task: Task, status: TaskStatus) => void;
  onOpenTask: (task: Task) => void;
}

export function KanbanBoard({ projects, tasks, onMove, onOpenTask }: KanbanBoardProps) {
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);

  function dropOn(status: TaskStatus) {
    const task = tasks.find((candidate) => candidate.id === draggedTaskId);
    setDraggedTaskId(null);
    if (task && task.status !== status) onMove(task, status);
  }

  function pointerDrop(task: Task, event: React.PointerEvent<HTMLButtonElement>) {
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-column-status]");
    const status = target?.dataset.columnStatus as TaskStatus | undefined;
    setDraggedTaskId(null);
    if (status && status !== task.status) onMove(task, status);
  }

  return (
    <div className="kanban-scroll">
      <div className="kanban-board" role="region" aria-label="Project task board">
        {KANBAN_COLUMNS.map((column) => {
          const columnTasks = tasks
            .filter((task) => task.status === column.status)
            .sort((left, right) => left.position - right.position);

          return (
            <section
              className="kanban-column"
              key={column.status}
              aria-labelledby={`column-${column.status}`}
              data-column-status={column.status}
              data-drop-target={draggedTaskId ? "true" : undefined}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => dropOn(column.status)}
            >
              <header className="kanban-column__header">
                <span>{column.marker}</span>
                <h2 id={`column-${column.status}`}>{column.label}</h2>
                <strong aria-label={`${columnTasks.length} tasks`}>{columnTasks.length}</strong>
              </header>
              <div className="kanban-column__body">
                {columnTasks.map((task) => {
                  const project = projectsById.get(task.projectId);
                  if (!project) return null;
                  return (
                    <TaskCard
                      key={task.id}
                      project={project}
                      task={task}
                      onMove={onMove}
                      onOpen={onOpenTask}
                      onDragStart={(item) => setDraggedTaskId(item.id)}
                      onDragEnd={() => setDraggedTaskId(null)}
                      onPointerDrop={pointerDrop}
                      dragging={draggedTaskId === task.id}
                    />
                  );
                })}
                {columnTasks.length === 0 ? <p className="column-empty">Clear / waiting</p> : null}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
