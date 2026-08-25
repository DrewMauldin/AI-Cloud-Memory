export type EntityType = "person" | "organisation" | "project" | "place" | "concept" | "system";
export type MemoryEntityRelation = "mentioned" | "subject" | "evidence";

export interface EntityRecord {
  id: string;
  ownerId: string;
  canonicalName: string;
  entityType: EntityType;
  description: string | null;
  aliases: string[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface EntityRelationshipRecord {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  relationshipType: string;
  validFrom: string | null;
  validUntil: string | null;
  evidenceMemoryId: string | null;
  confidence: number;
  updatedAt: string;
}

interface EntityRow {
  id: string;
  owner_id: string;
  canonical_name: string;
  entity_type: EntityType;
  description: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

const ENTITY_COLUMNS = "id, owner_id, canonical_name, entity_type, description, created_at, updated_at, version";

function toEntity(row: EntityRow): EntityRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    canonicalName: row.canonical_name,
    entityType: row.entity_type,
    description: row.description,
    aliases: [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

export class ContextGraphStore {
  constructor(
    private readonly database: D1Database,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  async upsertEntity(input: {
    ownerId: string;
    canonicalName: string;
    entityType: EntityType;
    description?: string;
  }): Promise<EntityRecord> {
    const name = input.canonicalName.trim();
    if (name.length < 1 || name.length > 200) throw new Error("Entity name must be between 1 and 200 characters");
    const timestamp = this.now();
    await this.database.prepare(
      `INSERT INTO entities (id, owner_id, canonical_name, entity_type, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner_id, entity_type, canonical_name) DO UPDATE SET
         description = COALESCE(excluded.description, entities.description),
         updated_at = excluded.updated_at,
         version = entities.version + 1`,
    ).bind(this.newId(), input.ownerId, name, input.entityType, input.description?.trim() || null, timestamp, timestamp).run();
    const row = await this.database.prepare(
      `SELECT ${ENTITY_COLUMNS} FROM entities WHERE owner_id = ? AND entity_type = ? AND canonical_name = ?`,
    ).bind(input.ownerId, input.entityType, name).first<EntityRow>();
    if (!row) throw new Error("Entity could not be read back");
    return toEntity(row);
  }

  async addAlias(ownerId: string, entityId: string, alias: string): Promise<void> {
    const value = alias.trim();
    const normalised = value.toLocaleLowerCase("en-AU");
    if (value.length < 1 || value.length > 200) throw new Error("Entity alias must be between 1 and 200 characters");
    await this.assertEntity(ownerId, entityId);
    await this.database.prepare(
      `INSERT INTO entity_aliases (id, owner_id, entity_id, alias, normalised_alias, created_at)
       VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(owner_id, normalised_alias) DO NOTHING`,
    ).bind(this.newId(), ownerId, entityId, value, normalised, this.now()).run();
  }

  async linkMemory(input: {
    ownerId: string;
    memoryId: string;
    entityId: string;
    relation?: MemoryEntityRelation;
    confidence?: number;
  }): Promise<void> {
    await Promise.all([
      this.assertMemory(input.ownerId, input.memoryId),
      this.assertEntity(input.ownerId, input.entityId),
    ]);
    await this.database.prepare(
      `INSERT INTO memory_entities (owner_id, memory_id, entity_id, relation, confidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(owner_id, memory_id, entity_id, relation) DO UPDATE SET confidence = excluded.confidence`,
    ).bind(input.ownerId, input.memoryId, input.entityId, input.relation ?? "mentioned", input.confidence ?? 1, this.now()).run();
  }

  async relate(input: {
    ownerId: string;
    fromEntityId: string;
    toEntityId: string;
    relationshipType: string;
    validFrom?: string;
    validUntil?: string;
    evidenceMemoryId?: string;
    confidence?: number;
  }): Promise<void> {
    if (input.fromEntityId === input.toEntityId) throw new Error("An entity cannot relate to itself");
    await Promise.all([
      this.assertEntity(input.ownerId, input.fromEntityId),
      this.assertEntity(input.ownerId, input.toEntityId),
      input.evidenceMemoryId ? this.assertMemory(input.ownerId, input.evidenceMemoryId) : Promise.resolve(),
    ]);
    const relationshipType = input.relationshipType.trim();
    if (relationshipType.length < 1 || relationshipType.length > 100) throw new Error("Relationship type must be between 1 and 100 characters");
    const timestamp = this.now();
    await this.database.prepare(
      `INSERT INTO entity_relationships (
         id, owner_id, from_entity_id, to_entity_id, relationship_type, valid_from,
         valid_until, evidence_memory_id, confidence, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner_id, from_entity_id, to_entity_id, relationship_type, valid_from)
       DO UPDATE SET valid_until = excluded.valid_until, evidence_memory_id = excluded.evidence_memory_id,
         confidence = excluded.confidence, updated_at = excluded.updated_at, version = entity_relationships.version + 1`,
    ).bind(
      this.newId(), input.ownerId, input.fromEntityId, input.toEntityId, relationshipType,
      input.validFrom ?? "", input.validUntil ?? null, input.evidenceMemoryId ?? null,
      input.confidence ?? 1, timestamp, timestamp,
    ).run();
  }

  async relatedMemoryIds(ownerId: string, seedMemoryIds: string[], limit = 10): Promise<string[]> {
    const seeds = [...new Set(seedMemoryIds)].slice(0, 20);
    if (seeds.length === 0) return [];
    const bounded = Math.max(1, Math.min(20, Math.floor(limit)));
    const placeholders = seeds.map(() => "?").join(", ");
    const result = await this.database.prepare(
      `WITH seed_entities AS (
         SELECT DISTINCT entity_id FROM memory_entities
         WHERE owner_id = ? AND memory_id IN (${placeholders})
       ), one_hop AS (
         SELECT to_entity_id AS entity_id FROM entity_relationships
         WHERE owner_id = ? AND from_entity_id IN (SELECT entity_id FROM seed_entities)
           AND (valid_until IS NULL OR valid_until >= ?)
         UNION
         SELECT from_entity_id AS entity_id FROM entity_relationships
         WHERE owner_id = ? AND to_entity_id IN (SELECT entity_id FROM seed_entities)
           AND (valid_until IS NULL OR valid_until >= ?)
       )
       SELECT DISTINCT me.memory_id
       FROM memory_entities me
       JOIN memories m ON m.id = me.memory_id AND m.owner_id = me.owner_id
       WHERE me.owner_id = ? AND me.entity_id IN (SELECT entity_id FROM one_hop)
         AND me.memory_id NOT IN (${placeholders}) AND m.status = 'active'
       ORDER BY m.importance DESC, m.updated_at DESC
       LIMIT ?`,
    ).bind(ownerId, ...seeds, ownerId, this.now(), ownerId, this.now(), ownerId, ...seeds, bounded).all<{ memory_id: string }>();
    return result.results.map((row) => row.memory_id);
  }

  async list(ownerId: string, limit = 100): Promise<{
    entities: EntityRecord[];
    relationships: EntityRelationshipRecord[];
    memoryLinks: Array<{ memoryId: string; entityId: string; relation: MemoryEntityRelation; confidence: number }>;
  }> {
    const bounded = Math.max(1, Math.min(200, Math.floor(limit)));
    const [entities, aliases, relationships, memoryLinks] = await Promise.all([
      this.database.prepare(
        `SELECT ${ENTITY_COLUMNS} FROM entities WHERE owner_id = ? ORDER BY updated_at DESC LIMIT ?`,
      ).bind(ownerId, bounded).all<EntityRow>(),
      this.database.prepare(
        `SELECT entity_id, alias FROM entity_aliases
         WHERE owner_id = ? ORDER BY created_at ASC LIMIT ?`,
      ).bind(ownerId, bounded * 4).all<{ entity_id: string; alias: string }>(),
      this.database.prepare(
        `SELECT id, from_entity_id, to_entity_id, relationship_type, valid_from, valid_until,
           evidence_memory_id, confidence, updated_at
         FROM entity_relationships WHERE owner_id = ? ORDER BY updated_at DESC LIMIT ?`,
      ).bind(ownerId, bounded).all<{
        id: string;
        from_entity_id: string;
        to_entity_id: string;
        relationship_type: string;
        valid_from: string | null;
        valid_until: string | null;
        evidence_memory_id: string | null;
        confidence: number;
        updated_at: string;
      }>(),
      this.database.prepare(
        `SELECT memory_id, entity_id, relation, confidence FROM memory_entities
         WHERE owner_id = ? ORDER BY created_at DESC LIMIT ?`,
      ).bind(ownerId, bounded).all<{
        memory_id: string;
        entity_id: string;
        relation: MemoryEntityRelation;
        confidence: number;
      }>(),
    ]);
    const aliasesByEntity = new Map<string, string[]>();
    for (const row of aliases.results) {
      const values = aliasesByEntity.get(row.entity_id) ?? [];
      if (values.length < 20) values.push(row.alias);
      aliasesByEntity.set(row.entity_id, values);
    }
    return {
      entities: entities.results.map((row) => ({ ...toEntity(row), aliases: aliasesByEntity.get(row.id) ?? [] })),
      relationships: relationships.results.map((row) => ({
        id: row.id,
        fromEntityId: row.from_entity_id,
        toEntityId: row.to_entity_id,
        relationshipType: row.relationship_type,
        validFrom: row.valid_from || null,
        validUntil: row.valid_until,
        evidenceMemoryId: row.evidence_memory_id,
        confidence: row.confidence,
        updatedAt: row.updated_at,
      })),
      memoryLinks: memoryLinks.results.map((row) => ({
        memoryId: row.memory_id,
        entityId: row.entity_id,
        relation: row.relation,
        confidence: row.confidence,
      })),
    };
  }

  private async assertEntity(ownerId: string, entityId: string): Promise<void> {
    const row = await this.database.prepare("SELECT id FROM entities WHERE owner_id = ? AND id = ?")
      .bind(ownerId, entityId).first<{ id: string }>();
    if (!row) throw new Error("Entity not found within owner boundary");
  }

  private async assertMemory(ownerId: string, memoryId: string): Promise<void> {
    const row = await this.database.prepare("SELECT id FROM memories WHERE owner_id = ? AND id = ?")
      .bind(ownerId, memoryId).first<{ id: string }>();
    if (!row) throw new Error("Memory not found within owner boundary");
  }
}
