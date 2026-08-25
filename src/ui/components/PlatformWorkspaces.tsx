import { useEffect, useMemo, useState } from "react";

import { api } from "../api";
import type {
  ClientCompatibility,
  ClientCompatibilityReceipt,
  ClientManifestItem,
  ConnectorAdapterId,
  ConnectorRun,
  ContextPack,
  ProfileFacet,
  ProfileFacetType,
  ReflectionProposal,
} from "../types";

export function parseConnectorInput(adapterId: ConnectorAdapterId, value: string): unknown {
  if (adapterId === "cloud_memory_jsonl" || adapterId === "truememory_jsonl") return value;
  return JSON.parse(value) as unknown;
}

const ADAPTER_HELP: Record<ConnectorAdapterId, string> = {
  cloud_memory_jsonl: "One Cloud Memory record per line. Useful for portable exports and controlled re-imports.",
  truememory_jsonl: "A schema-v2 TrueMemory manifest followed by its checksum-bound records.",
  markdown_bundle: 'A JSON object shaped as {"files":[{"path":"Notes/example.md","content":"…"}]}',
  github_markdown: 'A JSON object shaped as {"repository":"owner/repo","ref":"main","path":"note.md"}',
};

export function ConnectorWorkbench({ onNotice }: { onNotice: (message: string) => void }) {
  const [adapterId, setAdapterId] = useState<ConnectorAdapterId>("markdown_bundle");
  const [source, setSource] = useState("");
  const [run, setRun] = useState<ConnectorRun | null>(null);
  const [sample, setSample] = useState<Array<{ sourceId: string; content: string }>>([]);
  const [history, setHistory] = useState<ConnectorRun[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api.connectors().then((result) => setHistory(result.runs)).catch(() => undefined); }, []);
  async function preview() {
    setBusy(true);
    try {
      const result = await api.previewConnector(adapterId, parseConnectorInput(adapterId, source));
      setRun(result.run);
      setSample(result.preview.records.slice(0, 3));
      setHistory((current) => [result.run, ...current]);
      onNotice(`Previewed ${result.preview.records.length} records. Nothing was written.`);
    } catch (error) { onNotice(error instanceof Error ? error.message : "Connector preview failed"); }
    finally { setBusy(false); }
  }
  async function apply() {
    if (!run) return;
    setBusy(true);
    try {
      const applied = await api.applyConnector(run, adapterId, parseConnectorInput(adapterId, source));
      setRun(applied);
      setHistory((current) => [applied, ...current.filter((item) => item.id !== applied.id)]);
      onNotice(`Connector completed: ${applied.importedCount} imported, ${applied.duplicateCount} duplicates, ${applied.rejectedCount} rejected.`);
    } catch (error) { onNotice(error instanceof Error ? error.message : "Connector apply failed"); }
    finally { setBusy(false); }
  }
  function changeAdapter(value: ConnectorAdapterId) { setAdapterId(value); setRun(null); setSample([]); setSource(""); }
  return <section className="platform-panel connector-workbench" aria-labelledby="connector-title">
    <header><div><p className="eyebrow">SOURCE CONNECTORS / PREVIEW FIRST</p><h2 id="connector-title">Bring knowledge in without surrendering control.</h2><p>Every apply is bound to the exact preview hash. Changed, oversized, unsafe or secret-bearing input is rejected.</p></div><span>4 ADAPTERS</span></header>
    <div className="connector-layout">
      <div className="connector-editor">
        <label>Source format<select name="connector-source-format" value={adapterId} onChange={(event) => changeAdapter(event.target.value as ConnectorAdapterId)}><option value="cloud_memory_jsonl">Cloud Memory JSONL</option><option value="truememory_jsonl">TrueMemory JSONL</option><option value="markdown_bundle">Markdown bundle</option><option value="github_markdown">GitHub Markdown</option></select></label>
        <p>{ADAPTER_HELP[adapterId]}</p>
        <label>Source payload<textarea name="connector-source-payload" value={source} onChange={(event) => { setSource(event.target.value); setRun(null); setSample([]); }} rows={10} spellCheck={false} placeholder="Paste a bounded source payload…" /></label>
        <div className="platform-actions"><button className="secondary-button" disabled={busy || !source.trim()} onClick={preview}>{busy ? "Checking…" : "Preview safely"}</button><button className="primary-button" disabled={busy || !run || run.status !== "previewed"} onClick={apply}>Approve exact preview</button></div>
      </div>
      <aside className="connector-receipt" aria-live="polite">
        <p className="eyebrow">CURRENT RECEIPT</p>
        {run ? <><strong>{run.status.replaceAll("_", " ")}</strong><dl><div><dt>Examined</dt><dd>{run.examinedCount}</dd></div><div><dt>Imported</dt><dd>{run.importedCount}</dd></div><div><dt>Duplicates</dt><dd>{run.duplicateCount}</dd></div><div><dt>Rejected</dt><dd>{run.rejectedCount}</dd></div></dl><code>{run.previewSha256.slice(0, 16)}…</code>{sample.map((item) => <article key={item.sourceId}><strong>{item.sourceId}</strong><p>{item.content.slice(0, 140)}</p></article>)}</> : <div className="platform-empty"><span>↳</span><p>A hash-bound receipt and three-record sample will appear here.</p></div>}
      </aside>
    </div>
    {history.length ? <footer><strong>Recent runs</strong>{history.slice(0, 5).map((item) => <span key={item.id}>{item.adapterId.replaceAll("_", " ")} · {item.status} · {item.examinedCount}</span>)}</footer> : null}
  </section>;
}

