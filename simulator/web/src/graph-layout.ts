import type { Position } from 'cytoscape';
import type { Scenario } from './types';

/** Stable positions leave room for the 52px nodes and their selection halos. */
export function networkPositions(scenario: Pick<Scenario, 'n' | 'name'>): Position[] {
  const path = scenario.name === 'Bidirected path' || scenario.name === 'A bidirected path';
  if (!path && scenario.n <= 16) {
    return Array.from({ length: scenario.n }, (_, id) => {
      const angle = -Math.PI / 2 + id * 2 * Math.PI / scenario.n;
      return scenario.n === 1 ? { x: 0, y: 0 } : { x: 240 * Math.cos(angle), y: 200 * Math.sin(angle) };
    });
  }
  const columns = path && scenario.n <= 16 ? 4 : Math.ceil(Math.sqrt(scenario.n * 1.6));
  const rows = Math.ceil(scenario.n / columns);
  const gapX = path && scenario.n <= 16 ? 140 : 88;
  const gapY = path && scenario.n <= 16 ? 170 : 88;
  return Array.from({ length: scenario.n }, (_, id) => {
    const row = Math.floor(id / columns);
    // A folded path keeps every consecutive pair adjacent across row breaks.
    const column = path && row % 2 ? columns - 1 - id % columns : id % columns;
    return { x: (column - (columns - 1) / 2) * gapX, y: (row - (rows - 1) / 2) * gapY };
  });
}
