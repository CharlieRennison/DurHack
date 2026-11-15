import { createNoise2D } from 'simplex-noise';
import { inBounds, neighbors, neighbors8 } from '../grid';
import { GRID_SIZE, type Grid, type RepoNode, type Tile } from '../types';
import { effectiveChildren, isVillage, LOOSE_FILES_SUFFIX } from './children';
import { hashString, mulberry32 } from './rng';
import { planVillage } from './villageTemplates';

const MAX_CHILDREN = 100;

/** Smallest islet a child gets (cells), whenever its share of the territory can hold that. */
export const MIN_ISLET_SIZE = 6;
/** Different children's islets are never closer than this (Chebyshev distance), so a channel always separates them. */
export const MIN_ISLET_SEPARATION = 3;

/**
 * How a node's children are placed.
 *  - ring: cells of shallow water round each islet that belong to that child (its territory).
 *  - sep: islets keep this many cells clear of another child's share of the grid (so channels are 2 * sep wide).
 *  - landFraction: share of the available cells that is islet land.
 */
interface Params {
  ring: number;
  sep: number;
  landFraction: number;
}
/** Root: territories are mostly water and clusters are far apart (deep water between them). */
const ROOT: Params = { ring: 2, sep: 3, landFraction: 0.8 };
/** Inside a territory: narrow channels between islets, about half of it land. */
const SUB: Params = { ring: 1, sep: 1, landFraction: 0.5 };

/** Houses in a village sit close together. */
const VILLAGE_GAP = 1;
const VILLAGE_LAND_FRACTION = 0.5;
const VILLAGE_SUB_LAND_FRACTION = 0.3;

const newGrid = (): Grid =>
  Array.from({ length: GRID_SIZE }, () => Array.from({ length: GRID_SIZE }, (): Tile => ({ type: 'ocean', variant: 0, height: 0 })));

/**
 * Lay out one node's direct children. Deterministic per node.path.
 *
 * A folder's children become a cluster of islets: each child gets a rounded islet (land) with a ring of shallow
 * water round it; islet + ring is that child's territory (every cell carries the child's nodeId). `allowed`
 * (optional, grid[y][x]) is the territory this node itself owns on its parent's grid: everything is placed inside it.
 * A village (a folder of only files, or a file's functions) places its houses directly instead.
 */
export function layoutNode(node: RepoNode, _depth: number, allowed?: boolean[][]): Grid {
  const rand = mulberry32(hashString(node.path));
  const grid = newGrid();
  // The home islet (a folder's own loose files) comes first, then the biggest children: the first gets the middle of the territory.
  const home = (c: RepoNode) => (c.id.endsWith(LOOSE_FILES_SUFFIX) ? 0 : 1);
  const kids = [...effectiveChildren(node)]
    .sort((a, b) => home(a) - home(b) || b.size - a.size || a.id.localeCompare(b.id))
    .slice(0, MAX_CHILDREN);
  if (kids.length === 0) return grid;
  if (isVillage(node)) return layoutVillage(grid, kids, allowed, rand, node.path);
  return layoutCluster(grid, kids, allowed, rand);
}

// ---- clusters of islets --------------------------------------------------------------------------------

