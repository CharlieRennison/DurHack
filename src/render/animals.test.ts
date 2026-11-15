import { describe, expect, it } from 'vitest';
import { makeAnimals, makeDino, patches, MAX_PER_VIEW } from './animals';

const grid = (rows: string[]) => rows.map((r) => [...r].map((c) => c === '#'));

describe('patches', () => {
  it('finds connected land, biggest first', () => {
    const g = grid(['##....', '##..#.', '......', '....##']);
    expect(patches(g).map((p) => p.length)).toEqual([4, 2, 1]);
  });
});

describe('makeAnimals', () => {
  const big = Array.from({ length: 20 }, (_, y) => Array.from({ length: 20 }, (_, x) => x < 9 && y < 9)); // 81 cells
  const small = Array.from({ length: 20 }, (_, y) => Array.from({ length: 20 }, (_, x) => x >= 12 && x < 16 && y < 4)); // 16 cells
  const both = big.map((row, y) => row.map((v, x) => v || small[y][x]));

  it('gives a small island one animal and a big one two; tiny specks none', () => {
    expect(makeAnimals(big, 'a').length).toBe(2);
    expect(makeAnimals(small, 'a').length).toBe(1);
    const speck = Array.from({ length: 5 }, () => Array<boolean>(5).fill(false));
    speck[2][2] = true;
    expect(makeAnimals(speck, 'a').length).toBe(0);
    expect(makeAnimals(both, 'a').length).toBe(3);
  });
  it('keeps each animal on its own island, deterministically', () => {
    const a = makeAnimals(both, 'seed');
    const b = makeAnimals(both, 'seed');
    expect(a.map((x) => [x.walker.x, x.walker.y])).toEqual(b.map((x) => [x.walker.x, x.walker.y]));
    for (const an of a) expect(an.mask[Math.floor(an.walker.y)][Math.floor(an.walker.x)]).toBe(true);
  });
  it('a folder gets one dino, on its biggest island, and none if there is no room', () => {
    const d = makeDino(both, 'a')!;
    expect(d.cells.length).toBe(81);
    expect(d.mask[Math.floor(d.walker.y)][Math.floor(d.walker.x)]).toBe(true);
    expect(makeDino(Array.from({ length: 5 }, () => Array<boolean>(5).fill(false)), 'a')).toBeNull();
  });
  it('caps the animals per view', () => {
    const many = Array.from({ length: 40 }, (_, y) => Array.from({ length: 40 }, (_, x) => x % 5 < 4 && y % 5 < 4)); // 64 4x4 patches
    expect(makeAnimals(many, 'a').length).toBeLessThanOrEqual(MAX_PER_VIEW);
  });
});
