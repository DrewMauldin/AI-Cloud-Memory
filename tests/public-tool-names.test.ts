import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const publicContractFiles = [
  "README.md",
  "docs/ARCHITECTURE.md",
  "docs/CLIENTS.md",
  "public/setup.html",
  "src/server/mcp.ts",
] as const;

describe("public Cloud Memory tool names", () => {
  it("contains no visible legacy tool prefix on runtime or rollout surfaces", () => {
    const stale = publicContractFiles.filter((file) =>
      readFileSync(resolve(file), "utf8").includes("truememory_"),
    );

    expect(stale).toEqual([]);
  });
});
