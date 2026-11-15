import { describe, expect, it } from 'vitest';
import { findRoute, makeWalkers, MAX_PEOPLE, MAX_SPEED, MIN_SPEED, PEOPLE_VARIANTS, stepWalker, walkableCells, walkerFrame } from './people';

/** A w x h block of walkable cells, optionally with a wall. */
const field = (w: number, h: number, wall?: (x: number, y: number) => boolean) =>
  Array.from({ length: 48 }, (_, y) => Array.from({ length: 48 }, (_, x) => x >= 4 && x < 4 + w && y >= 4 && y < 4 + h && !(wall && wall(x, y))));

describe('findRoute', () => {
  it('finds a shortest route over walkable cells, as cell centres, excluding the start', () => {
    const r = findRoute(field(10, 10), [4, 4], [7, 4])!;
    expect(r).toEqual([[5.5, 4.5], [6.5, 4.5], [7.5, 4.5]]);
  });
  it('goes round a wall', () => {
    const f = field(10, 10, (x, y) => x === 7 && y < 12);
    const r = findRoute(f, [5, 5], [9, 5])!;
    expect(r.length).toBeGreaterThan(4);
    for (const [x, y] of r) expect(f[Math.floor(y)][Math.floor(x)]).toBe(true);
  });
  it('gives null when there is no way, and an empty route when already there', () => {
    expect(findRoute(field(10, 10, (x) => x === 7), [5, 5], [9, 5])).toBeNull();
    expect(findRoute(field(10, 10), [5, 5], [5, 5])).toEqual([]);
    expect(findRoute(field(10, 10), [5, 5], [30, 30])).toBeNull();
  });
});

describe('makeWalkers', () => {
  const names = ['alice', 'bob', 'carol', 'dave'];
  it('is deterministic', () => {
    const strip = (ws: ReturnType<typeof makeWalkers>) => ws.map(({ rng, ...rest }) => rest);
    expect(strip(makeWalkers(names, field(12, 12), 'r'))).toEqual(strip(makeWalkers(names, field(12, 12), 'r')));
  });
  it('makes one walker per collaborator, on walkable cells, up to the maximum', () => {
    const f = field(12, 12);
    const many = Array.from({ length: 30 }, (_, i) => 'person' + i);
    const ws = makeWalkers(many, f, 'r');
    expect(ws.length).toBe(MAX_PEOPLE);
    for (const w of ws) expect(f[Math.floor(w.y)][Math.floor(w.x)]).toBe(true);
    expect(makeWalkers(names, f, 'r').map((w) => w.name)).toEqual(names);
  });
  it('gives the same person the same look every time, within the designs available', () => {
    const a = makeWalkers(['alice'], field(12, 12), 'one')[0];
    const b = makeWalkers(['alice'], field(12, 12), 'two')[0];
    expect(a.variant).toBe(b.variant);
    for (const w of makeWalkers(Array.from({ length: 12 }, (_, i) => 'n' + i), field(12, 12), 's')) {
      expect(w.variant).toBeGreaterThanOrEqual(0);
      expect(w.variant).toBeLessThan(PEOPLE_VARIANTS);
      expect(w.speed).toBeGreaterThanOrEqual(MIN_SPEED);
      expect(w.speed).toBeLessThanOrEqual(MAX_SPEED);
    }
  });
  it('makes nobody when there is nowhere to walk', () => {
    expect(makeWalkers(names, field(0, 0), 'r')).toEqual([]);
  });
});

describe('stepWalker', () => {
  it('stays on walkable cells and never walks through a wall, over a long time', () => {
    const f = field(14, 14, (x, y) => x === 10 && y > 6 && y < 16);
    const cells = walkableCells(f);
    const ws = makeWalkers(['a', 'b', 'c', 'd', 'e'], f, 'walls');
    for (let t = 0; t < 600; t += 0.1) {
      for (const w of ws) {
        stepWalker(w, 0.1, f, cells);
        expect(f[Math.floor(w.y)][Math.floor(w.x)], `${w.name} at ${w.x.toFixed(2)},${w.y.toFixed(2)}`).toBe(true);
      }
    }
  });
  it('walks about: stands at times, moves at times, and covers ground', () => {
    const f = field(14, 14);
    const cells = walkableCells(f);
    const w = makeWalkers(['wanderer'], f, 'x')[0];
    const start = [w.x, w.y];
    let moving = 0;
    let still = 0;
    let far = 0;
    for (let t = 0; t < 300; t += 0.1) {
      stepWalker(w, 0.1, f, cells);
      if (w.moving) moving++;
      else still++;
      far = Math.max(far, Math.hypot(w.x - start[0], w.y - start[1]));
    }
    expect(moving).toBeGreaterThan(200);
    expect(still).toBeGreaterThan(100);
    expect(far).toBeGreaterThan(4);
  });
  it('moves at about its own speed', () => {
    const f = field(14, 14);
    const cells = walkableCells(f);
    const w = makeWalkers(['speedy'], f, 'x')[0];
    w.rest = 0;
    stepWalker(w, 0.05, f, cells); // picks a route
    let travelled = 0;
    let lastX = w.x;
    let lastY = w.y;
    for (let t = 0; t < 2; t += 0.05) {
      stepWalker(w, 0.05, f, cells);
      if (w.moving) travelled += Math.hypot(w.x - lastX, w.y - lastY);
      lastX = w.x;
      lastY = w.y;
    }
    expect(travelled).toBeGreaterThan(0.2);
    expect(travelled).toBeLessThanOrEqual(w.speed * 2 + 0.01);
  });
  it('faces the way it moves on the screen', () => {
    const f = field(14, 14);
    const w = makeWalkers(['p'], f, 'x')[0];
    w.route = [[w.x + 3, w.y]];
    stepWalker(w, 0.1, f, walkableCells(f));
    expect(w.facingRight).toBe(true); // +x is down-right on an iso screen
    w.route = [[w.x - 3, w.y]];
    stepWalker(w, 0.1, f, walkableCells(f));
    expect(w.facingRight).toBe(false);
  });
});

describe('walkerFrame', () => {
  it('stands when not moving and alternates the two steps when moving', () => {
    const w = makeWalkers(['q'], field(12, 12), 'x')[0];
    w.moving = false;
    expect(walkerFrame(w, 3)).toBe(0);
    w.moving = true;
    const seen = new Set<number>();
    for (let t = 0; t < 3; t += 0.05) seen.add(walkerFrame(w, t));
    expect(seen).toEqual(new Set([1, 2]));
  });
});
