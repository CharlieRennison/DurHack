import { createNoise2D } from 'simplex-noise';
import { inBounds, neighbors } from '../grid';
import { GRID_SIZE, MAX_ISLAND_DEPTH, type Grid, type RepoNode, type Tile } from '../types';
import { hashString, mulberry32 } from './rng';

const MAX_CHILDREN = 100;
/** Share of the grid that is land at the root; sub-islands take less so the parent's lake stays open. */
const LAND_FRACTION = 0.5;
const SUB_LAND_FRACTION = 0.22;
/** Open-water cells kept between different islands. */
const ISLAND_GAP = 4;

/**
 * Lay out one node's direct children as islands in an ocean. Deterministic per node.path.
 * `allowed` (optional, grid[y][x]) restricts land to those cells; used to keep a node's
 * sub-islands inside the footprint of its own island on the parent grid.
 */
export function layoutNode(node: RepoNode, depth: number, allowed?: boolean[][]): Grid {
  // Children nested deeper than MAX_ISLAND_DEPTH become coral reefs instead of islands (no coast ring).
  const landType = depth + 1 > MAX_ISLAND_DEPTH ? 'coral' : 'island';
  const rand = mulberry32(hashString(node.path));
  const noise = createNoise2D(rand);

  const grid: Grid = Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, (): Tile => ({ type: 'ocean', variant: 0, height: 0 })),
  );

  // Biggest child nearest the centre; the rest on a jittered ring.
  const sorted = [...node.children]
    .sort((a, b) => b.size - a.size || a.id.localeCompare(b.id))
    .slice(0, MAX_CHILDREN);
  if (sorted.length === 0) return grid;

  const weights = sorted.map((c) => Math.sqrt(Math.max(c.size, 1)));
  const totalW = weights.reduce((a, b) => a + b, 0);
  const ok = (x: number, y: number) => !allowed || allowed[y][x];
  const okCells: [number, number][] = [];
  for (let y = 0; y < GRID_SIZE; y++) for (let x = 0; x < GRID_SIZE; x++) if (ok(x, y)) okCells.push([x, y]);
  if (okCells.length === 0) return grid;
  const landBudget = okCells.length * (allowed ? SUB_LAND_FRACTION : LAND_FRACTION);

  const centre = Math.round((GRID_SIZE - 1) / 2);
  const owner: number[][] = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(-1));
  let budgetScale = 1;
  let seeds: [number, number][];
  if (allowed) {
    seeds = maskedSeeds(sorted.length, okCells, rand);
  } else {
    const placed = packSeeds(sorted.length, weights.map((w) => (w / totalW) * landBudget), centre, rand);
    seeds = placed.seeds;
    budgetScale = placed.scale;
  }

  const claim = (x: number, y: number, i: number) => {
    owner[y][x] = i;
    grid[y][x] = { type: landType, variant: landType === 'coral' ? coralVariant(x, y) : 0, height: 1, nodeId: sorted[i].id };
  };
  // Claim every seed up front so a growing island can never swallow another's seed.
  seeds.forEach(([x, y], i) => {
    if (owner[y][x] === -1) claim(x, y, i);
  });

  // Region-grow each island towards its area budget with noise-weighted frontier picking.
  // Islands grow round-robin (one cell each per round) so none gets squeezed by an earlier one.
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
      // Prefer cells near the seed (compact blobs) with noise-perturbed edges.
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
      const free = neighbors(fx, fy).filter(
        ([nx, ny]) => owner[ny][nx] === -1 && ok(nx, ny) && !tooCloseToOther(owner, nx, ny, i),
      );
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

  // Smoothing: fill ocean pockets enclosed by one island on 3+ sides (cellular-automata style).
  for (let pass = 0; pass < 2; pass++) {
    const fills: [number, number, number][] = [];
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        if (owner[y][x] !== -1 || !ok(x, y)) continue;
        const counts = new Map<number, number>();
        for (const [nx, ny] of neighbors(x, y)) {
          const o = owner[ny][nx];
          if (o !== -1) counts.set(o, (counts.get(o) ?? 0) + 1);
        }
        for (const [o, c] of counts) if (c >= 3 && counts.size === 1) fills.push([x, y, o]);
      }
    }
    for (const [x, y, o] of fills) claim(x, y, o);
  }

  // Coast: land tiles with an ocean neighbour (variant 0 for now).
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const t = grid[y][x];
      if (t.type === 'island' && neighbors(x, y).some(([nx, ny]) => grid[ny][nx].type === 'ocean')) {
        t.type = 'coast';
      }
    }
  }
  return grid;
}

/**
 * Root seeds by greedy packing: biggest first, each island at the valid spot nearest the grid centre
 * that keeps ISLAND_GAP of open water to every placed island. Land budgets are scaled down (the
 * returned scale) only as far as needed for everything to fit.
 */
function packSeeds(
  n: number,
  budgets: number[],
  centre: number,
  rand: () => number,
): { seeds: [number, number][]; scale: number } {
  const tries = n <= 12 ? 3000 : 500;
  // Fixed candidate points so a smaller scale re-uses the same sequence (deterministic).
  const cand = Array.from({ length: tries }, () => [rand(), rand()] as const);
  for (let scale = 1; scale > 0.2; scale *= 0.94) {
    const radius = budgets.map((b) => Math.sqrt((b * scale) / Math.PI) + 0.5);
    // Attempt 0 centres the biggest island; later attempts move it off-centre to free up room.
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
          if (Math.hypot(x - seeds[j][0], y - seeds[j][1]) < radius[i] + radius[j] + ISLAND_GAP + 1) clear = false;
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
  // Could not pack (very many children): spread on a ring and shrink hard.
  const seeds: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = i === 0 ? 0 : GRID_SIZE * 0.35;
    seeds.push([Math.round(centre + Math.cos(a) * r), Math.round(centre + Math.sin(a) * r)]);
  }
  return { seeds, scale: 0.2 };
}

/** Seeds inside the allowed cells: biggest nearest their centroid, the rest by farthest-point sampling. */
function maskedSeeds(n: number, cells: [number, number][], rand: () => number): [number, number][] {
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
    for (let t = 0; t < 60; t++) {
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

/** Coral look per tile: 0 = bare reef floor, 1-5 = coral forms. Pure hash, so no PRNG state is consumed. */
export function coralVariant(x: number, y: number): number {
  const h = (Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263)) >>> 0;
  return (h >>> 8) % 6;
}

/** True if another island owns land within ISLAND_GAP cells of (x,y); keeps open water between islands. */
function tooCloseToOther(owner: number[][], x: number, y: number, me: number): boolean {
  for (let dy = -ISLAND_GAP; dy <= ISLAND_GAP; dy++) {
    for (let dx = -ISLAND_GAP; dx <= ISLAND_GAP; dx++) {
      if (!inBounds(x + dx, y + dy)) continue;
      const o = owner[y + dy][x + dx];
      if (o !== -1 && o !== me) return true;
    }
  }
  return false;
}
