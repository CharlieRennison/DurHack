import { createNoise2D } from 'simplex-noise';
import { neighbors } from '../grid';
import { GRID_SIZE, type Grid, type RepoNode, type Tile } from '../types';
import { hashString, mulberry32 } from './rng';

const MAX_CHILDREN = 100;
const LAND_FRACTION = 0.45;

/** Lay out one node's direct children as islands in an ocean. Deterministic per node.path. */
export function layoutNode(node: RepoNode, _depth: number): Grid {
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
  const landBudget = GRID_SIZE * GRID_SIZE * LAND_FRACTION;

  const centre = Math.round((GRID_SIZE - 1) / 2);
  const owner: number[][] = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(-1));
  const clamp = (v: number) => Math.min(GRID_SIZE - 3, Math.max(2, Math.round(v)));
  const seeds: [number, number][] = sorted.map((_, i) => {
    if (i === 0) return [centre, centre];
    const angle = ((i - 1) / Math.max(sorted.length - 1, 1)) * Math.PI * 2 + rand() * 0.6;
    const r = GRID_SIZE * (0.28 + 0.1 * rand());
    return [clamp(centre + Math.cos(angle) * r), clamp(centre + Math.sin(angle) * r)];
  });

  const claim = (x: number, y: number, i: number) => {
    owner[y][x] = i;
    grid[y][x] = { type: 'island', variant: 0, height: 1, nodeId: sorted[i].id };
  };
  // Claim every seed up front so a growing island can never swallow another's seed.
  seeds.forEach(([x, y], i) => {
    if (owner[y][x] === -1) claim(x, y, i);
  });

  // Region-grow each island towards its area budget with noise-weighted frontier picking.
  sorted.forEach((_child, i) => {
    const budget = Math.max(3, Math.round((weights[i] / totalW) * landBudget));
    const [sx, sy] = seeds[i];
    if (owner[sy][sx] !== i) return;
    const frontier: [number, number][] = [[sx, sy]];
    let count = 1;
    let guard = 0;
    while (count < budget && frontier.length > 0 && guard++ < 5000) {
      let best = 0;
      let bestScore = -Infinity;
      for (let p = 0; p < Math.min(6, frontier.length); p++) {
        const idx = Math.floor(rand() * frontier.length);
        const [fx, fy] = frontier[idx];
        const score = noise(fx * 0.25, fy * 0.25) + rand() * 0.5;
        if (score > bestScore) {
          bestScore = score;
          best = idx;
        }
      }
      const [fx, fy] = frontier[best];
      const free = neighbors(fx, fy).filter(
        ([nx, ny]) => owner[ny][nx] === -1 && !touchesOther(owner, nx, ny, i),
      );
      if (free.length === 0) {
        frontier.splice(best, 1);
        continue;
      }
      const [nx, ny] = free[Math.floor(rand() * free.length)];
      claim(nx, ny, i);
      frontier.push([nx, ny]);
      count++;
    }
  });

  // Smoothing: fill ocean pockets enclosed by one island on 3+ sides (cellular-automata style).
  for (let pass = 0; pass < 2; pass++) {
    const fills: [number, number, number][] = [];
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        if (owner[y][x] !== -1) continue;
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

/** True if (x,y) is adjacent to land owned by a different island (keeps islands separated). */
function touchesOther(owner: number[][], x: number, y: number, me: number): boolean {
  for (const [nx, ny] of neighbors(x, y)) {
    const o = owner[ny][nx];
    if (o !== -1 && o !== me) return true;
  }
  return false;
}