function layoutCluster(grid: Grid, kids: RepoNode[], allowed: boolean[][] | undefined, rand: () => number): Grid {
  const params = allowed ? SUB : ROOT;
  const ok = (x: number, y: number) => inBounds(x, y) && (!allowed || allowed[y][x]);
  const okCells: [number, number][] = [];
  for (let y = 0; y < GRID_SIZE; y++) for (let x = 0; x < GRID_SIZE; x++) if (ok(x, y)) okCells.push([x, y]);
  if (okCells.length === 0) return grid;

  const n = kids.length;
  // Area weight: guaranteed room for every village, plus extra for more lines of code (sqrt so one folder cannot swallow the map).
  const weights = kids.map((c) => 4 + 2 * effectiveChildren(c).length + 1.5 * Math.sqrt(Math.max(0, c.size)));
  const totalW = weights.reduce((a, b) => a + b, 0);
  const landBudget = okCells.length * params.landFraction;
  const noise = createNoise2D(rand);

  // 1. Split the territory between the children: seeds spread by farthest-point sampling, then a few rounds of
  //    weighted Lloyd relaxation on an additively weighted nearest-seed partition (bigger weight = bigger share).
  const seeds = spreadSeeds(n, okCells, rand);
  // Half the share is equal for everyone, so even the lightest child keeps enough room for a minimum islet.
  const fairRadius = weights.map((w) => Math.sqrt(((0.5 / n + (0.5 * w) / totalW) * okCells.length) / Math.PI));
  const owner: number[][] = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(-1));
  const partition = () => {
    for (const [x, y] of okCells) {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < n; i++) {
        const d = Math.hypot(x - seeds[i][0], y - seeds[i][1]) - 0.6 * fairRadius[i];
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      owner[y][x] = best;
    }
    seeds.forEach(([sx, sy], i) => {
      if (ok(sx, sy)) owner[sy][sx] = i; // a child always keeps its own seed cell
    });
  };
  for (let round = 0; round < 3; round++) {
    partition();
    const sum = seeds.map(() => [0, 0, 0]);
    for (const [x, y] of okCells) {
      const s = sum[owner[y][x]];
      s[0] += x;
      s[1] += y;
      s[2]++;
    }
    sum.forEach((s, i) => {
      if (s[2] === 0) return;
      const cx = Math.round(s[0] / s[2]);
      const cy = Math.round(s[1] / s[2]);
      if (ok(cx, cy)) seeds[i] = [cx, cy];
    });
  }
  // The first child (the home islet, else the biggest) takes the seed nearest the middle of the territory.
  {
    const cx = okCells.reduce((a, c) => a + c[0], 0) / okCells.length;
    const cy = okCells.reduce((a, c) => a + c[1], 0) / okCells.length;
    let mid = 0;
    seeds.forEach((s, i) => {
      if (Math.hypot(s[0] - cx, s[1] - cy) < Math.hypot(seeds[mid][0] - cx, seeds[mid][1] - cy)) mid = i;
    });
    [seeds[0], seeds[mid]] = [seeds[mid], seeds[0]];
  }
  partition();

  // 2. Each child's islet may only use cells at least `sep` away from other children's cells (and `ring` away
  //    from the edge of the territory), so channels always separate islets and rings stay inside the territory.
  const coreFor = (sep: number): { core: number[][]; counts: number[] } => {
    const core: number[][] = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(-1));
    const counts = Array(n).fill(0);
    for (const [x, y] of okCells) {
      const me = owner[y][x];
      let clear = true;
      for (let dy = -sep; dy <= sep && clear; dy++) {
        for (let dx = -sep; dx <= sep; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          const edge = Math.max(Math.abs(dx), Math.abs(dy)) <= Math.min(params.ring, sep);
          if (!ok(nx, ny)) {
            if (edge) {
              clear = false;
              break;
            }
          } else if (owner[ny][nx] !== me) {
            clear = false;
            break;
          }
        }
      }
      if (clear) {
        core[y][x] = me;
        counts[me]++;
      }
    }
    return { core, counts };
  };
  let sep = params.sep;
  let { core, counts } = coreFor(sep);
  while (sep > 1 && counts.some((c) => c < MIN_ISLET_SIZE)) {
    sep--;
    ({ core, counts } = coreFor(sep));
  }
  const ring = Math.min(params.ring, sep);

  // 3. Grow a rounded islet for each child inside its core.
  const landOf: Set<number>[] = [];
  for (let i = 0; i < n; i++) {
    const cells: [number, number][] = [];
    for (const [x, y] of okCells) if (core[y][x] === i) cells.push([x, y]);
    const target = Math.max(MIN_ISLET_SIZE, (weights[i] / totalW) * landBudget);
    landOf.push(makeIslet(cells, seeds[i], target, i, noise, (x, y) => core[y][x] === i));
  }

  // 4. Write the tiles: islet land, then each child's shallow ring (its territory), then open water.
  landOf.forEach((set, i) => {
    for (const k of set) {
      const x = k % GRID_SIZE;
      const y = (k / GRID_SIZE) | 0;
      grid[y][x] = { type: 'island', variant: 0, height: 1, nodeId: kids[i].id };
    }
  });
  const R = ring + 0.4;
  landOf.forEach((set, i) => {
    for (const k of set) {
      const x = k % GRID_SIZE;
      const y = (k / GRID_SIZE) | 0;
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (!ok(nx, ny) || Math.hypot(dx, dy) > R || owner[ny][nx] !== i || grid[ny][nx].nodeId) continue;
          grid[ny][nx] = { type: 'ocean', variant: 1, height: 0, nodeId: kids[i].id };
        }
      }
    }
  });
  // Water inside this node's own territory but owned by no child is a shallow channel; the rest is deep sea.
  if (allowed) {
    for (const [x, y] of okCells) if (!grid[y][x].nodeId) grid[y][x].variant = 1;
  }
  // Coast: land tiles with an ocean neighbour.
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const t = grid[y][x];
      if (t.type === 'island' && (neighbors(x, y).length < 4 || neighbors(x, y).some(([nx, ny]) => grid[ny][nx].type === 'ocean'))) t.type = 'coast';
    }
  }
  return grid;
}

