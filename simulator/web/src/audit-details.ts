import type { Audit, Variant, ViewNode } from './types';

export type CheckStatus = 'passed' | 'failed' | 'not-reached';
export interface EvidenceLine {
  label: string;
  expression: string;
  result?: 'pass' | 'fail' | 'info';
  nodes?: number[];
}
export interface AuditStep {
  number: 1 | 2 | 3 | 4 | 5;
  title: string;
  status: CheckStatus;
  summary: string;
  witness: string | null;
  evidence: EvidenceLine[];
}
export interface Subcheck {
  status: CheckStatus;
  expression: string;
  witness: string | null;
}
export interface AuditEquation {
  label: string;
  kind: 'flow' | 'leader';
  parent: number | null;
  level: number;
  terms: { node: number; coefficient: string }[];
  rhs: string;
  expression: string;
}
export interface AuditDetails {
  kind: 'waiting' | 'all-leaders' | 'five-step';
  status: Audit['status'];
  reason: string;
  candidate: number | null;
  finalLevel: number | null;
  anchor: number | null;
  testRound: number | null;
  nextTest: { round: number; candidate: number; kind: 'all-leaders' | 'five-step'; finalLevel: number } | null;
  summary: string;
  witness: string | null;
  evidence: EvidenceLine[];
  steps: AuditStep[];
  structure: {
    levels: { level: number; count: string; limit: string; passes: boolean }[];
    leaderNodes: number[];
    missingChildren: number[];
    flatLevels: number[];
    flatChecks: { level: number; parents: { node: number; children: number[]; count: string }[]; flat: boolean }[];
  };
  equations: AuditEquation[];
  solution: {
    values: { node: number; value: string }[];
    unique: Subcheck;
    integral: Subcheck;
    positive: Subcheck;
    total: Subcheck;
  };
  backward: {
    values: { node: number; level: number; value: string; children: { node: number; value: string }[] }[];
    flows: { node: number; level: number; left: string; right: string; passes: boolean; expression: string }[];
  };
  descendants: { node: number; count: string; value: string; passes: boolean; descendantNodes: number[] }[];
}
export interface AuditDetailsInput {
  audit?: Audit;
  round: number;
  ell: number;
  variant: Variant;
  nodes: readonly ViewNode[];
  visibleNodes: readonly number[];
  halted?: boolean;
}

// All mathematical arithmetic stays in Q. Numbers are used only for node IDs,
// rounds, level indices, and matrix dimensions, as in the engine's JSON schema.
interface Rational { n: bigint; d: bigint }
const zero: Rational = { n: 0n, d: 1n };
const one: Rational = { n: 1n, d: 1n };
function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
}
function rational(n: bigint, d = 1n): Rational {
  if (!d) throw new Error('A rational denominator cannot be zero.');
  if (!n) return zero;
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}
function parse(value: string): Rational {
  const [n, d = '1'] = value.split('/');
  return rational(BigInt(n), BigInt(d));
}
function add(a: Rational, b: Rational): Rational { return rational(a.n * b.d + b.n * a.d, a.d * b.d); }
function neg(a: Rational): Rational { return { n: -a.n, d: a.d }; }
function mul(a: Rational, b: Rational): Rational { return rational(a.n * b.n, a.d * b.d); }
function div(a: Rational, b: Rational): Rational { return rational(a.n * b.d, a.d * b.n); }
function format(a: Rational): string { return a.d === 1n ? String(a.n) : `${a.n}/${a.d}`; }
function count(items: readonly unknown[]): bigint {
  let total = 0n;
  for (const _item of items) total++;
  return total;
}
function sum(values: Rational[]): Rational { return values.reduce(add, zero); }
function linear(terms: { coefficient: string; name: string }[]): string {
  let result = '';
  for (const term of terms) {
    const coefficient = parse(term.coefficient);
    if (!coefficient.n) continue;
    const magnitude = format(rational(coefficient.n < 0n ? -coefficient.n : coefficient.n, coefficient.d));
    const body = `${magnitude === '1' ? '' : `${magnitude}·`}${term.name}`;
    result += result ? `${coefficient.n < 0n ? ' − ' : ' + '}${body}` : `${coefficient.n < 0n ? '−' : ''}${body}`;
  }
  return result || '0';
}
function equationExpression(terms: AuditEquation['terms'], rhs: string): string {
  return `${linear(terms.map(term => ({ ...term, name: `b(v${term.node})` })))} = ${rhs}`;
}
function unused(expression: string): Subcheck { return { status: 'not-reached', expression, witness: null }; }
const reasonStep: Record<string, number> = {
  leader_missing: 1, node_limit: 1, missing_child: 1, no_flat: 1,
  inconsistent: 3, non_unique: 3, non_integer: 3, non_positive: 3, wrong_total: 3,
  backward_flow: 4, suffix: 5,
};

