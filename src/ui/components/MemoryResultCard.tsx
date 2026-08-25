import type { RankedMemory } from "../types";

export type MemoryFeedbackLabel = "helpful" | "not_helpful" | "outdated" | "incorrect";

function percentage(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function MemoryResultCard({
  result,
  onFeedback,
}: {
  result: RankedMemory;
  onFeedback?: (label: MemoryFeedbackLabel) => void;
}) {
  const { memory, score, sources, explanation } = result;
  return (
    <article className="memory-card">
      <header>
        <span>#{memory.memoryNumber.toString().padStart(4, "0")}</span>
        <div>
          <span className="memory-type-chip">{memory.memoryType}</span>
          {sources.map((source) => (
            <span className="provenance-chip" key={source}>{source}</span>
          ))}
        </div>
      </header>
      <p>{memory.content}</p>
      <footer>
        <span>{memory.sourceModel ?? memory.sourceClient ?? memory.sourceSystem ?? "Human"}</span>
        <span>{percentage(score)} relevance</span>
      </footer>
      <div className="memory-card-actions">
        {memory.sourceUrl ? (
          <a href={memory.sourceUrl} target="_blank" rel="noreferrer">Open source chat</a>
        ) : <span>Source chat unavailable</span>}
        {explanation ? (
          <details className="ranking-explanation">
            <summary>Why this result?</summary>
            <dl>
              <div><dt>Match</dt><dd>{explanation.matchSources.join(" + ")}</dd></div>
              <div><dt>Reranker</dt><dd>{explanation.rerankerScore === null ? "Not used" : percentage(explanation.rerankerScore)}</dd></div>
              <div><dt>Metadata boost</dt><dd>{explanation.boosts ? `+${percentage(explanation.boosts.total)}` : "None"}</dd></div>
              <div><dt>Temporal intent</dt><dd>{explanation.temporalIntent.kind}</dd></div>
              <div><dt>Retrieval state</dt><dd>{Object.values(explanation.degraded).some(Boolean) ? "Degraded" : "Healthy"}</dd></div>
            </dl>
          </details>
        ) : null}
      </div>
      {onFeedback ? (
        <div className="memory-feedback-actions" aria-label="Rate this memory result">
          <span>Relevance</span>
          <button type="button" onClick={() => onFeedback("helpful")}>Helpful</button>
          <button type="button" onClick={() => onFeedback("not_helpful")}>Not helpful</button>
          <button type="button" onClick={() => onFeedback("outdated")}>Outdated</button>
          <button type="button" onClick={() => onFeedback("incorrect")}>Incorrect</button>
        </div>
      ) : null}
    </article>
  );
}
