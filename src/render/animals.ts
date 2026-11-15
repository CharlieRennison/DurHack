import { makeWalkers, walkableCells, type Walker } from './people';

/**
 * Animals (sheep, foxes, deer) wandering the islands: one or two per island. An island here is a connected patch of
 * walkable land. Pure and seeded (no Math.random): the same view always gets the same animals. They reuse the
 * collaborators' walker (stand, pick a spot, walk a breadth-first route), confined to their own patch, and a bit slower.
 */
export const ANIMAL_KINDS = 3;
/** Patches smaller than this get no animal; from BIG_PATCH cells up they get two. */
export const MIN_PATCH = 10;
export const BIG_PATCH = 70;
/** At most this many animals per view (the biggest patches first). */
export const MAX_PER_VIEW = 8;
const SLOWER = 0.6;

export interface Animal {
  walker: Walker;
  /** The walkable cells of this animal's island, as a mask and a list. */
  mask: boolean[][];
  cells: [number, number][];
}

/** Connected patches (4-neighbour) of walkable cells, biggest first. */
export function patches(walkable: boolean[][]): [number, number][][] {
  const h = walkable.length;
  const w = walkable[0]?.length ?? 0;
  const seen = Array.from({ length: h }, () => Array<boolean>(w).fill(false));
  const out: [number, number][][] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!walkable[y][x] || seen[y][x]) continue;
      const patch: [number, number][] = [];
      const stack: [number, number][] = [[x, y]];
      seen[y][x] = true;
      while (stack.length > 0) {
        const [cx, cy] = stack.pop()!;
        patch.push([cx, cy]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && walkable[ny][nx] && !seen[ny][nx]) {
            seen[ny][nx] = true;
            stack.push([nx, ny]);
          }
        }
      }
      out.push(patch);
    }
  }
  return out.sort((a, b) => b.length - a.length);
}

/** One or two animals for each island (patch) of the walkable land of a view. */
export function makeAnimals(walkable: boolean[][], seed: string, prefix = 'animal'): Animal[] {
  const out: Animal[] = [];
  const h = walkable.length;
  const w = walkable[0]?.length ?? 0;
  patches(walkable).forEach((patch, p) => {
    if (patch.length < MIN_PATCH || out.length >= MAX_PER_VIEW) return;
    const mask = Array.from({ length: h }, () => Array<boolean>(w).fill(false));
    for (const [x, y] of patch) mask[y][x] = true;
    const count = patch.length >= BIG_PATCH ? 2 : 1;
    const names = Array.from({ length: Math.min(count, MAX_PER_VIEW - out.length) }, (_, k) => `${prefix} ${p}.${k}`);
    for (const walker of makeWalkers(names, mask, `${seed}|${p}`)) {
      walker.speed *= SLOWER;
      out.push({ walker, mask, cells: walkableCells(mask) });
    }
  });
  return out;
}

/**
 * Cosmetic boats drifting about the open sea: `count` walkers that share one mask of water cells (so they sail the
 * channels between the islands). Seeded; slower than the animals.
 */
export function makeBoats(water: boolean[][], seed: string, count: number): Animal[] {
  const biggest = patches(water)[0];
  if (!biggest || biggest.length < 30) return [];
  const mask = Array.from({ length: water.length }, () => Array<boolean>(water[0]?.length ?? 0).fill(false));
  for (const [x, y] of biggest) mask[y][x] = true;
  const cells = walkableCells(mask);
  return makeWalkers(Array.from({ length: count }, (_, k) => `boat ${k}`), mask, seed + '#boats').map((walker) => {
    walker.speed *= 0.7;
    return { walker, mask, cells };
  });
}

/** The folder's baby dinosaur: one walker on the biggest island of the view (null if there is no room). */
export function makeDino(walkable: boolean[][], seed: string): Animal | null {
  const biggest = patches(walkable)[0];
  if (!biggest || biggest.length < 4) return null;
  const mask = Array.from({ length: walkable.length }, () => Array<boolean>(walkable[0]?.length ?? 0).fill(false));
  for (const [x, y] of biggest) mask[y][x] = true;
  const [walker] = makeWalkers(['dino'], mask, seed + '#dino');
  walker.speed *= SLOWER;
  return { walker, mask, cells: walkableCells(mask) };
}

/** Which kind of animal (0..ANIMAL_KINDS-1) a walker is. */
export const kindOf = (walker: Walker): number => walker.variant % ANIMAL_KINDS;