function ClientReceiptCard({ client, endpoint, receipt, onSaved }: {
  client: ClientManifestItem; endpoint: string; receipt?: ClientCompatibilityReceipt; onSaved: (receipt: ClientCompatibilityReceipt) => void;
}) {
  const [configuredStatus, setConfigured] = useState<ClientCompatibilityReceipt["configuredStatus"]>(receipt?.configuredStatus ?? "unknown");
  const [authenticatedStatus, setAuthenticated] = useState<ClientCompatibilityReceipt["authenticatedStatus"]>(receipt?.authenticatedStatus ?? "unknown");
  const [verifiedStatus, setVerified] = useState<ClientCompatibilityReceipt["verifiedStatus"]>(receipt?.verifiedStatus ?? "unknown");
  const [evidence, setEvidence] = useState(receipt?.evidence ?? "");
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      onSaved(await api.saveClientReceipt(client.id, {
        clientVersion: receipt?.clientVersion ?? undefined, endpoint, configuredStatus, authenticatedStatus, verifiedStatus,
        expectedToolCount: client.expectedToolCount, discoveredToolCount: verifiedStatus === "verified" ? client.expectedToolCount : undefined,
        model: receipt?.model ?? undefined, evidence: evidence.trim() || undefined, expectedVersion: receipt?.version,
      }));
    } finally { setSaving(false); }
  }
  return <article className="client-receipt-card">
    <header><span>{client.label.slice(0, 2).toUpperCase()}</span><div><h3>{client.label}</h3><p>{client.setup === "cli" ? "Local CLI" : "Web connector"} · {client.hookSupport.replaceAll("_", " ")}</p></div><em>{receipt?.checkedAt.slice(0, 10) ?? "NO RECEIPT"}</em></header>
    <div className="client-state-grid"><label>Configured<select name={`${client.id}-configured`} value={configuredStatus} onChange={(event) => setConfigured(event.target.value as typeof configuredStatus)}><option>unknown</option><option>configured</option><option>failed</option></select></label><label>Authenticated<select name={`${client.id}-authenticated`} value={authenticatedStatus} onChange={(event) => setAuthenticated(event.target.value as typeof authenticatedStatus)}><option>unknown</option><option>authenticated</option><option>failed</option><option value="not_supported">not supported</option></select></label><label>Verified<select name={`${client.id}-verified`} value={verifiedStatus} onChange={(event) => setVerified(event.target.value as typeof verifiedStatus)}><option>unknown</option><option>verified</option><option>degraded</option><option>failed</option></select></label></div>
    <label>Evidence note<input name={`${client.id}-evidence`} value={evidence} maxLength={500} onChange={(event) => setEvidence(event.target.value)} placeholder="What canary actually passed?" /></label>
    <footer><span>{client.writeSupport === "full" ? "24 read/write tools" : "Read-only on current plan"}</span><button className="secondary-button" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save dated receipt"}</button></footer>
  </article>;
}

