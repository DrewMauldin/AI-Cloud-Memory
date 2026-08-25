export type DoctorFindingType = "expired" | "review_due" | "vector_failed" | "missing_provenance";
export type DoctorFindingStatus = "open" | "approved" | "dismissed" | "resolved";

export interface DoctorFinding {
  id: string;
  ownerId: string;
  findingType: DoctorFindingType;
  severity: "info" | "warning" | "critical";
  memoryId: string;
  title: string;
  detail: string;
  proposal: { action: "review" | "repair_index" | "add_provenance" | "archive_or_extend" };
  fingerprint: string;
  status: DoctorFindingStatus;
  createdAt: string;
  resolvedAt: string | null;
  version: number;
}

interface DoctorMemoryRow {
  id: string;
  source_system: string | null;
  source_url: string | null;
  review_at: string | null;
  expires_at: string | null;
  vector_state: string;
}

interface DoctorFindingRow {
  id: string;
  owner_id: string;
  finding_type: DoctorFindingType;
  severity: DoctorFinding["severity"];
  memory_id: string;
  title: string;
  detail: string;
  proposal_json: string;
  fingerprint: string;
  status: DoctorFindingStatus;
  created_at: string;
  resolved_at: string | null;
  version: number;
}

interface FindingCandidate {
  findingType: DoctorFindingType;
  severity: DoctorFinding["severity"];
  memoryId: string;
  title: string;
  detail: string;
  proposal: DoctorFinding["proposal"];
}

export const MEMORY_DOCTOR_SCAN_LIMIT = 125;
export const MEMORY_DOCTOR_FINDING_LIMIT = 500;
const MEMORY_DOCTOR_BATCH_SIZE = 50;

const FINDING_COLUMNS = `id, owner_id, finding_type, severity, memory_id, title, detail,
  proposal_json, fingerprint, status, created_at, resolved_at, version`;

function toFinding(row: DoctorFindingRow): DoctorFinding {
  return {
    id: row.id,
    ownerId: row.owner_id,
    findingType: row.finding_type,
    severity: row.severity,
    memoryId: row.memory_id,
    title: row.title,
    detail: row.detail,
    proposal: JSON.parse(row.proposal_json) as DoctorFinding["proposal"],
    fingerprint: row.fingerprint,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    version: row.version,
  };
}

export function diagnoseMemory(memory: DoctorMemoryRow, now: string): FindingCandidate[] {
  const findings: FindingCandidate[] = [];
  if (memory.expires_at && memory.expires_at <= now) {
    findings.push({
      findingType: "expired", severity: "critical", memoryId: memory.id,
      title: "Memory has passed its expiry date",
      detail: "Review whether this memory should be archived, replaced or given a new expiry date.",
      proposal: { action: "archive_or_extend" },
    });
  }
  if (memory.vector_state === "failed") {
    findings.push({
      findingType: "vector_failed", severity: "warning", memoryId: memory.id,
      title: "Semantic index repair is needed",
      detail: "D1 remains canonical. Re-run the bounded Vectorize repair before relying on semantic recall.",
      proposal: { action: "repair_index" },
    });
  }
  if (memory.review_at && memory.review_at <= now) {
    findings.push({
      findingType: "review_due", severity: "warning", memoryId: memory.id,
      title: "Memory review is due",
      detail: "Confirm, correct or supersede this memory through an explicit review action.",
      proposal: { action: "review" },
    });
  }
  if (!memory.source_system && !memory.source_url) {
    findings.push({
      findingType: "missing_provenance", severity: "info", memoryId: memory.id,
      title: "Memory provenance is incomplete",
      detail: "Add a source system or source URL if one is known. Provenance must not be inferred.",
      proposal: { action: "add_provenance" },
    });
  }
  return findings;
}

