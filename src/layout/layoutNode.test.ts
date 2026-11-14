import { describe, expect, it } from 'vitest';
import { layoutNode } from './layoutNode';
import { GRID_SIZE, MAX_ISLAND_DEPTH, type RepoNode } from '../types';

const mk = (id: string, size: number, children: RepoNode[] = []): RepoNode => ({
  id, kind: 'folder', name: id, path: id, size, children,
});
const root = mk('root', 100, [mk('a', 50), mk('b', 30), mk('c', 10)]);

describe('layoutNode', () => {
  it('is deterministic', () => {
    expect(layoutNode(root, 0)).toEqual(layoutNode(root, 0));
  });
  it('produces a full grid with a tile set per child', () => {
    const g = layoutNode(root, 0);
    expect(g.length).toBe(GRID_SIZE);
    const ids = new Set(g.flat().map((t) => t.nodeId).filter(Boolean));
    expect(ids).toEqual(new Set(['a', 'b', 'c']));
  });
});

describe('island spacing', () => {
  it('keeps open water between different islands', () => {
    const g = layoutNode(root, 0);
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const a = g[y][x].nodeId;
        if (!a) continue;
        for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
          const b = g[y + dy]?.[x + dx]?.nodeId;
          expect(b === undefined || b === a).toBe(true);
        }
      }
    }
  });
});

describe('masked layout', () => {
  const allowed = Array.from({ length: GRID_SIZE }, (_, y) =>
    Array.from({ length: GRID_SIZE }, (_, x) => x >= 8 && x < 24 && y >= 8 && y < 24),
  );
  it('keeps all land inside the allowed cells and keeps every child', () => {
    const g = layoutNode(root, 0, allowed);
    const ids = new Set<string>();
    g.forEach((row, y) => row.forEach((t, x) => {
      if (t.nodeId) {
        ids.add(t.nodeId);
        expect(allowed[y][x]).toBe(true);
      }
    }));
    expect(ids).toEqual(new Set(['a', 'b', 'c']));
  });
});

describe('coral', () => {
  const types = (depth: number) => new Set(layoutNode(root, depth).flat().filter((t) => t.nodeId).map((t) => t.type));
  it('uses islands and coasts up to MAX_ISLAND_DEPTH', () => {
    expect(types(MAX_ISLAND_DEPTH - 1)).not.toContain('coral');
  });
  it('uses coral for children deeper than MAX_ISLAND_DEPTH', () => {
    expect(types(MAX_ISLAND_DEPTH)).toEqual(new Set(['coral']));
  });
});
