import { GRID_SIZE } from './types';

export function inBounds(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < GRID_SIZE && y < GRID_SIZE;
}

/** In-bounds 4-neighbours. All neighbour logic lives here so hexes stay possible. */
export function neighbors(x: number, y: number): [number, number][] {
  const out: [number, number][] = [];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const nx = x + dx;
    const ny = y + dy;
    if (inBounds(nx, ny)) out.push([nx, ny]);
  }
  return out;
}