/**
 * A rounded islet inside `cells`: a noise-thresholded blob around `seed`, cleaned with 8-neighbour cellular
 * automata, reduced to its largest connected piece, holes filled, and sized to `target` cells (at least the minimum).
 */
function makeIslet(
  cells: [number, number][],
  seed: [number, number],
  target: number,
  index: number,
  noise: (x: number, y: number) => number,
  inCore: (x: number, y: number) => boolean,
): Set<number> {
  const key = (x: number, y: number) => y * GRID_SIZE + x;
  if (cells.length === 0) {
    // No room at all (tiny territory): a single cell at the seed keeps the child reachable.
    return new Set([key(seed[0], seed[1])]);
  }
  // Centre the blob on the core cell nearest the seed.
  let centre = cells[0];
  let bestD = Infinity;
  for (const c of cells) {
    const d = Math.hypot(c[0] - seed[0], c[1] - seed[1]);
    if (d < bestD) {
      bestD = d;
      centre = c;
    }
  }
  // A round blob cannot be bigger than the biggest circle that fits in the core, or it would just copy the core's
  // straight edges: cap the radius there (noise can still push it a little past).
  let inscribed = Infinity;
  for (let y = -1; y <= GRID_SIZE; y++) {
    for (let x = -1; x <= GRID_SIZE; x++) {
      if (inBounds(x, y) && inCore(x, y)) continue;
      inscribed = Math.min(inscribed, Math.hypot(x - centre[0], y - centre[1]));
    }
  }
  const cap = Math.max(1.5, inscribed * 1.3);
  const off = index * 37.7 + 11;
  const shape = (x: number, y: number) => {
    // domain-warped noise in [-1, 1]
    const wx = x + 2.4 * noise(x * 0.09 + off + 50, y * 0.09 + off);
    const wy = y + 2.4 * noise(x * 0.09 + off, y * 0.09 + off + 90);
    return noise(wx * 0.17 + off, wy * 0.17 + off);
  };
  const shaped = new Map<number, number>();
  for (const [x, y] of cells) shaped.set(key(x, y), shape(x, y));

  let land = new Set<number>();
  let radius = Math.min(cap, Math.sqrt(target / Math.PI));
  for (let attempt = 0; attempt < 6; attempt++) {
    let cur = new Set<number>();
    for (const [x, y] of cells) {
      if (Math.hypot(x - centre[0], y - centre[1]) / radius + 0.35 * shaped.get(key(x, y))! < 1) cur.add(key(x, y));
    }
    cur.add(key(centre[0], centre[1]));
    // two cellular-automata passes: land with 5+ land neighbours (of 8), water with 3 or fewer
    for (let pass = 0; pass < 2; pass++) {
      const next = new Set<number>();
      for (const [x, y] of cells) {
        let c = 0;
        for (const [nx, ny] of neighbors8(x, y)) if (cur.has(key(nx, ny))) c++;
        const was = cur.has(key(x, y));
        if (c >= 5 || (was && c > 3)) next.add(key(x, y));
      }
      if (next.size > 0) cur = next;
    }
    cur = largestPiece(cur);
    land = fillHoles(cur, inCore);
    const area = land.size;
    if (area >= target * 0.85 && area <= target * 1.2) break;
    if (area < target * 0.85 && (area >= cells.length || radius >= cap)) break; // as big as it can get
    radius = Math.min(cap, radius * Math.min(1.6, Math.max(0.7, Math.sqrt(target / Math.max(area, 1)))));
  }
  // Minimum size: grow back from the centre outwards if the clean-up shrank it too far.
  const want = Math.min(MIN_ISLET_SIZE, cells.length);
  if (land.size < want) {
    const byDist = [...cells].sort((a, b) => Math.hypot(a[0] - centre[0], a[1] - centre[1]) - Math.hypot(b[0] - centre[0], b[1] - centre[1]));
    for (const [x, y] of byDist) {
      if (land.size >= want) break;
      land.add(key(x, y));
    }
  }
  return land;
}

