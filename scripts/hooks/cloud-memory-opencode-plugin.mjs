import {
  clearLifecycleState,
  readLifecycleState,
  recordLifecycleEvent,
  START_CONTEXT,
  STOP_CONTEXT,
} from "./cloud-memory-hook.mjs";

const OPENCODE_SYSTEM_CONTEXT = `${START_CONTEXT}
- When a Cloud Memory task has been started in this session, do not end the work without calling cloudmemory_task_finish or reporting one unconfirmed finish after an authentication or availability failure.`;

export function createCloudMemoryOpenCodeHooks({ client, directory, stateDir }) {
  const nudgedSessions = new Set();

  return {
    "experimental.chat.system.transform": async (_input, output) => {
      output.system.push(OPENCODE_SYSTEM_CONTEXT);
    },

    "tool.execute.after": async (input, output) => {
      const action = recordLifecycleEvent({
        hook_event_name: "PostToolUse",
        session_id: input.sessionID,
        tool_name: input.tool,
        tool_input: input.args,
        tool_response: output.output,
      }, { stateDir });
      if (action === "start" || action === "finish") {
        nudgedSessions.delete(input.sessionID);
      }
    },

    event: async ({ event }) => {
      if (event.type === "session.deleted") {
        const sessionID = event.properties?.info?.id;
        clearLifecycleState(sessionID, { stateDir });
        nudgedSessions.delete(sessionID);
        return;
      }
      if (event.type !== "session.idle") return;

      const sessionID = event.properties?.sessionID;
      const state = readLifecycleState(sessionID, { stateDir });
      if (state.active_task_ids.length === 0 || nudgedSessions.has(sessionID)) return;

      nudgedSessions.add(sessionID);
      try {
        await client.session.promptAsync({
          path: { id: sessionID },
          query: { directory },
          body: {
            system: STOP_CONTEXT,
            parts: [{
              type: "text",
              text: "Complete the pending Cloud Memory task finish check before ending this work.",
              synthetic: true,
            }],
          },
        });
      } catch {
        nudgedSessions.delete(sessionID);
      }
    },
  };
}

export const CloudMemoryLifecyclePlugin = async ({ client, directory }) => {
  await client.app.log({
    body: {
      service: "cloud-memory-lifecycle",
      level: "info",
      message: "State-aware Cloud Memory task finish guard loaded",
    },
  });
  return createCloudMemoryOpenCodeHooks({ client, directory });
};

export default CloudMemoryLifecyclePlugin;
