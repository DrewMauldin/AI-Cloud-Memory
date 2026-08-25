export interface EncryptedExportEnvelope {
  format: "cloud-memory-encrypted-jsonl";
  version: 1;
  algorithm: "AES-256-GCM";
  keyDerivation: "raw-256-bit-key";
  createdAt: string;
  iv: string;
  plaintextSha256: string;
  ciphertext: string;
}

interface ExportSnapshot {
  exportedAt: string;
  ownerId: string;
  memories: unknown[];
  projects: unknown[];
  tasks: unknown[];
  memoryEvents?: unknown[];
  taskEvents?: unknown[];
  conversations?: unknown[];
  taskConversations?: unknown[];
  memoryLinks?: unknown[];
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function hexToBytes(value: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error("Export encryption key must be 64 hexadecimal characters");
  }
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
}

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function sha256(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", exactBuffer(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function serializeExport(snapshot: ExportSnapshot): string {
  const lines = [
    JSON.stringify({
      type: "manifest",
      schemaVersion: 1,
      exportedAt: snapshot.exportedAt,
      ownerId: snapshot.ownerId,
      counts: {
        memories: snapshot.memories.length,
        projects: snapshot.projects.length,
        tasks: snapshot.tasks.length,
        memoryEvents: snapshot.memoryEvents?.length ?? 0,
        taskEvents: snapshot.taskEvents?.length ?? 0,
        conversations: snapshot.conversations?.length ?? 0,
        taskConversations: snapshot.taskConversations?.length ?? 0,
        memoryLinks: snapshot.memoryLinks?.length ?? 0,
      },
    }),
    ...snapshot.memories.map((record) => JSON.stringify({ type: "memory", record })),
    ...snapshot.projects.map((record) => JSON.stringify({ type: "project", record })),
    ...snapshot.tasks.map((record) => JSON.stringify({ type: "task", record })),
    ...(snapshot.memoryEvents ?? []).map((record) => JSON.stringify({ type: "memory_event", record })),
    ...(snapshot.taskEvents ?? []).map((record) => JSON.stringify({ type: "task_event", record })),
    ...(snapshot.conversations ?? []).map((record) => JSON.stringify({ type: "conversation", record })),
    ...(snapshot.taskConversations ?? []).map((record) => JSON.stringify({ type: "task_conversation", record })),
    ...(snapshot.memoryLinks ?? []).map((record) => JSON.stringify({ type: "memory_link", record })),
  ];
  return `${lines.join("\n")}\n`;
}

export async function encryptExport(
  plaintext: string,
  keyHex: string,
  randomBytes: (length: number) => Uint8Array = (length) => crypto.getRandomValues(new Uint8Array(length)),
): Promise<EncryptedExportEnvelope> {
  const encoded = new TextEncoder().encode(plaintext);
  const iv = randomBytes(12);
  if (iv.length !== 12) throw new Error("AES-GCM IV must be 12 bytes");
  const key = await crypto.subtle.importKey("raw", exactBuffer(hexToBytes(keyHex)), "AES-GCM", false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: exactBuffer(iv) }, key, exactBuffer(encoded));
  return {
    format: "cloud-memory-encrypted-jsonl",
    version: 1,
    algorithm: "AES-256-GCM",
    keyDerivation: "raw-256-bit-key",
    createdAt: new Date().toISOString(),
    iv: bytesToBase64(iv),
    plaintextSha256: await sha256(encoded),
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
  };
}

export async function decryptExport(
  envelope: EncryptedExportEnvelope,
  keyHex: string,
): Promise<string> {
  if (
    envelope.format !== "cloud-memory-encrypted-jsonl" ||
    envelope.version !== 1 ||
    envelope.algorithm !== "AES-256-GCM"
  ) {
    throw new Error("Unsupported export envelope");
  }
  const key = await crypto.subtle.importKey("raw", exactBuffer(hexToBytes(keyHex)), "AES-GCM", false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: exactBuffer(base64ToBytes(envelope.iv)) },
    key,
    exactBuffer(base64ToBytes(envelope.ciphertext)),
  );
  const bytes = new Uint8Array(decrypted);
  if ((await sha256(bytes)) !== envelope.plaintextSha256) {
    throw new Error("Export checksum does not match the decrypted content");
  }
  return new TextDecoder().decode(bytes);
}
