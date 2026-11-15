/**
 * One house per file or function. Pure and seeded (no Math.random): given the houses of a village (their tile
 * patches and their code size) it says which art size each gets and how big to draw it.
 *
 *  - Size by rank within the village: the biggest 15% are large buildings, the next 35% medium houses, the rest
 *    small huts, so every village has a mix and the biggest code stands out.
 *  - A tiny patch of tiles always gets a small hut (and a small one at most a medium), so a big building never
 *    spills onto its neighbours' patches.
 *  - A big village shows buildings for its biggest MAX_HOUSES houses only; the rest keep just their patch of ground.
 */

export type HouseSize = 'small' | 'medium' | 'large';

export interface HouseInput {
  id: string;
  /** Centre of the house's tile patch, in cells. */
  x: number;
  y: number;
  /** Tiles in the patch. */
  n: number;
  /** Code size (lines) of the file or function. */
  size: number;
}

export interface HousePlacement {
  id: string;
  x: number;
  y: number;
  size: HouseSize;
  /** Hash of the id (0..2^32): picks the art variant and mirroring. */
  hash: number;
  /** Drawn width of the whole 32 px canvas, in cells. */
  widthInTiles: number;
  /** Width of the shadow under the building, in cells. */
  shadowInTiles: number;
}

export const LARGE_SHARE = 0.15;
export const MEDIUM_SHARE = 0.35;
export const MAX_HOUSES = 40;
/** Widest a building may be drawn, in cells. */
export const MAX_BUILDING = 2.6;
/** Pixels of the 32 px canvas the building itself covers, per size (from the art). */
const BUILDING_PX: Record<HouseSize, number> = { small: 11, medium: 17, large: 24 };

export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function placeHouses(houses: HouseInput[]): HousePlacement[] {
  const ranked = [...houses].sort((a, b) => b.size - a.size || b.n - a.n || a.id.localeCompare(b.id)).slice(0, MAX_HOUSES);
  const count = ranked.length;
  return ranked.map((h, rank) => {
    const share = (rank + 0.5) / count;
    let size: HouseSize = share < LARGE_SHARE && count >= 4 ? 'large' : share < LARGE_SHARE + MEDIUM_SHARE ? 'medium' : 'small';
    if (h.n <= 2) size = 'small';
    else if (h.n <= 5 && size === 'large') size = 'medium';
    // The building covers about 0.45 x sqrt(tiles) cells across, within sensible limits.
    const building = Math.min(MAX_BUILDING, Math.max(0.8, 0.45 * Math.sqrt(h.n)));
    return {
      id: h.id,
      x: h.x,
      y: h.y,
      size,
      hash: hashString(h.id),
      widthInTiles: (building * 32) / BUILDING_PX[size],
      shadowInTiles: building * 1.1,
    };
  });
}
