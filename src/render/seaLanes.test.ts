import { describe, expect, it } from 'vitest';
import type { Grid, RepoNode, Tile } from '../types';
import {
  boatAt, boatsFor, dashes, DOCK_SECONDS, dockFor, isSea, lanesFor, lengthOf, MAX_LANES, pointAt, seeded, slice, smooth, waterRoute,
} from './seaLanes';

const file = (path: string): RepoNode => ({ id: path, kind: 'file', name: path, path, size: 1, children: [] });
const folder = (path: string, children: RepoNode[]): RepoNode => ({ id: path, kind: 'folder', name: path, path, size: 1, children });
const kids = (n: RepoNode) => n.children;

describe('lanesFor', () => {
  const a = folder('a', [file('a/x.py'), folder('a/sub', [file('a/sub/y.py')])]);
  const b = folder('b', [file('b/z.py')]);
  const c = folder('c', [file('c/w.py')]);
  it('sums imports per pair of islands, either way, and ignores imports inside one island', () => {
    const lanes = lanesFor([a, b, c], [
      ['a/x.py', 'b/z.py', 2],
      ['a/sub/y.py', 'b/z.py', 3],
      ['b/z.py', 'a/x.py', 1],
      ['a/x.py', 'a/sub/y.py', 9],
      ['c/w.py', 'a/x.py', 1],
      ['outside.py', 'a/x.py', 4],
    ], kids);
    expect(lanes).toEqual([
      { a: 0, b: 1, ab: 5, ba: 1 },
      { a: 2, b: 0, ab: 1, ba: 0 },
    ]);
  });
  it('puts the main importer first and keeps only the busiest lanes', () => {
    const many = Array.from({ length: 20 }, (_, i) => folder('m' + i, [file(`m${i}/f.py`)]));
    const edges = many.slice(1).map((_m, i) => [`m${i + 1}/f.py`, 'm0/f.py', i + 1] as [string, string, number]);
    const lanes = lanesFor(many, edges, kids);
    expect(lanes).toHaveLength(MAX_LANES);
    expect(lanes[0]).toEqual({ a: 19, b: 0, ab: 19, ba: 0 });
  });
});

describe('boatsFor', () => {
  it('is 1 boat for a light link, up to 3 for a busy one', () => {
    expect(boatsFor(1)).toBe(1);
    expect(boatsFor(5)).toBe(2);
    expect(boatsFor(500)).toBe(3);
  });
});

/** A 20 x 12 sea with two islands (ids 'A' and 'B') and a wall of land between them with a gap. */
function sea(): Grid {
  const g: Grid = Array.from({ length: 12 }, () => Array.from({ length: 20 }, (): Tile => ({ type: 'ocean', variant: 0, height: 0 })));
  for (let y = 4; y < 8; y++) for (let x = 1; x < 4; x++) g[y][x] = { type: 'island', variant: 0, height: 1, nodeId: 'A' };
  for (let y = 4; y < 8; y++) for (let x = 16; x < 19; x++) g[y][x] = { type: 'island', variant: 0, height: 1, nodeId: 'B' };
  for (let y = 0; y < 10; y++) g[y][10] = { type: 'island', variant: 0, height: 1, nodeId: 'C' }; // gap at y 10, 11
  return g;
}

describe('docks and routes', () => {
  it('docks on open water touching the island, on the side facing the other island', () => {
    const g = sea();
    const d = dockFor(g, 'A', [17, 5])!;
    expect(isSea(g, d[0], d[1])).toBe(true);
    expect(d[0]).toBe(4);
  });
  it('sails round land, never over it', () => {
    const g = sea();
    const route = waterRoute(g, dockFor(g, 'A', [17, 5])!, dockFor(g, 'B', [2, 5])!)!;
    expect(route).not.toBeNull();
    for (const [x, y] of route) expect(isSea(g, Math.floor(x), Math.floor(y))).toBe(true);
    expect(Math.max(...route.map(([, y]) => y))).toBeGreaterThan(10); // went through the gap
  });
  it('gives null when no water connects', () => {
    const g = sea();
    for (let y = 0; y < 12; y++) g[y][10] = { type: 'island', variant: 0, height: 1, nodeId: 'C' };
    expect(waterRoute(g, [4, 5], [15, 5])).toBeNull();
  });
  it('keeps the ends when smoothing', () => {
    const r: [number, number][] = [[0, 0], [5, 0], [5, 5]];
    const s = smooth(r);
    expect(s[0]).toEqual([0, 0]);
    expect(s[s.length - 1]).toEqual([5, 5]);
    expect(lengthOf(s)).toBeLessThan(lengthOf(r));
  });
});

describe('polyline helpers', () => {
  const line: [number, number][] = [[0, 0], [10, 0], [10, 10]];
  it('finds points along a route', () => {
    expect(pointAt(line, 0)).toMatchObject({ x: 0, y: 0 });
    expect(pointAt(line, 15)).toMatchObject({ x: 10, y: 5, dx: 0, dy: 1 });
    expect(pointAt(line, 99)).toMatchObject({ x: 10, y: 10 });
  });
  it('slices the part between two distances', () => {
    expect(slice(line, 5, 15)).toEqual([[5, 0], [10, 0], [10, 5]]);
    expect(lengthOf(slice(line, 2, 18))).toBeCloseTo(16, 9);
  });
  it('dashes a route', () => {
    const d = dashes(line, 1, 1);
    expect(d).toHaveLength(10);
    const shifted = dashes(line, 1, 1, 0.5);
    expect(shifted[0][0]).toEqual([0, 0]);
  });
});

describe('boatAt: back and forth', () => {
  const L = 10;
  const speed = 2;
  it('sails out, waits at the far dock, sails back, waits at home', () => {
    expect(boatAt(L, speed, 0, 0)).toEqual({ s: 0, dir: 1, from: 0 });
    expect(boatAt(L, speed, 0, 2.5)).toEqual({ s: 5, dir: 1, from: 0 });
    expect(boatAt(L, speed, 0, 5 + DOCK_SECONDS / 2)).toMatchObject({ s: L, dir: 0 });
    expect(boatAt(L, speed, 0, 5 + DOCK_SECONDS + 1)).toMatchObject({ s: 8, dir: -1, from: L });
    expect(boatAt(L, speed, 0, 10 + DOCK_SECONDS + 0.5)).toMatchObject({ s: 0, dir: 0 });
  });
  it('always stays on the route, and repeats', () => {
    for (let t = 0; t < 60; t += 0.13) {
      const b = boatAt(L, speed, 0.37, t);
      expect(b.s).toBeGreaterThanOrEqual(0);
      expect(b.s).toBeLessThanOrEqual(L + 1e-9);
    }
    const cycle = 2 * (L / speed + DOCK_SECONDS);
    expect(boatAt(L, speed, 0.2, 3)).toEqual(boatAt(L, speed, 0.2, 3 + cycle));
  });
  it('starts boats at different points along the lane', () => {
    const starts = Array.from({ length: 3 }, (_, k) => boatAt(L, speed, seeded('lane-x', k), 0).s);
    expect(new Set(starts.map((s) => s.toFixed(3))).size).toBe(3);
  });
  it('seeded numbers are stable and in range', () => {
    expect(seeded('a', 1)).toBe(seeded('a', 1));
    expect(seeded('a', 1)).not.toBe(seeded('a', 2));
    for (let k = 0; k < 50; k++) {
      expect(seeded('z', k)).toBeGreaterThanOrEqual(0);
      expect(seeded('z', k)).toBeLessThan(1);
    }
  });
});
