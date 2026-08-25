const MAX_OWNER_ID_LENGTH = 200;
const MAX_REVIEW_CONTENT_LENGTH = 12_000;
const MAX_NAMESPACE_LENGTH = 100;
const MAX_SOURCE_LENGTH = 200;
const MAX_CLIENT_LENGTH = 100;
const MAX_CORRELATION_LENGTH = 200;
const MAX_QUERY_LENGTH = 500;
const MAX_RESULT_SET_LENGTH = 200;
const MAX_RESOLUTION_NOTE_LENGTH = 1_000;
const MAX_LIST_LIMIT = 100;
const MAX_RANK = 50;

export const REVIEW_CONTENT_LIMIT = MAX_REVIEW_CONTENT_LENGTH;
export const REVIEW_LIST_LIMIT = MAX_LIST_LIMIT;

export type MemoryReviewType = "probable_duplicate" | "source_conflict";
export type MemoryReviewStatus = "open" | "approved" | "rejected" | "dismissed";
export type MemoryReviewKind = "memory" | "directive";
export type MemoryFeedbackLabel =
  | "helpful"
  | "not_helpful"
  | "incorrect"
  | "outdated"
  | "confirmed";
export type MemorySearchMode = "exact" | "semantic" | "hybrid";

export interface MemoryReviewInput {
  ownerId: string;
  reviewType: MemoryReviewType;
  candidateContent: string;
  candidateSha256: string;
  candidateNamespace: string;
  candidateKind: MemoryReviewKind;
  matchedMemoryId: string | null;
  similarity: number | null;
  sourceSystem?: string | null;
  sourceId?: string | null;
  sourceUrl?: string | null;
  client?: string | null;
  model?: string | null;
  correlationId?: string | null;
}

export interface MemoryReviewRecord {
  id: string;
  ownerId: string;
  reviewType: MemoryReviewType;
  status: MemoryReviewStatus;
  candidateContent: string;
  candidateSha256: string;
  candidateNamespace: string;
  candidateKind: MemoryReviewKind;
  matchedMemoryId: string | null;
  similarity: number | null;
  sourceSystem: string | null;
  sourceId: string | null;
  sourceUrl: string | null;
  client: string | null;
  model: string | null;
  correlationId: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  createdAt: string;
  version: number;
}

export interface ReviewListInput {
  ownerId: string;
  status?: MemoryReviewStatus;
  limit?: number;
}

export interface ResolveReviewInput {
  ownerId: string;
  reviewId: string;
  expectedVersion: number;
  status: Exclude<MemoryReviewStatus, "open">;
  resolvedBy?: string | null;
  resolutionNote?: string | null;
}

export interface MemoryFeedbackInput {
  ownerId: string;
  memoryId: string;
  query: string;
  label: MemoryFeedbackLabel;
  mode: MemorySearchMode;
  rank?: number | null;
  score?: number | null;
  resultSetId?: string | null;
  correlationId?: string | null;
  client?: string | null;
  model?: string | null;
}

export interface MemoryFeedbackRecord {
  id: string;
  ownerId: string;
  memoryId: string;
  querySha256: string;
  label: MemoryFeedbackLabel;
  mode: MemorySearchMode;
  rank: number | null;
  score: number | null;
  resultSetId: string | null;
  correlationId: string | null;
  client: string | null;
  model: string | null;
  createdAt: string;
}

export interface FeedbackListInput {
  ownerId: string;
  memoryId?: string;
  limit?: number;
}

interface ReviewStoreDependencies {
  now: () => string;
  newId: () => string;
  sha256: (value: string) => Promise<string>;
}

interface ReviewRow {
  id: string;
  owner_id: string;
  review_type: MemoryReviewType;
  status: MemoryReviewStatus;
  candidate_content: string;
  candidate_sha256: string;
  candidate_namespace: string;
  candidate_kind: MemoryReviewKind;
  matched_memory_id: string | null;
  similarity: number | null;
  source_system: string | null;
  source_id: string | null;
  source_url: string | null;
  client: string | null;
  model: string | null;
  correlation_id: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
  created_at: string;
  version: number;
  request_sha256: string;
}

