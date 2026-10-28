export type Variant = 'core' | 'sharp';

export interface Edge {
  source: number;
  target: number;
  multiplicity: string;
}

export interface Scenario {
  schema_version: 1;
  name?: string;
  variant: Variant;
  n: number;
  leaders: number[];
  rounds: { edges: Edge[] }[];
  repeat_last: boolean;
  seed?: string;
}

export interface Audit {
  candidate: number | null;
  final_level: number | null;
  anchor: number | null;
  status: 'idle' | 'rejected' | 'accepted';
  reason: string;
  solution: { node: number; value: string }[];
  equations: { terms: { node: number; coefficient: string }[]; rhs: string }[];
  descendants: { node: number; count: number }[];
}

export interface Agent {
  id: number;
  leader: boolean;
  bottom: number;
  halted: boolean;
  output: number | null;
  visible_nodes: number[];
  audit: Audit;
}

export interface ViewNode {
  id: number;
  level: number;
  leader: boolean;
  parent: number | null;
  outdegree: string;
  incoming: { source: number; multiplicity: string }[];
  fiber: number[];
}

export interface Snapshot {
  schema_version: 1;
  round: number;
  complete: boolean;
  variant: Variant;
  n: number;
  ell: number;
  agents: Agent[];
  nodes: ViewNode[];
  graph: { edges: Edge[] } | null;
}

export type EngineRequest =
  | { id: number; command: 'load'; scenario: Scenario }
  | { id: number; command: 'step' }
  | { id: number; command: 'dispose' };
export type EngineResponse =
  | { id: number; ok: true; snapshot?: Snapshot }
  | { id: number; ok: false; error: string };

export type Phase = 'send' | 'receive' | 'view' | 'decision';
