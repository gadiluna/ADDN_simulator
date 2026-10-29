import { useEffect, useMemo, useState } from 'react';
import { buildAuditDetails } from './audit-details';
import type { Audit, Scenario, ViewNode } from './types';

interface MathDetailsProps {
  audit?: Audit;
  round: number;
  variant: Scenario['variant'];
  ell: number;
  nodes: ViewNode[];
  visibleNodes: number[];
  halted?: boolean;
  onNodeSelect: (id: number) => void;
}

type Details = ReturnType<typeof buildAuditDetails>;
type EvidenceLine = Details['evidence'][number];

const statusLabels = { passed: 'Passed', failed: 'Failed', 'not-reached': 'Not reached' };

function NodeLink({ node, onNodeSelect }: { node: number; onNodeSelect: MathDetailsProps['onNodeSelect'] }) {
  return <button className="math-node-link" aria-label={`Inspect history node v${node}`} onClick={() => onNodeSelect(node)}>v{node}</button>;
}

function Evidence({ lines, onNodeSelect }: { lines: EvidenceLine[]; onNodeSelect: MathDetailsProps['onNodeSelect'] }) {
  return <div className="math-evidence-lines">{lines.map((line, index) => <div className="math-evidence-line" data-result={line.result} key={`${line.label}-${index}`}>
    <div className="math-evidence-label"><span>{line.label}</span>{line.result && line.result !== 'info' && <span className={`math-status ${line.result === 'pass' ? 'passed' : 'failed'}`}>{line.result === 'pass' ? 'Passed' : 'Failed'}</span>}</div>
    <code className="math-expression">{line.expression}</code>
    {!!line.nodes?.length && <div className="math-node-links" aria-label={`${line.label} history nodes`}>{line.nodes.map(node => <NodeLink key={node} node={node} onNodeSelect={onNodeSelect} />)}</div>}
  </div>)}</div>;
}

export default function MathDetails({ audit, round, variant, ell, nodes, visibleNodes, halted, onNodeSelect }: MathDetailsProps) {
  const details = useMemo(() => buildAuditDetails({ audit, round, variant, ell, nodes, visibleNodes, halted }), [audit, round, variant, ell, nodes, visibleNodes, halted]);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const failedStep = details.steps.find(step => step.status === 'failed')?.number;

  // Open a newly failed step once; preserve the reader's choices across rounds.
  useEffect(() => {
    if (failedStep !== undefined) setExpanded(previous => previous[failedStep] ? previous : { ...previous, [failedStep]: true });
  }, [failedStep]);

  const inspectNode = (node: number) => {
    onNodeSelect(node);
    requestAnimationFrame(() => document.querySelector('.node-inspector')?.scrollIntoView({ block: 'nearest' }));
  };
  const nextTest = details.nextTest;
  const next = nextTest && <p className="math-next-test"><span>Next {nextTest.kind === 'all-leaders' ? 'all-leader test' : 'candidate'}</span><strong>m = {nextTest.candidate} · round {nextTest.round}</strong></p>;

  return <div className="math-audit" data-kind={details.kind}>
    <p className="math-context">Core algorithm · §4.1<br />Known leaders ℓ = {ell}<span aria-hidden="true"> · </span>Visible nodes: {visibleNodes.length}</p>
    {details.kind === 'waiting' ? <div className="math-waiting">
      <p className="math-summary">{details.summary}</p>
      {next}
      {!!details.evidence.length && <Evidence lines={details.evidence} onNodeSelect={inspectNode} />}
    </div> : <>
      <div className={`math-verdict ${details.status}`}>
        <strong>{details.kind === 'all-leaders' ? 'All-leader test' : details.status === 'accepted' ? 'Candidate accepted' : 'Candidate rejected'}</strong>
        <p>{details.summary}</p>
        {details.witness && !details.summary.includes(details.witness) && <p className="math-witness">{details.witness}</p>}
      </div>
      {details.kind === 'all-leaders' ? <div className="math-special">
        <p className="math-special-status"><span>Round {details.testRound} · m = {details.candidate}</span><span className={`math-status ${details.status === 'accepted' ? 'passed' : 'failed'}`}>{details.status === 'accepted' ? 'Passed' : 'Failed'}</span></p>
        <Evidence lines={details.evidence} onNodeSelect={inspectNode} />
        {next}
      </div> : <>
        <dl className="math-metadata">
          <div><dt>Candidate m</dt><dd>{details.candidate ?? '—'}</dd></div>
          <div><dt>Prefix depth</dt><dd>{details.finalLevel ?? '—'}</dd></div>
          <div><dt>Anchor level</dt><dd>{details.anchor ?? '—'}</dd></div>
        </dl>
        <div className="math-steps">{details.steps.map(step => <details className="math-step" data-step={step.number} data-status={step.status} key={step.number} open={expanded[step.number] ?? false} onToggle={event => {
          const open = event.currentTarget.open;
          setExpanded(previous => previous[step.number] === open ? previous : { ...previous, [step.number]: open });
        }}>
          <summary><span className="math-step-number" aria-hidden="true">{step.number}</span><span className="math-step-title">{step.title}</span><span className={`math-status ${step.status}`}>{statusLabels[step.status]}</span></summary>
          {expanded[step.number] && <div className="math-step-evidence">
            <p className="math-step-summary">{step.summary}</p>
            {step.witness && !step.summary.includes(step.witness) && <p className="math-witness">{step.witness}</p>}
            {step.number === 3 && step.status !== 'not-reached' && <p className="math-definition"><b>b</b>(<i>v</i>) is the candidate anonymity of history node v: the candidate number of agents it represents.</p>}
            <Evidence lines={step.evidence} onNodeSelect={inspectNode} />
            {step.number === 3 && step.status !== 'not-reached' && <div className="math-solution-checks">{([
              ['unique', 'Unique solution', details.solution.unique],
              ['integer', 'Integer values', details.solution.integral],
              ['positive', 'Positive values', details.solution.positive],
              ['total', 'Candidate total', details.solution.total],
            ] as const).map(([check, label, result]) => <div className="math-solution-check" data-check={check} data-status={result.status} key={check}>
              <div className="math-evidence-label"><span>{label}</span><span className={`math-status ${result.status}`}>{statusLabels[result.status]}</span></div>
              <code className="math-expression">{result.expression}</code>
              {result.witness && !result.expression.includes(result.witness) && <p className="math-witness">{result.witness}</p>}
            </div>)}</div>}
            {step.number === 5 && details.descendants.length > 0 && <div className="math-table-scroll" role="region" aria-label="Black descendant counts" tabIndex={0}>
              <table className="math-descendants"><thead><tr><th scope="col">Node</th><th scope="col">q(v)</th><th scope="col"><b>b</b>(<i>v</i>)</th><th scope="col">q(v) ≤ <b>b</b>(<i>v</i>)</th></tr></thead><tbody>{details.descendants.map(value => <tr key={value.node}>
                <th scope="row"><NodeLink node={value.node} onNodeSelect={inspectNode} /></th><td>{value.count}</td><td>{value.value}</td><td><code className="math-expression">{value.count} {value.passes ? '≤' : '>'} {value.value}</code><span className={`math-status ${value.passes ? 'passed' : 'failed'}`}>{value.passes ? 'Passed' : 'Failed'}</span></td>
              </tr>)}</tbody></table>
            </div>}
          </div>}
        </details>)}</div>
        {next}
      </>}
    </>}
  </div>;
}