export class MemoryDoctor {
  constructor(
    private readonly database: D1Database,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  async run(ownerId: string): Promise<{ examined: number; open: number; findings: DoctorFinding[]; truncated: boolean }> {
    const now = this.now();
    const result = await this.database.prepare(
      `SELECT id, source_system, source_url, review_at, expires_at, vector_state
       FROM memories WHERE owner_id = ? AND status = 'active'
       ORDER BY updated_at DESC, id DESC LIMIT ?`,
    ).bind(ownerId, MEMORY_DOCTOR_SCAN_LIMIT + 1).all<DoctorMemoryRow>();
    const memories = result.results.slice(0, MEMORY_DOCTOR_SCAN_LIMIT);
    const scanTruncated = result.results.length > MEMORY_DOCTOR_SCAN_LIMIT;
    const allCandidates = memories.flatMap((memory) => diagnoseMemory(memory, now));
    const candidates = allCandidates.slice(0, MEMORY_DOCTOR_FINDING_LIMIT);
    const findingsTruncated = allCandidates.length > MEMORY_DOCTOR_FINDING_LIMIT;
    const fingerprints = new Set(candidates.map((finding) => `${finding.findingType}:${finding.memoryId}`));
    const findingStatements = candidates.map((candidate) => {
      const fingerprint = `${candidate.findingType}:${candidate.memoryId}`;
      return this.database.prepare(
        `INSERT INTO memory_doctor_findings (
           id, owner_id, finding_type, severity, memory_id, title, detail,
           proposal_json, fingerprint, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(owner_id, fingerprint) DO UPDATE SET
           severity = excluded.severity, title = excluded.title, detail = excluded.detail,
           proposal_json = excluded.proposal_json,
           status = CASE WHEN memory_doctor_findings.status = 'resolved' THEN 'open' ELSE memory_doctor_findings.status END,
           resolved_at = CASE WHEN memory_doctor_findings.status = 'resolved' THEN NULL ELSE memory_doctor_findings.resolved_at END,
           version = CASE WHEN memory_doctor_findings.status = 'resolved' THEN memory_doctor_findings.version + 1 ELSE memory_doctor_findings.version END`,
      ).bind(
        this.newId(), ownerId, candidate.findingType, candidate.severity, candidate.memoryId,
        candidate.title, candidate.detail, JSON.stringify(candidate.proposal), fingerprint, now,
      );
    });
    await this.runBatches(findingStatements);

    if (!scanTruncated && !findingsTruncated) {
      const open = await this.list(ownerId, "open", MEMORY_DOCTOR_FINDING_LIMIT);
      const staleStatements = open
        .filter((finding) => !fingerprints.has(finding.fingerprint))
        .map((finding) => this.database.prepare(
          `UPDATE memory_doctor_findings SET status = 'resolved', resolved_at = ?, version = version + 1
           WHERE owner_id = ? AND id = ? AND status = 'open'`,
        ).bind(now, ownerId, finding.id));
      await this.runBatches(staleStatements);
    }
    const findings = await this.list(ownerId, "open", MEMORY_DOCTOR_FINDING_LIMIT);
    return {
      examined: memories.length,
      open: findings.length,
      findings,
      truncated: scanTruncated || findingsTruncated,
    };
  }

  async list(ownerId: string, status: DoctorFindingStatus = "open", limit = 100): Promise<DoctorFinding[]> {
    const bounded = Math.max(1, Math.min(MEMORY_DOCTOR_FINDING_LIMIT, Math.floor(limit)));
    const result = await this.database.prepare(
      `SELECT ${FINDING_COLUMNS} FROM memory_doctor_findings
       WHERE owner_id = ? AND status = ?
       ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, created_at DESC
       LIMIT ?`,
    ).bind(ownerId, status, bounded).all<DoctorFindingRow>();
    return result.results.map(toFinding);
  }

  async decide(
    ownerId: string,
    findingId: string,
    expectedVersion: number,
    status: "approved" | "dismissed",
  ): Promise<DoctorFinding> {
    const update = await this.database.prepare(
      `UPDATE memory_doctor_findings SET status = ?, resolved_at = ?, version = version + 1
       WHERE owner_id = ? AND id = ? AND status = 'open' AND version = ?`,
    ).bind(status, this.now(), ownerId, findingId, expectedVersion).run();
    if (update.meta.changes !== 1) throw new Error("Memory Doctor finding version conflict");
    const row = await this.database.prepare(
      `SELECT ${FINDING_COLUMNS} FROM memory_doctor_findings WHERE owner_id = ? AND id = ?`,
    ).bind(ownerId, findingId).first<DoctorFindingRow>();
    if (!row) throw new Error("Memory Doctor finding not found");
    return toFinding(row);
  }

  private async runBatches(statements: D1PreparedStatement[]): Promise<void> {
    for (let offset = 0; offset < statements.length; offset += MEMORY_DOCTOR_BATCH_SIZE) {
      await this.database.batch(statements.slice(offset, offset + MEMORY_DOCTOR_BATCH_SIZE));
    }
  }
}
