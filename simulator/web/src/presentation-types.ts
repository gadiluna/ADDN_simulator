import type { Scenario } from './types';

export interface PresentationNode {
  id: string;
  label: string;
  detail?: string;
  leader?: boolean;
  highlight?: boolean;
  muted?: boolean;
  group?: number;
  x?: number;
  y?: number;
}

export interface PresentationEdge {
  source: string;
  target: string;
  label?: string;
  multiplicity?: string;
  highlight?: boolean;
  kind?: 'black' | 'red' | 'communication';
}

export interface PresentationNetwork {
  title: string;
  nodes: PresentationNode[];
  edges: PresentationEdge[];
  note?: string;
}

export interface PresentationFrame {
  title: string;
  caption: string;
  duration: number;
  networks: PresentationNetwork[];
  metrics?: { label: string; value: string }[];
  round?: number;
}

export interface PresentationExample {
  id: string;
  number: number;
  title: string;
  label: string;
  section: string;
  kind: 'execution' | 'construction';
  summary: string;
  proof_note: string;
  checks: string[];
  frames: PresentationFrame[];
  scenario?: Scenario;
}

export interface PresentationCollection {
  schema_version: 1;
  paper_sha256: string;
  examples: PresentationExample[];
}
