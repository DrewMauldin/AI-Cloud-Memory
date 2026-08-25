import { hasSecretPattern } from "../memory/safety";
import type { ClientId } from "./manifest";

export interface ClientCompatibilityReceipt {
  clientId: ClientId;
  clientVersion: string | null;
  endpoint: string;
  configuredStatus: "unknown" | "configured" | "failed";
  authenticatedStatus: "unknown" | "authenticated" | "failed" | "not_supported";
  verifiedStatus: "unknown" | "verified" | "degraded" | "failed";
  expectedToolCount: number;
  discoveredToolCount: number | null;
  model: string | null;
  evidence: string | null;
  checkedAt: string;
  updatedAt: string;
  version: number;
}

interface ReceiptRow {
  client_id: ClientId;
  client_version: string | null;
  endpoint: string;
  configured_status: ClientCompatibilityReceipt["configuredStatus"];
  authenticated_status: ClientCompatibilityReceipt["authenticatedStatus"];
  verified_status: ClientCompatibilityReceipt["verifiedStatus"];
  expected_tool_count: number;
  discovered_tool_count: number | null;
  model: string | null;
  evidence: string | null;
  checked_at: string;
  updated_at: string;
  version: number;
}

function mapReceipt(row: ReceiptRow): ClientCompatibilityReceipt {
  return {
    clientId: row.client_id,
    clientVersion: row.client_version,
    endpoint: row.endpoint,
    configuredStatus: row.configured_status,
    authenticatedStatus: row.authenticated_status,
    verifiedStatus: row.verified_status,
    expectedToolCount: row.expected_tool_count,
    discoveredToolCount: row.discovered_tool_count,
    model: row.model,
    evidence: row.evidence,
    checkedAt: row.checked_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

function assertSafeEndpoint(value: string): void {
  const endpoint = new URL(value);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/mcp") {
    throw new Error("Client endpoint must be a credential-free HTTPS /mcp URL");
  }
}

export class ClientCompatibilityStore {
  constructor(private readonly database: D1Database) {}

  async record(input: {
    ownerId: string;
    clientId: ClientId;
    clientVersion?: string;
    endpoint: string;
    configuredStatus: ClientCompatibilityReceipt["configuredStatus"];
    authenticatedStatus: ClientCompatibilityReceipt["authenticatedStatus"];
    verifiedStatus: ClientCompatibilityReceipt["verifiedStatus"];
    expectedToolCount: number;
    discoveredToolCount?: number;
    model?: string;
    evidence?: string;
    checkedAt?: string;
    expectedVersion?: number;
  }): Promise<ClientCompatibilityReceipt> {
    assertSafeEndpoint(input.endpoint);
    if (input.evidence && hasSecretPattern(input.evidence)) throw new Error("Client evidence contains secret-like material");
    const now = new Date().toISOString();
    const existing = await this.database.prepare(
      "SELECT version FROM client_compatibility_receipts WHERE owner_id = ? AND client_id = ?",
    ).bind(input.ownerId, input.clientId).first<{ version: number }>();
    if (existing && existing.version !== input.expectedVersion) throw new Error("Client compatibility receipt version conflict");
    if (!existing && input.expectedVersion !== undefined) throw new Error("Client compatibility receipt was not found");
    if (existing) {
      await this.database.prepare(
        `UPDATE client_compatibility_receipts SET client_version = ?, endpoint = ?, configured_status = ?,
          authenticated_status = ?, verified_status = ?, expected_tool_count = ?, discovered_tool_count = ?,
          model = ?, evidence = ?, checked_at = ?, updated_at = ?, version = version + 1
         WHERE owner_id = ? AND client_id = ? AND version = ?`,
      ).bind(
        input.clientVersion ?? null, input.endpoint, input.configuredStatus, input.authenticatedStatus,
        input.verifiedStatus, input.expectedToolCount, input.discoveredToolCount ?? null, input.model ?? null,
        input.evidence ?? null, input.checkedAt ?? now, now, input.ownerId, input.clientId, input.expectedVersion,
      ).run();
    } else {
      await this.database.prepare(
        `INSERT INTO client_compatibility_receipts (
          owner_id, client_id, client_version, endpoint, configured_status, authenticated_status,
          verified_status, expected_tool_count, discovered_tool_count, model, evidence, checked_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        input.ownerId, input.clientId, input.clientVersion ?? null, input.endpoint, input.configuredStatus,
        input.authenticatedStatus, input.verifiedStatus, input.expectedToolCount, input.discoveredToolCount ?? null,
        input.model ?? null, input.evidence ?? null, input.checkedAt ?? now, now,
      ).run();
    }
    const row = await this.database.prepare(
      `SELECT client_id, client_version, endpoint, configured_status, authenticated_status, verified_status,
              expected_tool_count, discovered_tool_count, model, evidence, checked_at, updated_at, version
       FROM client_compatibility_receipts WHERE owner_id = ? AND client_id = ?`,
    ).bind(input.ownerId, input.clientId).first<ReceiptRow>();
    if (!row) throw new Error("Client compatibility receipt was not found");
    return mapReceipt(row);
  }

  async list(ownerId: string): Promise<ClientCompatibilityReceipt[]> {
    const result = await this.database.prepare(
      `SELECT client_id, client_version, endpoint, configured_status, authenticated_status, verified_status,
              expected_tool_count, discovered_tool_count, model, evidence, checked_at, updated_at, version
       FROM client_compatibility_receipts WHERE owner_id = ? ORDER BY client_id`,
    ).bind(ownerId).all<ReceiptRow>();
    return result.results.map(mapReceipt);
  }
}
