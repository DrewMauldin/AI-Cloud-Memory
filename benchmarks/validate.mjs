const SECRET_PATTERN = /(gh[pousr]_[A-Za-z0-9_-]{20,}|github_pat_[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]+)/iu;

const isPlainObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function assertDataset(dataset) {
  if (!isPlainObject(dataset) || !Array.isArray(dataset.memories) || !Array.isArray(dataset.queries)) {
    throw new Error("benchmark requires memories and queries arrays");
  }
  if (dataset.queries.length < 20 || dataset.queries.length > 30) {
    throw new Error("benchmark must contain 20-30 queries");
  }
  const memoryIds = new Set();
  for (const memory of dataset.memories) {
    if (
      !isPlainObject(memory) ||
      typeof memory.id !== "string" ||
      typeof memory.content !== "string" ||
      memory.content.trim().length === 0 ||
      typeof memory.importance !== "number" ||
      memory.importance < 0 ||
      memory.importance > 1 ||
      typeof memory.confidence !== "number" ||
      memory.confidence < 0 ||
      memory.confidence > 1 ||
      !["active", "superseded"].includes(memory.status) ||
      !Number.isFinite(Date.parse(memory.createdAt)) ||
      !Number.isFinite(Date.parse(memory.updatedAt)) ||
      (memory.validFrom !== null && !Number.isFinite(Date.parse(memory.validFrom))) ||
      (memory.validUntil !== null && !Number.isFinite(Date.parse(memory.validUntil)))
    ) {
      throw new Error("invalid benchmark memory");
    }
    if (memoryIds.has(memory.id)) throw new Error("duplicate memory id");
    memoryIds.add(memory.id);
  }
  const queryIds = new Set();
  for (const query of dataset.queries) {
    if (
      !isPlainObject(query) ||
      typeof query.id !== "string" ||
      typeof query.category !== "string" ||
      typeof query.query !== "string" ||
      query.query.trim().length === 0 ||
      !Array.isArray(query.relevant) ||
      !Array.isArray(query.candidates)
    ) {
      throw new Error("invalid benchmark query");
    }
    if (queryIds.has(query.id)) throw new Error("duplicate query id");
    queryIds.add(query.id);
    if (query.relevant.length === 0 && query.expectNoResult !== true) {
      throw new Error(`empty relevance labels: ${query.id}`);
    }
    if (query.relevant.length > 0 && query.expectNoResult === true) {
      throw new Error(`no-result query has relevance labels: ${query.id}`);
    }
    const candidateIds = new Set();
    for (const candidate of query.candidates) {
      if (
        !isPlainObject(candidate) ||
        typeof candidate.id !== "string" ||
        typeof candidate.score !== "number" ||
        !Number.isFinite(candidate.score) ||
        candidate.score < 0 ||
        candidate.score > 1 ||
        !memoryIds.has(candidate.id)
      ) {
        throw new Error(`invalid candidate: ${query.id}`);
      }
      if (candidateIds.has(candidate.id)) throw new Error(`duplicate candidate: ${query.id}`);
      candidateIds.add(candidate.id);
    }
    for (const id of query.relevant) {
      if (!memoryIds.has(id)) throw new Error(`unknown memory label: ${id}`);
      if (!candidateIds.has(id)) throw new Error(`relevant label missing from candidates: ${id}`);
    }
    if (query.graded !== undefined) {
      if (!isPlainObject(query.graded)) throw new Error(`invalid graded labels: ${query.id}`);
      for (const [id, grade] of Object.entries(query.graded)) {
        if (
          !memoryIds.has(id) ||
          !candidateIds.has(id) ||
          !Number.isInteger(grade) ||
          grade < 1 ||
          grade > 3
        ) {
          throw new Error(`invalid graded label: ${id}`);
        }
      }
    }
  }
  if (SECRET_PATTERN.test(JSON.stringify(dataset))) {
    throw new Error("benchmark contains a credential-like value");
  }
}
