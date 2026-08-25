import { describe, expect, it } from "vitest";

import { decryptExport, encryptExport, serializeExport } from "./crypto";

const key = "9f".repeat(32);

describe("encrypted export envelope", () => {
  it("round trips a deterministic JSONL snapshot", async () => {
    const plaintext = serializeExport({
      exportedAt: "2026-08-23T00:00:00.000Z",
      ownerId: "123456789",
      memories: [{ id: "memory-1", content: "Remember this" }],
      projects: [],
      tasks: [],
    });

    const envelope = await encryptExport(plaintext, key, () => new Uint8Array(12).fill(7));

    expect(envelope.format).toBe("cloud-memory-encrypted-jsonl");
    expect(envelope.plaintextSha256).toHaveLength(64);
    expect(await decryptExport(envelope, key)).toBe(plaintext);
  });

  it("rejects an altered encrypted payload", async () => {
    const envelope = await encryptExport("sensitive", key, () => new Uint8Array(12).fill(3));
    const altered = { ...envelope, ciphertext: `${envelope.ciphertext.slice(0, -2)}AA` };

    await expect(decryptExport(altered, key)).rejects.toThrow();
  });
});
