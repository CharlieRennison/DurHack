/**
 * Seagulls: packs of 1-10 birds that fly across the screen now and then.
 *
 * Everything here is pure and seeded (no Math.random), so it can be tested without drawing anything: `makeFlock`
 * builds a flock from a random generator, `flockPosition` says where it is at a time, and `birdFrame` says which
 * animation frame a bird shows. A flock is planned on the screen as it is when the flock appears (so it always crosses
 * what you are looking at) and then converted into map (world) units: from then on it belongs to the map, so zooming
 * and panning move and scale it with the islands.
 *
 * Animation: every bird flaps at about FLAP_FPS frames per second, but each bird gets its own rate within
 * +/- FPS_LEEWAY (so a pack of birds drifts in and out of step) and its own random starting point in the cycle, so no
 * two birds are in sync.
 */

/** Mean flapping speed, in animation frames per second, and how far each bird may stray from it. */
export const FLAP_FPS = 5;
export const FPS_LEEWAY = 1;
export const MIN_PACK = 1;
export const MAX_PACK = 10;
/** Pause between packs, in seconds. */
export const MIN_GAP = 4;
export const MAX_GAP = 14;
/** Most flocks in the sky at once for one zoom band (see zoomBand). */
export const MAX_FLOCKS = 2;
/** The first pack after you reach a new zoom band comes quickly (seconds), so zooming in always shows birds soon. */
export const FIRST_PACK_MIN = 1;
export const FIRST_PACK_MAX = 3;

/**
 * The zoom band the camera is in: one band per doubling of the zoom. Each band gets its own packs, sized for that
 * zoom, so there are birds to see whether you are looking at the whole map or right down inside a village.
 */
export function zoomBand(scale: number): number {
  return Math.round(Math.log2(Math.max(scale, 1e-6)));
}
/** The slowest a flock may cross, in seconds: a tiny, slow flock (zoomed far out) speeds up rather than lingering. */
export const MAX_CROSS_SECONDS = 28;
/** Birds are full size at the reference zoom and above, and shrink with the map below it, down to this fraction. */
export const MIN_SIZE_FRACTION = 0.25;
/** However close you zoom, a bird is never drawn bigger than this many screen pixels per art pixel. */
export const MAX_SCREEN_PX = 3;

/**
 * How big birds are at the current zoom, as a fraction of full size: 1 when zoomed in to `ref` (the village level) or
 * beyond, shrinking in step with the map as you zoom out, down to MIN_SIZE_FRACTION. So zoomed right out they are
 * small specks over the islands, not big birds taking up the screen.
 */
export function sizeFraction(scale: number, ref: number): number {
  return Math.min(1, Math.max(MIN_SIZE_FRACTION, scale / Math.max(ref, 1e-6)));
}

/** How far past the screen edge a flock starts and ends, in pixels. */
const MARGIN = 90;

export type Rng = () => number;

export interface Bird {
  /** Offset from the flock's lead point, along (back) and across the direction of travel, in pixels at scale 1. */
  back: number;
  side: number;
  /** This bird's own flapping speed (frames per second) and where in the cycle it starts (in frames). */
  fps: number;
  phase: number;
  /** Gentle bobbing up and down. */
  bobAmp: number;
  bobFreq: number;
  bobPhase: number;
}