export function CompatibilityCentre({ onNotice }: { onNotice: (message: string) => void }) {
  const [data, setData] = useState<ClientCompatibility | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void api.clientCompatibility().then(setData).catch((reason) => setError(reason instanceof Error ? reason.message : "Compatibility data unavailable")); }, []);
  if (error) return <section className="platform-panel"><p className="error-copy">{error}</p></section>;
  if (!data) return <section className="platform-panel platform-loading">Loading compatibility receipts…</section>;
  return <>
    <section className="compatibility-hero"><div><p className="eyebrow">CANONICAL ENDPOINT</p><code>{data.manifest.endpoint}</code><p>Registration, OAuth, and live tool verification are deliberately separate states.</p></div><dl><div><dt>Clients</dt><dd>5</dd></div><div><dt>Tools</dt><dd>24</dd></div><div><dt>OAuth scopes</dt><dd>4</dd></div></dl></section>
    <section className="client-receipt-grid" aria-label="Client compatibility receipts">{data.manifest.clients.map((client) => <ClientReceiptCard key={client.id} client={client} endpoint={data.manifest.endpoint} receipt={data.receipts.find((item) => item.clientId === client.id)} onSaved={(saved) => { setData((current) => current ? { ...current, receipts: [saved, ...current.receipts.filter((item) => item.clientId !== saved.clientId)] } : current); onNotice(`${client.label} receipt saved. This records evidence; it does not perform OAuth.`); }} />)}</section>
  </>;
}

const FACETS: Array<{ id: ProfileFacetType; label: string; prompt: string }> = [
  { id: "identity", label: "Identity", prompt: "Stable non-sensitive identity context" },
  { id: "communication", label: "Communication", prompt: "Tone, language and formatting preferences" },
  { id: "working_style", label: "Working style", prompt: "How models should collaborate with you" },
  { id: "preferences", label: "Preferences", prompt: "Durable product and workflow preferences" },
  { id: "constraints", label: "Constraints", prompt: "Standing limits and important boundaries" },
  { id: "goals", label: "Goals", prompt: "Long-lived outcomes that shape decisions" },
];

