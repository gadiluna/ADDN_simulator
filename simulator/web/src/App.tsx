import { useCallback, useEffect, useRef, useState } from 'react';
import Graph from './Graph';
import MathDetails from './MathDetails';
import PaperText from './PaperText';
import SplitWorkspace from './SplitWorkspace';
import { exportJSON, presets, randomScenario, validateScenario } from './scenarios';
import type { EngineResponse, Phase, Scenario, Snapshot } from './types';
import './paper-ui.css';

const phases: { id: Phase; number: string; title: string; explanation: string }[] = [
  { id: 'send', number: '01', title: 'Send', explanation: 'In round t, every active agent x broadcasts its previous state s_(t−1)(x), represented by its vista, on each outgoing arc.' },
  { id: 'receive', number: '02', title: 'Receive', explanation: 'Agent x receives the multiset I_t(x), then learns its outdegree d_t^+(x). Parallel arcs preserve multiplicity; sender identities are unavailable.' },
  { id: 'view', number: '03', title: 'Update the vista', explanation: 'Match and merge the previous vista with the received vistas, then add the new bottom node, its black parent edge labeled d_t(v), and the red edges labeled μ_t(u,v).' },
  { id: 'decision', number: '04', title: 'Test & decide', explanation: 'At round 2m − 1, test m ≥ ℓ using the prefix through 𝓛_m. If all five checks pass, output m and halt. Halted agents become silent.' },
];

