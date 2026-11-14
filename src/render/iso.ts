export const TILE_W = 64;
export const TILE_H = 32;

/** Screen position of a tile's top vertex. */
export function gridToScreen(x: number, y: number): { x: number; y: number } {
  return { x: (x - y) * (TILE_W / 2), y: (x + y) * (TILE_H / 2) };
}

/** Exact inverse of gridToScreen: fractional grid coordinates (cell = floor of each). */
export function screenToCell(sx: number, sy: number): { x: number; y: number } {
  const a = sx / (TILE_W / 2);
  const b = sy / (TILE_H / 2);
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

/** Tile under a screen point (world space, before camera). The diamond centre is half a tile below the top vertex. */
export function screenToGrid(sx: number, sy: number): { x: number; y: number } {
  const a = sx / (TILE_W / 2);
  const b = (sy - TILE_H / 2) / (TILE_H / 2);
  return { x: Math.round((a + b) / 2), y: Math.round((b - a) / 2) };
}
