export async function storeOAuthState(
  database: D1Database,
  key: string,
  value: unknown,
  ttlSeconds: number,
): Promise<void> {
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1_000).toISOString();
  await database.batch([
    database.prepare("DELETE FROM oauth_states WHERE expires_at <= ?").bind(createdAt),
    database.prepare(
      `INSERT INTO oauth_states (key, payload_json, expires_at, created_at)
       VALUES (?, ?, ?, ?)`,
    ).bind(key, JSON.stringify(value), expiresAt, createdAt),
  ]);
}

export async function takeOAuthState<T>(
  database: D1Database,
  key: string,
): Promise<T | null> {
  const now = new Date().toISOString();
  const claimToken = crypto.randomUUID();
  const claim = await database.prepare(
    `UPDATE oauth_states SET claim_token = ?
     WHERE key = ? AND expires_at > ? AND claim_token IS NULL`,
  ).bind(claimToken, key, now).run();
  if (claim.meta.changes !== 1) return null;

  const row = await database.prepare(
    `SELECT payload_json FROM oauth_states
     WHERE key = ? AND claim_token = ?`,
  ).bind(key, claimToken).first<{ payload_json: string }>();
  await database.prepare(
    "DELETE FROM oauth_states WHERE key = ? AND claim_token = ?",
  ).bind(key, claimToken).run();
  if (!row) return null;
  try {
    return JSON.parse(row.payload_json) as T;
  } catch {
    return null;
  }
}

export async function readOAuthState<T>(
  database: D1Database,
  key: string,
): Promise<T | null> {
  const row = await database.prepare(
    `SELECT payload_json FROM oauth_states
     WHERE key = ? AND expires_at > ?`,
  ).bind(key, new Date().toISOString()).first<{ payload_json: string }>();
  if (!row) return null;
  try {
    return JSON.parse(row.payload_json) as T;
  } catch {
    return null;
  }
}
