export interface ClientInstallPlanItem {
  client: "codex" | "claude-code" | "opencode";
  command: string;
  args: string[];
  loginCommand: string;
}

export function buildPlan(input: { endpoint: string; clients?: string[] }): ClientInstallPlanItem[];
export function main(argv?: string[]): void;
