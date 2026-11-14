import type { TileType } from '../types';

export const PALETTE: Record<TileType, number> = {
  ocean: 0x2f7fc1,
  island: 0x5fae52,
  coast: 0xe3d49a,
  village: 0xf08a24,
  house: 0xd0402f,
  coral: 0xf27fa5,
  tree: 0x1f6b34,
  port: 0x7a5230,
};

export const HIGHLIGHT = 0xffffff;

/** Reef floor: shallow turquoise water that coral branches grow from. */
export const CORAL_BASE = 0x57bfcf;
/** Branch / tip colour pairs, indexed by coral tile variant - 1 (variant 0 is bare reef floor). */
export const CORAL_COLORS: [number, number][] = [
  [0xf0628f, 0xffb3cc],
  [0xf08a3c, 0xffd27a],
  [0x9b5fd0, 0xd9b8f5],
  [0xe84a4a, 0xff9a8a],
  [0x3fb68b, 0xbdf2d8],
];
