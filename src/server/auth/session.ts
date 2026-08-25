export interface BrowserSession {
  userId: string;
  login: string;
  avatarUrl?: string;
  issuedAt: number;
  expiresAt: number;
}

export const SESSION_COOKIE_NAME = "cm_session";

function decodeHexKey(value: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error("COOKIE_ENCRYPTION_KEY must be a 64-character hex value");
  }
  return new Uint8Array(value.match(/../g)!.map((byte) => Number.parseInt(byte, 16)));
}

async function importKey(value: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    decodeHexKey(value).buffer as ArrayBuffer,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function isBrowserSession(value: unknown): value is BrowserSession {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BrowserSession>;
  return (
    typeof candidate.userId === "string" &&
    typeof candidate.login === "string" &&
    (candidate.avatarUrl === undefined || typeof candidate.avatarUrl === "string") &&
    typeof candidate.issuedAt === "number" &&
    Number.isFinite(candidate.issuedAt) &&
    typeof candidate.expiresAt === "number" &&
    Number.isFinite(candidate.expiresAt)
  );
}

export async function sealSession(
  session: BrowserSession,
  encryptionKey: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(session));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await importKey(encryptionKey),
      plaintext,
    ),
  );
  const payload = new Uint8Array(iv.length + ciphertext.length);
  payload.set(iv);
  payload.set(ciphertext, iv.length);
  return `v1.${toBase64Url(payload)}`;
}

export async function openSession(
  token: string,
  encryptionKey: string,
  nowEpochSeconds = Math.floor(Date.now() / 1000),
): Promise<BrowserSession | null> {
  try {
    const [version, encoded] = token.split(".", 2);
    if (version !== "v1" || !encoded) return null;
    const payload = fromBase64Url(encoded);
    if (payload.byteLength <= 12) return null;
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: payload.slice(0, 12) },
      await importKey(encryptionKey),
      payload.slice(12),
    );
    const session: unknown = JSON.parse(new TextDecoder().decode(plaintext));
    if (!isBrowserSession(session) || session.expiresAt <= nowEpochSeconds) return null;
    return session;
  } catch {
    return null;
  }
}

export function readCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

export function sessionCookie(token: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