function Icon({ name, size = 18 }: { name: 'play' | 'pause' | 'step' | 'reset' | 'download' | 'upload' | 'code' | 'arrow' | 'close' | 'chevron'; size?: number }) {
  const paths: Record<typeof name, React.ReactNode> = {
    play: <path d="m8 5 10 7-10 7Z" />,
    pause: <><path d="M8 5v14M16 5v14" /></>,
    step: <><path d="m5 5 10 7-10 7ZM19 5v14" /></>,
    reset: <><path d="M4 10a8 8 0 1 1 1 7M4 4v6h6" /></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></>,
    upload: <><path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5" /></>,
    code: <><path d="m7 7-5 5 5 5m10-10 5 5-5 5m-4-14-2 18" /></>,
    arrow: <><path d="M4 12h16m-6-6 6 6-6 6" /></>,
    close: <><path d="m6 6 12 12M6 18 18 6" /></>,
    chevron: <path d="m9 5 7 7-7 7" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function ScenarioEditor({ scenario, onClose, onApply }: { scenario: Scenario; onClose: () => void; onApply: (scenario: Scenario) => void }) {
  const [text, setText] = useState(JSON.stringify(scenario, null, 2));
  const [error, setError] = useState('');
  const [previewRound, setPreviewRound] = useState(0);
  const [edgeText, setEdgeText] = useState('');
  const [tab, setTab] = useState<'json' | 'round'>('round');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const parse = () => validateScenario(JSON.parse(text));
  let parsed: Scenario | null = null;
  try { parsed = parse(); } catch { /* Validation is shown when the user checks or applies. */ }
  const roundScenario = parsed ?? scenario;
  const round = Math.min(previewRound, roundScenario.rounds.length - 1);
  const switchRound = (r: number) => { setPreviewRound(r); setEdgeText(''); setError(''); };
  const saveEdges = () => {
    try {
      const current = parse();
      const edges = JSON.parse(edgeText || JSON.stringify(current.rounds[round].edges));
      current.rounds[round] = { edges };
      const validated = validateScenario(current);
      setText(JSON.stringify(validated, null, 2)); setEdgeText(''); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const apply = () => {
    try {
      const current = parse();
      if (tab === 'round' && edgeText) current.rounds[round] = { edges: JSON.parse(edgeText) };
      onApply(validateScenario(current));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return <dialog ref={dialog} className="scenario-dialog" aria-labelledby="scenario-editor-title" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="dialog-header"><div><span className="eyebrow">SCENARIO WORKSPACE</span><h2 id="scenario-editor-title">Make the network your own.</h2></div><button className="icon-button" aria-label="Close scenario editor" onClick={onClose}><Icon name="close" /></button></div>
    <div className="editor-tabs"><button className={tab === 'round' ? 'active' : ''} onClick={() => { setTab('round'); setError(''); }}>Round topologies</button><button className={tab === 'json' ? 'active' : ''} onClick={() => { if (edgeText) { saveEdges(); } setTab('json'); }}>Full scenario JSON</button></div>
    {tab === 'round' ? <div className="round-editor"><div className="round-editor-top"><label>Topology for round <select aria-label="Topology round" value={round} onChange={event => switchRound(Number(event.target.value))}>{roundScenario.rounds.map((_, i) => <option key={i} value={i}>{i + 1}</option>)}</select></label><button className="quiet-button" onClick={() => { try { const current = parse(); current.rounds.push(structuredClone(current.rounds[round])); setText(JSON.stringify(current, null, 2)); switchRound(current.rounds.length - 1); } catch (e) { setError(String(e)); } }}>+ Duplicate topology</button></div><p className="editor-hint">Edit directed edges below. Multiplicities are exact decimal strings. Every round must remain strongly connected.</p><textarea spellCheck={false} aria-label="Round edges JSON" value={edgeText || JSON.stringify(roundScenario.rounds[round].edges, null, 2)} onChange={event => setEdgeText(event.target.value)} /><button className="quiet-button" onClick={saveEdges}>Validate & save this topology</button></div> : <><p className="editor-hint">Imported networks run the core algorithm (§4.1). Agent IDs start at 0; ℓ is the length of leaders.</p><textarea className="full-json" spellCheck={false} aria-label="Scenario JSON" value={text} onChange={event => setText(event.target.value)} /></>}
    {error && <div className="editor-error" role="alert">{error}</div>}
    <div className="dialog-footer"><span>Applying starts a new core execution (§4.1).</span><button className="primary-button" onClick={apply}>Apply scenario <Icon name="arrow" /></button></div>
  </dialog>;
}

export default function App() {
  const [scenario, setScenario] = useState<Scenario>(() => structuredClone(presets[0].scenario));
  const [preset, setPreset] = useState('cycle');
  const [randomSize, setRandomSize] = useState('12');
  const [randomLeaders, setRandomLeaders] = useState('1');
  const [restart, setRestart] = useState(0);
  const [timeline, setTimeline] = useState<Snapshot[]>([]);
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState(0);
  const [selectedNode, setSelectedNode] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(900);
  const [phase, setPhase] = useState<Phase>('decision');
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [observer, setObserver] = useState(false);
  const [busy, setBusy] = useState(true);
  const [engineReady, setEngineReady] = useState(false);
  const [engineError, setEngineError] = useState('');
  const [importError, setImportError] = useState('');
  const [importNotice, setImportNotice] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  const optionsButton = useRef<HTMLButtonElement>(null);
  const requestID = useRef(0);
  const current = timeline[cursor];
  const agent = current?.agents.find(agent => agent.id === selected);
  const round = current?.round ?? 0;
  const exhausted = !scenario.repeat_last && round >= scenario.rounds.length && !current?.complete;
  const ell = scenario.leaders.length;
  const historyNode = current?.nodes.find(node => node.id === selectedNode);

  useEffect(() => {
    const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    setTimeline([]); setCursor(0); setBusy(true); setEngineReady(false); setEngineError(''); setPlaying(false); setSelectedNode(null);
    let alive = true;
    worker.onmessage = (event: MessageEvent<EngineResponse>) => {
      if (!alive) return;
      setBusy(false);
      if (!event.data.ok) { setEngineError(event.data.error); setPlaying(false); return; }
      const snapshot = event.data.snapshot;
      if (!snapshot) return;
      setEngineReady(true); setEngineError('');
      setTimeline(previous => event.data.id === 0 ? [snapshot] : previous.at(-1)?.round === snapshot.round ? previous : [...previous, snapshot]);
      setCursor(snapshot.round);
      if (snapshot.complete || !scenario.repeat_last && snapshot.round >= scenario.rounds.length) setPlaying(false);
    };
    worker.onerror = (event) => { if (alive) { setBusy(false); setPlaying(false); setEngineError(`The engine worker stopped: ${event.message || 'reload to retry.'}`); } };
    worker.postMessage({ id: 0, command: 'load', scenario });
    return () => { alive = false; worker.terminate(); workerRef.current = null; };
  }, [scenario, restart]);

  const step = useCallback(() => {
    if (busy || !engineReady) return;
    setSelectedNode(null);
    if (cursor < timeline.length - 1) { setCursor(cursor + 1); return; }
    if (current?.complete || exhausted) { setPlaying(false); return; }
    setBusy(true);
    workerRef.current?.postMessage({ id: ++requestID.current, command: 'step' });
  }, [busy, engineReady, cursor, timeline.length, current?.complete, exhausted]);

  useEffect(() => {
    if (!playing || busy) return;
    const timer = setTimeout(step, speed);
    return () => clearTimeout(timer);
  }, [playing, busy, speed, step]);

  useEffect(() => {
    if (!optionsOpen) return;
    const outside = (event: PointerEvent) => {
      if (!optionsRef.current?.contains(event.target as Node)) setOptionsOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [optionsOpen]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.code === 'Escape' && !editorOpen) {
        if (optionsOpen) { setOptionsOpen(false); optionsButton.current?.focus(); }
        setGuideOpen(false);
        return;
      }
      if (editorOpen || event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target instanceof Element ? event.target : null;
      // Let native controls and their descendants keep their own keyboard actions.
      if (target?.closest('input, textarea, select, button, summary, a[href], [contenteditable]:not([contenteditable="false"]), [role="button"], [role="slider"], [role="separator"], [role="combobox"], [role="listbox"]')) return;
      if (event.repeat && event.code === 'Space') return;
      if (event.code === 'Space' && engineReady && !busy) { event.preventDefault(); setPlaying(value => !value); }
      if (event.code === 'ArrowRight') { event.preventDefault(); setPlaying(false); step(); }
      if (event.code === 'ArrowLeft') { event.preventDefault(); setPlaying(false); setCursor(value => Math.max(0, value - 1)); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [editorOpen, optionsOpen, engineReady, busy, step]);

  const loadScenario = (next: Scenario, id = 'custom') => { setTimeline([]); setCursor(0); setEngineReady(false); setBusy(true); setPlaying(false); setEngineError(''); setScenario(next); setPreset(id); setSelected(presets.find(item => item.id === id)?.designatedAgent ?? next.leaders[0]); setSelectedNode(null); setImportError(''); setImportNotice(''); setEditorOpen(false); setDetailsOpen(false); setOptionsOpen(false); setGuideOpen(false); };
  const generateRandom = () => {
    const n = Number(randomSize);
    const leaders = Number(randomLeaders);
    if (!Number.isInteger(n) || n < 1 || n > 128) return;
    if (!Number.isInteger(leaders) || leaders < 1 || leaders > n) return;
    const seed = crypto.getRandomValues(new Uint32Array(1))[0].toString();
    loadScenario(randomScenario(n, seed, leaders), 'random');
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 30 * 1024 * 1024) throw new Error('Choose a scenario file smaller than 30 MB.');
      const input = JSON.parse(await file.text());
      loadScenario(validateScenario(input));
      if ((input.scenario ?? input).variant === 'sharp') setImportNotice('Imported network now runs the core algorithm (§4.1).');
    }
    catch (error) { setImportError(error instanceof Error ? error.message : String(error)); }
    if (fileInput.current) fileInput.current.value = '';
  };
  const selectAgent = (id: number) => { setSelected(id); setSelectedNode(null); setDetailsOpen(true); setOptionsOpen(false); };

  const finished = (!!current?.complete || exhausted) && cursor === timeline.length - 1;
  const designatedAgent = presets.find(item => item.id === preset)?.designatedAgent;
  const graphProps = { layoutKey: detailsOpen ? 'inspector' : 'network', scenario, snapshot: current, previousSnapshot: timeline[cursor - 1], selected, observer, onSelect: selectAgent, onNodeSelect: (id: number) => { setSelectedNode(id); setDetailsOpen(true); } };

  return <div className="app-shell">
    <header className={`app-header ${preset === 'random' ? 'has-random' : ''}`}>
      <div className="brand"><div className="brand-mark" aria-hidden="true"><svg viewBox="0 0 28 28"><path d="M5 20 14 5l9 15H5Z" /><circle cx="14" cy="5" r="3" /><circle cx="5" cy="20" r="3" /><circle cx="23" cy="20" r="3" /></svg></div><h1>Counting</h1></div>
      <select className="scenario-picker" aria-label="Example scenario" value={preset} onChange={event => {
        if (event.target.value === 'random') {
          const size = Number(randomSize);
          const n = Number.isInteger(size) && size >= 1 && size <= 128 ? size : 12;
          const count = Number(randomLeaders);
          const leaders = Number.isInteger(count) && count >= 1 ? Math.min(count, n) : 1;
          setRandomSize(String(n));
          setRandomLeaders(String(leaders));
          loadScenario(randomScenario(n, crypto.getRandomValues(new Uint32Array(1))[0].toString(), leaders), 'random');
          return;
        }
        const item = presets.find(item => item.id === event.target.value);
        if (item) loadScenario(structuredClone(item.scenario), item.id);
      }}>
        {presets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        <option value="random">Random</option>
        {preset === 'custom' && <option value="custom">{scenario.name || 'Custom network'}</option>}
      </select>
      {preset === 'random' && <form className="random-controls" onSubmit={event => { event.preventDefault(); generateRandom(); }}>
        <label>Agents<input aria-label="Number of agents" type="number" min="1" max="128" step="1" required value={randomSize} onChange={event => {
          setRandomSize(event.target.value);
          const n = Number(event.target.value);
          if (Number.isInteger(n) && n >= 1 && n <= 128 && Number(randomLeaders) > n) setRandomLeaders(String(n));
        }} /></label>
        <label>Leaders<input aria-label="Number of leaders" type="number" min="1" max={Number(randomSize) >= 1 && Number(randomSize) <= 128 ? Number(randomSize) : 128} step="1" required value={randomLeaders} onChange={event => setRandomLeaders(event.target.value)} /></label>
        <button className="quiet-button" type="submit" aria-label="Generate random network">Generate</button>
      </form>}
      <span className="sr-only engine-status" role="status">{engineReady ? 'Ready' : engineError ? 'Engine unavailable' : 'Loading engine…'}</span>
      <div className="options-wrap" ref={optionsRef}>
        <button ref={optionsButton} className="quiet-button" aria-expanded={optionsOpen} aria-controls="simulation-options" onClick={() => setOptionsOpen(value => !value)}>Options</button>
        {optionsOpen && <div id="simulation-options" className="options-popover" aria-label="Simulation options">
          <div className="network-counts">{scenario.n} agents · {ell} {ell === 1 ? 'leader' : 'leaders'}</div>
          <button className="option-action" aria-label="Edit scenario" onClick={() => { setOptionsOpen(false); setEditorOpen(true); }}><Icon name="code" />Edit network</button>
          <button className="option-action" aria-label="Import JSON" onClick={() => { setOptionsOpen(false); fileInput.current?.click(); }}><Icon name="upload" />Import scenario</button>
          <button className="option-action" aria-label="Export scenario" onClick={() => { exportJSON(scenario, 'counting-scenario.json'); setOptionsOpen(false); }}><Icon name="download" />Export scenario</button>
          <button className="option-action" disabled={!timeline.length} onClick={() => { exportJSON({ schema_version: 1, scenario, snapshots: timeline }, 'counting-trace.json'); setOptionsOpen(false); }}><Icon name="download" />Export recorded trace</button>
          <div className="option-settings"><label>Speed<select value={speed} onChange={event => setSpeed(Number(event.target.value))} aria-label="Playback speed"><option value={1800}>0.5×</option><option value={900}>1×</option><option value={450}>2×</option><option value={160}>5×</option></select></label>
          <label className="observer-toggle"><input type="checkbox" checked={observer} onChange={event => setObserver(event.target.checked)} />Observer overlay</label></div>
          <button className="option-action" onClick={() => { setOptionsOpen(false); setGuideOpen(true); }}>Help & legend</button>
        </div>}
      </div>
      <input ref={fileInput} className="sr-only" type="file" aria-label="Import scenario file" accept=".json,application/json" onChange={event => void importFile(event.target.files?.[0])} />
    </header>
    {importNotice && <div className="scenario-notice" role="status">{importNotice}<button className="icon-button" aria-label="Dismiss import notice" onClick={() => setImportNotice('')}><Icon name="close" /></button></div>}
    {importError && <div className="editor-error top-error" role="alert">{importError}<button aria-label="Dismiss error" onClick={() => setImportError('')}><Icon name="close" /></button></div>}

    <SplitWorkspace open={detailsOpen}>
      <section className="experiment-panel" aria-label="Simulation workspace">
        <div className="graph-stage">
          <Graph {...graphProps} designatedAgent={designatedAgent} animate={engineReady && round > 0 && playing} mode="network" />
          {observer && <div className="observer-banner">Observer knowledge · unavailable to the algorithm</div>}
          {!engineReady && !engineError && <div className="canvas-loading">Loading simulation…</div>}
        </div>
        {engineError && <div className="engine-error" role="alert"><strong>{engineReady ? 'Execution stopped' : 'Engine unavailable'}</strong><p>{engineError}</p><button className="quiet-button" onClick={() => setRestart(value => value + 1)}>Retry</button></div>}
        {exhausted && <div className="sequence-exhausted" role="status"><strong>Execution incomplete: the topology sequence is exhausted.</strong><button className="quiet-button" onClick={() => setEditorOpen(true)}>Edit sequence</button></div>}
        <div className="playback">
          <div className="transport"><button className="icon-button" aria-label="Restart execution" title="Restart" disabled={busy} onClick={() => setRestart(value => value + 1)}><Icon name="reset" /></button><button className="play-button" aria-label={playing ? 'Pause execution' : 'Play execution'} disabled={!engineReady || busy || finished} onClick={() => setPlaying(value => !value)}><Icon name={playing ? 'pause' : 'play'} /><span>{playing ? 'Pause' : 'Play'}</span></button><button className="icon-button" aria-label="Advance one round" title="Next round" disabled={!engineReady || busy || finished} onClick={() => { setPlaying(false); step(); }}><Icon name="step" /></button></div>
          <div className="round-counter"><span>Round</span><strong data-testid="round-number">{round.toString().padStart(2, '0')}</strong></div>
          <div className="scrubber"><label htmlFor="timeline" className="sr-only">Recorded round</label><input id="timeline" type="range" min="0" max={Math.max(0, timeline.length - 1)} value={cursor} disabled={!engineReady || busy || timeline.length < 2} onChange={event => { setPlaying(false); setCursor(Number(event.target.value)); setSelectedNode(null); }} /></div>
          {current?.complete && <span className="completion-tag" role="status">COMPLETE</span>}
        </div>
      </section>

      {detailsOpen && <aside id="agent-inspector" className="inspector-panel" aria-label="Agent inspector">
        <div className="inspector-title"><h2>Agent {selected}</h2><span className={`agent-type ${scenario.leaders.includes(selected) ? 'leader' : ''}`}>{scenario.leaders.includes(selected) ? 'Leader' : 'Nonleader'}</span><button className="icon-button" aria-label="Close agent details" onClick={() => setDetailsOpen(false)}><Icon name="close" /></button></div>
        <div className="inspector-content">
          <div className="local-history"><span className="local-heading"><PaperText>{`Vista 𝓥_${round}`}</PaperText></span><Graph {...graphProps} animate={false} mode="view" /></div>
          <div className="agent-properties"><div><span>Status</span><strong>{agent ? agent.halted ? 'Halted' : 'Active' : 'Not started'}</strong></div><div><span><PaperText>{`Output o_${round}(x${selected})`}</PaperText></span><strong title={agent?.output == null ? 'No output' : undefined} className={agent?.output !== null && agent?.output !== undefined ? 'output-value' : ''}>{agent?.output ?? '⊥'}</strong></div></div>
          <details className="math-details"><summary>Mathematical details</summary>
            <MathDetails audit={agent?.audit} round={round} variant={scenario.variant} ell={ell} nodes={current?.nodes ?? []} visibleNodes={agent?.visible_nodes ?? []} halted={agent?.halted} onNodeSelect={graphProps.onNodeSelect} />
          </details>
          {historyNode && <div className="node-inspector"><h3><PaperText>{`History node v${historyNode.id}`}</PaperText></h3><dl><dt>Level</dt><dd><PaperText>{`𝓛_${historyNode.level}`}</PaperText></dd><dt>Type</dt><dd>{historyNode.level < 0 ? 'Root' : historyNode.leader ? 'Leader node' : 'Nonleader node'}</dd><dt><PaperText>{historyNode.level < 1 ? 'Outdegree' : `Outdegree d_${historyNode.level}(v${historyNode.id})`}</PaperText></dt><dd>{historyNode.level < 1 ? '—' : historyNode.outdegree}</dd><dt>Parent</dt><dd><PaperText>{historyNode.parent === null ? '—' : `v${historyNode.parent}`}</PaperText></dd></dl>{observer && <div className="fiber-note"><strong>Observer only · unavailable to the agent</strong><p><PaperText>{`A(v${historyNode.id}) = {${historyNode.fiber.map(id => `x${id}`).join(', ')}}`}</PaperText></p><p><PaperText>{`a(v${historyNode.id}) = |A(v${historyNode.id})| = ${historyNode.fiber.length}`}</PaperText></p></div>}</div>}
        </div>
      </aside>}
    </SplitWorkspace>

    {guideOpen && <div className="guide-popover" role="dialog" aria-label="Simulation help"><div className="dialog-header"><h2>Help</h2><button className="icon-button" aria-label="Close help" onClick={() => setGuideOpen(false)}><Icon name="close" /></button></div>
      <p><PaperText>{'Core algorithm (§4.1): test m ≥ ℓ at round 2m − 1, using the prefix through 𝓛_m. Imported networks use this schedule too.'}</PaperText></p>
      <p>Click an agent to see its vista, shaded green. Drag nodes to move them; scroll or pinch to zoom.</p>
      <div className="help-legend"><span><i className="legend-dot leader" />Leader</span><span><i className="legend-dot" />{designatedAgent === undefined ? 'Nonleader' : 'Vista nonleader'}</span>{designatedAgent !== undefined && <><span><i className="legend-dot bound-nonleader" />Network nonleader</span><span><i className="legend-dot designated" /><PaperText>{`Designated leader x${designatedAgent}`}</PaperText></span></>}<span><i className="legend-dot halted" />Halted</span><span><i className="legend-line" /><PaperText>{'Black: d_r(v)'}</PaperText></span><span><i className="legend-line red" /><PaperText>{'Red: μ_r(u,v)'}</PaperText></span></div>
      <p>Network edge labels are arc multiplicities; labels equal to 1 are omitted.</p>
      <p><PaperText>{'In the vista, black and red edges point away from the root; labels equal to 1 are omitted. Black edges from the root have no outdegree label.'}</PaperText></p>
      <p><PaperText>{'Labels x0, x1, … identify physical agents only for the observer; v0, v1, … identify history nodes. The observer overlay adds the corresponding node and actual anonymity a(v), with fibre A(v) in node details. These are unavailable to the agents.'}</PaperText></p>
      <div className="phase-buttons">{phases.map(item => <button key={item.id} className={phase === item.id ? 'active' : ''} onClick={() => setPhase(item.id)}>{item.title}</button>)}</div><p><PaperText>{phases.find(item => item.id === phase)?.explanation ?? ''}</PaperText></p><p className="shortcuts">Space: play / pause · ← / →: previous / next round. Focus the graph and press Enter to inspect; ↑ / ↓ select agents.</p><p><a href={`${import.meta.env.BASE_URL}licenses/index.html`} target="_blank" rel="noreferrer">Third-party licenses</a></p></div>}
    {editorOpen && <ScenarioEditor scenario={scenario} onClose={() => setEditorOpen(false)} onApply={next => loadScenario(next)} />}
  </div>;
}
