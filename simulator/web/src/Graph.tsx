import { useEffect, useId, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import type { Core, ElementDefinition, Position, StylesheetStyle } from 'cytoscape';
import { graphAt } from './scenarios';
import { networkPositions } from './graph-layout';
import type { Scenario, Snapshot } from './types';

interface GraphProps {
  scenario: Scenario;
  snapshot: Snapshot | undefined;
  previousSnapshot?: Snapshot;
  selected: number;
  observer: boolean;
  animate: boolean;
  mode: 'network' | 'view';
  designatedAgent?: number;
  layoutKey?: string;
  onSelect: (id: number) => void;
  onNodeSelect: (id: number) => void;
}

// Node outlines are supported by Cytoscape 3.33, but are not yet included in
// its bundled TypeScript declarations. Keep the paper's designation ring
// independent of the node border used for selection and halting.
const designatedOutline = { 'outline-color': '#15803d', 'outline-width': 3, 'outline-offset': 4, 'outline-opacity': 1 };

const style: StylesheetStyle[] = [
  { selector: 'node', style: { 'background-color': '#ffffff', 'border-width': 2, 'border-color': '#64748b', width: 52, height: 52, label: 'data(label)', color: '#172033', 'font-family': 'system-ui, sans-serif', 'font-size': 14, 'font-weight': 600, 'text-valign': 'center', 'text-halign': 'center', 'text-wrap': 'wrap', 'text-max-width': '1000px', 'overlay-opacity': 0, 'text-outline-width': 0 } },
  { selector: 'node.leader', style: { 'background-color': '#dbeafe', 'border-color': '#2563eb', 'border-width': 2.5, color: '#17355c' } },
  { selector: 'node.lower-bound-nonleader', style: { 'background-color': '#fef3c7' } },
  { selector: 'node.designated', style: { ...designatedOutline } },
  { selector: 'node.observer-anonymity', style: { 'font-size': 11 } },
  { selector: 'node.halted', style: { 'border-color': '#475569', 'border-width': 5, 'border-style': 'double' } },
  { selector: 'node.focused', style: { 'border-width': 4, 'border-color': '#2563eb', 'underlay-color': '#2563eb', 'underlay-opacity': 0.1, 'underlay-padding': 9 } },
  { selector: 'node.anchor', style: { 'border-color': '#2563eb', 'border-width': 3 } },
  { selector: 'node.bottom', style: { 'border-color': '#2563eb', 'border-width': 3 } },
  { selector: 'node.keyboard-focused', style: { 'border-color': '#7c3aed', 'border-width': 4, 'underlay-color': '#7c3aed', 'underlay-opacity': 0.12, 'underlay-padding': 8 } },
  { selector: 'edge', style: { width: 2, 'line-color': '#7c8da5', 'target-arrow-color': '#52647c', 'target-arrow-shape': 'triangle', 'arrow-scale': 1, 'curve-style': 'bezier', 'control-point-step-size': 42, 'loop-direction': '-45deg', 'loop-sweep': '70deg', label: 'data(label)', 'font-size': 14, 'font-family': 'system-ui, sans-serif', color: '#334155', 'text-background-color': '#ffffff', 'text-background-opacity': 0.95, 'text-background-padding': '4px', 'text-rotation': 'autorotate', 'overlay-opacity': 0 } },
  { selector: 'edge.black', style: { 'line-color': '#172033', 'target-arrow-color': '#172033', 'curve-style': 'straight', width: 2.2 } },
  { selector: 'edge.red', style: { 'line-color': '#dc4d50', 'target-arrow-color': '#dc4d50', 'curve-style': 'bezier', width: 1.8, color: '#b91c1c' } },
  { selector: 'edge.silent', style: { opacity: 0.25 } },
  { selector: 'edge.context-edge', style: { opacity: 0.22, 'text-opacity': 0 } },
];

const indexedLabel = (symbol: 'x' | 'v', id: number) => symbol + String(id).replace(/\d/g, digit => '₀₁₂₃₄₅₆₇₈₉'[Number(digit)]);

function makeElements({ scenario, snapshot, previousSnapshot, selected, observer, mode, designatedAgent }: GraphProps, focusConnections: boolean): ElementDefinition[] {
  if (mode === 'view') {
    if (!snapshot) return [];
    const agent = snapshot.agents.find(a => a.id === selected);
    if (!agent) return [];
    const visible = new Set(agent.visible_nodes);
    const nodes = snapshot.nodes.filter(n => visible.has(n.id));
    const levels = [...new Set(nodes.map(n => n.level))].sort((a, b) => a - b);
    const elements: ElementDefinition[] = [];
    for (const level of levels) {
      const row = nodes.filter(n => n.level === level);
      row.forEach((node, i) => elements.push({
        data: { id: `v${node.id}`, label: node.level < 0 ? 'Root' : `${indexedLabel('v', node.id)}${observer ? `\na(v)=${node.fiber.length}` : ''}` },
        position: { x: (i - (row.length - 1) / 2) * 92, y: level * 100 },
        classes: [node.leader ? 'leader' : '', observer ? 'observer-anonymity' : '', node.id === agent.bottom ? 'bottom' : '', node.level === agent.audit.anchor ? 'anchor' : ''].join(' '),
      }));
    }
    for (const node of nodes) {
      // Root edges carry no outdegree: d_r(v) is defined only for r >= 1.
      // The figure in the paper omits unit labels on both edge types.
      if (node.parent !== null && visible.has(node.parent)) elements.push({ data: { id: `b${node.id}`, source: `v${node.parent}`, target: `v${node.id}`, label: node.level >= 1 && node.outdegree !== '1' ? node.outdegree : '' }, classes: 'black' });
      node.incoming.forEach((incoming, i) => {
        if (visible.has(incoming.source)) elements.push({ data: { id: `r${node.id}-${i}`, source: `v${incoming.source}`, target: `v${node.id}`, label: incoming.multiplicity === '1' ? '' : incoming.multiplicity }, classes: 'red' });
      });
    }
    return elements;
  }
  const layout = networkPositions(scenario);
  const elements: ElementDefinition[] = Array.from({ length: scenario.n }, (_, id) => {
    const a = snapshot?.agents.find(a => a.id === id);
    return {
      data: { id: `a${id}`, label: `${indexedLabel('x', id)}${observer && a ? `\n${indexedLabel('v', a.bottom)}` : ''}` },
      position: layout[id],
      classes: [scenario.leaders.includes(id) ? 'leader' : designatedAgent !== undefined ? 'lower-bound-nonleader' : '', id === designatedAgent ? 'designated' : '', a?.halted ? 'halted' : '', id === selected ? 'focused' : ''].join(' '),
    };
  });
  const edges = snapshot?.graph?.edges ?? graphAt(scenario, snapshot?.round ? snapshot.round - 1 : 0);
  // Graph rendering can combine parallel edges; multiplicities remain exact decimal integers.
  const grouped = new Map<string, { source: number; target: number; count: bigint }>();
  for (const edge of edges) {
    const key = `${edge.source}-${edge.target}`;
    const existing = grouped.get(key);
    if (existing) existing.count += BigInt(edge.multiplicity);
    else grouped.set(key, { source: edge.source, target: edge.target, count: BigInt(edge.multiplicity) });
  }
  for (const [key, edge] of grouped) {
    const senderHaltedBeforeRound = previousSnapshot?.agents.find(a => a.id === edge.source)?.halted;
    elements.push({ data: { id: `e${key}`, source: `a${edge.source}`, target: `a${edge.target}`, label: edge.count === 1n ? '' : String(edge.count) }, classes: [senderHaltedBeforeRound ? 'silent' : '', focusConnections && edge.source !== selected && edge.target !== selected ? 'context-edge' : ''].join(' ') });
  }
  return elements;
}

export default function Graph(props: GraphProps) {
  const { scenario, snapshot, previousSnapshot, selected, observer, mode, layoutKey, designatedAgent } = props;
  const descriptionID = useId();
  const [keyboardActive, setKeyboardActive] = useState(false);
  const [historyCursor, setHistoryCursor] = useState<{ scenario: Scenario; selected: number; id: number } | null>(null);
  // Highlighting is opt-in and belongs to one scenario. A new network always
  // starts with every arc prominent, even when its first graph is dense.
  const [highlightedScenario, setHighlightedScenario] = useState<Scenario | null>(null);
  const agent = snapshot?.agents.find(agent => agent.id === selected);
  const visibleIDs = new Set(agent?.visible_nodes);
  const historyNodes = mode === 'view' ? (snapshot?.nodes.filter(node => visibleIDs.has(node.id)) ?? []).sort((a, b) => a.level - b.level || a.id - b.id) : [];
  const historyNode = historyNodes.find(node => historyCursor?.scenario === scenario && historyCursor.selected === selected && node.id === historyCursor.id) ?? historyNodes.find(node => node.id === agent?.bottom) ?? historyNodes[0];
  const edges = snapshot?.graph?.edges ?? graphAt(scenario, snapshot?.round ? snapshot.round - 1 : 0);
  const dense = mode === 'network' && new Set(edges.map(edge => `${edge.source}-${edge.target}`)).size > Math.max(28, scenario.n * 2);
  const focusConnections = dense && highlightedScenario === scenario;
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const cy = useRef<Core | null>(null);
  const positions = useRef(new Map<string, Position>());
  const dragged = useRef(new Set<string>());
  const context = useRef<{ scenario: Scenario; mode: GraphProps['mode']; layoutKey?: string } | null>(null);
  const viewportSize = useRef<{ width: number; height: number } | null>(null);
  const pendingFit = useRef(true);
  const autoFitHistory = useRef(true);
  const graphMode = useRef(props.mode);
  const fitWhenReady = useRef<() => void>(() => {});
  const fitFrame = useRef(0);
  const selectAgent = useRef(props.onSelect);
  const selectNode = useRef(props.onNodeSelect);
  selectAgent.current = props.onSelect;
  selectNode.current = id => { setHistoryCursor({ scenario, selected, id }); props.onNodeSelect(id); };
  graphMode.current = props.mode;

  const manualCamera = () => {
    if (graphMode.current !== 'view') return;
    autoFitHistory.current = false;
    pendingFit.current = false;
    cancelAnimationFrame(fitFrame.current);
  };

  useEffect(() => {
    if (!host.current) return;
    const instance = cytoscape({ container: host.current, style, layout: { name: 'preset', fit: false }, minZoom: 0.1, maxZoom: 4, wheelSensitivity: 0.35, boxSelectionEnabled: false });
    cy.current = instance;
    context.current = null;
    positions.current.clear();
    dragged.current.clear();
    viewportSize.current = null;
    pendingFit.current = true;
    autoFitHistory.current = true;
    fitWhenReady.current = () => {
      const box = host.current?.getBoundingClientRect();
      if (!pendingFit.current || !box || box.width <= 0 || box.height <= 0 || !instance.nodes().length) return;
      instance.resize();
      viewportSize.current = { width: box.width, height: box.height };
      instance.fit(undefined, graphMode.current === 'network' ? Math.min(55, box.width * 0.075) : 55);
      if (graphMode.current === 'view' && instance.zoom() > 1.5) {
        instance.zoom({ level: 1.5, renderedPosition: { x: box.width / 2, y: box.height / 2 } });
      }
      pendingFit.current = false;
    };
    instance.on('tap', 'node', event => {
      const id = event.target.id() as string;
      if (id.startsWith('a')) selectAgent.current(Number(id.slice(1)));
      else selectNode.current(Number(id.slice(1)));
    });
    instance.on('dragfree', 'node', event => {
      positions.current.set(event.target.id(), { ...event.target.position() });
      dragged.current.add(event.target.id());
      manualCamera();
    });
    const element = host.current;
    const pointerMove = (event: PointerEvent) => { if (event.buttons) manualCamera(); };
    element.addEventListener('wheel', manualCamera, { passive: true });
    element.addEventListener('touchmove', manualCamera, { passive: true });
    element.addEventListener('pointermove', pointerMove);
    const observer = new ResizeObserver(() => {
      const box = host.current?.getBoundingClientRect();
      instance.resize();
      // Hidden panes retain their last real dimensions. On an ordinary resize,
      // keep the same world point in the centre without changing zoom.
      if (!box || box.width <= 0 || box.height <= 0) return;
      const previous = viewportSize.current;
      if (previous && !pendingFit.current) {
        const pan = instance.pan();
        instance.pan({ x: pan.x + (box.width - previous.width) / 2, y: pan.y + (box.height - previous.height) / 2 });
      }
      viewportSize.current = { width: box.width, height: box.height };
      // A hidden or not-yet-sized pane can defer its one initial fit until visible.
      if (pendingFit.current) fitWhenReady.current();
    });
    observer.observe(host.current);
    return () => {
      cancelAnimationFrame(fitFrame.current);
      element.removeEventListener('wheel', manualCamera);
      element.removeEventListener('touchmove', manualCamera);
      element.removeEventListener('pointermove', pointerMove);
      observer.disconnect(); instance.destroy(); cy.current = null; fitWhenReady.current = () => {};
    };
  }, []);

  useEffect(() => {
    const instance = cy.current;
    if (!instance) return;
    const reset = context.current?.scenario !== scenario || context.current.mode !== mode;
    if (reset) {
      positions.current.clear();
      dragged.current.clear();
      instance.elements().remove();
      pendingFit.current = true;
      autoFitHistory.current = true;
    } else {
      instance.nodes().forEach(node => { positions.current.set(node.id(), { ...node.position() }); });
    }
    if (context.current?.layoutKey !== layoutKey) pendingFit.current = true;
    context.current = { scenario, mode, layoutKey };
    const elements = makeElements(props, focusConnections);
    if (mode === 'view' && keyboardActive && historyNode) {
      const definition = elements.find(element => element.data.id === `v${historyNode.id}`);
      if (definition) definition.classes = `${definition.classes ?? ''} keyboard-focused`;
    }
    const newHistoryNodes = mode === 'view' && elements.some(element => element.data.source === undefined && !instance.getElementById(element.data.id!).length);
    if (newHistoryNodes && autoFitHistory.current) pendingFit.current = true;
    const wanted = new Set(elements.map(element => element.data.id));
    // Network positions remain fixed. History rows can rebalance as they grow,
    // while explicitly dragged nodes keep the user's position.
    instance.batch(() => {
      instance.elements().forEach(element => { if (!wanted.has(element.id())) element.remove(); });
      for (const definition of elements) {
        const existing = instance.getElementById(definition.data.id!);
        if (existing.length) {
          existing.data(definition.data);
          existing.classes(definition.classes ?? '');
          if (mode === 'view' && !dragged.current.has(definition.data.id!) && definition.position) existing.position(definition.position);
        } else {
          const position = mode === 'view' && !dragged.current.has(definition.data.id!) ? definition.position : positions.current.get(definition.data.id!) ?? definition.position;
          instance.add({ ...definition, ...(position ? { position } : {}) });
        }
      }
    });
    if (pendingFit.current) {
      cancelAnimationFrame(fitFrame.current);
      fitFrame.current = requestAnimationFrame(() => fitWhenReady.current());
    }
  }, [scenario, snapshot, previousSnapshot, selected, observer, mode, layoutKey, designatedAgent, focusConnections, keyboardActive, historyNode?.id]);

  useEffect(() => {
    const overlay = canvas.current;
    const instance = cy.current;
    if (!overlay || !instance || !props.animate || mode !== 'network' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const context = overlay.getContext('2d');
    if (!context) return;
    let frame = 0;
    const start = performance.now();
    const draw = (time: number) => {
      const ratio = devicePixelRatio || 1;
      const box = overlay.getBoundingClientRect();
      overlay.width = box.width * ratio; overlay.height = box.height * ratio;
      context.scale(ratio, ratio);
      context.clearRect(0, 0, box.width, box.height);
      instance.edges().filter(edge => !edge.hasClass('silent') && !edge.hasClass('context-edge')).slice(0, 350).forEach((edge, i) => {
        const from = edge.sourceEndpoint(); const to = edge.targetEndpoint();
        if (!from || !to) return;
        const source = { x: from.x * instance.zoom() + instance.pan().x, y: from.y * instance.zoom() + instance.pan().y };
        const target = { x: to.x * instance.zoom() + instance.pan().x, y: to.y * instance.zoom() + instance.pan().y };
        const t = ((time - start + i * 63) % 1200) / 1200;
        const midpoint = edge.midpoint();
        const middle = { x: midpoint.x * instance.zoom() + instance.pan().x, y: midpoint.y * instance.zoom() + instance.pan().y };
        const ctrl = { x: 2 * middle.x - (source.x + target.x) / 2, y: 2 * middle.y - (source.y + target.y) / 2 };
        const x = (1 - t) ** 2 * source.x + 2 * (1 - t) * t * ctrl.x + t * t * target.x;
        const y = (1 - t) ** 2 * source.y + 2 * (1 - t) * t * ctrl.y + t * t * target.y;
        context.beginPath(); context.arc(x, y, 3.8, 0, Math.PI * 2); context.fillStyle = '#2563eb'; context.fill();
      });
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); context.clearRect(0, 0, overlay.width, overlay.height); };
  }, [props.animate, snapshot, mode, scenario]);

  const revealNode = (id: string) => {
    const instance = cy.current;
    const node = instance?.getElementById(id);
    if (!instance || !node?.length) return;
    const box = node.renderedBoundingBox();
    const margin = 45;
    const x = box.x1 < margin ? margin - box.x1 : box.x2 > instance.width() - margin ? instance.width() - margin - box.x2 : 0;
    const y = box.y1 < margin ? margin - box.y1 : box.y2 > instance.height() - margin ? instance.height() - margin - box.y2 : 0;
    if (x || y) { manualCamera(); instance.panBy({ x, y }); }
  };
  const summary = mode === 'view'
    ? historyNode ? `History node v${historyNode.id}. ${historyNode.level < 0 ? 'Root' : `${historyNode.leader ? 'Leader node' : 'Nonleader node'}, level ${historyNode.level}`}. Outdegree ${historyNode.level < 1 ? 'not defined' : historyNode.outdegree}. Parent ${historyNode.parent === null ? 'none' : `v${historyNode.parent}`}. Node ${historyNodes.indexOf(historyNode) + 1} of ${historyNodes.length}.` : 'No history nodes available.'
    : `Agent ${selected}${scenario.leaders.includes(selected) ? ', leader' : ''}${agent?.halted ? ', halted' : ''}. ${scenario.n} agents.${focusConnections ? ' Connections of the selected agent are highlighted.' : ''}`;

  return <div className={`graph-wrap ${mode === 'view' ? 'view-graph' : ''}`}>
    <div ref={host} className="cytoscape" aria-label={mode === 'view' ? 'Vista graph' : 'Directed communication network'} aria-describedby={`${descriptionID}-help ${descriptionID}-node`} role="img" tabIndex={0} onFocus={() => setKeyboardActive(true)} onBlur={() => setKeyboardActive(false)} onKeyDown={event => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (mode === 'view') {
        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' '].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        if (!historyNode) return;
        if (event.key === 'Enter' || event.key === ' ') { props.onNodeSelect(historyNode.id); return; }
        const delta = event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1;
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? historyNodes.length - 1 : (historyNodes.indexOf(historyNode) + delta + historyNodes.length) % historyNodes.length;
        const id = historyNodes[index].id;
        setHistoryCursor({ scenario, selected, id });
        revealNode(`v${id}`);
        return;
      }
      if (event.key === 'Enter' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault(); event.stopPropagation();
        const delta = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
        const id = (selected + delta + scenario.n) % scenario.n;
        props.onSelect(id);
        if (delta) revealNode(`a${id}`);
      }
    }} />
    <span id={`${descriptionID}-help`} className="sr-only">{mode === 'view' ? 'Arrow keys move between history nodes in the vista. Home and End move to the first and last node. Enter opens node details.' : 'Up and Down select an agent. Enter opens agent details. The x labels are observer identifiers, unavailable to the agents.'}</span>
    <span id={`${descriptionID}-node`} className="sr-only" aria-live={keyboardActive ? 'polite' : 'off'} aria-atomic="true">{summary}</span>
    <canvas ref={canvas} className="message-canvas" aria-hidden="true" />
    {focusConnections && <div className="graph-focus-note" role="status">Connections highlighted: {indexedLabel('x', selected)}</div>}
    {mode === 'view' && !snapshot && <div className="graph-empty">The vista appears when the exact engine is ready.</div>}
    <div className="graph-tools">{dense && <button aria-label="Highlight selected agent connections" aria-pressed={focusConnections} title={focusConnections ? 'Show all connections equally' : 'Highlight selected agent connections'} onClick={() => setHighlightedScenario(focusConnections ? null : scenario)}>≋</button>}<button aria-label="Fit graph to view" title="Fit graph to view" onClick={() => { autoFitHistory.current = true; pendingFit.current = true; fitWhenReady.current(); }}>⊡</button><button aria-label="Zoom in" title="Zoom in" onClick={() => { manualCamera(); cy.current?.zoom({ level: Math.min(4, cy.current.zoom() * 1.25), renderedPosition: { x: cy.current.width() / 2, y: cy.current.height() / 2 } }); }}>+</button><button aria-label="Zoom out" title="Zoom out" onClick={() => { manualCamera(); cy.current?.zoom({ level: Math.max(.1, cy.current.zoom() / 1.25), renderedPosition: { x: cy.current.width() / 2, y: cy.current.height() / 2 } }); }}>−</button></div>
  </div>;
}
