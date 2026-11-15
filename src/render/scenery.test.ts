import { describe, expect, it } from 'vitest';
import { MAX_SHARE, MIN_SPACING, MIN_TREES, placeScenery, treeTarget, type Placement } from './scenery';

/** A w x h block of eligible cells. */
const block = (w: number, h: number) => Array.from({ length: w * h }, (_, k) => ({ i: 3 + (k % w), j: 3 + Math.floor(k / w) }));
const trees = (ps: Placement[]) => ps.filter((p) => p.kind !== 'rock' && p.kind !== 'tuft');

describe('placeScenery', () => {
  it('is deterministic', () => {
    expect(placeScenery(block(12, 12), 'a/b')).toEqual(placeScenery(block(12, 12), 'a/b'));
  });
  it('differs between islets', () => {
    expect(placeScenery(block(12, 12), 'a/b')).not.toEqual(placeScenery(block(12, 12), 'a/c'));
  });
  it('never places two trees closer than the minimum spacing', () => {
    for (const seed of ['x', 'y', 'z', 'src/flask']) {
      const t = trees(placeScenery(block(14, 14), seed));
      for (let a = 0; a < t.length; a++) {
        for (let b = a + 1; b < t.length; b++) {
          const d = Math.hypot(t[a].i + t[a].dx - (t[b].i + t[b].dx), t[a].j + t[a].dy - (t[b].j + t[b].dy));
          expect(d, seed).toBeGreaterThanOrEqual(MIN_SPACING - 1e-9);
        }
      }
    }
  });
  it('keeps every object on one of the given cells', () => {
    const cells = block(10, 10).filter((c) => (c.i + c.j) % 3 !== 0);
    const ok = new Set(cells.map((c) => c.i * 1000 + c.j));
    for (const p of placeScenery(cells, 'seed')) expect(ok.has(p.i * 1000 + p.j)).toBe(true);
  });
  it('is neither bare nor crowded, whatever the islet', () => {
    for (const [w, h] of [[4, 4], [6, 6], [12, 12], [24, 24]] as const) {
      for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
        const n = w * h;
        const t = trees(placeScenery(block(w, h), seed)).length;
        if (n >= 10) expect(t, `${w}x${h} ${seed}`).toBeGreaterThanOrEqual(Math.min(MIN_TREES, 2) - 1); // spacing can cost at most one
        expect(t, `${w}x${h} ${seed}`).toBeLessThanOrEqual(Math.floor(n * MAX_SHARE));
      }
    }
  });
  it('gives nothing to an islet with no eligible cells', () => {
    expect(placeScenery([], 'x')).toEqual([]);
  });
  it('treeTarget respects the minimum and the maximum share', () => {
    expect(treeTarget(20, 0)).toBe(MIN_TREES);
    expect(treeTarget(100, 1)).toBe(45);
    expect(treeTarget(5, 1)).toBe(2);
  });
  it('mixes kinds on a big islet', () => {
    const kinds = new Set(placeScenery(block(30, 30), 'big').map((p) => p.kind));
    expect(kinds.has('conifer') || kinds.has('leafy')).toBe(true);
    expect(kinds.size).toBeGreaterThanOrEqual(3);
  });
});