interface FeedbackRow {
  id: string;
  owner_id: string;
  memory_id: string;
  query_sha256: string;
  label: MemoryFeedbackLabel;
  mode: MemorySearchMode;
  result_rank: number | null;
  result_score: number | null;
  result_set_id: string | null;
  correlation_id: string | null;
  request_sha256: string;
  client: string | null;
  model: string | null;
  created_at: string;
}

const defaultDependencies: ReviewStoreDependencies = {
  now: () => new Date().toISOString(),
  newId: () => crypto.randomUUID(),
  sha256: async (value) => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  },
};

const REVIEW_COLUMNS = `
  id, owner_id, review_type, status, candidate_content, candidate_sha256,
  candidate_namespace, candidate_kind, matched_memory_id, similarity,
  source_system, source_id, source_url, client, model, correlation_id,
  resolved_at, resolved_by, resolution_note, created_at, version, request_sha256
`;

const FEEDBACK_COLUMNS = `
  id, owner_id, memory_id, query_sha256, label, mode, result_rank, result_score,
  result_set_id, correlation_id, request_sha256, client, model, created_at
`;

const REVIEW_TYPES = new Set<MemoryReviewType>(["probable_duplicate", "source_conflict"]);
const REVIEW_STATUSES = new Set<MemoryReviewStatus>(["open", "approved", "rejected", "dismissed"]);
const REVIEW_KINDS = new Set<MemoryReviewKind>(["memory", "directive"]);
const FEEDBACK_LABELS = new Set<MemoryFeedbackLabel>([
  "helpful",
  "not_helpful",
  "incorrect",
  "outdated",
  "confirmed",
]);
const SEARCH_MODES = new Set<MemorySearchMode>(["exact", "semantic", "hybrid"]);

export class ReviewValidationError extends Error {
  readonly code = "REVIEW_VALIDATION";

  constructor(message: string) {
    super(message);
    this.name = "ReviewValidationError";
  }
}

export class ReviewNotFoundError extends Error {
  readonly code = "REVIEW_NOT_FOUND";

  constructor() {
    super("Memory review was not found");
    this.name = "ReviewNotFoundError";
  }
}

export class ReviewConflictError extends Error {
  readonly code: "REVIEW_CONFLICT" | "REVIEW_CORRELATION_CONFLICT" = "REVIEW_CONFLICT";

  constructor(message: string, code: "REVIEW_CONFLICT" | "REVIEW_CORRELATION_CONFLICT" = "REVIEW_CONFLICT") {
    super(message);
    this.name = "ReviewConflictError";
    this.code = code;
  }
}

export class ReviewOwnerBoundaryError extends Error {
  readonly code = "REVIEW_OWNER_BOUNDARY";

  constructor() {
    super("Referenced memory is outside the owner boundary");
    this.name = "ReviewOwnerBoundaryError";
  }
}

export class FeedbackValidationError extends Error {
  readonly code = "FEEDBACK_VALIDATION";

  constructor(message: string) {
    super(message);
    this.name = "FeedbackValidationError";
  }
}

export class FeedbackOwnerBoundaryError extends Error {
  readonly code = "FEEDBACK_OWNER_BOUNDARY";

  constructor() {
    super("Referenced memory is outside the owner boundary");
    this.name = "FeedbackOwnerBoundaryError";
  }
}

export class FeedbackConflictError extends Error {
  readonly code = "FEEDBACK_CORRELATION_CONFLICT";

  constructor() {
    super("Feedback correlation ID already belongs to another request");
    this.name = "FeedbackConflictError";
  }
}

function validateText(value: unknown, name: string, maximum: number, required = true): asserts value is string | null | undefined {
  if (value === null || value === undefined) {
    if (required) throw new ReviewValidationError(`${name} is required`);
    return;
  }
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) {
    throw new ReviewValidationError(`${name} is invalid`);
  }
}

function validateId(value: unknown, name: string, required = true): asserts value is string | null | undefined {
  validateText(value, name, MAX_OWNER_ID_LENGTH, required);
}

