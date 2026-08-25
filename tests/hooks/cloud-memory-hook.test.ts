import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildHookResponse,
  clearLifecycleState,
  parseHookInput,
  readLifecycleState,
  recordLifecycleEvent,
  START_CONTEXT,
  STOP_CONTEXT,
} from "../../scripts/hooks/cloud-memory-hook.mjs";

describe("Cloud Memory lifecycle hook", () => {
  it("adds one privacy-bounded start workflow as developer context", () => {
    const response = buildHookResponse({
      hook_event_name: "SessionStart",
      source: "startup",
      session_id: "session-1",
    });

    expect(response).toEqual({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: START_CONTEXT,
      },
    });
    expect(START_CONTEXT).toContain("cloudmemory_context_brief");
    expect(START_CONTEXT).toContain("cloudmemory_board");
    expect(START_CONTEXT).toContain("Do not use browser or Computer Use");
    expect(START_CONTEXT).toContain("Auth required");
    expect(START_CONTEXT).toContain("once");
    expect(START_CONTEXT).toContain("Never read or upload a transcript");
  });

  it("allows an ordinary stop when no tracked Cloud Memory task is open", () => {
    const response = buildHookResponse({
      hook_event_name: "Stop",
      stop_hook_active: false,
      last_assistant_message: "Implemented and verified the requested change. ".repeat(5),
    }, { version: 1, active_task_ids: [] });

    expect(response).toEqual({ continue: true });
  });

  it("continues exactly once when a started Cloud Memory task was not finished", () => {
    const response = buildHookResponse({
      hook_event_name: "Stop",
      stop_hook_active: false,
      last_assistant_message: "Done.",
    }, { version: 1, active_task_ids: ["task-1"] });

    expect(response).toEqual({ decision: "block", reason: STOP_CONTEXT });
    expect(STOP_CONTEXT).toContain("cloudmemory_task_finish");
    expect(STOP_CONTEXT).toContain("do not retry in a loop");
    expect(STOP_CONTEXT).toContain("do not use browser or Computer Use");
    expect(STOP_CONTEXT).toContain("Never read or upload the transcript");
  });

  it("does not loop after the stop hook has already continued the model", () => {
    expect(buildHookResponse({
      hook_event_name: "Stop",
      stop_hook_active: true,
      last_assistant_message: "A substantive final response".repeat(10),
    }, { version: 1, active_task_ids: ["task-1"] })).toEqual({ continue: true });
  });

  it("fails open for malformed or oversized hook input", () => {
    expect(parseHookInput("not json")).toBeNull();
    expect(parseHookInput("x".repeat(65_537))).toBeNull();
    expect(buildHookResponse(null)).toEqual({ continue: true });
  });

  it("ignores transcript paths and unrelated events", () => {
    expect(buildHookResponse({
      hook_event_name: "SessionEnd",
      transcript_path: "/private/session.jsonl",
    })).toEqual({ continue: true });
  });

  it("records successful task starts and finishes without storing tool output", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "cloud-memory-hook-"));
    const sessionID = "session-start-finish";

    recordLifecycleEvent({
      hook_event_name: "PostToolUse",
      session_id: sessionID,
      tool_name: "mcp__cloud_memory__cloudmemory_task_start",
      tool_input: { task_id: "task-1", expected_version: 3 },
      tool_response: { content: [{ type: "text", text: "started" }] },
    }, { stateDir });

    expect(readLifecycleState(sessionID, { stateDir })).toEqual({
      version: 1,
      active_task_ids: ["task-1"],
    });

    recordLifecycleEvent({
      hook_event_name: "PostToolUse",
      session_id: sessionID,
      tool_name: "mcp__cloud_memory__cloudmemory_task_finish",
      tool_input: { task_id: "task-1", expected_version: 4, status: "done" },
      tool_response: { content: [{ type: "text", text: "finished" }] },
    }, { stateDir });

    expect(readLifecycleState(sessionID, { stateDir })).toEqual({
      version: 1,
      active_task_ids: [],
    });
  });

  it("keeps the task open when a lifecycle tool fails", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "cloud-memory-hook-"));
    const sessionID = "session-failed-finish";

    recordLifecycleEvent({
      hook_event_name: "PostToolUse",
      session_id: sessionID,
      tool_name: "cloud-memory_cloudmemory_task_start",
      tool_input: { task_id: "task-2" },
      tool_response: "started",
    }, { stateDir });
    recordLifecycleEvent({
      hook_event_name: "PostToolUse",
      session_id: sessionID,
      tool_name: "cloud-memory_cloudmemory_task_finish",
      tool_input: { task_id: "task-2" },
      tool_response: { isError: true, content: [{ type: "text", text: "Auth required" }] },
    }, { stateDir });

    expect(readLifecycleState(sessionID, { stateDir }).active_task_ids).toEqual(["task-2"]);
  });

  it("cleans up only the current session state", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "cloud-memory-hook-"));
    for (const sessionID of ["session-a", "session-b"]) {
      recordLifecycleEvent({
        hook_event_name: "PostToolUse",
        session_id: sessionID,
        tool_name: "mcp__cloud_memory__cloudmemory_task_start",
        tool_input: { task_id: `${sessionID}-task` },
        tool_response: "started",
      }, { stateDir });
    }

    clearLifecycleState("session-a", { stateDir });

    expect(readLifecycleState("session-a", { stateDir }).active_task_ids).toEqual([]);
    expect(readLifecycleState("session-b", { stateDir }).active_task_ids).toEqual(["session-b-task"]);
  });
});
