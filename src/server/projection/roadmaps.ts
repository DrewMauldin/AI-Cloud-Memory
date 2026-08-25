export interface ProjectionRoadmap {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  horizon: "next" | "later" | "someday";
  status: "suggested" | "considering" | "planned" | "promoted" | "dismissed" | "archived";
  impact: "low" | "medium" | "high";
  effort: "small" | "medium" | "large";
  sourceType: string;
  sourceClient: string | null;
  sourceModel: string | null;
  sourceUrl: string | null;
  promotedTaskId: string | null;
  archivedAt: string | null;
  updatedAt: string;
}

const ACTIVE_STATUSES = new Set(["suggested", "considering", "planned"]);
const HORIZONS: ReadonlyArray<ProjectionRoadmap["horizon"]> = ["next", "later", "someday"];

export function roadmapSort(left: ProjectionRoadmap, right: ProjectionRoadmap): number {
  const horizon = HORIZONS.indexOf(left.horizon) - HORIZONS.indexOf(right.horizon);
  const statusOrder = ["planned", "considering", "suggested", "promoted", "archived", "dismissed"];
  const status = statusOrder.indexOf(left.status) - statusOrder.indexOf(right.status);
  const impact = ["high", "medium", "low"].indexOf(left.impact) - ["high", "medium", "low"].indexOf(right.impact);
  const effort = ["small", "medium", "large"].indexOf(left.effort) - ["small", "medium", "large"].indexOf(right.effort);
  return horizon || status || impact || effort || left.id.localeCompare(right.id);
}

function text(value: string, limit = 320): string {
  const bounded = Array.from(value.replaceAll("\n", " ").replaceAll("\r", " ").trim())
    .slice(0, limit)
    .join("");
  return bounded.replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function sourceLink(value: string | null): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return ` · [open chat](${url.toString().replaceAll(")", "%29")})`;
  } catch {
    return "";
  }
}

function provenance(item: ProjectionRoadmap): string {
  return [item.sourceModel ?? item.sourceType, item.sourceClient ? `via ${item.sourceClient}` : null]
    .filter(Boolean)
    .join(" ");
}

function ideaLine(item: ProjectionRoadmap, projectName?: string): string[] {
  const project = projectName ? ` · ${text(projectName, 120)}` : "";
  const lines = [
    `- **${text(item.title, 240)}**${project} · ${item.status} · ${item.impact} impact · ${item.effort} effort · ${text(provenance(item), 220)}${sourceLink(item.sourceUrl)}`,
  ];
  if (item.description) lines.push(`  - ${text(item.description)}`);
  return lines;
}

function active(items: ProjectionRoadmap[]): ProjectionRoadmap[] {
  return items.filter((item) => ACTIVE_STATUSES.has(item.status) && !item.archivedAt);
}

export function roadmapMetrics(items: ProjectionRoadmap[]): { active: number; next: number } {
  const current = active(items);
  return { active: current.length, next: current.filter((item) => item.horizon === "next").length };
}

export function renderProjectRoadmapSection(items: ProjectionRoadmap[]): string[] {
  const current = active(items);
  const history = items.filter((item) => !current.includes(item));
  const lines = ["## Roadmap", ""];
  if (!current.length) lines.push("_No active roadmap ideas._", "");
  for (const horizon of HORIZONS) {
    const ideas = current.filter((item) => item.horizon === horizon);
    if (!ideas.length) continue;
    lines.push(`### ${horizon[0]?.toUpperCase()}${horizon.slice(1)}`, "");
    for (const item of ideas) lines.push(...ideaLine(item));
    lines.push("");
  }
  if (history.length) {
    lines.push("### Promoted and archived", "");
    for (const item of history) lines.push(...ideaLine(item));
    lines.push("");
  }
  return lines;
}

export function renderRoadmapSummary(
  items: ProjectionRoadmap[],
  projectNames: Map<string, string>,
): string {
  const current = active(items);
  const archived = items.filter((item) => item.status === "archived" || item.status === "dismissed" || item.archivedAt);
  const promoted = items.filter((item) => item.status === "promoted");
  const lines = [
    "---",
    'record_type: "roadmap_summary"',
    `roadmap_count: ${current.length}`,
    "cloud_memory_managed: true",
    "managed: true",
    "tags:",
    "  - cloud-memory/roadmap",
    "---",
    "",
    "# Project Roadmap",
    "",
    "> [!warning] Managed Cloud Memory projection",
    "> D1 is canonical. Review, archive and promote ideas in Cloud Memory; the next projection safely replaces this note.",
    "",
    "## What should I work on next?",
    "",
  ];
  const next = current.filter((item) => item.horizon === "next").slice(0, 10);
  if (!next.length) lines.push("_No ideas are currently in the Next horizon._");
  for (const item of next) lines.push(...ideaLine(item, projectNames.get(item.projectId)));
  lines.push("");
  for (const horizon of HORIZONS) {
    const ideas = current.filter((item) => item.horizon === horizon);
    lines.push(`## ${horizon[0]?.toUpperCase()}${horizon.slice(1)}`, "");
    if (!ideas.length) lines.push("_No active ideas._");
    for (const item of ideas) lines.push(...ideaLine(item, projectNames.get(item.projectId)));
    lines.push("");
  }
  lines.push("## Promoted ideas", "");
  if (!promoted.length) lines.push("_No promoted ideas._");
  for (const item of promoted) lines.push(...ideaLine(item, projectNames.get(item.projectId)));
  lines.push("", "## Archived ideas", "");
  if (!archived.length) lines.push("_No archived ideas._");
  for (const item of archived) lines.push(...ideaLine(item, projectNames.get(item.projectId)));
  return `${lines.join("\n")}\n`;
}

export const ROADMAPS_BASE = `filters:
  and:
    - 'file.inFolder("Cloud Memory/Projects")'
    - 'file.ext == "md"'
    - 'managed == true'
    - 'roadmap_count > 0'
properties:
  status:
    displayName: "Project status"
  roadmap_count:
    displayName: "Active ideas"
  roadmap_next_count:
    displayName: "Next"
  updated:
    displayName: "Last changed"
views:
  - type: cards
    name: "Roadmap projects"
    order:
      - file.name
      - roadmap_next_count
      - roadmap_count
      - status
  - type: table
    name: "Roadmap register"
    order:
      - file.name
      - roadmap_next_count
      - roadmap_count
      - status
      - updated
`;
