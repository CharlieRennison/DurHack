/**
 * One house per file. Pure and seeded (no Math.random): given the houses of a village (their tile patches and their
 * code size) it says how tall each is and how wide to draw it.
 *
 *  - Every house is the same width: a village is a cluster of houses, not one big building.
 *  - Code size sets the height instead: floors = 1 for a file of median size or smaller, one more floor roughly each
 *    time the file doubles (up to MAX_FLOORS), so the biggest files are the tallest buildings.
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
  /** Storeys, 1..MAX_FLOORS. */
  floors: number;
  /** Art class for the fallback huts (when the manifest has no multi-floor houses). */
  size: HouseSize;
  /** Hash of the id (0..2^32): picks the art variant and mirroring. */
  hash: number;
  /** Width of the building (not the whole image), in cells: the same for every house. */
  width: number;
  /** Fallback huts: drawn width of the whole 32 px canvas, in cells. */
  widthInTiles: number;
  /** Width of the shadow under the building, in cells. */
  shadowInTiles: number;
}

export const MAX_HOUSES = 40;
export const MAX_FLOORS = 4;
/** How wide every house is drawn, in cells. */
export const HOUSE_WIDTH = 1.3;
/** Extra floors per doubling of code size above the village's median file. */
export const FLOORS_PER_DOUBLING = 0.8;
/** Pixels of the 32 px canvas a fallback hut covers, per art size. */
const BUILDING_PX: Record<HouseSize, number> = { small: 11, medium: 17, large: 24 };

export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Floors for a file of `size` lines in a village whose median file has `median` lines. */
export function floorsFor(size: number, median: number): number {
  if (!(median > 0) || !(size > 0)) return 1;
  return Math.min(MAX_FLOORS, Math.max(1, Math.round(1 + FLOORS_PER_DOUBLING * Math.log2(size / median))));
}

export function placeHouses(houses: HouseInput[]): HousePlacement[] {
  const sizes = houses.map((h) => h.size).sort((a, b) => a - b);
  const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;
  const ranked = [...houses].sort((a, b) => b.size - a.size || b.n - a.n || a.id.localeCompare(b.id)).slice(0, MAX_HOUSES);
  return ranked.map((h) => {
    const floors = floorsFor(h.size, median);
    const size: HouseSize = floors >= 3 ? 'large' : 'medium';
    return {
      id: h.id,
      x: h.x,
      y: h.y,
      floors,
      size,
      hash: hashString(h.id),
      width: HOUSE_WIDTH,
      widthInTiles: (HOUSE_WIDTH * 32) / BUILDING_PX[size],
      shadowInTiles: HOUSE_WIDTH * 1.1,
    };
  });
}