/** Keep only the biggest 4-connected group of cells. */
function largestPiece(set: Set<number>): Set<number> {
  const seen = new Set<number>();
  let best: number[] = [];
  for (const start of set) {
    if (seen.has(start)) continue;
    const comp: number[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const k = stack.pop()!;
      comp.push(k);
      const x = k % GRID_SIZE;
      const y = (k / GRID_SIZE) | 0;
      for (const [nx, ny] of neighbors(x, y)) {
        const nk = ny * GRID_SIZE + nx;
        if (set.has(nk) && !seen.has(nk)) {
          seen.add(nk);
          stack.push(nk);
        }
      }
    }
    if (comp.length > best.length) best = comp;
  }
  return new Set(best);
}

/** Fill water cells that the land fully encloses (single-cell and larger holes), as long as the cell may be land. */
function fillHoles(set: Set<number>, allowedCell: (x: number, y: number) => boolean): Set<number> {
  if (set.size === 0) return set;
  let x0 = GRID_SIZE, x1 = 0, y0 = GRID_SIZE, y1 = 0;
  for (const k of set) {
    const x = k % GRID_SIZE;
    const y = (k / GRID_SIZE) | 0;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  x0--; y0--; x1++; y1++;
  // flood the outside of the bounding box (padded by one)
  const outside = new Set<number>();
  const stack: [number, number][] = [[x0, y0]];
  outside.add(y0 * 1000 + x0);
  while (stack.length) {
    const [x, y] = stack.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < x0 || ny < y0 || nx > x1 || ny > y1) continue;
      const kk = ny * 1000 + nx;
      if (outside.has(kk) || (inBounds(nx, ny) && set.has(ny * GRID_SIZE + nx))) continue;
      outside.add(kk);
      stack.push([nx, ny]);
    }
  }
  const out = new Set(set);
  for (let y = y0 + 1; y < y1; y++) {
    for (let x = x0 + 1; x < x1; x++) {
      if (inBounds(x, y) && !outside.has(y * 1000 + x) && allowedCell(x, y)) out.add(y * GRID_SIZE + x);
    }
  }
  return out;
}