function validateSha(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new ReviewValidationError(`${name} is invalid`);
  }
}

function validateUrl(value: unknown, name: string): asserts value is string | null | undefined {
  validateText(value, name, 2_048, false);
  if (value === null || value === undefined) return;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ReviewValidationError(`${name} is invalid`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ReviewValidationError(`${name} is invalid`);
  }
}

function validateBoundedNumber(value: unknown, name: string, minimum: number, maximum: number): asserts value is number | null | undefined {
  if (value === null || value === undefined) return;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ReviewValidationError(`${name} is invalid`);
  }
}

function validateReviewInput(input: MemoryReviewInput): void {
  validateId(input.ownerId, "ownerId");
  if (!REVIEW_TYPES.has(input.reviewType)) throw new ReviewValidationError("reviewType is invalid");
  validateText(input.candidateContent, "candidateContent", MAX_REVIEW_CONTENT_LENGTH);
  validateSha(input.candidateSha256, "candidateSha256");
  validateText(input.candidateNamespace, "candidateNamespace", MAX_NAMESPACE_LENGTH);
  if (!REVIEW_KINDS.has(input.candidateKind)) throw new ReviewValidationError("candidateKind is invalid");
  validateId(input.matchedMemoryId, "matchedMemoryId", false);
  validateBoundedNumber(input.similarity, "similarity", 0, 1);
  validateText(input.sourceSystem, "sourceSystem", MAX_SOURCE_LENGTH, false);
  validateText(input.sourceId, "sourceId", MAX_SOURCE_LENGTH, false);
  validateUrl(input.sourceUrl, "sourceUrl");
  validateText(input.client, "client", MAX_CLIENT_LENGTH, false);
  validateText(input.model, "model", MAX_CLIENT_LENGTH, false);
  validateText(input.correlationId, "correlationId", MAX_CORRELATION_LENGTH, false);
}

function validateReviewListInput(input: ReviewListInput): void {
  validateId(input.ownerId, "ownerId");
  if (input.status !== undefined && !REVIEW_STATUSES.has(input.status)) {
    throw new ReviewValidationError("status is invalid");
  }
  if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > MAX_LIST_LIMIT)) {
    throw new ReviewValidationError("limit is invalid");
  }
}

function validateResolveInput(input: ResolveReviewInput): void {
  validateId(input.ownerId, "ownerId");
  validateId(input.reviewId, "reviewId");
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new ReviewValidationError("expectedVersion is invalid");
  }
  if (!REVIEW_STATUSES.has(input.status) || !["approved", "rejected", "dismissed"].includes(input.status)) {
    throw new ReviewValidationError("status is invalid");
  }
  validateText(input.resolvedBy, "resolvedBy", MAX_OWNER_ID_LENGTH, false);
  validateText(input.resolutionNote, "resolutionNote", MAX_RESOLUTION_NOTE_LENGTH, false);
}

function validateFeedbackInput(input: MemoryFeedbackInput): void {
  validateFeedbackId(input.ownerId, "ownerId");
  validateFeedbackId(input.memoryId, "memoryId");
  validateFeedbackText(input.query, "query", MAX_QUERY_LENGTH);
  if (!FEEDBACK_LABELS.has(input.label)) throw new FeedbackValidationError("label is invalid");
  if (!SEARCH_MODES.has(input.mode)) throw new FeedbackValidationError("mode is invalid");
  if (input.rank !== null && input.rank !== undefined && (!Number.isInteger(input.rank) || input.rank < 1 || input.rank > MAX_RANK)) {
    throw new FeedbackValidationError("rank is invalid");
  }
  if (input.score !== null && input.score !== undefined && (!Number.isFinite(input.score) || input.score < 0 || input.score > 1)) {
    throw new FeedbackValidationError("score is invalid");
  }
  validateFeedbackText(input.resultSetId, "resultSetId", MAX_RESULT_SET_LENGTH, false);
  validateFeedbackText(input.correlationId, "correlationId", MAX_CORRELATION_LENGTH, false);
  validateFeedbackText(input.client, "client", MAX_CLIENT_LENGTH, false);
  validateFeedbackText(input.model, "model", MAX_CLIENT_LENGTH, false);
}

