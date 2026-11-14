import { describe, expect, it } from 'vitest';
import { layoutNode } from './layoutNode';
import { GRID_SIZE, type RepoNode } from '../types';

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
