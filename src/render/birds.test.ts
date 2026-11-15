import { describe, expect, it } from 'vitest';
import { birdFrame, birdPosition, FLAP_FPS, flockDone, FPS_LEEWAY, makeFlock, MAX_PACK, MIN_PACK, mulberry32, MAX_CROSS_SECONDS, MIN_SIZE_FRACTION, sizeFraction, zoomBand } from './birds';

const W = 1000;
const H = 700;
const flocks = (n: number, seed = 1) => {
  const rng = mulberry32(seed);
  return Array.from({ length: n }, (_, k) => makeFlock(rng, W, H, k * 10));
};

describe('makeFlock', () => {
  it('is deterministic for a seed', () => {
    expect(makeFlock(mulberry32(5), W, H, 0)).toEqual(makeFlock(mulberry32(5), W, H, 0));
  });
  it('makes packs of 1 to 10 birds, and over many packs uses both ends of that range', () => {
    const sizes = flocks(400).map((f) => f.birds.length);
    expect(Math.min(...sizes)).toBe(MIN_PACK);
    expect(Math.max(...sizes)).toBe(MAX_PACK);
    expect(sizes.every((n) => n >= MIN_PACK && n <= MAX_PACK)).toBe(true);
  });
  it('gives each bird its own flapping speed within the leeway of 5 fps', () => {
    for (const f of flocks(100)) {
      for (const b of f.birds) {
        expect(b.fps).toBeGreaterThanOrEqual(FLAP_FPS - FPS_LEEWAY);
        expect(b.fps).toBeLessThanOrEqual(FLAP_FPS + FPS_LEEWAY);
      }
    }
    const fps = flocks(50).flatMap((f) => f.birds.map((b) => b.fps));
    expect(new Set(fps.map((v) => v.toFixed(3))).size).toBeGreaterThan(50); // not all alike
    expect(Math.min(...fps)).toBeLessThan(4.3);
    expect(Math.max(...fps)).toBeGreaterThan(5.7);
    expect(fps.reduce((a, b) => a + b, 0) / fps.length).toBeGreaterThan(4.8);
    expect(fps.reduce((a, b) => a + b, 0) / fps.length).toBeLessThan(5.2);
  });
  it('starts each bird at a different point of its flap cycle', () => {
    const big = flocks(200).find((f) => f.birds.length >= 8)!;
    expect(new Set(big.birds.map((b) => b.phase.toFixed(3))).size).toBe(big.birds.length);
  });
  it('enters outside the screen and leaves outside it', () => {
    for (const f of flocks(60)) {
      const lead = f.birds[0];
      const start = birdPosition(f, lead, f.born);
      const end = birdPosition(f, lead, f.born + f.duration);
      const outside = (p: { x: number; y: number }) => p.x < 0 || p.x > W || p.y < 0 || p.y > H;
      expect(outside(start)).toBe(true);
      expect(outside(end)).toBe(true);
    }
  });
  it('crosses the screen: some moment of the flight is on screen', () => {
    for (const f of flocks(60)) {
      let seen = false;
      for (let t = 0; t <= f.duration; t += 0.25) {
        const p = birdPosition(f, f.birds[0], f.born + t);
        if (p.x > 0 && p.x < W && p.y > 0 && p.y < H) seen = true;
      }
      expect(seen).toBe(true);
    }
  });
  it('flies low: across the lower middle of the screen, not along the top', () => {
    let sum = 0;
    let n = 0;
    for (const f of flocks(300)) {
      for (let tt = 0; tt <= f.duration; tt += 0.25) {
        const p = birdPosition(f, f.birds[0], f.born + tt);
        if (p.x > 0 && p.x < W && p.y > 0 && p.y < H) {
          sum += p.y;
          n++;
        }
      }
    }
    expect(sum / n).toBeGreaterThan(H * 0.5);
    // and every flock crosses the lower half at some point
    for (const f of flocks(100)) {
      let low = false;
      for (let tt = 0; tt <= f.duration; tt += 0.25) {
        const p = birdPosition(f, f.birds[0], f.born + tt);
        if (p.x > 0 && p.x < W && p.y > H * 0.4) low = true;
      }
      expect(low).toBe(true);
    }
  });
  it('faces the way it flies', () => {
    for (const f of flocks(60)) expect(birdPosition(f, f.birds[0], f.born).facingRight).toBe(f.ux >= 0);
  });
  it('is done after it has crossed, not before', () => {
    const f = flocks(1)[0];
    expect(flockDone(f, f.born + 1)).toBe(false);
    expect(flockDone(f, f.born + f.duration + 10)).toBe(true);
  });
});

