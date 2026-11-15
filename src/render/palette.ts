import type { TileType } from '../types';

/** Flat-colour look (drawFlat), used when the tile kit cannot be built at all. */
export const PALETTE: Record<TileType, number> = {
  ocean: 0x2a6fa8,
  island: 0x5fae52,
  coast: 0xe3d49a,
  village: 0xf08a24,
  house: 0xd0402f,
  coral: 0x7fd6c8,
  tree: 0x1f6b34,
  port: 0x7a5230,
};

export const HIGHLIGHT = 0xffffff;

/** Water by depth: ocean tile `variant` 0 = deep, 1 = shallow (inside a cluster), 2 = reef. */
export const WATER = [0x18a7b4, 0x18a7b4, 0x62d6c8] as const;

/** Colours for the code-drawn placeholder art (src/render/tiles.ts). One place, so it looks deliberate. */
export const PLACEHOLDER = {
  grass: '#5fae52',
  sand: '#e3d49a',
  dirt: '#a98259',
  dirtDark: '#8a6a45',
  stone: '#a59d90',
  fire: ['#ac2c05', '#ffa000', '#ffd800'],
  foam: 'rgba(255,255,255,0.85)',
  sandBlend: 'rgba(227,212,154,0.85)',
  waterLine: 'rgba(255,255,255,0.10)',
  hutLeft: '#e8dcc0',
  hutRight: '#b5a47e',
  roofs: ['#d0402f', '#3b82c4', '#e0a428', '#7a4fb5', '#2f9e6a', '#c46a2f'],
  trunk: '#6b4a2b',
  leafy: ['#3f9a4a', '#4aa850', '#35863f'],
  conifer: ['#24733f', '#2c8048', '#1f6339'],
  bush: '#3a8a3e',
  dead: '#8a7a64',
  rock: '#8d9097',
  rockDark: '#6d7078',
  tuft: '#7cc464',
  coral: ['#f06a8a', '#f59a5a', '#ee7fb0', '#ff8f6b'],
  dock: '#7a5230',
  dockDark: '#5a3b20',
  shadow: '0,0,0',
} as const;
