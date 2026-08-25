export const AUTOMATION_SCOPES = ["projection:read", "export:write"] as const;
export type AutomationScope = (typeof AUTOMATION_SCOPES)[number];

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function createAutomationToken(
  randomBytes: (length: number) => Uint8Array = (length) => crypto.getRandomValues(new Uint8Array(length)),
): string {
  const bytes = randomBytes(32);
  if (bytes.length !== 32) throw new Error("Automation token entropy must be 32 bytes");
  return `cm_auto_${base64Url(bytes)}`;
}

export async function hashAutomationToken(token: string): Promise<string> {
  const encoded = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", exactBuffer(encoded));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function isAllowedAutomationScope(value: string): value is AutomationScope {
  return (AUTOMATION_SCOPES as readonly string[]).includes(value);
}

export async function issueAutomationToken(input: {
  database: D1Database;
  ownerId: string;
  label: string;
  scopes: AutomationScope[];
  expiresAt?: string;
}): Promise<{ id: string; token: string; createdAt: string }> {
  const token = createAutomationToken();
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await input.database.prepare(
    `INSERT INTO automation_tokens (
      id, owner_id, label, token_hash, scopes_json, expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    input.ownerId,
    input.label,
    await hashAutomationToken(token),
    JSON.stringify([...new Set(input.scopes)].sort()),
    input.expiresAt ?? null,
    createdAt,
  ).run();
  return { id, token, createdAt };
}

export async function authenticateAutomationToken(input: {
  database: D1Database;
  authorization: string | undefined;
  requiredScope: AutomationScope;
}): Promise<{ ownerId: string; tokenId: string }> {
  const match = input.authorization?.match(/^Bearer (cm_auto_[A-Za-z0-9_-]{43})$/);
  if (!match?.[1]) throw new Error("Automation token is missing or invalid");
  const row = await input.database.prepare(
    `SELECT id, owner_id, scopes_json, expires_at FROM automation_tokens
     WHERE token_hash = ? AND revoked_at IS NULL`,
  ).bind(await hashAutomationToken(match[1])).first<{
    id: string;
    owner_id: string;
    scopes_json: string;
    expires_at: string | null;
  }>();
  if (!row || (row.expires_at && row.expires_at <= new Date().toISOString())) {
    throw new Error("Automation token is missing or invalid");
  }
  let scopes: unknown;
  try { scopes = JSON.parse(row.scopes_json); } catch { throw new Error("Automation token scope is invalid"); }
  if (!Array.isArray(scopes) || !scopes.includes(input.requiredScope)) {
    throw new Error("Automation token does not grant the required scope");
  }
  await input.database.prepare(
    "UPDATE automation_tokens SET last_used_at = ? WHERE id = ?",
  ).bind(new Date().toISOString(), row.id).run();
  return { ownerId: row.owner_id, tokenId: row.id };
}
