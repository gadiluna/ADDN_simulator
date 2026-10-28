import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { PresentationCollection, PresentationEdge, PresentationExample, PresentationNetwork } from './presentation-types';
import './presentation.css';

const params = new URLSearchParams(location.search);
const recording = params.get('recording') === '1';
const colors = ['#2563b9', '#b56e16', '#16806f', '#8657ad', '#bf554e', '#577283'];

function edgeColor(edge: PresentationEdge) {
  if (edge.kind === 'red') return '#bb4f48';
  if (edge.highlight) return '#2466bc';
  if (edge.kind === 'black') return '#233247';
  return '#8899aa';
}

/** Explicit positions make the same small witness stable across all its steps. */
function Diagram({ network }: { network: PresentationNetwork }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const nodes = network.nodes.map((node, i) => {
    const angle = -Math.PI / 2 + i * Math.PI * 2 / network.nodes.length;
    return { ...node, px: 65 + (node.x ?? (.5 + .35 * Math.cos(angle))) * 630,
      py: 65 + (node.y ?? (.5 + .35 * Math.sin(angle))) * 300 };
  });
  const byId = new Map(nodes.map(node => [node.id, node]));
  return <figure className="presentation-network">
    <figcaption>{network.title}</figcaption>
    <svg viewBox="0 0 760 440" role="img" aria-label={network.title}>
      <defs>
        {['#bb4f48', '#2466bc', '#233247', '#8899aa'].map((color, i) => <marker key={color} id={`${id}-arrow-${i}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 1 L 9 5 L 0 9 z" fill={color} />
        </marker>)}
      </defs>
      {network.edges.map((edge, index) => {
        const from = byId.get(edge.source), to = byId.get(edge.target);
        if (!from || !to) return null;
        const color = edgeColor(edge);
        const colorIndex = ['#bb4f48', '#2466bc', '#233247', '#8899aa'].indexOf(color);
        const reciprocal = network.edges.some(other => other.source === edge.target && other.target === edge.source && other !== edge);
        const sameDirection = network.edges.filter(other => other.source === edge.source && other.target === edge.target);
        const parallelIndex = sameDirection.indexOf(edge);
        const lane = sameDirection.length > 1
          ? (reciprocal ? parallelIndex * 44 : (parallelIndex - (sameDirection.length - 1) / 2) * 44)
          : 0;
        const dx = to.px - from.px, dy = to.py - from.py;
        const length = Math.hypot(dx, dy) || 1;
        const ux = dx / length, uy = dy / length;
        const curve = (reciprocal ? 22 : 0) + lane;
        const mx = (from.px + to.px) / 2 - uy * curve;
        const my = (from.py + to.py) / 2 + ux * curve;
        const endpointOffset = (reciprocal ? 7 : 0) + lane * .2;
        const startX = from.px + ux * 30 - uy * endpointOffset;
        const startY = from.py + uy * 30 + ux * endpointOffset;
        const endX = to.px - ux * 35 - uy * endpointOffset;
        const endY = to.py - uy * 35 + ux * endpointOffset;
        const loop = from.id === to.id;
        const path = loop
          ? `M ${from.px - 18} ${from.py - 24} C ${from.px - 62 - parallelIndex * 22} ${from.py - 90 - parallelIndex * 22}, ${from.px + 62 + parallelIndex * 22} ${from.py - 90 - parallelIndex * 22}, ${from.px + 20} ${from.py - 28}`
          : `M ${startX} ${startY} Q ${mx} ${my} ${endX} ${endY}`;
        const label = edge.label ?? (edge.multiplicity && edge.multiplicity !== '1' ? `×${edge.multiplicity}` : '');
        // Put labels before the midpoint so crossing and opposite edges do not
        // all put their multiplicities at the same point.
        const t = .38;
        const labelX = (1 - t) ** 2 * startX + 2 * (1 - t) * t * mx + t ** 2 * endX - uy * 14;
        const labelY = (1 - t) ** 2 * startY + 2 * (1 - t) * t * my + t ** 2 * endY + ux * 14;
        return <g key={`${edge.source}-${edge.target}-${index}`} className="presentation-edge" data-source={edge.source} data-target={edge.target} data-kind={edge.kind ?? 'communication'}>
          <path d={path} fill="none" stroke={color} strokeWidth={edge.highlight ? 3.8 : 2.3} markerEnd={`url(#${id}-arrow-${colorIndex})`} />
          {label && <text x={loop ? from.px : labelX} y={loop ? from.py - 77 - parallelIndex * 22 : labelY} className="presentation-edge-label" fill={color} dominantBaseline="central" textAnchor="middle">{label}</text>}
        </g>;
      })}
      {nodes.map(node => <g key={node.id} className={`presentation-node ${node.muted ? 'muted' : ''}`} transform={`translate(${node.px} ${node.py})`}>
        {node.highlight && <circle r="37" fill="none" stroke="#2466bc" strokeWidth="2" opacity=".28" />}
        <circle r="29" fill={node.leader ? '#f6d491' : node.highlight ? '#dbe9fb' : '#fffdf8'} stroke={node.leader ? '#aa681c' : node.group !== undefined ? colors[node.group % colors.length] : '#324961'} strokeWidth={node.highlight || node.leader ? '3' : '2.3'} />
        <text textAnchor="middle" dominantBaseline="central" className={`presentation-node-label ${node.label.length > 7 ? 'long' : ''}`}>{node.label}</text>
        {node.detail && <text y="50" textAnchor="middle" className="presentation-node-detail">{node.detail}</text>}
      </g>)}
    </svg>
    {network.note && <p className="presentation-network-note">{network.note}</p>}
  </figure>;
}

function downloadScenario(example: PresentationExample) {
  if (!example.scenario) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(example.scenario, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${example.id}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Presentation() {
  const [collection, setCollection] = useState<PresentationCollection>();
  const [error, setError] = useState('');
  const [exampleId, setExampleId] = useState(params.get('lemma') ?? 'lemma-01');
  const [frameIndex, setFrameIndex] = useState(Math.max(0, Math.floor(Number(params.get('frame')) || 0)));
  const [playing, setPlaying] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const example = collection?.examples.find(item => item.id === exampleId) ?? collection?.examples[0];
  const safeIndex = example ? Math.min(frameIndex, example.frames.length - 1) : 0;
  const frame = example?.frames[safeIndex];

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}presentation/examples.json`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`Examples could not be loaded (${response.status}).`);
        const data = await response.json() as PresentationCollection;
        if (data.schema_version !== 1 || !data.examples?.length || data.examples.some(item => !item.frames?.length)) throw new Error('The presentation examples are invalid.');
        setCollection(data);
      }).catch(reason => { if (!controller.signal.aborted) setError(String(reason instanceof Error ? reason.message : reason)); });
    return () => controller.abort();
  }, []);

  const move = useCallback((delta: number) => {
    setPlaying(false);
    if (example) setFrameIndex(current => Math.max(0, Math.min(example.frames.length - 1, current + delta)));
  }, [example]);

  useEffect(() => {
    if (!example) return;
    const url = new URL(location.href);
    url.searchParams.set('lemma', example.id);
    url.searchParams.set('frame', String(safeIndex));
    history.replaceState(null, '', url);
  }, [example, safeIndex]);

  useEffect(() => {
    if (!playing || !example || !frame) return;
    const timer = setTimeout(() => {
      if (safeIndex >= example.frames.length - 1) setPlaying(false);
      else setFrameIndex(safeIndex + 1);
    }, Math.max(1, frame.duration) * 1000);
    return () => clearTimeout(timer);
  }, [playing, example, frame, safeIndex]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('select,input,textarea,button,a,summary')) return;
      if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
      else if (event.key === ' ') { event.preventDefault(); setPlaying(value => !value); }
      else if (event.key === 'Home') { event.preventDefault(); setPlaying(false); setFrameIndex(0); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [move]);

  if (!collection || !example || !frame) return <main className="presentation-root"><p className="presentation-loading" role={error ? 'alert' : 'status'}>{error || 'Loading illustrations…'}</p></main>;
  const hasLeaders = frame.networks.some(network => network.nodes.some(node => node.leader));
  const hasAncestry = frame.networks.some(network => network.edges.some(edge => edge.kind === 'black'));
  const hasMessages = frame.networks.some(network => network.edges.some(edge => edge.kind === 'red'));

  return <main className={`presentation-root${recording ? ' is-recording' : ''}`}>
    {!recording && <nav className="presentation-toolbar" aria-label="Presentation controls">
      <a href={import.meta.env.BASE_URL} className="presentation-back">← Simulator</a>
      <select aria-label="Choose lemma" value={example.id} onChange={event => { setExampleId(event.target.value); setFrameIndex(0); setPlaying(false); }}>
        {collection.examples.map(item => <option key={item.id} value={item.id}>{item.id === 'lower-bound' ? 'Bonus' : `Lemma ${item.number}`} · {item.title}</option>)}
      </select>
      <div className="presentation-transport">
        <button aria-label="Previous step" onClick={() => move(-1)} disabled={safeIndex === 0}>←</button>
        <button className="presentation-play" aria-label={playing ? 'Pause illustration' : 'Play illustration'} onClick={() => { if (safeIndex === example.frames.length - 1 && !playing) setFrameIndex(0); setPlaying(value => !value); }}>{playing ? 'Pause' : 'Play'}</button>
        <button aria-label="Next step" onClick={() => move(1)} disabled={safeIndex === example.frames.length - 1}>→</button>
        <button aria-label="Restart illustration" onClick={() => { setPlaying(false); setFrameIndex(0); }}>↺</button>
      </div>
      <button className="presentation-fullscreen" onClick={() => { void stageRef.current?.requestFullscreen().catch(() => setError('Full screen is unavailable in this browser.')); }}>Full screen</button>
    </nav>}
    {error && <p role="alert" className="presentation-inline-error">{error}</p>}
    <div className="presentation-stage" data-testid="presentation-stage" data-frame={safeIndex} data-example={example.id} ref={stageRef}>
      <header className="presentation-heading">
        <p className="presentation-kicker">{example.id === 'lower-bound' ? 'Termination lower bound' : `Lemma ${String(example.number).padStart(2, '0')}`}<span>{example.section}</span></p>
        <h1>{example.title}</h1>
        <div className="presentation-step-heading"><h2>{frame.title}</h2>{frame.round !== undefined && <span>Round {frame.round}</span>}</div>
      </header>
      <div className={`presentation-diagrams count-${frame.networks.length}`}>
        {frame.networks.map((network, index) => <Diagram key={index} network={network} />)}
      </div>
      {frame.metrics && frame.metrics.length > 0 && <dl className="presentation-metrics">{frame.metrics.map((metric, i) => <div key={i}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>)}</dl>}
      <div className="presentation-caption" aria-live={recording ? 'off' : 'polite'}><p>{frame.caption}</p></div>
      <footer className="presentation-stage-footer">
        <span>{example.kind === 'execution' ? 'Execution illustration' : 'Construction illustration'} · Observer knowledge</span>
        <span className="presentation-legend">{hasLeaders && <span><i className="leader" />Leader</span>}{hasAncestry && <span><i className="ancestry" />Parent</span>}{hasMessages && <span><i className="message" />Message</span>}</span>
        <span className="presentation-step-count">{safeIndex + 1} / {example.frames.length}</span>
      </footer>
      <div className="presentation-progress" aria-hidden="true"><span style={{ width: `${(safeIndex + 1) / example.frames.length * 100}%` }} /></div>
    </div>
    {!recording && <div className="presentation-below">
      <details className="presentation-notes"><summary>Proof connection and checked facts</summary><p>{example.proof_note}</p><ul>{example.checks.map((check, i) => <li key={i}>{check}</li>)}</ul><small>Source: {example.label} · Paper SHA-256: {collection.paper_sha256.slice(0, 12)}</small></details>
      {example.scenario && <button onClick={() => downloadScenario(example)}>Download simulator scenario</button>}
      <span className="presentation-shortcuts">← → Steps · Space Play / pause</span>
    </div>}
  </main>;
}