function validateFeedbackListInput(input: FeedbackListInput): void {
  validateFeedbackId(input.ownerId, "ownerId");
  validateFeedbackId(input.memoryId, "memoryId", false);
  if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > MAX_LIST_LIMIT)) {
    throw new FeedbackValidationError("limit is invalid");
  }
}

function validateFeedbackText(
  value: unknown,
  name: string,
  maximum: number,
  required = true,
): asserts value is string | null | undefined {
  if (value === null || value === undefined) {
    if (required) throw new FeedbackValidationError(`${name} is required`);
    return;
  }
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) {
    throw new FeedbackValidationError(`${name} is invalid`);
  }
}

function validateFeedbackId(
  value: unknown,
  name: string,
  required = true,
): asserts value is string | null | undefined {
  validateFeedbackText(value, name, MAX_OWNER_ID_LENGTH, required);
}

function reviewFingerprint(input: MemoryReviewInput): string {
  return [
    input.ownerId,
    input.reviewType,
    input.candidateContent,
    input.candidateSha256,
    input.candidateNamespace,
    input.candidateKind,
    input.matchedMemoryId ?? "",
    input.similarity === null || input.similarity === undefined ? "" : String(input.similarity),
    input.sourceSystem ?? "",
    input.sourceId ?? "",
    input.sourceUrl ?? "",
    input.client ?? "",
    input.model ?? "",
    input.correlationId ?? "",
  ].join("\u0000");
}

function feedbackFingerprint(input: MemoryFeedbackInput): string {
  return [
    input.ownerId,
    input.memoryId,
    input.query,
    input.label,
    input.mode,
    input.rank === null || input.rank === undefined ? "" : String(input.rank),
    input.score === null || input.score === undefined ? "" : String(input.score),
    input.resultSetId ?? "",
    input.correlationId ?? "",
    input.client ?? "",
    input.model ?? "",
  ].join("\u0000");
}

function toReview(row: ReviewRow): MemoryReviewRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    reviewType: row.review_type,
    status: row.status,
    candidateContent: row.candidate_content,
    candidateSha256: row.candidate_sha256,
    candidateNamespace: row.candidate_namespace,
    candidateKind: row.candidate_kind,
    matchedMemoryId: row.matched_memory_id,
    similarity: row.similarity,
    sourceSystem: row.source_system,
    sourceId: row.source_id,
    sourceUrl: row.source_url,
    client: row.client,
    model: row.model,
    correlationId: row.correlation_id,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    resolutionNote: row.resolution_note,
    createdAt: row.created_at,
    version: row.version,
  };
}

function toFeedback(row: FeedbackRow): MemoryFeedbackRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    memoryId: row.memory_id,
    querySha256: row.query_sha256,
    label: row.label,
    mode: row.mode,
    rank: row.result_rank,
    score: row.result_score,
    resultSetId: row.result_set_id,
    correlationId: row.correlation_id,
    client: row.client,
    model: row.model,
    createdAt: row.created_at,
  };
}

export class MemoryReviewStore {
  private readonly dependencies: ReviewStoreDependencies;

