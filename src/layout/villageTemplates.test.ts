import { describe, expect, it } from 'vitest';
import { GRID_SIZE } from '../types';
import { layoutNode } from './layoutNode';
import { MIN_HOUSE_SPACING, planVillage, templatesFor, type TemplateName } from './villageTemplates';
import type { RepoNode } from '../types';

/** A round islet of the given radius. */
const disc = (r: number, cx = 24, cy = 24) =>
  Array.from({ length: GRID_SIZE }, (_, y) => Array.from({ length: GRID_SIZE }, (_, x) => Math.hypot(x - cx, y - cy) <= r));
const key = (c: [number, number]) => c[1] * 100 + c[0];

describe('planVillage', () => {
  it('is deterministic', () => {
    expect(planVillage(9, disc(14), 'a/b')).toEqual(planVillage(9, disc(14), 'a/b'));
  });
  it('gives one distinct seed cell per house, all inside the region', () => {
    const region = disc(14);
    for (const n of [1, 3, 5, 9, 16, 30, 60]) {
      const plan = planVillage(n, region, 'v' + n)!;
      expect(plan.houses.length, 'n=' + n).toBe(n);
      expect(new Set(plan.houses.map(key)).size).toBe(n);
      for (const [x, y] of plan.houses) expect(region[y][x]).toBe(true);
    }
  });
  it('keeps houses off the plazas, campfires and paths', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const plan = planVillage(14, disc(15), seed)!;
      const reserved = new Set([...plan.plazas, ...plan.paths].map(key));
      for (const h of plan.houses) expect(reserved.has(key(h)), seed).toBe(false);
      for (const f of plan.fires) expect(plan.plazas.map(key)).toContain(key(f));
    }
  });
  it('keeps houses apart on a roomy islet', () => {
    const plan = planVillage(10, disc(16), 'roomy')!;
    for (let a = 0; a < plan.houses.length; a++) {
      for (let b = a + 1; b < plan.houses.length; b++) {
        const d = Math.hypot(plan.houses[a][0] - plan.houses[b][0], plan.houses[a][1] - plan.houses[b][1]);
        expect(d).toBeGreaterThanOrEqual(MIN_HOUSE_SPACING - 1e-9);
      }
    }
  });
  it('puts the most central house first', () => {
    const plan = planVillage(12, disc(14), 'c')!;
    const d = (p: [number, number]) => Math.hypot(p[0] - 24, p[1] - 24);
    expect(d(plan.houses[0])).toBeLessThanOrEqual(d(plan.houses[plan.houses.length - 1]));
  });
  it('uses every template for some size and seed, and they differ', () => {
    const seen = new Set<TemplateName>();
    for (const n of [2, 4, 6, 9, 15, 30]) {
      for (let k = 0; k < 24; k++) seen.add(planVillage(n, disc(15), `seed${k}`)!.template);
    }
    expect([...seen].sort()).toEqual(['crossroads', 'farmsteads', 'hamlet', 'ring', 'square', 'street', 'twin']);
    expect(planVillage(9, disc(15), 'x1')!.houses).not.toEqual(planVillage(9, disc(15), 'x2')!.houses);
  });
  it('picks templates that suit the size', () => {
    expect(templatesFor(2)).not.toContain('square');
    expect(templatesFor(40)).not.toContain('hamlet');
  });
  it('still places every house on a thin strip', () => {
    const strip = Array.from({ length: GRID_SIZE }, (_, y) => Array.from({ length: GRID_SIZE }, (_, x) => y >= 22 && y <= 25 && x >= 8 && x <= 40));
    const plan = planVillage(8, strip, 'thin')!;
    expect(plan.houses.length).toBe(8);
    expect(new Set(plan.houses.map(key)).size).toBe(8);
  });
  it('returns nothing for an empty region', () => {
    expect(planVillage(5, disc(-1), 'x')).toBeNull();
  });
});

const file = (id: string, size: number): RepoNode => ({ id, kind: 'file', name: id, path: id, size, children: [] });
const village = (n: number): RepoNode => ({ id: 'vv' + n, kind: 'folder', name: 'vv', path: 'vv' + n, size: 100, children: Array.from({ length: n }, (_, i) => file('vv' + n + '/f' + i, 10 + i)) });

describe('village layout with templates', () => {
  const allowed = disc(15);
  for (const n of [3, 8, 20]) {
    it(`gives each of ${n} files its own patch and leaves open ground for the plaza and paths`, () => {
      const g = layoutNode(village(n), 0, allowed);
      const flat = g.flat();
      const ids = new Set(flat.filter((t) => t.type === 'house').map((t) => t.nodeId));
      expect(ids.size).toBe(n);
      const ground = flat.filter((t) => t.type === 'village');
      expect(ground.every((t) => t.nodeId === undefined)).toBe(true);
      expect(ground.length).toBeGreaterThan(0);
      expect(flat.some((t) => t.type === 'village' && t.variant === 2) || n > 0).toBe(true);
    });
  }
  it('stays inside the allowed cells', () => {
    const g = layoutNode(village(12), 0, allowed);
    g.forEach((row, y) => row.forEach((t, x) => { if (t.type === 'house' || t.type === 'village') expect(allowed[y][x]).toBe(true); }));
  });
});
