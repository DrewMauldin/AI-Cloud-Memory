import type { CreateMemoryInput, MemoryRecord } from "./store";

export const CAPTURE_CANDIDATE_LIMIT = 3;
export const DUPLICATE_CANDIDATE_LIMIT = 5;
export const PROBABLE_DUPLICATE_THRESHOLD = 0.92;

export interface CaptureCandidate extends Omit<CreateMemoryInput, "ownerId"> {
  supersedesId?: string;
  expectedSupersededVersion?: number;
}

export interface DuplicateCandidate {
  memory: MemoryRecord;
  score: number;
}

export type CaptureOutcome =
  | { outcome: "created"; memory: MemoryRecord }
  | { outcome: "exact_duplicate"; duplicateOf: MemoryRecord }
  | { outcome: "source_conflict"; conflictingWith: MemoryRecord }
  | { outcome: "probable_duplicate"; candidates: DuplicateCandidate[] }
  | { outcome: "superseded"; replacement: MemoryRecord; superseded: MemoryRecord };
