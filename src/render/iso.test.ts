import { expect, it } from 'vitest';
import { gridToScreen, screenToGrid, TILE_H } from './iso';

it('round-trips grid -> screen -> grid', () => {
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const s = gridToScreen(x, y);
      expect(screenToGrid(s.x, s.y + TILE_H / 2)).toEqual({ x, y });
    }
  }
});
