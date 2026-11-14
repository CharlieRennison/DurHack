import type { TileType } from '../types';

export const PALETTE: Record<TileType, number> = {
  ocean: 0x2f7fc1,
  island: 0x5fae52,
  coast: 0xe3d49a,
  village: 0xf08a24,
  house: 0xd0402f,
  coral: 0x2f7fc1, // same water as the ocean; a coral is only marked out by its red border
  tree: 0x1f6b34,
  port: 0x7a5230,
};

export const HIGHLIGHT = 0xffffff;

/** The red border that marks a coral. The coral's inside is plain ocean water. */
export const CORAL_BORDER = 0xe0505a;

/** Water inside an island: the lake that holds its sub-folders. Lighter than coral so coral patches show up in it. */
export const LAGOON = 0xa5e0f0;
