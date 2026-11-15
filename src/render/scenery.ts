/**
 * Where trees, bushes, rocks and tufts go on an islet. Pure and seeded (no Math.random), so the same repo always
 * grows the same forest, and testable without drawing anything.
 *
 * Per islet: a density between DENSITY_MIN and DENSITY_MAX of its eligible cells (varied by the islet's id, so some
 * islets are wooded and some open, but none bare or solid), clamped to at least MIN_TREES and at most MAX_SHARE of
 * the cells. Candidates are ranked by a grove noise field (so trees clump into groves with clearings) and accepted
 * best-first only if they keep MIN_SPACING from every tree already placed. Finally the empty space is populated: any
 * spot that is still more than FILL_GAP from every tree gets one (the emptiest spots first), so no islet is left with
 * a big bare stretch, while the spacing and MAX_SHARE keep it from getting crowded.
 */

export type SceneryKind = 'conifer' | 'leafy' | 'bush' | 'dead' | 'rock' | 'tuft';

export interface Placement {
  /** Cell the object belongs to. */
  i: number;
  j: number;
  /** Offset inside the cell, in cells (-0.25..0.25). */
  dx: number;
  dy: number;
  kind: SceneryKind;
  /** Per-object hash (0..2^32): picks the art variant, mirroring and tint. */
  hash: number;
}

export const DENSITY_MIN = 0.2;
export const DENSITY_MAX = 0.4;
/** No clearing is wider than this (cells): any spot farther than this from every tree gets one, up to MAX_SHARE. */
export const FILL_GAP = 2.5;
export const MIN_TREES = 2;
export const MAX_SHARE = 0.45;
/** Closest two trees may stand, in cells. */
export const MIN_SPACING = 1.3;
/** Rocks and tufts: a share of the cells, kept this far from trees. */
const EXTRA_SHARE = 0.06;
const EXTRA_SPACING = 0.9;

export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic hash of integer lattice coordinates and a seed, in [0, 1). */
export function lattice(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1]. */
export function valueNoise(x: number, y: number, seed = 0): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = lattice(x0, y0, seed) + (lattice(x0 + 1, y0, seed) - lattice(x0, y0, seed)) * sx;
  const b = lattice(x0, y0 + 1, seed) + (lattice(x0 + 1, y0 + 1, seed) - lattice(x0, y0 + 1, seed)) * sx;
  return a + (b - a) * sy;
}

/** How many trees an islet with `n` eligible cells gets. */
export function treeTarget(n: number, density: number): number {
  const lo = n >= 10 ? MIN_TREES : 0;
  const hi = Math.floor(n * MAX_SHARE);
  return Math.max(lo, Math.min(hi, Math.round(n * density)));
}

/**
 * Scenery for one islet. `cells` are the eligible cells (inland grass, away from shore and village core), `seed` is
 * the islet's id (its own density, groves and patches).
 */
export function placeScenery(cells: { i: number; j: number }[], seed: string): Placement[] {
  const n = cells.length;
  if (n === 0) return [];
  const s = hashString(seed);
  const density = DENSITY_MIN + (DENSITY_MAX - DENSITY_MIN) * lattice(s, 7, 1);
  const target = treeTarget(n, density);
  const off = (s % 997) * 3.17;
  const off2 = ((s >>> 10) % 991) * 2.71;
  const grove = (i: number, j: number) => valueNoise(i * 0.24 + off, j * 0.24 + off2, s);
  const patch = (i: number, j: number) => valueNoise(i * 0.11 + off2, j * 0.11 + off, s + 1);

  const spot = (c: { i: number; j: number }) => {
    const h = Math.floor(lattice(c.i, c.j, s + 2) * 4294967295);
    return { dx: ((h >> 3) % 51) / 100 - 0.25, dy: ((h >> 9) % 51) / 100 - 0.25, hash: h };
  };
  const ranked = cells
    .map((c) => ({ c, score: grove(c.i, c.j) + 0.35 * lattice(c.i, c.j, s + 3) }))
    .sort((a, b) => b.score - a.score || a.c.j - b.c.j || a.c.i - b.c.i);

  const out: Placement[] = [];
  const pos: [number, number][] = [];
  const clear = (x: number, y: number, d: number) => pos.every(([px, py]) => Math.hypot(px - x, py - y) >= d);

  for (const { c } of ranked) {
    if (out.length >= target) break;
    const { dx, dy, hash } = spot(c);
    const x = c.i + 0.5 + dx;
    const y = c.j + 0.5 + dy;
    if (!clear(x, y, MIN_SPACING)) continue;
    const g = grove(c.i, c.j);
    const roll = lattice(c.i, c.j, s + 4);
    let kind: SceneryKind;
    if (g < 0.34) kind = g < 0.4 && roll < 0.03 ? 'dead' : 'bush'; // the thin edge of a grove: bushes and the odd dead tree
    else {
      const conifer = patch(c.i, c.j) > 0.5;
      kind = (roll < 0.85 ? conifer : !conifer) ? 'conifer' : 'leafy';
    }
    out.push({ i: c.i, j: c.j, dx, dy, kind, hash });
    pos.push([x, y]);
  }

  // Populate the empty space: repeatedly plant the spot farthest from every tree while it is farther than FILL_GAP.
  const maxTrees = Math.floor(n * MAX_SHARE);
  if (out.length < maxTrees) {
    const spots = cells.map((c) => ({ c, x: c.i + 0.5, y: c.j + 0.5 }));
    const nearest = spots.map((p) => pos.reduce((m, [px, py]) => Math.min(m, Math.hypot(px - p.x, py - p.y)), Infinity));
    while (out.length < maxTrees) {
      let best = -1;
      let bestD = FILL_GAP;
      for (let k = 0; k < spots.length; k++) {
        if (nearest[k] > bestD) {
          bestD = nearest[k];
          best = k;
        }
      }
      if (best < 0) break;
      const c = spots[best].c;
      const { hash } = spot(c);
      const g = grove(c.i, c.j);
      const conifer = patch(c.i, c.j) > 0.5;
      const kind: SceneryKind = g < 0.34 ? 'bush' : (lattice(c.i, c.j, s + 6) < 0.85 ? conifer : !conifer) ? 'conifer' : 'leafy';
      const dx = 0;
      const dy = 0;
      out.push({ i: c.i, j: c.j, dx, dy, kind, hash });
      pos.push([c.i + 0.5, c.j + 0.5]);
      for (let k = 0; k < spots.length; k++) nearest[k] = Math.min(nearest[k], Math.hypot(spots[k].x - (c.i + 0.5), spots[k].y - (c.j + 0.5)));
    }
  }

  // Rocks and tufts in the clearings, kept off the trees.
  const extras = Math.round(n * EXTRA_SHARE);
  let made = 0;
  for (const c of [...cells].sort((a, b) => lattice(a.i, a.j, s + 5) - lattice(b.i, b.j, s + 5))) {
    if (made >= extras) break;
    const { dx, dy, hash } = spot(c);
    const x = c.i + 0.5 + dx;
    const y = c.j + 0.5 + dy;
    if (!clear(x, y, EXTRA_SPACING)) continue;
    out.push({ i: c.i, j: c.j, dx, dy, kind: hash % 2 === 0 ? 'rock' : 'tuft', hash });
    pos.push([x, y]);
    made++;
  }
  return out;
}
