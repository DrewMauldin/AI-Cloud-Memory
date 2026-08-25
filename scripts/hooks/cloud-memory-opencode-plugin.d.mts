type OpenCodeClient = {
  app?: {
    log(options: {
      body: {
        service: string;
        level: string;
        message: string;
      };
    }): Promise<unknown>;
  };
  session: {
    promptAsync(options: Record<string, unknown>): Promise<unknown>;
  };
};

type PluginOptions = {
  client: OpenCodeClient;
  directory: string;
  stateDir?: string;
};

type OpenCodeHooks = {
  "experimental.chat.system.transform": (
    input: Record<string, unknown>,
    output: { system: string[] },
  ) => Promise<void>;
  "tool.execute.after": (
    input: Record<string, unknown>,
    output: Record<string, unknown>,
  ) => Promise<void>;
  event: (input: { event: Record<string, unknown> }) => Promise<void>;
};

export function createCloudMemoryOpenCodeHooks(options: PluginOptions): OpenCodeHooks;
export function CloudMemoryLifecyclePlugin(options: PluginOptions): Promise<OpenCodeHooks>;
export default CloudMemoryLifecyclePlugin;
