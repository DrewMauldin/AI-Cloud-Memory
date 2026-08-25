export type ReflectionProposalType = "exact_duplicate" | "probable_duplicate" | "stale_dynamic" | "expiry_review" | "supersession_review";
export type ReflectionProposalStatus = "open" | "kept" | "dismissed" | "applied";

export interface ReflectionProposal {
  id: string;
  proposalType: ReflectionProposalType;
  primaryMemoryId: string;
  relatedMemoryIds: string[];
  evidence: Record<string, unknown>;
  suggestedAction: "review" | "keep" | "archive" | "supersede";
  impact: "low" | "medium" | "high";
  fingerprint: string;
  status: ReflectionProposalStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  version: number;
  primaryMemory: { version: number; status: string; summary: string | null };
}

interface ProposalRow {
  id: string; proposal_type: ReflectionProposalType; primary_memory_id: string; related_memory_ids_json: string;
  evidence_json: string; suggested_action: ReflectionProposal["suggestedAction"]; impact: ReflectionProposal["impact"];
  fingerprint: string; status: ReflectionProposalStatus; created_at: string; updated_at: string; resolved_at: string | null; version: number;
  primary_memory_version: number; primary_memory_status: string; primary_memory_summary: string | null;
}

interface Candidate {
  proposalType: ReflectionProposalType;
  primaryMemoryId: string;
  relatedMemoryIds: string[];
  evidence: Record<string, unknown>;
  suggestedAction: ReflectionProposal["suggestedAction"];
  impact: ReflectionProposal["impact"];
  fingerprint: string;
}

const QUALIFIED_PROPOSAL_COLUMNS = `p.id, p.proposal_type, p.primary_memory_id, p.related_memory_ids_json,
  p.evidence_json, p.suggested_action, p.impact, p.fingerprint, p.status, p.created_at, p.updated_at, p.resolved_at, p.version`;

const mapProposal = (row: ProposalRow): ReflectionProposal => ({
  id: row.id, proposalType: row.proposal_type, primaryMemoryId: row.primary_memory_id,
  relatedMemoryIds: JSON.parse(row.related_memory_ids_json) as string[],
  evidence: JSON.parse(row.evidence_json) as Record<string, unknown>, suggestedAction: row.suggested_action,
  impact: row.impact, fingerprint: row.fingerprint, status: row.status,
  createdAt: row.created_at, updatedAt: row.updated_at, resolvedAt: row.resolved_at, version: row.version,
  primaryMemory: { version: row.primary_memory_version, status: row.primary_memory_status, summary: row.primary_memory_summary },
});

