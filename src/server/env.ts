export interface Env {
  APP_ENV: "local" | "preview" | "production";
  ALLOWED_GITHUB_USER_ID: string;
  ALLOWED_GITHUB_LOGIN: string;
  GITHUB_EXPORT_REPOSITORY: string;
  PUBLIC_ORIGIN: string;
  SEMANTIC_SEARCH_ENABLED?: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  COOKIE_ENCRYPTION_KEY: string;
  EXPORT_ENCRYPTION_KEY?: string;
  GITHUB_EXPORT_TOKEN?: string;
  GITHUB_CONNECTOR_TOKEN?: string;
  NATIVE_AUTOMATION_ENABLED?: string;
  PROJECTION_WEBDAV_BASE_URL?: string;
  PROJECTION_WEBDAV_USERNAME?: string;
  PROJECTION_WEBDAV_PASSWORD?: string;
  DB: D1Database;
  OAUTH_KV: KVNamespace;
  MEMORY_INDEX: VectorizeIndex;
  AI: Ai;
}