export interface Flock {
  birds: Bird[];
  /** Where the lead point enters, in screen pixels, and the unit direction of travel. */
  x0: number;
  y0: number;
  ux: number;
  uy: number;
  /** Pixels per second. */
  speed: number;
  /** Pixel-art scale in world units per art pixel (a whole number on screen when the flock appears, so pixels are crisp). */
  scale: number;
  /** World units per screen pixel when the flock appeared; sizes in pixels (bobbing) are multiplied by this. */
  unit: number;
  /** Sideways sway of the whole flock: amplitude (px) and frequency (rad/s). */
  swayAmp: number;
  swayFreq: number;
  swayPhase: number;
  /** Seconds the flock takes to cross, then leave, the screen. */
  duration: number;
  /** Time the flock was made (seconds on the animation clock). */
  born: number;
  /** The zoom band it was made in. */
  band: number;
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (rng: Rng, lo: number, hi: number) => lo + (hi - lo) * rng();

/** Seconds until the next pack appears. */
export function nextGap(rng: Rng): number {
  return between(rng, MIN_GAP, MAX_GAP);
}

/** One bird: its own flapping speed (within the leeway) and starting point in the flap cycle. */
export function makeBird(rng: Rng, back: number, side: number, frames: number): Bird {
  return {
    back,
    side,
    fps: FLAP_FPS + between(rng, -FPS_LEEWAY, FPS_LEEWAY),
    phase: rng() * frames,
    bobAmp: between(rng, 1, 4),
    bobFreq: between(rng, 1.2, 2.6),
    bobPhase: rng() * Math.PI * 2,
  };
}

/**
 * A new pack of 1-10 birds entering from a random edge of a `w` x `h` screen, flying roughly across it.
 * `frames` is the number of animation frames a bird has.
 */
export function makeFlock(
  rng: Rng,
  w: number,
  h: number,
  now: number,
  frames = 2,
  /**
   * Screen -> world: world = (screen - origin) * k (default: the screen itself, k = 1). `sizeK` is the world size of
   * one screen pixel for sizing (bird size, speed, sway); it defaults to k, and is smaller when zoomed out so birds
   * shrink with the map there.
   */
  view: { k: number; ox: number; oy: number; sizeK?: number } = { k: 1, ox: 0, oy: 0 },
): Flock {
  const n = MIN_PACK + Math.floor(rng() * (MAX_PACK - MIN_PACK + 1));
  const scale = rng() < 0.7 ? 2 : 3;
  // Fly in a straight line (any direction) through a point in the lower middle of the screen, from one edge to the
  // other: low over the map, where the land is when you are zoomed in, not up near the top of the screen.
  const tx = between(rng, 0.2, 0.8) * w;
  const ty = between(rng, 0.45, 0.88) * h;
  const angle = rng() * Math.PI * 2;
  const cx = Math.cos(angle);
  const cy = Math.sin(angle);
  // how far from the point to the screen edge along (+cx, +cy) and (-cx, -cy)
  const reach = (sx: number, sy: number) =>
    Math.min(sx > 0 ? (w - tx) / sx : sx < 0 ? tx / -sx : Infinity, sy > 0 ? (h - ty) / sy : sy < 0 ? ty / -sy : Infinity);
  const ahead = reach(cx, cy) + MARGIN;
  const behind = reach(-cx, -cy) + MARGIN;
  const x0 = tx - cx * behind;
  const y0 = ty - cy * behind;
  const x1 = tx + cx * ahead;
  const y1 = ty + cy * ahead;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const speed = between(rng, 55, 110);
  // a loose V: the lead bird in front, the others in pairs behind it, each nudged a little off the ideal spot
  const spacing = 30;
  const birds: Bird[] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.ceil(i / 2);
    const side = i === 0 ? 0 : (i % 2 === 1 ? -1 : 1) * row * spacing * 0.7;
    const back = i === 0 ? 0 : row * spacing;
    birds.push(makeBird(rng, back + between(rng, -9, 9), side + between(rng, -9, 9), frames));
  }
  const k = view.k;
  const sk = view.sizeK ?? k;
  // world speed: the sized speed, but fast enough to cross the (world-sized) path within MAX_CROSS_SECONDS
  const worldSpeed = Math.max(speed * sk, (len * k) / MAX_CROSS_SECONDS);
  return {
    birds,
    x0: (x0 - view.ox) * k,
    y0: (y0 - view.oy) * k,
    ux: dx / len,
    uy: dy / len,
    speed: worldSpeed,
    scale: scale * sk,
    unit: sk,
    swayAmp: between(rng, 10, 50) * sk,
    swayFreq: between(rng, 0.25, 0.7),
    swayPhase: rng() * Math.PI * 2,
    duration: (len * k + 2 * 200 * sk) / worldSpeed,
    born: now,
    band: 0,
  };
}

/** Where a bird of the flock is at `time`, in the flock's units (world units for the game), and whether it faces right. */
export function birdPosition(f: Flock, b: Bird, time: number): { x: number; y: number; facingRight: boolean } {
  const tau = time - f.born;
  const lead = f.speed * tau;
  const sway = f.swayAmp * Math.sin(f.swayFreq * tau + f.swayPhase);
  // perpendicular to the direction of travel
  const px = -f.uy;
  const py = f.ux;
  const along = lead - b.back * f.scale;
  const across = sway + b.side * f.scale + b.bobAmp * f.unit * Math.sin(b.bobFreq * tau + b.bobPhase);
  return { x: f.x0 + f.ux * along + px * across, y: f.y0 + f.uy * along + py * across, facingRight: f.ux >= 0 };
}

/** Which animation frame (0..frames-1) a bird shows at `time`. Each bird has its own speed and starting phase. */
export function birdFrame(b: Bird, time: number, frames = 2): number {
  return Math.floor(b.fps * time + b.phase) % frames;
}

/** Has the whole flock flown out of the picture? */
export function flockDone(f: Flock, time: number): boolean {
  return time - f.born > f.duration + 3; // a few seconds of slack for the trailing birds
}
