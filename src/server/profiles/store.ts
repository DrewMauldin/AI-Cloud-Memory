import { hasSecretPattern } from "../memory/safety";

export const FACET_TYPES = ["identity", "communication", "working_style", "preferences", "constraints", "goals"] as const;
export type FacetType = typeof FACET_TYPES[number];
export type ContextScopeType = "global" | "project" | "repository" | "client";

export interface ProfileFacet {
  id: string;
  facetType: FacetType;
  content: string;
  summary: string | null;
  sensitivity: "normal" | "private" | "sensitive";
  enabled: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ContextPack {
  id: string;
  name: string;
  description: string | null;
  scopeType: ContextScopeType;
  scopeId: string | null;
  facetTypes: FacetType[];
  memoryIds: string[];
  query: string | null;
  memoryLimit: number;
  directiveLimit: number;
  enabled: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

interface FacetRow {
  id: string; facet_type: FacetType; content: string; summary: string | null;
  sensitivity: ProfileFacet["sensitivity"]; enabled: number; archived_at: string | null;
  created_at: string; updated_at: string; version: number;
}

interface PackRow {
  id: string; name: string; description: string | null; scope_type: ContextScopeType; scope_id: string | null;
  facet_types_json: string; memory_ids_json: string; query: string | null; memory_limit: number;
  directive_limit: number; enabled: number; archived_at: string | null; created_at: string; updated_at: string; version: number;
}

const mapFacet = (row: FacetRow): ProfileFacet => ({
  id: row.id, facetType: row.facet_type, content: row.content, summary: row.summary,
  sensitivity: row.sensitivity, enabled: row.enabled === 1, archivedAt: row.archived_at,
  createdAt: row.created_at, updatedAt: row.updated_at, version: row.version,
});

const mapPack = (row: PackRow): ContextPack => ({
  id: row.id, name: row.name, description: row.description, scopeType: row.scope_type, scopeId: row.scope_id,
  facetTypes: JSON.parse(row.facet_types_json) as FacetType[], memoryIds: JSON.parse(row.memory_ids_json) as string[],
  query: row.query, memoryLimit: row.memory_limit, directiveLimit: row.directive_limit,
  enabled: row.enabled === 1, archivedAt: row.archived_at, createdAt: row.created_at, updatedAt: row.updated_at, version: row.version,
});

export class ContextProfileStore {
  constructor(private readonly database: D1Database) {}

  async saveFacet(input: {
    ownerId: string; facetType: FacetType; content: string; summary?: string;
    sensitivity: ProfileFacet["sensitivity"]; enabled: boolean; expectedVersion?: number;
  }): Promise<ProfileFacet> {
    if (hasSecretPattern(input.content) || (input.summary && hasSecretPattern(input.summary))) {
      throw new Error("Profile facet contains secret-like material");
    }
    const existing = await this.database.prepare(
      "SELECT id, version FROM profile_facets WHERE owner_id = ? AND facet_type = ?",
    ).bind(input.ownerId, input.facetType).first<{ id: string; version: number }>();
    const now = new Date().toISOString();
    if (existing) {
      if (existing.version !== input.expectedVersion) throw new Error("Profile facet version conflict");
      const result = await this.database.prepare(
        `UPDATE profile_facets SET content = ?, summary = ?, sensitivity = ?, enabled = ?,
          archived_at = NULL, updated_at = ?, version = version + 1
         WHERE id = ? AND owner_id = ? AND version = ?`,
      ).bind(input.content, input.summary ?? null, input.sensitivity, input.enabled ? 1 : 0, now, existing.id, input.ownerId, input.expectedVersion).run();
      if (result.meta.changes !== 1) throw new Error("Profile facet version conflict");
    } else {
      if (input.expectedVersion !== undefined) throw new Error("Profile facet was not found");
      await this.database.prepare(
        `INSERT INTO profile_facets (id, owner_id, facet_type, content, summary, sensitivity, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), input.ownerId, input.facetType, input.content, input.summary ?? null, input.sensitivity, input.enabled ? 1 : 0, now, now).run();
    }
    const row = await this.database.prepare(
      `SELECT id, facet_type, content, summary, sensitivity, enabled, archived_at, created_at, updated_at, version
       FROM profile_facets WHERE owner_id = ? AND facet_type = ?`,
    ).bind(input.ownerId, input.facetType).first<FacetRow>();
    if (!row) throw new Error("Profile facet was not found");
    return mapFacet(row);
  }

  async createPack(input: {
    ownerId: string; name: string; description?: string; scopeType: ContextScopeType; scopeId?: string;
    facetTypes: FacetType[]; memoryIds: string[]; query?: string; memoryLimit: number; directiveLimit: number;
  }): Promise<ContextPack> {
    if ([input.name, input.description, input.query].some((value) => value && hasSecretPattern(value))) {
      throw new Error("Context pack contains secret-like material");
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await this.database.prepare(
      `INSERT INTO context_packs (
        id, owner_id, name, description, scope_type, scope_id, facet_types_json,
        memory_ids_json, query, memory_limit, directive_limit, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id, input.ownerId, input.name, input.description ?? null, input.scopeType, input.scopeId ?? null,
      JSON.stringify([...new Set(input.facetTypes)]), JSON.stringify([...new Set(input.memoryIds)]),
      input.query ?? null, input.memoryLimit, input.directiveLimit, now, now,
    ).run();
    const pack = await this.getPack(input.ownerId, id);
    if (!pack) throw new Error("Context pack was not found");
    return pack;
  }

  async updatePack(input: {
    ownerId: string; packId: string; expectedVersion: number; name: string; description?: string;
    scopeType: ContextScopeType; scopeId?: string; facetTypes: FacetType[]; memoryIds: string[];
    query?: string; memoryLimit: number; directiveLimit: number; enabled: boolean;
  }): Promise<ContextPack> {
    if ([input.name, input.description, input.query].some((value) => value && hasSecretPattern(value))) {
      throw new Error("Context pack contains secret-like material");
    }
    const result = await this.database.prepare(
      `UPDATE context_packs SET name = ?, description = ?, scope_type = ?, scope_id = ?,
        facet_types_json = ?, memory_ids_json = ?, query = ?, memory_limit = ?, directive_limit = ?,
        enabled = ?, updated_at = ?, version = version + 1
       WHERE id = ? AND owner_id = ? AND archived_at IS NULL AND version = ?`,
    ).bind(
      input.name, input.description ?? null, input.scopeType, input.scopeId ?? null,
      JSON.stringify([...new Set(input.facetTypes)]), JSON.stringify([...new Set(input.memoryIds)]),
      input.query ?? null, input.memoryLimit, input.directiveLimit, input.enabled ? 1 : 0,
      new Date().toISOString(), input.packId, input.ownerId, input.expectedVersion,
    ).run();
    if (result.meta.changes !== 1) throw new Error("Context pack version conflict or archived pack");
    const pack = await this.getPack(input.ownerId, input.packId);
    if (!pack) throw new Error("Context pack was not found");
    return pack;
  }

  async archivePack(ownerId: string, packId: string, expectedVersion: number): Promise<ContextPack> {
    const now = new Date().toISOString();
    const result = await this.database.prepare(
      `UPDATE context_packs SET archived_at = ?, enabled = 0, updated_at = ?, version = version + 1
       WHERE id = ? AND owner_id = ? AND archived_at IS NULL AND version = ?`,
    ).bind(now, now, packId, ownerId, expectedVersion).run();
    if (result.meta.changes !== 1) throw new Error("Context pack version conflict or not found");
    const pack = await this.getPack(ownerId, packId);
    if (!pack) throw new Error("Context pack was not found");
    return pack;
  }

  async restorePack(ownerId: string, packId: string, expectedVersion: number): Promise<ContextPack> {
    const now = new Date().toISOString();
    const result = await this.database.prepare(
      `UPDATE context_packs SET archived_at = NULL, enabled = 1, updated_at = ?, version = version + 1
       WHERE id = ? AND owner_id = ? AND archived_at IS NOT NULL AND version = ?`,
    ).bind(now, packId, ownerId, expectedVersion).run();
    if (result.meta.changes !== 1) throw new Error("Context pack version conflict or not found");
    const pack = await this.getPack(ownerId, packId);
    if (!pack) throw new Error("Context pack was not found");
    return pack;
  }

  async archiveFacet(ownerId: string, facetId: string, expectedVersion: number): Promise<ProfileFacet> {
    const now = new Date().toISOString();
    const result = await this.database.prepare(
      `UPDATE profile_facets SET archived_at = ?, enabled = 0, updated_at = ?, version = version + 1
       WHERE id = ? AND owner_id = ? AND archived_at IS NULL AND version = ?`,
    ).bind(now, now, facetId, ownerId, expectedVersion).run();
    if (result.meta.changes !== 1) throw new Error("Profile facet version conflict or not found");
    const row = await this.database.prepare(
      `SELECT id, facet_type, content, summary, sensitivity, enabled, archived_at, created_at, updated_at, version
       FROM profile_facets WHERE id = ? AND owner_id = ?`,
    ).bind(facetId, ownerId).first<FacetRow>();
    if (!row) throw new Error("Profile facet was not found");
    return mapFacet(row);
  }

  async getPack(ownerId: string, packId: string): Promise<ContextPack | null> {
    const row = await this.database.prepare(
      `SELECT id, name, description, scope_type, scope_id, facet_types_json, memory_ids_json,
              query, memory_limit, directive_limit, enabled, archived_at, created_at, updated_at, version
       FROM context_packs WHERE id = ? AND owner_id = ?`,
    ).bind(packId, ownerId).first<PackRow>();
    return row ? mapPack(row) : null;
  }

  async list(ownerId: string): Promise<{ facets: ProfileFacet[]; packs: ContextPack[] }> {
    const [facets, packs] = await Promise.all([
      this.database.prepare(
        `SELECT id, facet_type, content, summary, sensitivity, enabled, archived_at, created_at, updated_at, version
         FROM profile_facets WHERE owner_id = ? ORDER BY facet_type`,
      ).bind(ownerId).all<FacetRow>(),
      this.database.prepare(
        `SELECT id, name, description, scope_type, scope_id, facet_types_json, memory_ids_json,
                query, memory_limit, directive_limit, enabled, archived_at, created_at, updated_at, version
         FROM context_packs WHERE owner_id = ? ORDER BY name`,
      ).bind(ownerId).all<PackRow>(),
    ]);
    return { facets: facets.results.map(mapFacet), packs: packs.results.map(mapPack) };
  }

  async buildContext(ownerId: string, packId: string): Promise<null | {
    pack: ContextPack;
    facets: Array<ProfileFacet & { reason: "selected_by_context_pack" }>;
    linkedMemories: Array<{ id: string; content: string; memoryType: string; reason: "linked_by_context_pack" }>;
    omittedSensitiveFacetCount: number;
    omittedSensitiveMemoryCount: number;
  }> {
    const pack = await this.getPack(ownerId, packId);
    if (!pack || !pack.enabled || pack.archivedAt) return null;
    const facets = pack.facetTypes.length ? await this.database.prepare(
      `SELECT id, facet_type, content, summary, sensitivity, enabled, archived_at, created_at, updated_at, version
       FROM profile_facets WHERE owner_id = ? AND enabled = 1 AND archived_at IS NULL
         AND facet_type IN (SELECT value FROM json_each(?)) ORDER BY facet_type LIMIT 6`,
    ).bind(ownerId, JSON.stringify(pack.facetTypes)).all<FacetRow>() : { results: [] as FacetRow[] };
    const safeFacets = facets.results.filter((facet) => facet.sensitivity !== "sensitive");
    const memories = pack.memoryIds.length ? await this.database.prepare(
      `SELECT id, content, memory_type, sensitivity FROM memories
       WHERE owner_id = ? AND status = 'active' AND id IN (SELECT value FROM json_each(?))
       ORDER BY updated_at DESC LIMIT ?`,
    ).bind(ownerId, JSON.stringify(pack.memoryIds), pack.memoryLimit).all<{
      id: string; content: string; memory_type: string; sensitivity: string;
    }>() : { results: [] as Array<{ id: string; content: string; memory_type: string; sensitivity: string }> };
    const safeMemories = memories.results.filter((memory) => memory.sensitivity !== "sensitive");
    return {
      pack,
      facets: safeFacets.map((facet) => ({ ...mapFacet(facet), reason: "selected_by_context_pack" })),
      linkedMemories: safeMemories.map((memory) => ({
        id: memory.id,
        content: Array.from(memory.content).slice(0, 900).join(""),
        memoryType: memory.memory_type,
        reason: "linked_by_context_pack",
      })),
      omittedSensitiveFacetCount: facets.results.length - safeFacets.length,
      omittedSensitiveMemoryCount: memories.results.length - safeMemories.length,
    };
  }
}