  constructor(
    private readonly database: D1Database,
    dependencies: Partial<ReviewStoreDependencies> = {},
  ) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  async createReview(input: MemoryReviewInput): Promise<{ review: MemoryReviewRecord; idempotent: boolean }> {
    validateReviewInput(input);
    const requestSha256 = await this.dependencies.sha256(reviewFingerprint(input));

    if (input.correlationId) {
      const existing = await this.database.prepare(
        `SELECT ${REVIEW_COLUMNS} FROM memory_review_items
         WHERE owner_id = ? AND correlation_id = ?`,
      ).bind(input.ownerId, input.correlationId).first<ReviewRow>();
      if (existing) {
        if (existing.request_sha256 !== requestSha256) {
          throw new ReviewConflictError(
            "Review correlation ID already belongs to another request",
            "REVIEW_CORRELATION_CONFLICT",
          );
        }
        return { review: toReview(existing), idempotent: true };
      }
    }

    await this.assertMemoryOwner(input.ownerId, input.matchedMemoryId, "review");
    const id = this.dependencies.newId();
    const timestamp = this.dependencies.now();
    const result = await this.database.prepare(
      `INSERT INTO memory_review_items (
         id, owner_id, review_type, candidate_content, candidate_sha256,
         candidate_namespace, candidate_kind, matched_memory_id, similarity,
         source_system, source_id, source_url, client, model, correlation_id,
         request_sha256, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner_id, correlation_id) DO NOTHING`,
    ).bind(
      id,
      input.ownerId,
      input.reviewType,
      input.candidateContent,
      input.candidateSha256,
      input.candidateNamespace,
      input.candidateKind,
      input.matchedMemoryId,
      input.similarity ?? null,
      input.sourceSystem ?? null,
      input.sourceId ?? null,
      input.sourceUrl ?? null,
      input.client ?? null,
      input.model ?? null,
      input.correlationId ?? null,
      requestSha256,
      timestamp,
    ).run();

    if ((result.meta.changes ?? 0) === 0 && input.correlationId) {
      const existing = await this.database.prepare(
        `SELECT ${REVIEW_COLUMNS} FROM memory_review_items
         WHERE owner_id = ? AND correlation_id = ?`,
      ).bind(input.ownerId, input.correlationId).first<ReviewRow>();
      if (!existing) throw new Error("Review idempotency row could not be read back");
      if (existing.request_sha256 !== requestSha256) {
        throw new ReviewConflictError(
          "Review correlation ID already belongs to another request",
          "REVIEW_CORRELATION_CONFLICT",
        );
      }
      return { review: toReview(existing), idempotent: true };
    }

    const review = await this.getReview(input.ownerId, id);
    if (!review) throw new Error("Created review could not be read back");
    return { review, idempotent: false };
  }

