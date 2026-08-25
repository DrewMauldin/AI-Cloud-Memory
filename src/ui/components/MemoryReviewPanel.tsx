export type MemoryReviewStatus = "open" | "approved" | "rejected" | "dismissed";
export type MemoryReviewDecision = Exclude<MemoryReviewStatus, "open">;
export type MemoryReviewType = "probable_duplicate" | "source_conflict";

export interface MemoryReviewItem {
  id: string;
  reviewType: MemoryReviewType;
  status: MemoryReviewStatus;
  candidateContent: string;
  candidateSha256: string;
  candidateNamespace: string;
  candidateKind: "memory" | "directive";
  matchedMemoryId: string | null;
  similarity: number | null;
  sourceSystem: string | null;
  sourceId: string | null;
  sourceUrl: string | null;
  client: string | null;
  model: string | null;
  correlationId: string | null;
  createdAt: string;
  version: number;
}

interface MemoryReviewPanelProps {
  reviews: readonly MemoryReviewItem[];
  onApprove: (reviewId: string, expectedVersion: number) => void;
  onReject: (reviewId: string, expectedVersion: number) => void;
  onDismiss: (reviewId: string, expectedVersion: number) => void;
  resolvingReviewId?: string | null;
}

const MAX_EXCERPT_LENGTH = 1_200;

function boundedExcerpt(value: string): string {
  return value.length > MAX_EXCERPT_LENGTH
    ? `${value.slice(0, MAX_EXCERPT_LENGTH)}…`
    : value;
}

function safeSourceUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function reviewLabel(type: MemoryReviewType): string {
  return type === "probable_duplicate" ? "Probable duplicate" : "Source conflict";
}

function formatSimilarity(value: number | null): string {
  return value === null ? "No similarity score" : `${Math.round(value * 100)}% match`;
}

export function MemoryReviewPanel({
  reviews,
  onApprove,
  onReject,
  onDismiss,
  resolvingReviewId = null,
}: MemoryReviewPanelProps) {
  const openReviews = reviews.filter((review) => review.status === "open");
  return (
    <section id="memory-review-workbench" className="memory-review-panel" aria-labelledby="memory-review-panel-title">
      <header className="memory-review-panel__header">
        <div>
          <p className="eyebrow">TRUST LAB / OPEN REVIEWS</p>
          <h2 id="memory-review-panel-title">Resolve the review without rewriting truth.</h2>
          <p>These decisions close a queue item only. They do not create, merge or supersede a memory.</p>
        </div>
        <span aria-label={`${openReviews.length} open reviews`}>{openReviews.length.toString().padStart(2, "0")}</span>
      </header>
      {openReviews.length === 0 ? (
        <p className="memory-review-panel__empty" role="status">No open review items.</p>
      ) : (
        <ol className="memory-review-panel__list">
          {openReviews.map((review) => {
            const resolving = resolvingReviewId === review.id;
            const sourceUrl = safeSourceUrl(review.sourceUrl);
            return (
              <li className="memory-review-panel__item" key={review.id}>
                <article>
                  <header className="memory-review-panel__item-header">
                    <div>
                      <span className="memory-review-panel__type">{reviewLabel(review.reviewType)}</span>
                      <span className="memory-review-panel__kind">{review.candidateKind} · {review.candidateNamespace}</span>
                    </div>
                    <span className="memory-review-panel__version">v{review.version}</span>
                  </header>
                  <p className="memory-review-panel__candidate">{boundedExcerpt(review.candidateContent)}</p>
                  <dl className="memory-review-panel__provenance">
                    <div><dt>Candidate hash</dt><dd>{boundedExcerpt(review.candidateSha256)}</dd></div>
                    <div><dt>Matched memory</dt><dd>{review.matchedMemoryId ?? "No matched memory"}</dd></div>
                    <div><dt>Similarity</dt><dd>{formatSimilarity(review.similarity)}</dd></div>
                    <div><dt>Source</dt><dd>{review.sourceSystem ?? review.client ?? "Unspecified"}{review.sourceId ? ` · ${review.sourceId}` : ""}</dd></div>
                  </dl>
                  <footer className="memory-review-panel__item-footer">
                    {sourceUrl ? <a href={sourceUrl} target="_blank" rel="noreferrer">Open source</a> : <span>Source unavailable</span>}
                    <div className="memory-review-panel__actions" aria-label={`Actions for ${reviewLabel(review.reviewType)}`}>
                      <button type="button" disabled={resolving} onClick={() => onApprove(review.id, review.version)}>Mark approved</button>
                      <button type="button" disabled={resolving} onClick={() => onReject(review.id, review.version)}>Reject</button>
                      <button type="button" disabled={resolving} onClick={() => onDismiss(review.id, review.version)}>Dismiss</button>
                    </div>
                  </footer>
                </article>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
