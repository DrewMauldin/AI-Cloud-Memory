import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import {
  MEMORY_DOCTOR_FINDING_LIMIT,
  MEMORY_DOCTOR_SCAN_LIMIT,
  MemoryDoctor,
} from "./doctor";

const ownerId = "doctor-owner";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM memory_doctor_findings WHERE owner_id = ?").bind(ownerId).run();
  await env.DB.prepare("DELETE FROM memories WHERE owner_id = ?").bind(ownerId).run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO users (id, github_login, created_at, updated_at) VALUES (?, ?, ?, ?)",
  ).bind(ownerId, "doctor-owner", "2026-08-24T00:00:00.000Z", "2026-08-24T00:00:00.000Z").run();
});

describe("MemoryDoctor", () => {
  it("creates deterministic review-only findings without mutating memories", async () => {
    await env.DB.prepare(
      `INSERT INTO memories (
        id, owner_id, namespace, kind, content, content_sha256, status,
        vector_state, review_at, expires_at, created_at, updated_at
      ) VALUES (?, ?, 'default', 'memory', ?, ?, 'active', 'failed', ?, ?, ?, ?)`,
    ).bind(
      "doctor-memory", ownerId, "A memory needing care", "doctor-hash",
      "2026-08-22T00:00:00.000Z", "2026-08-23T00:00:00.000Z",
      "2026-08-20T00:00:00.000Z", "2026-08-20T00:00:00.000Z",
    ).run();

    const doctor = new MemoryDoctor(env.DB, () => "2026-08-24T00:00:00.000Z", () => crypto.randomUUID());
    const result = await doctor.run(ownerId);
    expect(result.open).toBe(4);
    expect(result.findings.map((finding) => finding.findingType)).toEqual([
      "expired", "vector_failed", "review_due", "missing_provenance",
    ]);
    const memory = await env.DB.prepare("SELECT status FROM memories WHERE owner_id = ? AND id = ?")
      .bind(ownerId, "doctor-memory").first<{ status: string }>();
    expect(memory?.status).toBe("active");
  });

  it("requires an expected version for explicit finding decisions", async () => {
    await env.DB.prepare(
      `INSERT INTO memories (id, owner_id, namespace, kind, content, content_sha256, created_at, updated_at)
       VALUES (?, ?, 'default', 'memory', ?, ?, ?, ?)`,
    ).bind("doctor-current", ownerId, "Current memory", "current-hash", "2026-08-24T00:00:00.000Z", "2026-08-24T00:00:00.000Z").run();
    const doctor = new MemoryDoctor(env.DB, () => "2026-08-24T00:00:00.000Z", () => crypto.randomUUID());
    const { findings } = await doctor.run(ownerId);
    const finding = findings[0];
    const before = await env.DB.prepare(
      "SELECT status, vector_state, content, review_at, expires_at FROM memories WHERE owner_id = ? AND id = ?",
    ).bind(ownerId, "doctor-current").first<Record<string, string | null>>();
    const decided = await doctor.decide(ownerId, finding.id, finding.version, "dismissed");
    expect(decided.status).toBe("dismissed");
    const after = await env.DB.prepare(
      "SELECT status, vector_state, content, review_at, expires_at FROM memories WHERE owner_id = ? AND id = ?",
    ).bind(ownerId, "doctor-current").first<Record<string, string | null>>();
    expect(after).toEqual(before);
    await expect(doctor.decide(ownerId, finding.id, finding.version, "approved")).rejects.toThrow("version conflict");
  });

  it("caps scan and finding work and does not resolve findings outside a truncated scan", async () => {
    const timestamp = "2026-08-24T00:00:00.000Z";
    const statements = Array.from({ length: MEMORY_DOCTOR_SCAN_LIMIT + 1 }, (_, index) => {
      const memoryId = `doctor-cap-${index}`;
      return env.DB.prepare(
        `INSERT INTO memories (
          id, owner_id, namespace, kind, content, content_sha256, status,
          vector_state, review_at, expires_at, created_at, updated_at
        ) VALUES (?, ?, 'default', 'memory', ?, ?, 'active', 'failed', ?, ?, ?, ?)`,
      ).bind(
        memoryId,
        ownerId,
        `Memory ${index}`,
        `hash-${index}`,
        "2026-08-22T00:00:00.000Z",
        "2026-08-23T00:00:00.000Z",
        timestamp,
        timestamp,
      );
    });
    for (let offset = 0; offset < statements.length; offset += 50) {
      await env.DB.batch(statements.slice(offset, offset + 50));
    }
    await env.DB.prepare(
      `INSERT INTO memory_doctor_findings (
        id, owner_id, finding_type, severity, memory_id, title, detail,
        proposal_json, fingerprint, created_at
      ) VALUES (?, ?, 'missing_provenance', 'info', ?, ?, ?, ?, ?, ?)`,
    ).bind(
      "doctor-cap-existing",
      ownerId,
      `doctor-cap-${MEMORY_DOCTOR_SCAN_LIMIT}`,
      "Existing finding",
      "Keep this open when the scan is bounded.",
      JSON.stringify({ action: "add_provenance" }),
      `missing_provenance:doctor-cap-${MEMORY_DOCTOR_SCAN_LIMIT}`,
      timestamp,
    ).run();

    const doctor = new MemoryDoctor(env.DB, () => timestamp, () => crypto.randomUUID());
    const result = await doctor.run(ownerId);

    expect(result.examined).toBe(MEMORY_DOCTOR_SCAN_LIMIT);
    expect(result.open).toBe(MEMORY_DOCTOR_FINDING_LIMIT);
    expect(result.findings).toHaveLength(MEMORY_DOCTOR_FINDING_LIMIT);
    expect(result.truncated).toBe(true);
    const unseenFinding = await env.DB.prepare(
      "SELECT status FROM memory_doctor_findings WHERE owner_id = ? AND id = ?",
    ).bind(ownerId, "doctor-cap-existing").first<{ status: string }>();
    expect(unseenFinding?.status).toBe("open");
  });
});
