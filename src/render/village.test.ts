import { describe, expect, it } from 'vitest';
import { MAX_HOUSES, placeHouses, type HouseInput } from './village';

const village = (n: number, patch = 9): HouseInput[] =>
  Array.from({ length: n }, (_, k) => ({ id: 'f' + k, x: 3 + k * 2, y: 4, n: patch, size: (k + 1) * 10 }));
const counts = (ps: { size: string }[]) => ({
  small: ps.filter((p) => p.size === 'small').length,
  medium: ps.filter((p) => p.size === 'medium').length,
  large: ps.filter((p) => p.size === 'large').length,
});

describe('placeHouses', () => {
  it('is deterministic', () => {
    expect(placeHouses(village(12))).toEqual(placeHouses(village(12)));
  });
  it('gives every house exactly one building, at its own patch', () => {
    const ins = village(10);
    const out = placeHouses(ins);
    expect(out.map((p) => p.id).sort()).toEqual(ins.map((p) => p.id).sort());
    for (const p of out) {
      const src = ins.find((i) => i.id === p.id)!;
      expect([p.x, p.y]).toEqual([src.x, src.y]);
    }
  });
  it('splits sizes by rank: about 15% large, 35% medium, the rest small', () => {
    const c = counts(placeHouses(village(20)));
    expect(c).toEqual({ large: 3, medium: 7, small: 10 });
  });
  it('puts the biggest code in the biggest buildings', () => {
    const out = placeHouses(village(20));
    const biggest = out.find((p) => p.id === 'f19')!;
    const smallest = out.find((p) => p.id === 'f0')!;
    expect(biggest.size).toBe('large');
    expect(smallest.size).toBe('small');
  });
  it('never makes a large building in a tiny village', () => {
    expect(counts(placeHouses(village(3))).large).toBe(0);
  });
  it('keeps tiny patches small and cannot give a big building to a small patch', () => {
    const out = placeHouses(village(10, 2));
    expect(out.every((p) => p.size === 'small')).toBe(true);
    expect(placeHouses(village(10, 5)).some((p) => p.size === 'large')).toBe(false);
  });
  it('draws buildings only for the biggest houses of a huge village', () => {
    const out = placeHouses(village(100));
    expect(out.length).toBe(MAX_HOUSES);
    expect(out.some((p) => p.id === 'f99')).toBe(true);
    expect(out.some((p) => p.id === 'f0')).toBe(false);
  });
  it('sizes a building to its patch, within limits', () => {
    const small = placeHouses([{ id: 'a', x: 0, y: 0, n: 1, size: 5 }])[0];
    const big = placeHouses([{ id: 'b', x: 0, y: 0, n: 100, size: 5 }])[0];
    expect(big.shadowInTiles).toBeGreaterThan(small.shadowInTiles);
    expect(big.shadowInTiles).toBeLessThanOrEqual(2.6 * 1.1 + 1e-9);
  });
  it('gives nothing for an empty village', () => {
    expect(placeHouses([])).toEqual([]);
  });
});