function schedule(round: number, ell: number, variant: Variant): NonNullable<AuditDetails['nextTest']> {
  if (variant === 'sharp' && round < ell) return { round: ell, candidate: ell, kind: 'all-leaders', finalLevel: 0 };
  if (variant === 'sharp' && ell > 1) {
    const candidate = Math.max(ell + 1, Math.floor(round / 2) + 2);
    return { round: 2 * candidate - 2, candidate, kind: 'five-step', finalLevel: candidate - 1 };
  }
  const candidate = Math.max(variant === 'core' ? ell : 2, Math.floor((round + 1) / 2) + 1);
  return { round: 2 * candidate - 1, candidate, kind: 'five-step', finalLevel: candidate };
}

// RREF is diagnostic only, and runs only for the two rejection reasons for
// which the engine omits a solution. Row combinations certify inconsistency;
// a nonzero null vector certifies failure of uniqueness without adding Σb=m.
function linearWitness(equations: AuditEquation[], columns: number[], reason: string): string | null {
  const width = columns.length;
  const columnIndex = new Map(columns.map((id, index) => [id, index]));
  const matrix = equations.map(eq => {
    const row = Array.from({ length: width + 1 }, () => zero);
    for (const term of eq.terms) {
      const index = columnIndex.get(term.node);
      if (index !== undefined) row[index] = add(row[index], parse(term.coefficient));
    }
    row[width] = parse(eq.rhs);
    return row;
  });
  const combinations = equations.map((_eq, i) => equations.map((_other, j) => i === j ? one : zero));
  const pivots: number[] = [];
  for (let c = 0; c < width; c++) {
    const rank = pivots.length;
    const found = matrix.findIndex((row, index) => index >= rank && row[c].n !== 0n);
    if (found < 0) continue;
    [matrix[rank], matrix[found]] = [matrix[found], matrix[rank]];
    [combinations[rank], combinations[found]] = [combinations[found], combinations[rank]];
    const pivot = matrix[rank][c];
    matrix[rank] = matrix[rank].map(value => div(value, pivot));
    combinations[rank] = combinations[rank].map(value => div(value, pivot));
    for (let r = 0; r < matrix.length; r++) {
      if (r === rank || !matrix[r][c].n) continue;
      const factor = matrix[r][c];
      matrix[r] = matrix[r].map((value, j) => add(value, neg(mul(factor, matrix[rank][j]))));
      combinations[r] = combinations[r].map((value, j) => add(value, neg(mul(factor, combinations[rank][j]))));
    }
    pivots.push(c);
  }
  if (reason === 'inconsistent') {
    const bad = matrix.findIndex(row => row.slice(0, width).every(value => !value.n) && row[width].n !== 0n);
    if (bad < 0) return null;
    const combination = linear(combinations[bad].map((value, index) => ({ coefficient: format(value), name: `[${equations[index].label}]` })));
    return `${combination} ⇒ 0 = ${format(matrix[bad][width])}. The system is inconsistent.`;
  }
  const free = columns.findIndex((_id, index) => !pivots.includes(index));
  if (free < 0) return null;
  const vector = columns.map(() => zero);
  vector[free] = one;
  pivots.forEach((column, row) => { vector[column] = neg(matrix[row][free]); });
  return `rank(A) = ${pivots.length} < ${width}; z = (${columns.map((id, i) => `z(v${id}) = ${format(vector[i])}`).join(', ')}), z ≠ 0, A·z = 0. The solution is not unique.`;
}

