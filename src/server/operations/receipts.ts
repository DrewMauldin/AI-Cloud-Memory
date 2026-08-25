export const CAPABILITIES = [
  "d1", "vectorize", "workers_ai", "oauth", "mcp", "n8n", "obsidian_projection",
] as const;
export type Capability = typeof CAPABILITIES[number];
export type CapabilityStatus = "verified" | "degraded" | "failed" | "configured" | "unknown";

export interface CapabilityReceipt {
  ownerId: string;
  capability: Capability;
  status: CapabilityStatus;
  detail: string;
  evidenceSha256: string | null;
  source: string;
  checkedAt: string;
  updatedAt: string;
  version: number;
}

interface ReceiptRow {
  owner_id: string;
  capability: Capability;
  status: CapabilityStatus;
  detail: string;
  evidence_sha256: string | null;
  source: string;
  checked_at: string;
  updated_at: string;
  version: number;
}

const RECEIPT_COLUMNS = "owner_id, capability, status, detail, evidence_sha256, source, checked_at, updated_at, version";

function toReceipt(row: ReceiptRow): CapabilityReceipt {
  return {
    ownerId: row.owner_id,
    capability: row.capability,
    status: row.status,
    detail: row.detail,
    evidenceSha256: row.evidence_sha256,
    source: row.source,
    checkedAt: row.checked_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

export class CapabilityReceiptStore {
  constructor(
    private readonly database: D1Database,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async record(input: {
    ownerId: string;
    capability: Capability;
    status: CapabilityStatus;
    detail: string;
    evidenceSha256?: string;
    source: string;
    checkedAt?: string;
  }): Promise<CapabilityReceipt> {
    const detail = input.detail.trim();
    const source = input.source.trim();
    if (detail.length < 1 || detail.length > 500) throw new Error("Receipt detail must be between 1 and 500 characters");
    if (source.length < 1 || source.length > 100) throw new Error("Receipt source must be between 1 and 100 characters");
    if (input.evidenceSha256 && !/^[a-f0-9]{64}$/i.test(input.evidenceSha256)) throw new Error("Receipt evidence digest must be SHA-256");
    const updatedAt = this.now();
    const checkedAt = input.checkedAt ?? updatedAt;
    if (!Number.isFinite(Date.parse(checkedAt))) throw new Error("Receipt checked time must be a valid date");
    if (Date.parse(checkedAt) > Date.parse(updatedAt)) throw new Error("Receipt checked time cannot be in the future");
    await this.database.prepare(
      `INSERT INTO capability_receipts (
         owner_id, capability, status, detail, evidence_sha256, source, checked_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner_id, capability) DO UPDATE SET
         status = excluded.status, detail = excluded.detail, evidence_sha256 = excluded.evidence_sha256,
         source = excluded.source, checked_at = excluded.checked_at, updated_at = excluded.updated_at,
         version = capability_receipts.version + 1`,
    ).bind(
      input.ownerId, input.capability, input.status, detail, input.evidenceSha256 ?? null,
      source, checkedAt, updatedAt,
    ).run();
    const receipt = await this.database.prepare(
      `SELECT ${RECEIPT_COLUMNS} FROM capability_receipts WHERE owner_id = ? AND capability = ?`,
    ).bind(input.ownerId, input.capability).first<ReceiptRow>();
    if (!receipt) throw new Error("Capability receipt could not be read back");
    return toReceipt(receipt);
  }

  async list(ownerId: string): Promise<CapabilityReceipt[]> {
    const result = await this.database.prepare(
      `SELECT ${RECEIPT_COLUMNS} FROM capability_receipts WHERE owner_id = ? ORDER BY checked_at DESC`,
    ).bind(ownerId).all<ReceiptRow>();
    return result.results.map(toReceipt);
  }
}
