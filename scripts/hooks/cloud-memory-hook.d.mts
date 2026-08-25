export const START_CONTEXT: string;
export const STOP_CONTEXT: string;

export type HookEvent = Record<string, unknown>;
export type LifecycleState = {
  version: 1;
  active_task_ids: string[];
};
export type LifecycleOptions = { stateDir?: string };
export type HookResponse =
  | { continue: true }
  | { decision: "block"; reason: string }
  | {
    hookSpecificOutput: {
      hookEventName: "SessionStart";
      additionalContext: string;
    };
  };

export function parseHookInput(raw: string): HookEvent | null;
export function classifyLifecycleTool(toolName: unknown): "start" | "finish" | null;
export function readLifecycleState(sessionID: unknown, options?: LifecycleOptions): LifecycleState;
export function clearLifecycleState(sessionID: unknown, options?: LifecycleOptions): void;
export function recordLifecycleEvent(
  event: HookEvent | null,
  options?: LifecycleOptions,
): "start" | "finish" | null;
export function buildHookResponse(
  event: HookEvent | null,
  lifecycleState?: LifecycleState,
): HookResponse;