describe('flocks in world units', () => {
  it('takes the same path on the map as it would on the screen: world = (screen - origin) * k', () => {
    const view = { k: 0.5, ox: 300, oy: -80 };
    const onScreen = makeFlock(mulberry32(9), W, H, 0);
    const inWorld = makeFlock(mulberry32(9), W, H, 0, 2, view);
    expect(inWorld.birds.length).toBe(onScreen.birds.length);
    for (const t of [0, 5, 12, 20]) {
      for (let k = 0; k < onScreen.birds.length; k++) {
        const s = birdPosition(onScreen, onScreen.birds[k], t);
        const w = birdPosition(inWorld, inWorld.birds[k], t);
        expect(w.x).toBeCloseTo((s.x - view.ox) * view.k, 6);
        expect(w.y).toBeCloseTo((s.y - view.oy) * view.k, 6);
      }
    }
    expect(inWorld.duration).toBeCloseTo(onScreen.duration, 9); // same time to cross, whatever the zoom
  });
  it('is sized for the zoom it appeared at, so it looks the same size on screen then', () => {
    const zoomedIn = makeFlock(mulberry32(3), W, H, 0, 2, { k: 1 / 4, ox: 0, oy: 0 });
    const normal = makeFlock(mulberry32(3), W, H, 0);
    expect(zoomedIn.scale).toBeCloseTo(normal.scale / 4, 9);
    expect(zoomedIn.speed).toBeCloseTo(normal.speed / 4, 9);
  });
});

describe('birdFrame', () => {
  it('flips between the frames at about the bird fps', () => {
    const f = flocks(1)[0];
    const b = f.birds[0];
    let flips = 0;
    let last = birdFrame(b, 0);
    for (let t = 0.01; t <= 10; t += 0.01) {
      const fr = birdFrame(b, t);
      if (fr !== last) flips++;
      last = fr;
    }
    expect(flips).toBeGreaterThan(b.fps * 10 - 2);
    expect(flips).toBeLessThan(b.fps * 10 + 2);
  });
  it('stays within the frame count', () => {
    const b = flocks(1)[0].birds[0];
    for (let t = 0; t < 20; t += 0.07) {
      expect([0, 1]).toContain(birdFrame(b, t));
      expect([0, 1, 2]).toContain(birdFrame(b, t, 3));
    }
  });
  it('is not in sync across a pack', () => {
    const big = flocks(200).find((f) => f.birds.length >= 8)!;
    let allSame = 0;
    for (let t = 0; t < 30; t += 0.1) {
      const frames = new Set(big.birds.map((b) => birdFrame(b, t)));
      if (frames.size === 1) allSame++;
    }
    expect(allSame).toBeLessThan(30); // out of 300 samples, the whole pack almost never shows the same frame at once
  });
});

describe('zoomBand', () => {
  it('is one band per doubling of zoom, so zooming in always reaches a new band', () => {
    expect(zoomBand(1)).toBe(0);
    expect(zoomBand(2)).toBe(1);
    expect(zoomBand(4)).toBe(2);
    expect(zoomBand(0.5)).toBe(-1);
    expect(zoomBand(1.2)).toBe(zoomBand(1));
    expect(zoomBand(40)).toBeGreaterThan(zoomBand(4));
  });
  it('never fails on a tiny or zero scale', () => {
    expect(Number.isFinite(zoomBand(0))).toBe(true);
  });
});

describe('size by zoom', () => {
  it('is full size at the reference zoom and above, and shrinks with the map below it', () => {
    expect(sizeFraction(3, 3)).toBe(1);
    expect(sizeFraction(30, 3)).toBe(1);
    expect(sizeFraction(1.5, 3)).toBeCloseTo(0.5, 9);
    expect(sizeFraction(0.01, 3)).toBe(MIN_SIZE_FRACTION);
  });
  it('makes birds small on screen when zoomed out, whatever the zoom', () => {
    for (const scale of [0.15, 0.5, 1, 3, 12]) {
      const ref = 3;
      const sizeK = sizeFraction(scale, ref) / scale;
      const f = makeFlock(mulberry32(7), W, H, 0, 2, { k: 1 / scale, ox: 0, oy: 0, sizeK });
      const screenScale = f.scale * scale; // screen pixels per art pixel
      expect(screenScale).toBeLessThanOrEqual(3 * sizeFraction(scale, ref) + 1e-9);
      if (scale < ref) expect(screenScale).toBeLessThan(2.1 * sizeFraction(scale, ref) + 1e-9 + 1);
    }
    const out = makeFlock(mulberry32(7), W, H, 0, 2, { k: 1 / 0.15, ox: 0, oy: 0, sizeK: sizeFraction(0.15, 3) / 0.15 });
    const inn = makeFlock(mulberry32(7), W, H, 0, 2, { k: 1 / 3, ox: 0, oy: 0, sizeK: sizeFraction(3, 3) / 3 });
    expect(out.scale * 0.15).toBeLessThan(inn.scale * 3 * 0.3); // far out: well under a third of the zoomed-in size
  });
  it('never lingers: even a tiny, slow flock crosses within the limit', () => {
    for (const scale of [0.15, 0.4, 1, 6]) {
      const f = makeFlock(mulberry32(11), W, H, 0, 2, { k: 1 / scale, ox: 0, oy: 0, sizeK: sizeFraction(scale, 3) / scale });
      expect(f.duration).toBeLessThanOrEqual(MAX_CROSS_SECONDS + 400 / 28 + 8);
    }
  });
});
