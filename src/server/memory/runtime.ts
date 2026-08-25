import type { Env } from "../env";

export function semanticSearchEnabled(env: Env): boolean {
  return env.SEMANTIC_SEARCH_ENABLED === "true";
}
