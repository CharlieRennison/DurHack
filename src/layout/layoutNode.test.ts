import { describe, expect, it } from 'vitest';
import { effectiveChildren, folderHeight } from './children';
import { layoutNode, MIN_ISLET_SEPARATION, MIN_ISLET_SIZE } from './layoutNode';
import { GRID_SIZE, MAX_ISLAND_DEPTH, type Grid, type RepoNode, type Tile } from '../types';

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

const isLand = (t: Tile) => t.type === 'island' || t.type === 'coast' || t.type === 'house';
/** Land cells of one child (its islet), as [x, y]. */
const isletOf = (g: Grid, id: string): [number, number][] => {
  const out: [number, number][] = [];
  g.forEach((row, y) => row.forEach((t, x) => { if (t.nodeId === id && isLand(t)) out.push([x, y]); }));
  return out;
};
/** Number of 4-connected pieces of a cell list. */
const pieces = (cells: [number, number][]): number => {
  const left = new Set(cells.map(([x, y]) => y * 100 + x));
  let n = 0;
  while (left.size) {
    n++;
    const stack = [left.values().next().value as number];
    left.delete(stack[0]);
    while (stack.length) {
      const k = stack.pop()!;
      for (const d of [1, -1, 100, -100]) if (left.delete(k + d)) stack.push(k + d);
    }
  }
  return n;
};
/** A folder of `n` sub-folders that each hold a file (so each is an island, not a village). */
const cluster = (n: number): RepoNode =>
  mk('r' + n, 100, Array.from({ length: n }, (_, i) => mk('r' + n + '/k' + i, 20 + (i % 5) * 10, [file('r' + n + '/k' + i + '/f', 3)])));
const kidsOf = (r: RepoNode) => effectiveChildren(r);

