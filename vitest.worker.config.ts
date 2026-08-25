import path from "node:path";

import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Cloudflare recommends running binding tests inside the Workers runtime.
// Source: https://developers.cloudflare.com/workers/testing/vitest-integration/
export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      // Keep tests fully local. AI and Vectorize are exercised through deterministic
      // fakes; loading production bindings would activate Wrangler's remote proxy.
      wrangler: { configPath: "./wrangler.test.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(
            path.resolve(import.meta.dirname, "migrations"),
          ),
        },
      },
    })),
  ],
  test: {
    include: ["src/**/*.worker.test.ts", "tests/**/*.worker.test.ts"],
    setupFiles: ["./tests/apply-migrations.ts"],
  },
});
