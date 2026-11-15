/**
 * Village templates: where a village's houses, plazas, campfires and paths go. Pure and seeded (no Math.random).
 *
 * Each template is drawn in a unit circle (-1..1), then rotated, scaled and moved onto the village's islet and
 * snapped to cells it may use, so two villages of the same template still look different. The choice of template
 * depends on how many houses there are and a hash of the village's id.
 */
import { GRID_SIZE } from '../types';

export type TemplateName = 'hamlet' | 'ring' | 'street' | 'crossroads' | 'twin' | 'square' | 'farmsteads';

export interface VillagePlan {
  template: TemplateName;
  /** One seed cell per house, most central first. */
  houses: [number, number][];
  /** Open ground round the campfires (includes the campfire cells). */
  plazas: [number, number][];
  /** The campfire cells (each also in plazas). */
  fires: [number, number][];
  /** Dirt path cells between plazas and out to the edge. */
  paths: [number, number][];
}

/** Closest two house seeds may be, in cells (relaxed down to MIN_SPACING_FLOOR when the islet is cramped). */
export const MIN_HOUSE_SPACING = 3;
const MIN_SPACING_FLOOR = 1.5;

export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Which templates suit a village of `n` houses. */
export function templatesFor(n: number): TemplateName[] {
  if (n <= 3) return ['hamlet', 'farmsteads'];
  if (n <= 5) return ['hamlet', 'ring', 'farmsteads'];
  if (n <= 7) return ['ring', 'street', 'farmsteads'];
  if (n <= 12) return ['ring', 'street', 'twin', 'crossroads'];
  if (n <= 24) return ['street', 'crossroads', 'twin', 'square'];
  return ['crossroads', 'square'];
}

type P = [number, number];
interface Raw {
  houses: P[];
  /** plaza centres in unit coordinates and their radius in cells */
  plazas: { at: P; r: number; fire: boolean }[];
  /** polylines in unit coordinates */
  paths: P[][];
}

const ring = (n: number, r: number, phase = 0, jitter = 0, rnd: () => number = () => 0.5): P[] =>
  Array.from({ length: n }, (_, k) => {
    const a = phase + (k / n) * Math.PI * 2 + (rnd() - 0.5) * jitter;
    const rr = r * (1 + (rnd() - 0.5) * jitter * 0.6);
    return [Math.cos(a) * rr, Math.sin(a) * rr] as P;
  });

function raw(template: TemplateName, n: number, rnd: () => number): Raw {
  switch (template) {
    case 'hamlet':
      return { houses: ring(n, 0.55, rnd() * 6, 0.9, rnd), plazas: [{ at: [0, 0], r: 1.6, fire: true }], paths: [] };
    case 'ring': {
      const gap = rnd() * Math.PI * 2; // the road leaves the ring here
      return {
        houses: ring(n, n > 8 ? 0.8 : 0.65, gap + 0.35, 0.15, rnd),
        plazas: [{ at: [0, 0], r: n > 8 ? 2.4 : 1.8, fire: true }],
        paths: [[[0, 0], [Math.cos(gap) * 1.1, Math.sin(gap) * 1.1]]],
      };
    }
    case 'street': {
      const per = Math.ceil(n / 2);
      const houses: P[] = [];
      for (let k = 0; k < n; k++) {
        const side = k % 2 === 0 ? -1 : 1;
        const along = Math.floor(k / 2);
        houses.push([-0.85 + (along / Math.max(1, per - 1)) * 1.7 + (rnd() - 0.5) * 0.08, side * (0.34 + rnd() * 0.08)]);
      }
      return { houses, plazas: [{ at: [0, 0], r: 1.5, fire: true }], paths: [[[-1.05, 0], [1.05, 0]]] };
    }
    case 'crossroads': {
      const houses: P[] = [];
      const per = Math.ceil(n / 4);
      for (let k = 0; k < n; k++) {
        const arm = k % 4; // 0:+x 1:+y 2:-x 3:-y
        const step = 0.3 + (Math.floor(k / 4) / Math.max(1, per)) * 0.65;
        const side = (Math.floor(k / 4) % 2 === 0 ? 1 : -1) * 0.3;
        houses.push(arm % 2 === 0 ? [(arm === 0 ? 1 : -1) * step, side] : [side, (arm === 1 ? 1 : -1) * step]);
      }
      return { houses, plazas: [{ at: [0, 0], r: 1.8, fire: true }], paths: [[[-1.05, 0], [1.05, 0]], [[0, -1.05], [0, 1.05]]] };
    }
    case 'twin': {
      const a = Math.ceil(n / 2);
      return {
        houses: [
          ...ring(a, 0.32, rnd() * 6, 0.2, rnd).map(([x, y]) => [x - 0.5, y] as P),
          ...ring(n - a, 0.32, rnd() * 6, 0.2, rnd).map(([x, y]) => [x + 0.5, y] as P),
        ],
        plazas: [{ at: [-0.5, 0], r: 1.5, fire: true }, { at: [0.5, 0], r: 1.5, fire: true }],
        paths: [[[-0.5, 0], [0.5, 0]]],
      };
    }
    case 'square': {
      const inner = Math.min(n, Math.max(6, Math.round(n * 0.4)));
      return {
        houses: [...ring(inner, 0.5, rnd() * 6, 0.1, rnd), ...ring(n - inner, 0.85, rnd() * 6, 0.1, rnd)],
        plazas: [{ at: [-0.1, 0], r: 2.4, fire: true }, { at: [0.12, 0.05], r: 2.4, fire: n > 18 }],
        paths: [[[0, 0], [1.05, 0.4]], [[0, 0], [-1.05, -0.4]]],
      };
    }
    case 'farmsteads': {
      const houses: P[] = [];
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + rnd() * 0.8;
        const r = 0.35 + rnd() * 0.55;
        houses.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      return { houses, plazas: [], paths: [[[-1, rnd() - 0.5], [-0.3, rnd() * 0.4], [0.4, rnd() * 0.4 - 0.2], [1, rnd() - 0.5]]] };
    }
  }
}

