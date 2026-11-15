/**
 * Sea lanes: boats that link modules (islands) that import from each other.
 *
 * Pure and seeded (no Math.random), so it can all be tested without drawing anything:
 *  - lanesFor: which pairs of sibling islands in a view import from each other, and how much (busiest first);
 *  - dockFor / waterRoute: where a lane's boats dock on each island and the route over open water between the docks;
 *  - boatAt: where a boat is at a time. Boats go back and forth: sail to one end, wait at the dock, sail back, wait,
 *    and so on. Every boat starts at its own random point of that cycle (seeded by the lane and the boat's number), so
 *    the boats are spread along their lanes, not stacked at the docks.
 *  - polyline helpers: point at a distance, the part sailed so far and the part still to go, dashed lines.
 */
import type { Grid, RepoNode } from '../types';

/** [importing file, imported file, number of import statements] */
export type ImportEdge = [string, string, number];

export interface Lane {
  /** Indexes into the children passed to lanesFor; `a` is the importer when only one way is used. */
  a: number;
  b: number;
  /** Import statements from a's files to b's, and from b's to a's. */
  ab: number;
  ba: number;
}

export const MAX_LANES = 12;
export const MAX_BOATS_PER_LANE = 3;
/** Seconds a boat waits at a dock before turning round. */
export const DOCK_SECONDS = 2;

/** Boats for a lane: 1 up to 3 imports, 2 up to 10, 3 beyond. */
export function boatsFor(total: number): number {
  return Math.min(MAX_BOATS_PER_LANE, total <= 3 ? 1 : total <= 10 ? 2 : 3);
}

/** Every file path below a node (files only). */
export function filesUnder(node: RepoNode, kids: (n: RepoNode) => RepoNode[]): string[] {
  if (node.kind === 'file') return [node.path];
  const out: string[] = [];
  for (const c of kids(node)) out.push(...filesUnder(c, kids));
  return out;
}

/**
 * The lanes between `children` (sibling islands in one view): import edges summed per pair of children, imports inside
 * one child left out (they show one level down). Busiest first, at most MAX_LANES.
 */
export function lanesFor(children: RepoNode[], edges: ImportEdge[], kids: (n: RepoNode) => RepoNode[]): Lane[] {
  const owner = new Map<string, number>();
  children.forEach((c, i) => {
    for (const f of filesUnder(c, kids)) owner.set(f, i);
  });
  const pair = new Map<string, Lane>();
  for (const [from, to, n] of edges) {
    const i = owner.get(from);
    const j = owner.get(to);
    if (i === undefined || j === undefined || i === j) continue;
    const a = Math.min(i, j);
    const b = Math.max(i, j);
    const k = a + ':' + b;
    const lane = pair.get(k) ?? { a, b, ab: 0, ba: 0 };
    if (i === a) lane.ab += n;
    else lane.ba += n;
    pair.set(k, lane);
  }
  return [...pair.values()]
    .map((l) => (l.ba > l.ab ? { a: l.b, b: l.a, ab: l.ba, ba: l.ab } : l)) // the importer first
    .sort((x, y) => y.ab + y.ba - (x.ab + x.ba) || x.a - y.a || x.b - y.b)
    .slice(0, MAX_LANES);
}

/**
 * Open water a boat may sail on: ocean that belongs to no island (channels and the deep sea), and, if `allowed` is
 * given, inside it (a view's own territory: water outside it is hidden by the view's mask).
 */
export function isSea(grid: Grid, x: number, y: number, allowed?: boolean[][]): boolean {
  const t = grid[y]?.[x];
  return !!t && t.type === 'ocean' && !t.nodeId && (!allowed || !!allowed[y]?.[x]);
}

/** The dock for island `id`: the open-water cell touching its territory that is nearest `toward` (cell coords). */
export function dockFor(grid: Grid, id: string, toward: [number, number], allowed?: boolean[][]): [number, number] | null {
  let best: [number, number] | null = null;
  let bd = Infinity;
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      if (!isSea(grid, x, y, allowed)) continue;
      const touches = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => grid[y + dy]?.[x + dx]?.nodeId === id);
      if (!touches) continue;
      const d = Math.hypot(x + 0.5 - toward[0], y + 0.5 - toward[1]);
      if (d < bd) {
        bd = d;
        best = [x, y];
      }
    }
  }
  return best;
}

/** The middle of island `id`'s cells (cell coords), or null if it has none. */
export function centreOf(grid: Grid, id: string): [number, number] | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  grid.forEach((row, y) => row.forEach((t, x) => {
    if (t.nodeId === id) {
      sx += x + 0.5;
      sy += y + 0.5;
      n++;
    }
  }));
  return n ? [sx / n, sy / n] : null;
}

/**
 * The shortest route over open water from one cell to another (A*, 8 directions, never cutting a corner of land),
 * as cell centres including both ends; null if there is none.
 */