/** Seeds spread over the cells by farthest-point sampling; the first (biggest child) sits nearest the centre. */
function spreadSeeds(n: number, cells: [number, number][], rand: () => number): [number, number][] {
  const cx = cells.reduce((a, c) => a + c[0], 0) / cells.length;
  const cy = cells.reduce((a, c) => a + c[1], 0) / cells.length;
  let first = cells[0];
  let bestD = Infinity;
  for (const c of cells) {
    const d = (c[0] - cx) ** 2 + (c[1] - cy) ** 2;
    if (d < bestD) {
      bestD = d;
      first = c;
    }
  }
  const seeds: [number, number][] = [first];
  while (seeds.length < n) {
    let pick = cells[0];
    let pickD = -1;
    for (let t = 0; t < 80; t++) {
      const c = cells[Math.floor(rand() * cells.length)];
      const d = Math.min(...seeds.map((s) => (s[0] - c[0]) ** 2 + (s[1] - c[1]) ** 2));
      if (d > pickD) {
        pickD = d;
        pick = c;
      }
    }
    seeds.push(pick);
  }
  return seeds;
}

// ---- villages (houses placed directly) -----------------------------------------------------------------

function layoutVillage(grid: Grid, kids: RepoNode[], allowed: boolean[][] | undefined, rand: () => number, seed: string): Grid {
  const gap = VILLAGE_GAP;
  const noise = createNoise2D(rand);
  const sorted = kids;
  const weights = sorted.map((c) => 2 + effectiveChildren(c).length);
  const totalW = weights.reduce((a, b) => a + b, 0);
  const ok = (x: number, y: number) => !allowed || allowed[y][x];
  const okCells: [number, number][] = [];
  for (let y = 0; y < GRID_SIZE; y++) for (let x = 0; x < GRID_SIZE; x++) if (ok(x, y)) okCells.push([x, y]);
  if (okCells.length === 0) return grid;
  const landBudget = okCells.length * (allowed ? VILLAGE_SUB_LAND_FRACTION : VILLAGE_LAND_FRACTION);

  const centre = Math.round((GRID_SIZE - 1) / 2);
  const owner: number[][] = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(-1));
  let budgetScale = 1;
  let seeds: [number, number][];
  // Inside an islet the village follows a template (hamlet, ring, street...): houses, plazas with campfires and paths.
  const plan = allowed ? planVillage(sorted.length, allowed, seed) : null;
  if (plan && plan.houses.length === sorted.length) {
    seeds = plan.houses; // most central first, and the kids are sorted biggest first
    for (const [x, y] of [...plan.plazas, ...plan.paths]) owner[y][x] = -2; // reserved: houses never grow over them
  } else if (allowed) {
    seeds = spreadSeeds(sorted.length, okCells, rand);
  } else {
    const placed = packSeeds(sorted.length, weights.map((w) => (w / totalW) * landBudget), centre, rand, gap);
    seeds = placed.seeds;
    budgetScale = placed.scale;
  }

  const claim = (x: number, y: number, i: number) => {
    owner[y][x] = i;
    grid[y][x] = { type: 'house', variant: 0, height: 1, nodeId: sorted[i].id };
  };
  seeds.forEach(([x, y], i) => {
    if (owner[y][x] === -1) claim(x, y, i);
  });

  // Region-grow each house towards its area budget, round-robin so none gets squeezed by an earlier one.
  const states = sorted.map((_child, i) => ({
    budget: Math.max(3, Math.round((weights[i] / totalW) * landBudget * budgetScale)),
    frontier: owner[seeds[i][1]][seeds[i][0]] === i ? [[seeds[i][0], seeds[i][1]] as [number, number]] : [],
    count: 1,
  }));
  let active = true;
  for (let guard = 0; active && guard < 20000; guard++) {
    active = false;
    states.forEach((st, i) => {
      if (st.count >= st.budget || st.frontier.length === 0) return;
      active = true;
      let best = 0;
      let bestScore = -Infinity;
      const [sx, sy] = seeds[i];
      for (let p = 0; p < Math.min(16, st.frontier.length); p++) {
        const idx = Math.floor(rand() * st.frontier.length);
        const [fx, fy] = st.frontier[idx];
        const score = noise(fx * 0.2, fy * 0.2) * 0.8 - Math.hypot(fx - sx, fy - sy) * 0.15 + rand() * 0.15;
        if (score > bestScore) {
          bestScore = score;
          best = idx;
        }
      }
      const [fx, fy] = st.frontier[best];
      const free = neighbors(fx, fy).filter(([nx, ny]) => owner[ny][nx] === -1 && ok(nx, ny) && !tooCloseToOther(owner, nx, ny, i, gap));
      if (free.length === 0) {
        st.frontier.splice(best, 1);
        return;
      }
      const [nx, ny] = free[Math.floor(rand() * free.length)];
      claim(nx, ny, i);
      st.frontier.push([nx, ny]);
      st.count++;
    });
  }
  // Plazas, campfire spots and paths: 'village' tiles with no nodeId (variant 0 path, 1 plaza, 2 campfire).
  if (plan && plan.houses.length === sorted.length) {
    for (const [x, y] of plan.paths) grid[y][x] = { type: 'village', variant: 0, height: 0 };
    for (const [x, y] of plan.plazas) grid[y][x] = { type: 'village', variant: 1, height: 0 };
    for (const [x, y] of plan.fires) grid[y][x] = { type: 'village', variant: 2, height: 0 };
  }
  return grid;
}