/** Cells along a straight line (Bresenham). */
function line(a: P, b: P): P[] {
  const out: P[] = [];
  let [x0, y0] = a;
  const [x1, y1] = b;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (let guard = 0; guard < 400; guard++) {
    out.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
  return out;
}

/**
 * Plan a village of `n` houses inside `region` (region[y][x] = the cell may be used). Returns null if the region has
 * no cells at all.
 */
export function planVillage(n: number, region: boolean[][], seed: string): VillagePlan | null {
  const cells: P[] = [];
  for (let y = 0; y < GRID_SIZE; y++) for (let x = 0; x < GRID_SIZE; x++) if (region[y]?.[x]) cells.push([x, y]);
  if (cells.length === 0 || n <= 0) return null;
  const h = hashString(seed);
  let a = h;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const options = templatesFor(n);
  const template = options[h % options.length];
  const r0 = raw(template, n, rnd);

  // Fit: centre on the region's centroid, radius from its area, rotate by a seeded angle.
  const cx = cells.reduce((s, c) => s + c[0], 0) / cells.length;
  const cy = cells.reduce((s, c) => s + c[1], 0) / cells.length;
  const R = Math.max(2, Math.sqrt(cells.length / Math.PI) * 0.92);
  const rot = rnd() * Math.PI * 2;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const place = ([x, y]: P): P => [cx + (x * cos - y * sin) * R, cy + (x * sin + y * cos) * R];
  const inRegion = (x: number, y: number) => !!region[y]?.[x];
  const nearestCell = (t: P, ok: (x: number, y: number) => boolean): P | null => {
    let best: P | null = null;
    let bd = Infinity;
    for (const c of cells) {
      if (!ok(c[0], c[1])) continue;
      const d = (c[0] - t[0]) ** 2 + (c[1] - t[1]) ** 2;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  };

  // Plazas, then paths (kept to the region), then houses on what is left.
  const reserved = new Set<number>();
  const key = (x: number, y: number) => y * GRID_SIZE + x;
  const plazas: P[] = [];
  const fires: P[] = [];
  for (const pl of r0.plazas) {
    const centre = nearestCell(place(pl.at), inRegion);
    if (!centre) continue;
    const rr = Math.max(1.2, pl.r * Math.min(1, R / 9));
    for (const c of cells) {
      if (Math.hypot(c[0] - centre[0], c[1] - centre[1]) <= rr && !reserved.has(key(c[0], c[1]))) {
        reserved.add(key(c[0], c[1]));
        plazas.push(c);
      }
    }
    if (pl.fire) fires.push(centre);
  }
  const paths: P[] = [];
  for (const pl of r0.paths) {
    for (let i = 0; i + 1 < pl.length; i++) {
      const p0 = place(pl[i]).map(Math.round) as P;
      const p1 = place(pl[i + 1]).map(Math.round) as P;
      for (const c of line(p0, p1)) {
        if (inRegion(c[0], c[1]) && !reserved.has(key(c[0], c[1]))) {
          reserved.add(key(c[0], c[1]));
          paths.push(c);
        }
      }
    }
  }

  const free = (x: number, y: number) => inRegion(x, y) && !reserved.has(key(x, y));
  const houses: P[] = [];
  for (const target of r0.houses.map(place)) {
    let spacing = MIN_HOUSE_SPACING;
    let chosen: P | null = null;
    for (;;) {
      let bd = Infinity;
      for (const c of cells) {
        if (!free(c[0], c[1]) || houses.some((q) => Math.hypot(q[0] - c[0], q[1] - c[1]) < spacing)) continue;
        const d = (c[0] - target[0]) ** 2 + (c[1] - target[1]) ** 2;
        if (d < bd) {
          bd = d;
          chosen = c;
        }
      }
      if (chosen || spacing <= MIN_SPACING_FLOOR) break;
      spacing -= 0.5;
    }
    // Still nothing (a very cramped islet): take any free cell not already used as a house.
    if (!chosen) chosen = cells.find((c) => free(c[0], c[1]) && !houses.some((q) => q[0] === c[0] && q[1] === c[1])) ?? null;
    if (chosen) houses.push(chosen);
  }
  // Most central first: the biggest file gets the heart of the village.
  houses.sort((p, q) => Math.hypot(p[0] - cx, p[1] - cy) - Math.hypot(q[0] - cx, q[1] - cy));
  return { template, houses, plazas, fires, paths };
}
