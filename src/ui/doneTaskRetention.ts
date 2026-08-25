import type { DoneBoardRetentionDays } from "./preferences";
import type { Task } from "./types";

const DAY_MS = 86_400_000;

export function partitionDoneTasks(tasks: Task[], retentionDays: DoneBoardRetentionDays, referenceTime: number) {
  const cutoff = referenceTime - retentionDays * DAY_MS;
  const done = tasks
    .filter((task) => task.status === "done")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const recent: Task[] = [];
  const history: Task[] = [];
  for (const task of done) {
    const updatedAt = Date.parse(task.updatedAt);
    if (retentionDays > 0 && Number.isFinite(updatedAt) && updatedAt >= cutoff) recent.push(task);
    else history.push(task);
  }
  return { recent, history };
}
