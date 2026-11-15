import { describe, expect, it } from 'vitest';
import { FILL_GAP, MAX_SHARE, MIN_SPACING, MIN_TREES, placeScenery, treeTarget, type Placement } from './scenery';

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

describe('populating the empty space', () => {
  it('leaves no clearing wider than FILL_GAP (unless the cap on trees is reached)', () => {
    for (const [w, h] of [[14, 14], [24, 24], [30, 12]] as const) {
      for (const seed of ['a', 'b', 'c', 'd', 'e']) {
        const cells = block(w, h);
        const ps = placeScenery(cells, seed);
        const t = trees(ps);
        if (t.length >= Math.floor(w * h * MAX_SHARE)) continue;
        for (const c of cells) {
          const d = Math.min(...t.map((p) => Math.hypot(p.i + 0.5 + p.dx - (c.i + 0.5), p.j + 0.5 + p.dy - (c.j + 0.5))));
          expect(d, `${w}x${h} ${seed}`).toBeLessThanOrEqual(FILL_GAP + 1e-9);
        }
      }
    }
  });
  it('keeps the spacing and the cap while filling', () => {
    const cells = block(24, 24);
    const t = trees(placeScenery(cells, 'full'));
    expect(t.length).toBeLessThanOrEqual(Math.floor(cells.length * MAX_SHARE));
    for (let a = 0; a < t.length; a++) {
      for (let b = a + 1; b < t.length; b++) {
        const d = Math.hypot(t[a].i + t[a].dx - (t[b].i + t[b].dx), t[a].j + t[a].dy - (t[b].j + t[b].dy));
        expect(d).toBeGreaterThanOrEqual(MIN_SPACING - 1e-9);
      }
    }
  });
});