export class ReflectionStore {
  constructor(
    private readonly database: D1Database,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async run(ownerId: string): Promise<{ examined: number; proposals: ReflectionProposal[]; truncated: boolean }> {
    const now = this.now();
    const staleBefore = new Date(Date.parse(now) - 90 * 24 * 60 * 60 * 1_000).toISOString();
    const [countRow, duplicateRows, expiryRows, staleRows, chainRows] = await Promise.all([
      this.database.prepare(
        "SELECT COUNT(*) AS total FROM memories WHERE owner_id = ? AND purged_at IS NULL",
      ).bind(ownerId).first<{ total: number }>(),
      this.database.prepare(
        `SELECT content_sha256, MIN(id) AS primary_memory_id, json_group_array(id) AS ids_json, COUNT(*) AS duplicate_count
         FROM memories WHERE owner_id = ? AND purged_at IS NULL AND status = 'active'
         GROUP BY content_sha256 HAVING COUNT(*) > 1
         ORDER BY MAX(updated_at) DESC LIMIT 51`,
      ).bind(ownerId).all<{ content_sha256: string; primary_memory_id: string; ids_json: string; duplicate_count: number }>(),
      this.database.prepare(
        `SELECT id, expires_at FROM memories
         WHERE owner_id = ? AND purged_at IS NULL AND status = 'active'
           AND expires_at IS NOT NULL AND expires_at <= ?
         ORDER BY expires_at ASC LIMIT 101`,
      ).bind(ownerId, now).all<{ id: string; expires_at: string }>(),
      this.database.prepare(
        `SELECT id, updated_at FROM memories
         WHERE owner_id = ? AND purged_at IS NULL AND status = 'active'
           AND retention_tier = 'dynamic' AND updated_at <= ?
         ORDER BY updated_at ASC LIMIT 101`,
      ).bind(ownerId, staleBefore).all<{ id: string; updated_at: string }>(),
      this.database.prepare(
        `SELECT current.id, predecessor.id AS predecessor_id, predecessor.supersedes_id AS ancestor_id
         FROM memories current
         JOIN memories predecessor ON predecessor.owner_id = current.owner_id AND predecessor.id = current.supersedes_id
         WHERE current.owner_id = ? AND current.purged_at IS NULL AND current.status = 'active'
           AND predecessor.supersedes_id IS NOT NULL
         ORDER BY current.updated_at DESC LIMIT 101`,
      ).bind(ownerId).all<{ id: string; predecessor_id: string; ancestor_id: string }>(),
    ]);
    const candidates: Candidate[] = [];
    for (const row of duplicateRows.results.slice(0, 50)) {
      const relatedMemoryIds = (JSON.parse(row.ids_json) as string[]).filter((id) => id !== row.primary_memory_id);
      candidates.push({
        proposalType: "exact_duplicate", primaryMemoryId: row.primary_memory_id, relatedMemoryIds,
        evidence: { contentSha256: row.content_sha256, duplicateCount: row.duplicate_count }, suggestedAction: "review", impact: "medium",
        fingerprint: `exact_duplicate:${row.content_sha256}`,
      });
    }
    for (const memory of expiryRows.results.slice(0, 100)) candidates.push({
      proposalType: "expiry_review", primaryMemoryId: memory.id, relatedMemoryIds: [],
      evidence: { expiresAt: memory.expires_at }, suggestedAction: "archive", impact: "high",
      fingerprint: `expiry_review:${memory.id}:${memory.expires_at}`,
    });
    for (const memory of staleRows.results.slice(0, 100)) candidates.push({
      proposalType: "stale_dynamic", primaryMemoryId: memory.id, relatedMemoryIds: [],
      evidence: { updatedAt: memory.updated_at, staleAfterDays: 90 }, suggestedAction: "archive", impact: "low",
      fingerprint: `stale_dynamic:${memory.id}:${memory.updated_at}`,
    });
    for (const memory of chainRows.results.slice(0, 100)) {
      candidates.push({
        proposalType: "supersession_review", primaryMemoryId: memory.id,
        relatedMemoryIds: [memory.predecessor_id, memory.ancestor_id],
        evidence: { chainLengthAtLeast: 3 }, suggestedAction: "review", impact: "low",
        fingerprint: `supersession_review:${memory.id}:${memory.predecessor_id}`,
      });
    }
    const reviews = await this.database.prepare(
      `SELECT id, matched_memory_id, similarity FROM memory_review_items
       WHERE owner_id = ? AND status = 'open' AND review_type = 'probable_duplicate'
         AND matched_memory_id IS NOT NULL ORDER BY created_at DESC LIMIT 100`,
    ).bind(ownerId).all<{ id: string; matched_memory_id: string; similarity: number | null }>();
    for (const review of reviews.results) candidates.push({
      proposalType: "probable_duplicate", primaryMemoryId: review.matched_memory_id, relatedMemoryIds: [],
      evidence: { reviewId: review.id, similarity: review.similarity }, suggestedAction: "review", impact: "medium",
      fingerprint: `probable_duplicate:${review.id}`,
    });

    for (let offset = 0; offset < candidates.length; offset += 50) {
      await this.database.batch(candidates.slice(offset, offset + 50).map((candidate) => this.database.prepare(
        `INSERT INTO reflection_proposals (
          id, owner_id, proposal_type, primary_memory_id, related_memory_ids_json, evidence_json,
          suggested_action, impact, fingerprint, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner_id, fingerprint) DO UPDATE SET
          related_memory_ids_json = excluded.related_memory_ids_json,
          evidence_json = excluded.evidence_json, suggested_action = excluded.suggested_action,
          impact = excluded.impact, updated_at = excluded.updated_at`,
      ).bind(
        crypto.randomUUID(), ownerId, candidate.proposalType, candidate.primaryMemoryId,
        JSON.stringify(candidate.relatedMemoryIds), JSON.stringify(candidate.evidence), candidate.suggestedAction,
        candidate.impact, candidate.fingerprint, now, now,
      )));
    }
    return {
      examined: countRow?.total ?? 0,
      proposals: await this.list(ownerId, "open", 200),
      truncated: duplicateRows.results.length > 50 || expiryRows.results.length > 100
        || staleRows.results.length > 100 || chainRows.results.length > 100,
    };
  }

  async list(ownerId: string, status: ReflectionProposalStatus = "open", limit = 100): Promise<ReflectionProposal[]> {
    const result = await this.database.prepare(
      `SELECT ${QUALIFIED_PROPOSAL_COLUMNS}, m.version AS primary_memory_version,
              m.status AS primary_memory_status, m.summary AS primary_memory_summary
       FROM reflection_proposals p JOIN memories m ON m.owner_id = p.owner_id AND m.id = p.primary_memory_id
       WHERE p.owner_id = ? AND p.status = ?
       ORDER BY CASE p.impact WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, p.updated_at DESC LIMIT ?`,
    ).bind(ownerId, status, Math.max(1, Math.min(Math.floor(limit), 200))).all<ProposalRow>();
    return result.results.map(mapProposal);
  }

  async get(ownerId: string, proposalId: string): Promise<ReflectionProposal | null> {
    const row = await this.database.prepare(
      `SELECT ${QUALIFIED_PROPOSAL_COLUMNS}, m.version AS primary_memory_version,
              m.status AS primary_memory_status, m.summary AS primary_memory_summary
       FROM reflection_proposals p JOIN memories m ON m.owner_id = p.owner_id AND m.id = p.primary_memory_id
       WHERE p.owner_id = ? AND p.id = ?`,
    ).bind(ownerId, proposalId).first<ProposalRow>();
    return row ? mapProposal(row) : null;
  }

  async decide(ownerId: string, proposalId: string, expectedVersion: number, status: "kept" | "dismissed" | "applied"): Promise<ReflectionProposal> {
    const now = this.now();
    const result = await this.database.prepare(
      `UPDATE reflection_proposals SET status = ?, resolved_at = ?, updated_at = ?, version = version + 1
       WHERE owner_id = ? AND id = ? AND status = 'open' AND version = ?`,
    ).bind(status, now, now, ownerId, proposalId, expectedVersion).run();
    if (result.meta.changes !== 1) throw new Error("Reflection proposal version conflict or not found");
    const proposal = await this.get(ownerId, proposalId);
    if (!proposal) throw new Error("Reflection proposal was not found");
    return proposal;
  }
}
