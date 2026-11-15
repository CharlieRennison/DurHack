import { describe, expect, it } from 'vitest';
import { floorsFor, HOUSE_WIDTH, MAX_FLOORS, MAX_HOUSES, placeHouses, type HouseInput } from './village';

const village = (n: number, patch = 9): HouseInput[] =>
  Array.from({ length: n }, (_, k) => ({ id: 'f' + k, x: 3 + k * 2, y: 4, n: patch, size: (k + 1) * 10 }));

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
  it('draws every house the same width, whatever its code size or patch', () => {
    const mixed: HouseInput[] = [
      { id: 'tiny', x: 1, y: 1, n: 1, size: 1 },
      { id: 'mid', x: 5, y: 5, n: 9, size: 50 },
      { id: 'huge', x: 9, y: 9, n: 80, size: 9000 },
    ];
    const out = placeHouses(mixed);
    expect(new Set(out.map((p) => p.width))).toEqual(new Set([HOUSE_WIDTH]));
    expect(new Set(out.map((p) => p.shadowInTiles)).size).toBe(1);
  });
  it('makes bigger files taller: floors never decrease with code size, and stay within 1..MAX_FLOORS', () => {
    const ins: HouseInput[] = [1, 5, 20, 60, 200, 1000, 20000].map((size, k) => ({ id: 's' + k, x: k * 3, y: 2, n: 9, size }));
    const out = placeHouses(ins);
    const floors = ins.map((i) => out.find((p) => p.id === i.id)!.floors);
    for (let k = 1; k < floors.length; k++) expect(floors[k]).toBeGreaterThanOrEqual(floors[k - 1]);
    expect(floors[0]).toBe(1);
    expect(floors[floors.length - 1]).toBe(MAX_FLOORS);
    expect(Math.max(...floors)).toBeLessThanOrEqual(MAX_FLOORS);
  });
  it('gives a median-sized file one floor, and about one more per doubling', () => {
    expect(floorsFor(100, 100)).toBe(1);
    expect(floorsFor(50, 100)).toBe(1);
    expect(floorsFor(200, 100)).toBe(2);
    expect(floorsFor(400, 100)).toBe(3);
    expect(floorsFor(100000, 100)).toBe(MAX_FLOORS);
  });
  it('makes equal files equal houses, and a village of unknown sizes all one floor', () => {
    const out = placeHouses([{ id: 'a', x: 0, y: 0, n: 9, size: 100 }, { id: 'b', x: 4, y: 0, n: 9, size: 100 }]);
    expect(out[0].floors).toBe(out[1].floors);
    expect(placeHouses(village(5).map((h) => ({ ...h, size: 0 }))).every((p) => p.floors === 1)).toBe(true);
  });
  it('mixes heights in an ordinary village (some tall, most short)', () => {
    const sizes = [3, 5, 8, 12, 15, 20, 30, 45, 90, 200, 600, 2500];
    const out = placeHouses(sizes.map((size, k) => ({ id: 'x' + k, x: k, y: 0, n: 9, size })));
    const counts = [1, 2, 3, 4].map((f) => out.filter((p) => p.floors === f).length);
    expect(counts[0]).toBeGreaterThan(0);
    expect(counts[2] + counts[3]).toBeGreaterThan(0);
    expect(counts[0]).toBeGreaterThanOrEqual(counts[3]);
  });
  it('draws buildings only for the biggest houses of a huge village', () => {
    const out = placeHouses(village(100));
    expect(out.length).toBe(MAX_HOUSES);
    expect(out.some((p) => p.id === 'f99')).toBe(true);
    expect(out.some((p) => p.id === 'f0')).toBe(false);
  });
  it('gives nothing for an empty village', () => {
    expect(placeHouses([])).toEqual([]);
  });
});
