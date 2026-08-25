import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createCloudMemoryOpenCodeHooks } from "../../scripts/hooks/cloud-memory-opencode-plugin.mjs";
import { readLifecycleState, STOP_CONTEXT } from "../../scripts/hooks/cloud-memory-hook.mjs";

describe("Cloud Memory OpenCode lifecycle plugin", () => {
  it("adds quiet lifecycle guidance to the system context", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "cloud-memory-opencode-"));
    const hooks = createCloudMemoryOpenCodeHooks({
      client: { session: { promptAsync: vi.fn() } },
      directory: "/workspace",
      stateDir,
    });
    const output = { system: [] as string[] };

    await hooks["experimental.chat.system.transform"]?.({
      sessionID: "session-1",
      model: {} as never,
    }, output);

    expect(output.system.join("\n")).toContain("cloudmemory_task_start");
    expect(output.system.join("\n")).toContain("cloudmemory_task_finish");
  });

  it("queues one synthetic finish turn only for an unfinished started task", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "cloud-memory-opencode-"));
    const promptAsync = vi.fn().mockResolvedValue(undefined);
    const hooks = createCloudMemoryOpenCodeHooks({
      client: { session: { promptAsync } },
      directory: "/workspace",
      stateDir,
    });

    await hooks["tool.execute.after"]?.({
      tool: "cloud-memory_cloudmemory_task_start",
      sessionID: "session-2",
      callID: "call-1",
      args: { task_id: "task-1" },
    }, { title: "", output: "started", metadata: {} });

    await hooks.event?.({ event: { type: "session.idle", properties: { sessionID: "session-2" } } as never });
    await hooks.event?.({ event: { type: "session.idle", properties: { sessionID: "session-2" } } as never });

    expect(promptAsync).toHaveBeenCalledTimes(1);
    expect(promptAsync).toHaveBeenCalledWith(expect.objectContaining({
      path: { id: "session-2" },
      query: { directory: "/workspace" },
      body: expect.objectContaining({
        system: STOP_CONTEXT,
        parts: [expect.objectContaining({ type: "text", synthetic: true })],
      }),
    }));
  });

  it("does not queue a finish turn after task_finish succeeds", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "cloud-memory-opencode-"));
    const promptAsync = vi.fn().mockResolvedValue(undefined);
    const hooks = createCloudMemoryOpenCodeHooks({
      client: { session: { promptAsync } },
      directory: "/workspace",
      stateDir,
    });

    for (const [tool, output] of [
      ["cloud-memory_cloudmemory_task_start", "started"],
      ["cloud-memory_cloudmemory_task_finish", "finished"],
    ] as const) {
      await hooks["tool.execute.after"]?.({
        tool,
        sessionID: "session-3",
        callID: tool,
        args: { task_id: "task-3" },
      }, { title: "", output, metadata: {} });
    }

    await hooks.event?.({ event: { type: "session.idle", properties: { sessionID: "session-3" } } as never });

    expect(promptAsync).not.toHaveBeenCalled();
    expect(readLifecycleState("session-3", { stateDir }).active_task_ids).toEqual([]);
  });
});