  async listReviews(input: ReviewListInput): Promise<MemoryReviewRecord[]> {
    validateReviewListInput(input);
    const limit = input.limit ?? 25;
    const result = input.status === undefined
      ? await this.database.prepare(
        `SELECT ${REVIEW_COLUMNS} FROM memory_review_items
         WHERE owner_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
      ).bind(input.ownerId, limit).all<ReviewRow>()
      : await this.database.prepare(
        `SELECT ${REVIEW_COLUMNS} FROM memory_review_items
         WHERE owner_id = ? AND status = ?
         ORDER BY created_at DESC, id DESC LIMIT ?`,
      ).bind(input.ownerId, input.status, limit).all<ReviewRow>();
    return result.results.map(toReview);
  }

  async resolveReview(input: ResolveReviewInput): Promise<MemoryReviewRecord> {
    validateResolveInput(input);
    const timestamp = this.dependencies.now();
    const result = await this.database.prepare(
      `UPDATE memory_review_items
       SET status = ?, resolved_at = ?, resolved_by = ?, resolution_note = ?, version = version + 1
       WHERE owner_id = ? AND id = ? AND status = 'open' AND version = ?`,
    ).bind(
      input.status,
      timestamp,
      input.resolvedBy ?? null,
      input.resolutionNote ?? null,
      input.ownerId,
      input.reviewId,
      input.expectedVersion,
    ).run();

    if ((result.meta.changes ?? 0) !== 1) {
      const existing = await this.getReview(input.ownerId, input.reviewId);
      if (!existing) throw new ReviewNotFoundError();
      throw new ReviewConflictError("Memory review was already resolved or has changed");
    }
    const review = await this.getReview(input.ownerId, input.reviewId);
    if (!review) throw new Error("Resolved review could not be read back");
    return review;
  }

  async createFeedback(input: MemoryFeedbackInput): Promise<{ feedback: MemoryFeedbackRecord; idempotent: boolean }> {
    validateFeedbackInput(input);
    const querySha256 = await this.dependencies.sha256(input.query);
    const requestSha256 = await this.dependencies.sha256(feedbackFingerprint(input));

    if (input.correlationId) {
      const existing = await this.database.prepare(
        `SELECT ${FEEDBACK_COLUMNS} FROM memory_relevance_feedback
         WHERE owner_id = ? AND correlation_id = ?`,
      ).bind(input.ownerId, input.correlationId).first<FeedbackRow>();
      if (existing) return this.feedbackReplay(existing, requestSha256);
    }

    await this.assertMemoryOwner(input.ownerId, input.memoryId, "feedback");
    const id = this.dependencies.newId();
    const result = await this.database.prepare(
      `INSERT INTO memory_relevance_feedback (
         id, owner_id, memory_id, query_sha256, label, mode, result_rank, result_score,
         result_set_id, correlation_id, request_sha256, client, model, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner_id, correlation_id) DO NOTHING`,
    ).bind(
      id,
      input.ownerId,
      input.memoryId,
      querySha256,
      input.label,
      input.mode,
      input.rank ?? null,
      input.score ?? null,
      input.resultSetId ?? null,
      input.correlationId ?? null,
      requestSha256,
      input.client ?? null,
      input.model ?? null,
      this.dependencies.now(),
    ).run();

    if ((result.meta.changes ?? 0) === 0 && input.correlationId) {
      const existing = await this.database.prepare(
        `SELECT ${FEEDBACK_COLUMNS} FROM memory_relevance_feedback
         WHERE owner_id = ? AND correlation_id = ?`,
      ).bind(input.ownerId, input.correlationId).first<FeedbackRow>();
      if (!existing) throw new Error("Feedback idempotency row could not be read back");
      return this.feedbackReplay(existing, requestSha256);
    }

    const feedback = await this.getFeedback(input.ownerId, id);
    if (!feedback) throw new Error("Created feedback could not be read back");
    return { feedback, idempotent: false };
  }

  async listFeedback(input: FeedbackListInput): Promise<MemoryFeedbackRecord[]> {
    validateFeedbackListInput(input);
    const limit = input.limit ?? 25;
    const result = input.memoryId === undefined
      ? await this.database.prepare(
        `SELECT ${FEEDBACK_COLUMNS} FROM memory_relevance_feedback
         WHERE owner_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
      ).bind(input.ownerId, limit).all<FeedbackRow>()
      : await this.database.prepare(
        `SELECT ${FEEDBACK_COLUMNS} FROM memory_relevance_feedback
         WHERE owner_id = ? AND memory_id = ?
         ORDER BY created_at DESC, id DESC LIMIT ?`,
      ).bind(input.ownerId, input.memoryId, limit).all<FeedbackRow>();
    return result.results.map(toFeedback);
  }

  private async getReview(ownerId: string, id: string): Promise<MemoryReviewRecord | null> {
    const row = await this.database.prepare(
      `SELECT ${REVIEW_COLUMNS} FROM memory_review_items WHERE owner_id = ? AND id = ?`,
    ).bind(ownerId, id).first<ReviewRow>();
    return row ? toReview(row) : null;
  }

  private async getFeedback(ownerId: string, id: string): Promise<MemoryFeedbackRecord | null> {
    const row = await this.database.prepare(
      `SELECT ${FEEDBACK_COLUMNS} FROM memory_relevance_feedback WHERE owner_id = ? AND id = ?`,
    ).bind(ownerId, id).first<FeedbackRow>();
    return row ? toFeedback(row) : null;
  }

  private async feedbackReplay(row: FeedbackRow, requestSha256: string): Promise<{ feedback: MemoryFeedbackRecord; idempotent: boolean }> {
    if (row.request_sha256 !== requestSha256) throw new FeedbackConflictError();
    return { feedback: toFeedback(row), idempotent: true };
  }

  private async assertMemoryOwner(ownerId: string, memoryId: string | null | undefined, kind: "review" | "feedback"): Promise<void> {
    if (!memoryId) return;
    const row = await this.database.prepare(
      "SELECT id FROM memories WHERE owner_id = ? AND id = ?",
    ).bind(ownerId, memoryId).first<{ id: string }>();
    if (!row) {
      if (kind === "review") throw new ReviewOwnerBoundaryError();
      throw new FeedbackOwnerBoundaryError();
    }
  }
}