export function waterRoute(grid: Grid, from: [number, number], to: [number, number], allowed?: boolean[][]): [number, number][] | null {
  const h = grid.length;
  const w = grid[0]?.length ?? 0;
  const key = (x: number, y: number) => y * w + x;
  const goal = key(to[0], to[1]);
  const g = new Map<number, number>([[key(from[0], from[1]), 0]]);
  const prev = new Map<number, number>();
  const open: { k: number; f: number }[] = [{ k: key(from[0], from[1]), f: 0 }];
  const done = new Set<number>();
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const { k } = open.splice(bi, 1)[0];
    if (done.has(k)) continue;
    done.add(k);
    if (k === goal) {
      const route: [number, number][] = [];
      for (let c: number | undefined = k; c !== undefined; c = prev.get(c)) route.push([(c % w) + 0.5, Math.floor(c / w) + 0.5]);
      return route.reverse();
    }
    const x = k % w;
    const y = Math.floor(k / w);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || !isSea(grid, nx, ny, allowed)) continue;
        if (dx && dy && (!isSea(grid, x + dx, y, allowed) || !isSea(grid, x, y + dy, allowed))) continue; // no squeezing past a corner
        const nk = key(nx, ny);
        const ng = g.get(k)! + (dx && dy ? Math.SQRT2 : 1);
        if (ng < (g.get(nk) ?? Infinity)) {
          g.set(nk, ng);
          prev.set(nk, k);
          open.push({ k: nk, f: ng + Math.hypot(to[0] - nx, to[1] - ny) });
        }
      }
    }
  }
  return null;
}

/** Round a route's corners (Chaikin), keeping its two ends. */
export function smooth(route: [number, number][], passes = 2): [number, number][] {
  let pts = route;
  for (let p = 0; p < passes && pts.length > 2; p++) {
    const out: [number, number][] = [pts[0]];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      out.push([x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25], [x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75]);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

/** Total length of a polyline. */
export function lengthOf(pts: [number, number][]): number {
  let L = 0;
  for (let i = 0; i + 1 < pts.length; i++) L += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  return L;
}

/** The point `s` along a polyline (clamped to its ends), and the direction of travel there (unit vector). */
export function pointAt(pts: [number, number][], s: number): { x: number; y: number; dx: number; dy: number } {
  let left = Math.max(0, s);
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const seg = Math.hypot(x1 - x0, y1 - y0);
    if (left <= seg || i + 2 === pts.length) {
      const t = seg > 0 ? Math.min(1, left / seg) : 0;
      return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, dx: seg > 0 ? (x1 - x0) / seg : 0, dy: seg > 0 ? (y1 - y0) / seg : 0 };
    }
    left -= seg;
  }
  const [x, y] = pts[0] ?? [0, 0];
  return { x, y, dx: 0, dy: 0 };
}

/** The part of a polyline between distances s0 and s1 (s0 < s1). */
export function slice(pts: [number, number][], s0: number, s1: number): [number, number][] {
  const out: [number, number][] = [];
  const a = pointAt(pts, s0);
  out.push([a.x, a.y]);
  let run = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    run += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    if (run > s0 && run < s1) out.push(pts[i + 1]);
  }
  const b = pointAt(pts, s1);
  out.push([b.x, b.y]);
  return out;
}

/** Dashes along a polyline: [start, end] point pairs, `dash` long with `gap` between, shifted by `offset`. */
export function dashes(pts: [number, number][], dash: number, gap: number, offset = 0): [[number, number], [number, number]][] {
  const L = lengthOf(pts);
  const out: [[number, number], [number, number]][] = [];
  const period = dash + gap;
  for (let s = -(((offset % period) + period) % period); s < L; s += period) {
    const a = Math.max(0, s);
    const b = Math.min(L, s + dash);
    if (b <= a) continue;
    const p = pointAt(pts, a);
    const q = pointAt(pts, b);
    out.push([[p.x, p.y], [q.x, q.y]]);
  }
  return out;
}

export interface BoatState {
  /** Distance along the route from its start (the importer's dock). */
  s: number;
  /** +1 sailing towards the end, -1 sailing back to the start; 0 while docked. */
  dir: number;
  /** Where the current trip began: the distance it left from (0 or the route length). */
  from: number;
}

/**
 * A boat on a route of length L, going back and forth at `speed`, waiting DOCK_SECONDS at each end. `phase` (0..1)
 * says where in that cycle it was at time 0, so boats can start anywhere along the lane.
 */
export function boatAt(L: number, speed: number, phase: number, time: number): BoatState {
  const leg = L / Math.max(speed, 1e-6);
  const cycle = 2 * (leg + DOCK_SECONDS);
  const u = (((time + phase * cycle) % cycle) + cycle) % cycle;
  if (u < leg) return { s: speed * u, dir: 1, from: 0 };
  if (u < leg + DOCK_SECONDS) return { s: L, dir: 0, from: 0 };
  if (u < 2 * leg + DOCK_SECONDS) return { s: L - speed * (u - leg - DOCK_SECONDS), dir: -1, from: L };
  return { s: 0, dir: 0, from: L };
}

export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A seeded number in [0, 1) for a lane and a boat: the boat's starting point in its cycle, or its speed. */
export function seeded(seed: string, k: number, salt = 0): number {
  let h = hashString(`${seed}#${k}#${salt}`);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