function FacetEditor({ definition, facet, onSaved, onArchived }: { definition: typeof FACETS[number]; facet?: ProfileFacet; onSaved: (facet: ProfileFacet) => void; onArchived: (facet: ProfileFacet) => void }) {
  const [content, setContent] = useState(facet?.content ?? "");
  const [sensitivity, setSensitivity] = useState<ProfileFacet["sensitivity"]>(facet?.sensitivity ?? "normal");
  const [enabled, setEnabled] = useState(facet?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const archived = Boolean(facet?.archivedAt);
  async function save() {
    setSaving(true);
    try { onSaved(await api.saveProfileFacet(definition.id, { content, sensitivity, enabled: archived ? true : enabled, expectedVersion: facet?.version })); }
    finally { setSaving(false); }
  }
  return <article className={`facet-card${archived ? " facet-card--archived" : ""}`}><header><div><p className="eyebrow">{definition.id.replaceAll("_", " ")}</p><h3>{definition.label}</h3></div>{archived ? <span className="facet-status">Archived</span> : <label className="mini-toggle"><input name={`facet-${definition.id}-enabled`} type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span>{enabled ? "On" : "Off"}</span></label>}</header><p>{definition.prompt}</p><textarea name={`facet-${definition.id}-content`} aria-label={`${definition.label} content`} value={content} rows={5} maxLength={4000} onChange={(event) => setContent(event.target.value)} placeholder="Add only durable, non-secret context…" /><footer><select name={`facet-${definition.id}-sensitivity`} aria-label={`${definition.label} sensitivity`} value={sensitivity} onChange={(event) => setSensitivity(event.target.value as typeof sensitivity)}><option>normal</option><option>private</option><option>sensitive</option></select><div className="facet-actions">{facet && !archived ? <button className="danger-text" disabled={saving} onClick={() => onArchived(facet)}>Archive</button> : null}<button className="secondary-button" disabled={saving || !content.trim()} onClick={save}>{saving ? "Saving…" : archived ? "Restore facet" : facet ? "Save changes" : "Create facet"}</button></div></footer></article>;
}

export function MemoryIntelligencePanel({ onNotice }: { onNotice: (message: string) => void }) {
  const [facets, setFacets] = useState<ProfileFacet[]>([]);
  const [packs, setPacks] = useState<ContextPack[]>([]);
  const [proposals, setProposals] = useState<ReflectionProposal[]>([]);
  const [packName, setPackName] = useState("");
  const [packQuery, setPackQuery] = useState("");
  const [packMemoryLimit, setPackMemoryLimit] = useState(5);
  const [packDirectiveLimit, setPackDirectiveLimit] = useState(5);
  const [editingPack, setEditingPack] = useState<ContextPack | null>(null);
  const [selectedFacets, setSelectedFacets] = useState<ProfileFacetType[]>(["communication", "working_style", "constraints"]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void Promise.all([api.contextProfile(), api.reflection()]).then(([profile, reflection]) => { setFacets(profile.facets); setPacks(profile.packs); setProposals(reflection.proposals); }).catch(() => undefined); }, []);
  const activePacks = useMemo(() => packs.filter((pack) => !pack.archivedAt), [packs]);
  const archivedPacks = useMemo(() => packs.filter((pack) => pack.archivedAt), [packs]);
  function resetPackEditor() {
    setEditingPack(null); setPackName(""); setPackQuery(""); setPackMemoryLimit(5); setPackDirectiveLimit(5);
    setSelectedFacets(["communication", "working_style", "constraints"]);
  }
  function editPack(pack: ContextPack) {
    setEditingPack(pack); setPackName(pack.name); setPackQuery(pack.query ?? "");
    setPackMemoryLimit(pack.memoryLimit); setPackDirectiveLimit(pack.directiveLimit); setSelectedFacets(pack.facetTypes);
  }
  function replacePack(updated: ContextPack) {
    setPacks((current) => current.map((item) => item.id === updated.id ? updated : item));
  }
  async function savePack() {
    if (!packName.trim()) return;
    setBusy(true);
    try {
      const input = { name: packName, facetTypes: selectedFacets, query: packQuery.trim() || undefined, memoryLimit: packMemoryLimit, directiveLimit: packDirectiveLimit };
      if (editingPack) {
        replacePack(await api.saveContextPack(editingPack, input));
        onNotice("Context pack updated with its current version.");
      } else {
        const pack = await api.createContextPack({ ...input, scopeType: "global", memoryIds: [] });
        setPacks((current) => [...current, pack]);
        onNotice("Context pack created. It is used only when a client explicitly selects it.");
      }
      resetPackEditor();
    } catch (error) { onNotice(error instanceof Error ? error.message : "Context pack could not be saved"); }
    finally { setBusy(false); }
  }
  async function runReflection() {
    setBusy(true);
    try { const result = await api.runReflection(); setProposals(result.proposals); onNotice(`Reflection examined ${result.examined} records and changed none.`); }
    catch (error) { onNotice(error instanceof Error ? error.message : "Reflection failed"); }
    finally { setBusy(false); }
  }
  async function resolve(proposal: ReflectionProposal, action: "kept" | "dismissed" | "archive") {
    setBusy(true);
    try {
      if (action === "archive") await api.applyReflectionArchive(proposal);
      else await api.decideReflection(proposal, action);
      setProposals((current) => current.filter((item) => item.id !== proposal.id));
      onNotice(action === "archive" ? "Memory archived with version-checked proposal evidence." : `Proposal marked ${action}. Canonical memory was unchanged.`);
    } catch (error) { onNotice(error instanceof Error ? error.message : "Proposal could not be resolved"); }
    finally { setBusy(false); }
  }
  return <div className="intelligence-stack">
    <section className="platform-panel">
      <header><div><p className="eyebrow">MAINTAINED PROFILE</p><h2>Context models can understand, without a transcript dump.</h2><p>Facets are independently enabled and sensitivity classified. Sensitive facets never enter automatic briefs.</p></div><span>{facets.filter((facet) => facet.enabled && !facet.archivedAt).length} ACTIVE</span></header>
      <div className="facet-grid">{FACETS.map((definition) => {
        const facet = facets.find((item) => item.facetType === definition.id);
        return <FacetEditor
          key={`${definition.id}-${facet?.version ?? 0}`}
          definition={definition}
          facet={facet}
          onSaved={(saved) => {
            setFacets((current) => [saved, ...current.filter((item) => item.facetType !== saved.facetType)]);
            onNotice(`${definition.label} facet ${facet?.archivedAt ? "restored" : "saved"}.`);
          }}
          onArchived={(currentFacet) => {
            setBusy(true);
            void api.archiveProfileFacet(currentFacet)
              .then((archived) => { setFacets((current) => current.map((item) => item.id === archived.id ? archived : item)); onNotice(`${definition.label} facet archived.`); })
              .catch((error) => onNotice(error instanceof Error ? error.message : "Facet could not be archived"))
              .finally(() => setBusy(false));
          }}
        />;
      })}</div>
    </section>
    <section className="platform-panel">
      <header><div><p className="eyebrow">TYPED CONTEXT PACKS</p><h2>Choose the right context for the work.</h2><p>Packs select facets and bounded linked memories. They are never injected unless explicitly requested.</p></div><span>{activePacks.length} ACTIVE</span></header>
      <div className="pack-builder">
        <label>Pack name<input name="context-pack-name" value={packName} maxLength={100} onChange={(event) => setPackName(event.target.value)} placeholder="Cloud Memory development" /></label>
        <label>Retrieval query<input name="context-pack-query" value={packQuery} maxLength={500} onChange={(event) => setPackQuery(event.target.value)} placeholder="Optional bounded topic query" /></label>
        <div className="pack-limits"><label>Memories<select name="context-pack-memory-limit" value={packMemoryLimit} onChange={(event) => setPackMemoryLimit(Number(event.target.value))}>{[1, 3, 5, 8, 10].map((value) => <option key={value}>{value}</option>)}</select></label><label>Directives<select name="context-pack-directive-limit" value={packDirectiveLimit} onChange={(event) => setPackDirectiveLimit(Number(event.target.value))}>{[1, 3, 5, 8, 10].map((value) => <option key={value}>{value}</option>)}</select></label></div>
        <fieldset><legend>Include facets</legend>{FACETS.map((facet) => <label key={facet.id}><input name={`context-pack-facet-${facet.id}`} type="checkbox" checked={selectedFacets.includes(facet.id)} onChange={() => setSelectedFacets((current) => current.includes(facet.id) ? current.filter((item) => item !== facet.id) : [...current, facet.id])} />{facet.label}</label>)}</fieldset>
        <div className="platform-actions"><button className="primary-button" disabled={busy || !packName.trim()} onClick={savePack}>{editingPack ? "Save pack" : "Create global pack"}</button>{editingPack ? <button className="secondary-button" disabled={busy} onClick={resetPackEditor}>Cancel edit</button> : null}</div>
      </div>
      <div className="pack-list">{activePacks.map((pack) => <article key={pack.id}><div><strong>{pack.name}</strong><p>{pack.facetTypes.map((facet) => facet.replaceAll("_", " ")).join(" · ") || "No facets"}{pack.query ? ` · ${pack.query}` : ""}</p></div><span>{pack.enabled ? "ACTIVE" : "PAUSED"}</span><button onClick={() => editPack(pack)}>Edit</button><button onClick={() => void api.previewContextPack(pack).then((preview) => onNotice(`Preview ready: ${JSON.stringify(preview).length} bounded characters.`)).catch((error) => onNotice(error.message))}>Preview</button><button onClick={() => void api.updateContextPack(pack, !pack.enabled).then(replacePack).catch((error) => onNotice(error.message))}>{pack.enabled ? "Pause" : "Enable"}</button><button className="danger-text" onClick={() => void api.archiveContextPack(pack).then((archived) => { replacePack(archived); if (editingPack?.id === archived.id) resetPackEditor(); }).catch((error) => onNotice(error.message))}>Archive</button></article>)}</div>
      {archivedPacks.length ? <details className="archived-pack-list"><summary>{archivedPacks.length} archived pack{archivedPacks.length === 1 ? "" : "s"}</summary>{archivedPacks.map((pack) => <article key={pack.id}><div><strong>{pack.name}</strong><p>Archived context pack, excluded from briefs.</p></div><button className="secondary-button" onClick={() => void api.restoreContextPack(pack).then((restored) => { replacePack(restored); onNotice(`${restored.name} restored.`); }).catch((error) => onNotice(error.message))}>Restore</button></article>)}</details> : null}
    </section>
    <section className="platform-panel reflection-panel"><header><div><p className="eyebrow">REFLECTION / SAFE FORGETTING</p><h2>Less noise. No autonomous deletion.</h2><p>Deterministic proposals identify maintenance opportunities. Keep and dismiss never change memory; archive requires two current versions.</p></div><button className="secondary-button" disabled={busy} onClick={runReflection}>{busy ? "Scanning…" : "Run reflection"}</button></header>{proposals.length ? <div className="proposal-list">{proposals.map((proposal) => <article key={proposal.id} data-impact={proposal.impact}><div><span>{proposal.impact} impact</span><h3>{proposal.proposalType.replaceAll("_", " ")}</h3><p>{proposal.primaryMemory.summary ?? `Memory ${proposal.primaryMemoryId.slice(0, 8)}…`} · {proposal.suggestedAction}</p></div><div className="platform-actions"><button disabled={busy} onClick={() => resolve(proposal, "kept")}>Keep</button><button disabled={busy} onClick={() => resolve(proposal, "dismissed")}>Dismiss</button>{proposal.suggestedAction === "archive" ? <button className="danger-button" disabled={busy || proposal.primaryMemory.status !== "active"} onClick={() => resolve(proposal, "archive")}>Archive memory</button> : null}</div></article>)}</div> : <div className="platform-empty"><span>✓</span><p>No open reflection proposals. Running a scan never changes canonical memory.</p></div>}</section>
  </div>;
}