/** Explain one engine decision using only the agent's visible prefix.
 * The engine remains authoritative: reconstruction never changes its status.
 * No fiber, population size, global graph, or invisible node is inspected.
 */
export function buildAuditDetails(input: AuditDetailsInput): AuditDetails {
  const { round, ell, variant, halted } = input;
  const audit: Audit = input.audit ?? { candidate: null, final_level: null, anchor: null, status: 'idle', reason: 'waiting', solution: [], equations: [], descendants: [] };
  const kind = audit.reason === 'all_leaders' || audit.reason === 'nonleader_visible' ? 'all-leaders' : audit.status === 'idle' ? 'waiting' : 'five-step';
  const candidate = audit.candidate;
  const finalLevel = audit.final_level;
  const anchor = audit.anchor;
  const details: AuditDetails = {
    kind, status: audit.status, reason: audit.reason, candidate, finalLevel, anchor,
    testRound: kind === 'waiting' ? null : kind === 'all-leaders' ? ell : candidate === null ? null : variant === 'sharp' && ell > 1 ? 2 * candidate - 2 : 2 * candidate - 1,
    nextTest: halted || audit.status === 'accepted' ? null : schedule(round, ell, variant),
    summary: '', witness: null, evidence: [], steps: [],
    structure: { levels: [], leaderNodes: [], missingChildren: [], flatLevels: [], flatChecks: [] },
    equations: [],
    solution: { values: [], unique: unused('The flow and leader equations must have a unique solution.'), integral: unused('Every b(v) must be an integer.'), positive: unused('Every b(v) must be positive.'), total: unused('The separate post-solve check is Σ b(v) = m.') },
    backward: { values: [], flows: [] }, descendants: [],
  };
  // Mask before accessing mathematical fields. Copy only local mathematical
  // data, never the observer-only fiber attached to snapshot nodes.
  const visible = new Set(input.visibleNodes);
  const cutoff = finalLevel ?? 0;
  const local = input.nodes.filter(node => visible.has(node.id) && node.level >= -1 && node.level <= cutoff)
    .map(node => ({ id: node.id, level: node.level, leader: node.leader, parent: node.parent, outdegree: node.outdegree, incoming: node.incoming.filter(message => visible.has(message.source)) }))
    .sort((a, b) => a.id - b.id);
  const byId = new Map(local.map(node => [node.id, node]));
  const levels = new Map<number, typeof local>();
  const children = new Map<number, typeof local>();
  for (const node of local) {
    const level = levels.get(node.level) ?? [];
    level.push(node); levels.set(node.level, level);
    if (node.parent !== null && byId.get(node.parent)?.level === node.level - 1) {
      const siblings = children.get(node.parent) ?? [];
      siblings.push(node); children.set(node.parent, siblings);
    }
  }
  const at = (level: number) => levels.get(level) ?? [];
  const childNodes = (node: number) => children.get(node) ?? [];
  const leaders = at(0).filter(node => node.leader);
  const nonleaders = at(0).filter(node => !node.leader);
  details.structure.leaderNodes = leaders.map(node => node.id);
  if (kind === 'waiting') {
    const next = details.nextTest;
    details.summary = next ? `No test is scheduled at round ${round}.` : 'This agent has halted; no further test is scheduled.';
    if (next) details.evidence.push({ label: 'Schedule', expression: next.kind === 'all-leaders' ? 'At round ℓ, inspect 𝓛_0 for a nonleader node.' : variant === 'sharp' && ell > 1 ? `t = 2m − 2; prefix ends at 𝓛_(m−1). Next cutoff: 𝓛_${next.finalLevel}.` : `t = 2m − 1; prefix ends at 𝓛_m. Next cutoff: 𝓛_${next.finalLevel}.`, result: 'info' });
    return details;
  }
  if (kind === 'all-leaders') {
    const accepted = audit.status === 'accepted';
    const nonleaderIds = nonleaders.map(node => node.id);
    details.summary = accepted ? `At round ℓ = ${ell}, no nonleader is visible in 𝓛_0; output ℓ = ${ell} and halt.` : `At round ℓ = ${ell}, a nonleader is visible in 𝓛_0; the all-leaders check fails.`;
    details.witness = accepted ? null : `Visible nonleader${nonleaderIds.length === 1 ? '' : 's'} in 𝓛_0: ${nonleaderIds.map(id => `v${id}`).join(', ')}.`;
    details.evidence = [{ label: 'All-leaders condition', expression: `Visible nonleader nodes in 𝓛_0: ${count(nonleaders)}${nonleaderIds.length ? ` (${nonleaderIds.map(id => `v${id}`).join(', ')})` : ''}. Required: 0.`, result: accepted ? 'pass' : 'fail', nodes: nonleaderIds }];
    return details;
  }

  const failure = audit.status === 'accepted' ? 6 : reasonStep[audit.reason] ?? 1;
  // Step names from the paper, §4.1, in the same order as the C audit.
  const titles = ['Check the visible structure', 'Choose the anchor', 'Solve the anchor', 'Propagate backward', 'Check the suffix'];
  details.steps = titles.map((title, index) => ({ number: (index + 1) as AuditStep['number'], title, status: index + 1 < failure ? 'passed' : index + 1 === failure ? 'failed' : 'not-reached', summary: index + 1 > failure ? 'Not reached after the earlier rejection.' : '', witness: null, evidence: [] }));
  const [structureStep, anchorStep, solveStep, backwardStep, suffixStep] = details.steps;
  const m = BigInt(candidate ?? 0);
  for (let level = 0; level <= cutoff; level++) {
    const size = count(at(level));
    details.structure.levels.push({ level, count: String(size), limit: String(m), passes: size <= m });
  }
  details.structure.missingChildren = local.filter(node => node.level >= 0 && node.level < cutoff && !childNodes(node.id).length).map(node => node.id);
  for (let level = 1; level <= cutoff; level++) {
    const parents = at(level - 1).map(node => ({ node: node.id, children: childNodes(node.id).map(child => child.id), count: String(count(childNodes(node.id))) }));
    const flat = parents.length > 0 && parents.every(parent => parent.count === '1');
    details.structure.flatChecks.push({ level, parents, flat });
    if (flat) details.structure.flatLevels.push(level);
  }
  structureStep.evidence.push({ label: 'Leader in 𝓛_0', expression: leaders.length ? `${leaders.map(node => `v${node.id}`).join(', ')} is visible in 𝓛_0.` : 'No leader node is visible in 𝓛_0.', result: leaders.length ? 'pass' : 'fail', nodes: leaders.map(node => node.id) });
  if (audit.reason !== 'leader_missing') {
    for (const level of details.structure.levels) {
      structureStep.evidence.push({ label: `Level 𝓛_${level.level}`, expression: `|𝓛_${level.level}| = ${level.count} ${level.passes ? '≤' : '>'} m = ${m}.`, result: level.passes ? 'pass' : 'fail', nodes: at(level.level).map(node => node.id) });
      if (audit.reason === 'node_limit' && !level.passes) break;
    }
  }
  if (!['leader_missing', 'node_limit'].includes(audit.reason)) {
    const missing = details.structure.missingChildren;
    structureStep.evidence.push({ label: 'Children through the cutoff', expression: missing.length ? `${missing.map(id => `v${id} ∈ 𝓛_${byId.get(id)!.level}: 0 children in 𝓛_${byId.get(id)!.level + 1}`).join('; ')}.` : `Every node in 𝓛_0,…,𝓛_${cutoff - 1} has a child in the next level.`, result: missing.length ? 'fail' : 'pass', nodes: missing });
  }
  if (!['leader_missing', 'node_limit', 'missing_child'].includes(audit.reason)) {
    for (const flat of details.structure.flatChecks) structureStep.evidence.push({ label: `Flatness of 𝓛_${flat.level}`, expression: `${flat.parents.map(parent => `v${parent.node}: ${parent.count} child${parent.count === '1' ? '' : 'ren'}`).join('; ') || 'No preceding nodes'}. ${flat.flat ? 'Flat: every preceding node has exactly one child.' : 'Not flat.'}`, result: 'info', nodes: flat.parents.map(parent => parent.node) });
    structureStep.evidence.push({ label: 'At least one flat level', expression: details.structure.flatLevels.length ? `Flat levels: ${details.structure.flatLevels.map(level => `𝓛_${level}`).join(', ')}.` : `No flat level in 𝓛_1,…,𝓛_${cutoff}.`, result: details.structure.flatLevels.length ? 'pass' : 'fail' });
  }
  if (audit.reason === 'leader_missing') structureStep.witness = '𝓛_0 contains no visible leader node.';
  if (audit.reason === 'node_limit') {
    const bad = details.structure.levels.find(level => !level.passes);
    if (bad) structureStep.witness = `|𝓛_${bad.level}| = ${bad.count} > m = ${m}.`;
  }
  if (audit.reason === 'missing_child') {
    const id = details.structure.missingChildren[0];
    if (id !== undefined) structureStep.witness = `v${id} ∈ 𝓛_${byId.get(id)!.level} has 0 children in 𝓛_${byId.get(id)!.level + 1}.`;
  }
  if (audit.reason === 'no_flat') structureStep.witness = `No level 𝓛_1,…,𝓛_${cutoff} is flat; ${details.structure.flatChecks.map(check => { const bad = check.parents.find(parent => parent.count !== '1'); return bad ? `𝓛_${check.level}: v${bad.node} has ${bad.count} children` : `𝓛_${check.level}: no preceding node`; }).join('; ')}.`;
  structureStep.summary = structureStep.status === 'passed' ? `Leader visible; level sizes ≤ ${m}; children present; a flat level exists.` : structureStep.witness ?? `The engine rejects the visible structure (${audit.reason}).`;

  if (anchorStep.status !== 'not-reached' && anchor !== null) {
    anchorStep.summary = `Choose the latest flat level: h = ${anchor}.`;
    anchorStep.evidence.push({ label: 'Latest flat level', expression: `h = max{${details.structure.flatLevels.join(', ')}} = ${anchor}; |𝓛_${anchor - 1}| = ${count(at(anchor - 1))} = |𝓛_${anchor}| = ${count(at(anchor))}.`, result: 'pass', nodes: at(anchor).map(node => node.id) });
  }

  if (solveStep.status !== 'not-reached' && anchor !== null) {
    const predecessors = at(anchor - 1);
    const columns = at(anchor).map(node => node.id);
    const columnSet = new Set(columns);
    details.equations = audit.equations.map((eq, index) => {
      const parent = predecessors[index]?.id ?? null;
      const leader = index === predecessors.length;
      const terms = eq.terms.filter(term => columnSet.has(term.node)).map(term => ({ node: term.node, coefficient: format(parse(term.coefficient)) }));
      const rhs = format(parse(eq.rhs));
      return { label: leader ? `Leader equation at 𝓛_${anchor}` : `Flow equation at 𝓛_${anchor} for u = v${parent}`, kind: leader ? 'leader' as const : 'flow' as const, parent, level: anchor, terms, rhs, expression: equationExpression(terms, rhs) };
    });
    solveStep.evidence.push({ label: 'Anchor flow equations', expression: `Σ_{v ∈ 𝓛_${anchor}} μ_${anchor}(u,v)b(v) = Σ_{w child of u in 𝓛_${anchor}} d_${anchor}(w)b(w), for u ∈ 𝓛_${anchor - 1}.` });
    for (const eq of details.equations) solveStep.evidence.push({ label: eq.label, expression: `${eq.expression}${eq.kind === 'leader' ? ` (Σ_{v leader node in 𝓛_${anchor}} b(v) = ℓ = ${ell})` : ''}.`, nodes: [...(eq.parent === null ? [] : [eq.parent]), ...eq.terms.map(term => term.node)] });
    const uniquenessFailed = audit.reason === 'inconsistent' || audit.reason === 'non_unique';
    const witness = uniquenessFailed ? linearWitness(details.equations, columns, audit.reason) ?? (audit.reason === 'inconsistent' ? 'The engine reports an inconsistent system.' : 'The engine reports a non-unique solution.') : null;
    details.solution.unique = { status: uniquenessFailed ? 'failed' : 'passed', expression: uniquenessFailed ? witness! : `The flow and leader equations have a unique solution in ${columns.length} unknown${columns.length === 1 ? '' : 's'}.`, witness };
    details.solution.values = audit.solution.filter(value => columnSet.has(value.node)).map(value => ({ node: value.node, value: format(parse(value.value)) }));
    if (!uniquenessFailed) {
      const values = details.solution.values;
      const noninteger = values.find(value => parse(value.value).d !== 1n);
      details.solution.integral = { status: audit.reason === 'non_integer' ? 'failed' : 'passed', expression: noninteger ? `b(v${noninteger.node}) = ${noninteger.value} ∉ ℤ.` : 'Every b(v) is an integer.', witness: audit.reason === 'non_integer' && noninteger ? `b(v${noninteger.node}) = ${noninteger.value} ∉ ℤ.` : null };
      if (audit.reason !== 'non_integer') {
        const nonpositive = values.find(value => parse(value.value).n <= 0n);
        details.solution.positive = { status: audit.reason === 'non_positive' ? 'failed' : 'passed', expression: nonpositive ? `b(v${nonpositive.node}) = ${nonpositive.value} ≤ 0.` : 'Every b(v) > 0.', witness: audit.reason === 'non_positive' && nonpositive ? `b(v${nonpositive.node}) = ${nonpositive.value} ≤ 0.` : null };
        if (audit.reason !== 'non_positive') {
          const total = format(sum(values.map(value => parse(value.value))));
          const expression = `Σ_{v ∈ 𝓛_${anchor}} b(v) = ${values.map(value => value.value).join(' + ') || '0'} = ${total} ${audit.reason === 'wrong_total' ? '≠' : '='} m = ${m}. This is a separate post-solve check, not a system equation.`;
          details.solution.total = { status: audit.reason === 'wrong_total' ? 'failed' : 'passed', expression, witness: audit.reason === 'wrong_total' ? `Σ b(v) = ${total} ≠ m = ${m}.` : null };
        }
      }
    }
    for (const value of details.solution.values) solveStep.evidence.push({ label: `Candidate anonymity b(v${value.node})`, expression: `b(v${value.node}) = ${value.value}.`, nodes: [value.node] });
    solveStep.witness = [details.solution.unique, details.solution.integral, details.solution.positive, details.solution.total].find(check => check.status === 'failed')?.witness ?? null;
    solveStep.summary = solveStep.status === 'passed' ? `Unique positive integer solution; its separate total equals m = ${m}.` : solveStep.witness ?? 'The anchor solution fails an engine check.';
  }

  if (backwardStep.status !== 'not-reached' && anchor !== null) {
    const values = new Map(details.solution.values.map(value => [value.node, parse(value.value)]));
    for (let level = anchor - 1; level >= -1; level--) {
      for (const node of at(level)) {
        const terms = childNodes(node.id).map(child => ({ node: child.id, value: format(values.get(child.id) ?? zero) }));
        const value = sum(terms.map(term => parse(term.value)));
        values.set(node.id, value);
        details.backward.values.push({ node: node.id, level, value: format(value), children: terms });
        backwardStep.evidence.push({ label: `Disjoint refinement at v${node.id} ∈ 𝓛_${level}`, expression: `b(v${node.id}) = ${terms.map(term => `b(v${term.node})`).join(' + ') || '0'} = ${terms.map(term => term.value).join(' + ') || '0'} = ${format(value)}.`, nodes: [node.id, ...terms.map(term => term.node)] });
      }
    }
    for (let level = 1; level < anchor; level++) {
      const left = new Map<number, Rational>();
      const right = new Map<number, Rational>();
      const incomingTerms = new Map<number, string[]>();
      const outgoingTerms = new Map<number, string[]>();
      for (const node of at(level)) {
        const value = values.get(node.id) ?? zero;
        for (const message of node.incoming) {
          if (byId.get(message.source)?.level !== level - 1) continue;
          left.set(message.source, add(left.get(message.source) ?? zero, mul(parse(message.multiplicity), value)));
          const terms = incomingTerms.get(message.source) ?? [];
          terms.push(`${message.multiplicity}·${format(value)} [v${node.id}]`); incomingTerms.set(message.source, terms);
        }
        if (node.parent !== null && byId.get(node.parent)?.level === level - 1) {
          right.set(node.parent, add(right.get(node.parent) ?? zero, mul(parse(node.outdegree), value)));
          const terms = outgoingTerms.get(node.parent) ?? [];
          terms.push(`${node.outdegree}·${format(value)} [v${node.id}]`); outgoingTerms.set(node.parent, terms);
        }
      }
      for (const node of at(level - 1)) {
        const lhs = format(left.get(node.id) ?? zero);
        const rhs = format(right.get(node.id) ?? zero);
        const passes = lhs === rhs;
        const expression = `Received from v${node.id}: Σ_{v ∈ 𝓛_${level}} μ_${level}(v${node.id},v)b(v) = ${(incomingTerms.get(node.id) ?? []).join(' + ') || '0'} = ${lhs}; sent by children of v${node.id}: Σ_{w child of v${node.id} in 𝓛_${level}} d_${level}(w)b(w) = ${(outgoingTerms.get(node.id) ?? []).join(' + ') || '0'} = ${rhs}; ${lhs} ${passes ? '=' : '≠'} ${rhs}.`;
        details.backward.flows.push({ node: node.id, level, left: lhs, right: rhs, passes, expression });
        backwardStep.evidence.push({ label: `Flow equation at 𝓛_${level} for u = v${node.id}`, expression, result: passes ? 'pass' : 'fail', nodes: [node.id] });
      }
    }
    const bad = details.backward.flows.find(flow => !flow.passes);
    backwardStep.witness = audit.reason === 'backward_flow' && bad ? `Flow equation at 𝓛_${bad.level} for u = v${bad.node}: incoming total ${bad.left} ≠ outgoing total ${bad.right}.` : null;
    backwardStep.summary = backwardStep.status === 'passed' ? anchor === 1 ? 'Propagated through 𝓛_−1; no earlier flow level to check.' : 'Propagated through 𝓛_−1; every earlier flow equation holds.' : backwardStep.witness ?? 'An earlier flow equation fails.';
  }

  if (suffixStep.status !== 'not-reached' && anchor !== null) {
    // Only black parent/child edges define descendants. Red message edges do
    // not contribute. Memoized ancestry also handles shared storage once.
    const ancestor = new Map<number, number>();
    for (const node of at(anchor)) ancestor.set(node.id, node.id);
    for (let level = anchor + 1; level <= cutoff; level++) for (const node of at(level)) {
      const above = node.parent === null ? undefined : ancestor.get(node.parent);
      if (above !== undefined) ancestor.set(node.id, above);
    }
    const descendants = new Map<number, number[]>();
    for (const node of at(cutoff)) {
      const above = ancestor.get(node.id);
      if (above === undefined) continue;
      const list = descendants.get(above) ?? [];
      list.push(node.id); descendants.set(above, list);
    }
    suffixStep.evidence.push({ label: 'Descendant cutoff', expression: `Count black-tree descendants in 𝓛_${cutoff}${anchor === cutoff ? '; h equals the cutoff, so every anchor node counts itself' : ''}. Red message edges do not add descendants.`, result: 'info' });
    for (const value of details.solution.values) {
      const ids = descendants.get(value.node) ?? [];
      const q = count(ids);
      const b = parse(value.value);
      const passes = q * b.d <= b.n;
      details.descendants.push({ node: value.node, count: String(q), value: value.value, passes, descendantNodes: ids });
    }
    const bad = details.descendants.find(item => !item.passes);
    suffixStep.witness = audit.reason === 'suffix' && bad ? `q(v${bad.node}) = ${bad.count} > b(v${bad.node}) = ${bad.value} at 𝓛_${cutoff}.` : null;
    suffixStep.summary = suffixStep.status === 'passed' ? `Every q(v) ≤ b(v) at 𝓛_${cutoff}; accept m = ${m}, output ${m}, and halt.` : suffixStep.witness ?? 'A suffix descendant bound fails.';
  }
  details.witness = details.steps.find(step => step.status === 'failed')?.witness ?? null;
  details.summary = audit.status === 'accepted' ? `All five steps pass. Output m = ${m} and halt.` : `Reject m = ${m} at Step ${failure}: ${details.witness ?? audit.reason}`;
  return details;
}
