import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";

type TestEnv = Env & {
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
};

const testEnv = env as TestEnv;
await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
