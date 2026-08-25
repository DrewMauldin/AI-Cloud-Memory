import type { ContextGraphEntity, ContextGraphRelationship, ContextGraphSnapshot } from "../types";

interface ContextGraphPanelProps {
  graph: ContextGraphSnapshot | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

const MAX_ENTITY_DESCRIPTION = 240;
const MAX_ALIASES = 20;
const MAX_RELATIONSHIPS = 12;

function boundedText(value: string, maximum: number): string {
  return value.length > maximum ? `${value.slice(0, maximum)}…` : value;
}

function entityName(entities: Map<string, ContextGraphEntity>, id: string): string {
  return entities.get(id)?.canonicalName ?? "Unknown entity";
}

function relatedEntityId(relationship: ContextGraphRelationship, entityId: string): string {
  return relationship.fromEntityId === entityId ? relationship.toEntityId : relationship.fromEntityId;
}

function percentage(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function GraphLoadingState() {
  return (
    <section className="context-graph-panel" aria-labelledby="context-graph-title" aria-busy="true">
      <header className="context-graph-panel__header">
        <div><p className="eyebrow">CONTEXT GRAPH / LOADING</p><h2 id="context-graph-title">Following the connections.</h2></div>
      </header>
      <div className="context-graph-panel__loading" aria-label="Loading context graph">
        <span /><span /><span />
      </div>
    </section>
  );
}

export function ContextGraphPanel({ graph, loading = false, error = null, onRetry }: ContextGraphPanelProps) {
  if (loading) return <GraphLoadingState />;

  if (error) {
    return (
      <section className="context-graph-panel" aria-labelledby="context-graph-title">
        <header className="context-graph-panel__header">
          <div><p className="eyebrow">CONTEXT GRAPH / DEGRADED</p><h2 id="context-graph-title">The graph is unavailable.</h2></div>
        </header>
        <div className="context-graph-panel__message" role="alert">
          <p>{boundedText(error, 300)}</p>
          {onRetry ? <button className="secondary-button" type="button" onClick={onRetry}>Try again</button> : null}
        </div>
      </section>
    );
  }

  const entities = graph?.entities ?? [];
  if (!graph || entities.length === 0) {
    return (
      <section className="context-graph-panel" aria-labelledby="context-graph-title">
        <header className="context-graph-panel__header">
          <div><p className="eyebrow">CONTEXT GRAPH / 00 ENTITIES</p><h2 id="context-graph-title">Build the map behind recall.</h2></div>
        </header>
        <p className="context-graph-panel__empty" role="status">No context entities have been linked yet.</p>
      </section>
    );
  }

  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const aliases = entities.reduce((total, entity) => total + (entity.aliases?.length ?? 0), 0);
  const evidenceLinks = graph.memoryLinks.filter((link) => entityById.has(link.entityId));
  const relationships = graph.relationships.filter((relationship) => (
    entityById.has(relationship.fromEntityId) || entityById.has(relationship.toEntityId)
  ));

  return (
    <section className="context-graph-panel" aria-labelledby="context-graph-title">
      <header className="context-graph-panel__header">
        <div><p className="eyebrow">CONTEXT GRAPH / LIVE MAP</p><h2 id="context-graph-title">The connections behind recall.</h2></div>
        <span className="context-graph-panel__status">READ ONLY</span>
      </header>
      <dl className="context-graph-panel__metrics" aria-label="Context graph summary">
        <div><dt>Entities</dt><dd>{entities.length}</dd></div>
        <div><dt>Aliases</dt><dd>{aliases}</dd></div>
        <div><dt>Evidence links</dt><dd>{evidenceLinks.length}</dd></div>
        <div><dt>One-hop links</dt><dd>{relationships.length}</dd></div>
      </dl>
      <ul className="context-graph-panel__entities" aria-label="Context graph entities">
        {entities.map((entity) => {
          const entityAliases = (entity.aliases ?? []).slice(0, MAX_ALIASES);
          const evidenceCount = evidenceLinks.filter((link) => link.entityId === entity.id).length;
          const entityRelationships = relationships
            .filter((relationship) => relationship.fromEntityId === entity.id || relationship.toEntityId === entity.id)
            .slice(0, MAX_RELATIONSHIPS);
          return (
            <li key={entity.id}>
              <article className="context-graph-panel__entity">
                <header>
                  <div><span className="context-graph-panel__entity-type">{entity.entityType}</span><h3>{boundedText(entity.canonicalName, 200)}</h3></div>
                  <span className="context-graph-panel__evidence-count">{evidenceCount} evidence</span>
                </header>
                {entity.description ? <p className="context-graph-panel__description">{boundedText(entity.description, MAX_ENTITY_DESCRIPTION)}</p> : null}
                <div className="context-graph-panel__section">
                  <h4>Aliases</h4>
                  {entityAliases.length ? <ul className="context-graph-panel__aliases">{entityAliases.map((alias) => <li key={alias}>{boundedText(alias, 200)}</li>)}</ul> : <p className="context-graph-panel__muted">No aliases recorded.</p>}
                </div>
                <div className="context-graph-panel__section">
                  <h4>One-hop relationships</h4>
                  {entityRelationships.length ? <ul className="context-graph-panel__relationships">{entityRelationships.map((relationship) => <li key={relationship.id}><span>{relationship.relationshipType}</span><strong>{entityName(entityById, relatedEntityId(relationship, entity.id))}</strong><small>{percentage(relationship.confidence)} confidence</small></li>)}</ul> : <p className="context-graph-panel__muted">No direct relationships recorded.</p>}
                </div>
              </article>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
