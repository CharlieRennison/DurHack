import { describe, expect, it } from 'vitest';
import { effectiveChildren, folderHeight } from './children';
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

const file = (id: string, size = 5): RepoNode => ({ id, kind: 'file', name: id, path: id, size, children: [] });
/** A chain of folders: chain('x', 3) -> x0 > x1 > x2 > (leaf folder holding one file). */
const chain = (name: string, levels: number): RepoNode =>
  levels === 0 ? mk(name, 5, [file(name + '.txt')]) : mk(name, 5, [chain(name + 'i', levels - 1)]);
const typesOf = (parent: RepoNode, id: string) => new Set(layoutNode(parent, 0).flat().filter((t) => t.nodeId === id).map((t) => t.type));

describe('sub-folder depth (height)', () => {
  it('is 0 for a folder of only files and grows with nested folders', () => {
    expect(folderHeight(chain('a', 0))).toBe(0);
    expect(folderHeight(chain('a', 1))).toBe(1);
    expect(folderHeight(chain('a', 4))).toBe(4);
  });
});

describe('what each folder becomes', () => {
  it('a folder of only files is a village island (coast ring) and its files are houses', () => {
    const village = chain('v', 0);
    const parent = mk('p', 10, [village, chain('w', 0)]);
    expect(typesOf(parent, 'v')).toEqual(new Set(['island', 'coast']));
    const inside = new Set(layoutNode(village, 0).flat().filter((t) => t.nodeId).map((t) => t.type));
    expect(inside).toEqual(new Set(['house']));
  });
  it('1 to MAX_ISLAND_DEPTH - 1 levels below is an island', () => {
    for (let h = 1; h < MAX_ISLAND_DEPTH; h++) {
      const parent = mk('p', 10, [chain('c', h), chain('d', 0)]);
      expect(typesOf(parent, 'c'), 'height ' + h).toEqual(new Set(['island', 'coast']));
    }
  });
  it('MAX_ISLAND_DEPTH or more levels below is coral with no coast ring', () => {
    for (const h of [MAX_ISLAND_DEPTH, MAX_ISLAND_DEPTH + 2]) {
      const parent = mk('p', 10, [chain('c', h), chain('d', 0)]);
      expect(typesOf(parent, 'c'), 'height ' + h).toEqual(new Set(['coral']));
    }
  });
});

describe('loose files', () => {
  const mixed = mk('m', 20, [mk('sub', 5, [file('sub/f.txt')]), file('a.txt'), file('b.txt')]);
  it('are collected into one village island next to the sub-folders', () => {
    const kids = effectiveChildren(mixed);
    expect(kids.map((k) => k.id)).toEqual(['sub', 'm#files']);
    expect(kids[1].children.map((c) => c.id)).toEqual(['a.txt', 'b.txt']);
    expect(effectiveChildren(mixed)).toBe(kids); // memoised: layout and renderer share ids
    expect(typesOf(mixed, 'm#files')).toEqual(new Set(['island', 'coast']));
  });
  it('leave a folder with only files untouched', () => {
    const onlyFiles = mk('f', 5, [file('x'), file('y')]);
    expect(effectiveChildren(onlyFiles)).toBe(onlyFiles.children);
  });
});

describe('island size follows how many things must fit inside', () => {
  it('gives a folder with many sub-folders more land than one with few', () => {
    const many = mk('many', 5, Array.from({ length: 8 }, (_, i) => chain('m' + i, 0)));
    const few = mk('few', 5, [chain('f0', 0)]);
    const g = layoutNode(mk('r', 10, [many, few]), 0).flat();
    const area = (id: string) => g.filter((t) => t.nodeId === id).length;
    expect(area('many')).toBeGreaterThan(area('few'));
  });
});
