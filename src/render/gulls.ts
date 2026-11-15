import { Container, Sprite, type Texture } from 'pixi.js';
import { birdFrame, birdPosition, FIRST_PACK_MAX, FIRST_PACK_MIN, flockDone, makeFlock, MAX_FLOCKS, MAX_SCREEN_PX, mulberry32, nextGap, sizeFraction, zoomBand, type Flock } from './birds';

/**
 * The seagulls flying over the map. All the flock logic (and the random numbers, which are seeded) is in birds.ts; this
 * just owns the sprites and moves them each frame. The layer follows the world's camera exactly (the birds are in map
 * units, so they pan and zoom with the islands) and ignores the mouse, so it never gets in the way of picking.
 */
export class Gulls {
  readonly layer = new Container();
  private flocks: { flock: Flock; sprites: Sprite[] }[] = [];
  private clock = 0;
  private rng = mulberry32(0x5ea9017);
  /** When the next pack may appear, per zoom band: every band has its own clock. */
  private nextAt = new Map<number, number>();

  /** `frames`: the animation's textures in order (facing left). `view`: the screen size and the world's camera now. */
  constructor(
    private frames: Texture[],
    private view: () => { w: number; h: number; x: number; y: number; scale: number; ref: number },
  ) {
    this.layer.eventMode = 'none';
  }

  /** Advance by `dt` seconds: maybe send out a new pack, then move and animate every bird. */
  update(dt: number): void {
    if (this.frames.length === 0) return;
    this.clock += Math.min(dt, 0.1);
    const v = this.view();
    // the layer shares the world's transform: the birds fly over the map, not over the glass
    this.layer.position.set(v.x, v.y);
    this.layer.scale.set(v.scale);
    // Packs are made per zoom band (one band per doubling of zoom): reaching a band you have not been in for a while
    // brings a pack within a couple of seconds, so there are birds to see zoomed right in as well as zoomed out.
    const band = zoomBand(v.scale);
    if (!this.nextAt.has(band)) this.nextAt.set(band, this.clock + FIRST_PACK_MIN + this.rng() * (FIRST_PACK_MAX - FIRST_PACK_MIN));
    const inBand = this.flocks.filter((f) => f.flock.band === band).length;
    if (this.clock >= this.nextAt.get(band)! && inBand < MAX_FLOCKS) {
      // planned across the screen as it is now, in world units, so the pack crosses what you are looking at
      // sized for the zoom: full size when zoomed in (the village level), shrinking with the map as you zoom out
      const sizeK = sizeFraction(v.scale, v.ref) / v.scale;
      const flock = makeFlock(this.rng, v.w, v.h, this.clock, this.frames.length, { k: 1 / v.scale, ox: v.x, oy: v.y, sizeK });
      flock.band = band;
      const sprites = flock.birds.map(() => {
        const s = new Sprite(this.frames[0]);
        s.anchor.set(0.5);
        this.layer.addChild(s);
        return s;
      });
      this.flocks.push({ flock, sprites });
      this.nextAt.set(band, this.clock + nextGap(this.rng));
    }
    for (let i = this.flocks.length - 1; i >= 0; i--) {
      const { flock, sprites } = this.flocks[i];
      if (flockDone(flock, this.clock)) {
        sprites.forEach((s) => s.destroy());
        this.flocks.splice(i, 1);
        continue;
      }
      flock.birds.forEach((bird, k) => {
        const s = sprites[k];
        const p = birdPosition(flock, bird, this.clock);
        s.position.set(p.x, p.y);
        s.texture = this.frames[birdFrame(bird, this.clock, this.frames.length)];
        // never bigger than MAX_SCREEN_PX screen pixels per art pixel, however close you zoom in afterwards
        const sc = Math.min(flock.scale, MAX_SCREEN_PX / v.scale);
        s.scale.set(p.facingRight ? -sc : sc, sc); // the art faces left
      });
    }
  }

  destroy(): void {
    this.layer.destroy({ children: true });
    this.flocks = [];
  }
}