/**
 * Root seeds for villages by greedy packing: biggest first, each at the valid spot nearest the grid centre
 * that keeps `gap` of open space to every placed house. Budgets are scaled down only as far as needed.
 */
function packSeeds(
  n: number,
  budgets: number[],
  centre: number,
  rand: () => number,
  gap: number,
): { seeds: [number, number][]; scale: number } {
  const tries = n <= 12 ? 3000 : 500;
  const cand = Array.from({ length: tries }, () => [rand(), rand()] as const);
  for (let scale = 1; scale > 0.2; scale *= 0.94) {
    const radius = budgets.map((b) => Math.sqrt((b * scale) / Math.PI) + 0.5);
    for (let attempt = 0; attempt < 8; attempt++) {
      const seeds: [number, number][] = [];
      let fits = true;
      for (let i = 0; i < n && fits; i++) {
        let best: [number, number] | null = null;
        let bestD = Infinity;
        const firstPick = i === 0 && attempt > 0 ? cand[attempt] : null;
        for (const [u, v] of firstPick ? [firstPick] : cand) {
          const lo = radius[i] + 1;
          const hi = GRID_SIZE - 1 - radius[i];
          if (hi <= lo) continue;
          const x = lo + u * (hi - lo);
          const y = lo + v * (hi - lo);
          let clear = true;
          for (let j = 0; j < seeds.length && clear; j++) {
            if (Math.hypot(x - seeds[j][0], y - seeds[j][1]) < radius[i] + radius[j] + gap + 1) clear = false;
          }
          if (!clear) continue;
          const d = Math.hypot(x - centre, y - centre);
          if (d < bestD) {
            bestD = d;
            best = [Math.round(x), Math.round(y)];
          }
        }
        if (best) seeds.push(best);
        else fits = false;
      }
      if (fits) return { seeds, scale };
    }
  }
  const seeds: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = i === 0 ? 0 : GRID_SIZE * 0.35;
    seeds.push([Math.round(centre + Math.cos(a) * r), Math.round(centre + Math.sin(a) * r)]);
  }
  return { seeds, scale: 0.2 };
}

/** True if another house owns a cell within `gap` of (x,y); keeps open space between houses. */
function tooCloseToOther(owner: number[][], x: number, y: number, me: number, gap: number): boolean {
  for (let dy = -gap; dy <= gap; dy++) {
    for (let dx = -gap; dx <= gap; dx++) {
      if (!inBounds(x + dx, y + dy)) continue;
      const o = owner[y + dy][x + dx];
      if (o !== -1 && o !== -2 && o !== me) return true;
    }
  }
  return false;
}