describe('islets and territories', () => {
  for (const n of [3, 10, 50]) {
    describe(n + ' children', () => {
      const r = cluster(n);
      const g = layoutNode(r, 0);
      it('gives every child an islet of at least the minimum size, in one piece', () => {
        for (const k of kidsOf(r)) {
          const cells = isletOf(g, k.id);
          expect(cells.length, k.id).toBeGreaterThanOrEqual(MIN_ISLET_SIZE);
          expect(pieces(cells), k.id).toBe(1);
        }
      });
      it('wraps every islet in shallow territory water carrying the child id', () => {
        for (const k of kidsOf(r)) {
          const ring = g.flat().filter((t) => t.nodeId === k.id && t.type === 'ocean');
          expect(ring.length, k.id).toBeGreaterThan(0);
          expect(ring.every((t) => t.variant === 1), k.id).toBe(true);
        }
      });
      it('keeps different islets at least the separation apart', () => {
        const owners = kidsOf(r).map((k) => isletOf(g, k.id));
        for (let a = 0; a < owners.length; a++) {
          for (let b = a + 1; b < owners.length; b++) {
            for (const [ax, ay] of owners[a]) {
              for (const [bx, by] of owners[b]) {
                if (Math.max(Math.abs(ax - bx), Math.abs(ay - by)) < MIN_ISLET_SEPARATION) throw new Error(`islets ${a} and ${b} touch`);
              }
            }
          }
        }
      });
    });
  }
  it('is deterministic for a big cluster', () => {
    expect(layoutNode(cluster(10), 0)).toEqual(layoutNode(cluster(10), 0));
  });
  it('uses deep water between root clusters and shallow water between islets inside a territory', () => {
    const allowed = Array.from({ length: GRID_SIZE }, (_, y) => Array.from({ length: GRID_SIZE }, (_, x) => x >= 6 && x < 40 && y >= 6 && y < 40));
    const inner = layoutNode(cluster(3), 0, allowed);
    expect(inner[20][2].variant).toBe(0); // outside the territory
    const open = inner.flat().filter((t, i) => !t.nodeId && allowed[(i / GRID_SIZE) | 0][i % GRID_SIZE]);
    expect(open.every((t) => t.variant === 1)).toBe(true);
    expect(layoutNode(cluster(3), 0).flat().filter((t) => !t.nodeId).every((t) => t.variant === 0)).toBe(true);
  });
  it('lands in the target share of the territory for 3, 10 and 50 children', () => {
    const allowed = Array.from({ length: GRID_SIZE }, (_, y) => Array.from({ length: GRID_SIZE }, (_, x) => x >= 4 && x < 44 && y >= 4 && y < 44));
    for (const [n, lo, hi] of [[3, 0.3, 0.6], [10, 0.3, 0.6], [50, 0.2, 0.6]] as const) {
      const g = layoutNode(cluster(n), 0, allowed);
      const share = g.flat().filter(isLand).length / (40 * 40);
      expect(share, n + ' children: ' + share.toFixed(2)).toBeGreaterThanOrEqual(lo);
      expect(share, n + ' children: ' + share.toFixed(2)).toBeLessThanOrEqual(hi);
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
/** Land tile types of a child on its parent's grid (the shallow ring round it is not counted). */
const typesOf = (parent: RepoNode, id: string) => new Set(layoutNode(parent, 0).flat().filter((t) => t.nodeId === id && t.type !== 'ocean').map((t) => t.type));

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
  it('even very deep folders are plain islands: there is no coral', () => {
    for (const h of [MAX_ISLAND_DEPTH, MAX_ISLAND_DEPTH + 2]) {
      const parent = mk('p', 10, [chain('c', h), chain('d', 0)]);
      expect(typesOf(parent, 'c'), 'height ' + h).toEqual(new Set(['island', 'coast']));
      expect(layoutNode(parent, 0).flat().some((t) => t.type === 'coral' || t.variant === 2)).toBe(false);
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

describe('home islet', () => {
  const sub = (n: number) => mk('h/s' + n, 20 + n * 10, [file('h/s' + n + '/f', 3)]);
  const home = mk('h', 100, [sub(1), sub(2), sub(3), sub(4), sub(5), file('h/a.txt', 500), file('h/b.txt', 500)]);
  const kids = effectiveChildren(home);
  const homeKid = kids.find((k) => k.id.endsWith('#files'))!;
  it('is named after its folder, not "files"', () => {
    expect(homeKid.name).toBe('h');
  });
  it('is the islet nearest the middle of the territory, at the root and inside a territory', () => {
    const allowed = Array.from({ length: GRID_SIZE }, (_, y) => Array.from({ length: GRID_SIZE }, (_, x) => x >= 6 && x < 40 && y >= 6 && y < 40));
    for (const [g, c] of [[layoutNode(home, 0), 23.5], [layoutNode(home, 0, allowed), 22.5]] as const) {
      const dist = (id: string) => {
        const cells = isletOf(g, id);
        const cx = cells.reduce((a, p) => a + p[0], 0) / cells.length;
        const cy = cells.reduce((a, p) => a + p[1], 0) / cells.length;
        return Math.hypot(cx - c, cy - c);
      };
      const d = dist(homeKid.id);
      for (const k of kids) if (k !== homeKid) expect(d, k.id).toBeLessThanOrEqual(dist(k.id));
    }
  });
});

describe('no functions layer', () => {
  const fn = (id: string): RepoNode => ({ id, kind: 'function', name: id, path: id, size: 3, children: [] });
  const withFns: RepoNode = { id: 'a.py', kind: 'file', name: 'a.py', path: 'a.py', size: 30, children: [fn('a.py#f'), fn('a.py#g')] };
  it('a file shows nothing under it, even if it has function nodes', () => {
    expect(effectiveChildren(withFns)).toEqual([]);
  });
  it('a folder of files with functions is a plain village of one house per file', () => {
    const folder = mk('d', 50, [withFns, { ...withFns, id: 'b.py', path: 'b.py', children: [fn('b.py#h')] }]);
    const g = layoutNode(folder, 0, Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(true)));
    expect(new Set(g.flat().filter((t) => t.type === 'house').map((t) => t.nodeId))).toEqual(new Set(['a.py', 'b.py']));
  });
});

describe('the root island is not dwarfed by big neighbours', () => {
  const huge = (name: string) => mk(name, 400000, [mk(name + '/x', 200000, [file(name + '/x/f', 9)]), mk(name + '/y', 200000, [file(name + '/y/f', 9)])]);
  const big = mk('big', 1000, [huge('h1'), huge('h2'), huge('h3'), huge('h4'), huge('h5'), huge('h6'), file('a.txt', 10), file('b.txt', 10)]);
  it('gives the home islet a good share of the land next to huge folders', () => {
    const g = layoutNode(big, 0);
    const land = (id: string) => g.flat().filter((t) => t.nodeId === id && t.type !== 'ocean').length;
    const home = land('big#files');
    const biggest = Math.max(...['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map(land));
    expect(home).toBeGreaterThanOrEqual(0.5 * biggest);
  });
  it('does not change an island inside a territory', () => {
    const allowed = Array.from({ length: GRID_SIZE }, (_, y) => Array.from({ length: GRID_SIZE }, (_, x) => x >= 6 && x < 40 && y >= 6 && y < 40));
    expect(layoutNode(big, 0, allowed)).toEqual(layoutNode(big, 0, allowed));
  });
});
