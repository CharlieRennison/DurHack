/**
 * TileKit: every texture the renderer draws comes from here, by category name.
 *
 *  - Art is described by public/assets/tileset/manifest.json (see the README next to it). A missing manifest
 *    is normal: every category then falls back to a code-drawn placeholder (colours in palette.ts).
 *  - The renderer never mentions a filename. It asks `pick(category, hash)`, which is seeded (never random).
 *  - Ground and water are drawn flat and square (u = +x, v = +y); the renderer maps them onto the isometric
 *    diamond. Objects (trees, huts, coral...) stand upright and are anchored at their base.
 *  - Placeholders use the same sizes and anchors as real art will, so swapping art in never shifts anything.
 *  - A category with no art logs one warning (not one per tile).
 */
import { Rectangle, Texture } from 'pixi.js';
import { PLACEHOLDER as P, WATER } from './palette';

/** Pixel size of one flat ground tile. */
const TS = 128;
const ATLAS = 2048;
const WATER_PX = 256;
const BASE = '/assets/tileset/';

/** Directions in grid axes, in the order used for edge arrays: +x, +y, -x, -y. */
export type Side = 0 | 1 | 2 | 3;
export const SIDES: Side[] = [0, 1, 2, 3];

/** What a ground tile touches on one side. */
export const Edge = {
  None: 0,
  /** Sand blends into this (grass) tile along the edge. */
  Sand: 1,
  /** Water: a foam line is drawn along the edge. */
  Water: 2,
} as const;
export type Edge = (typeof Edge)[keyof typeof Edge];

export type TreeKind = 'conifer' | 'leafy' | 'bush' | 'dead';

/** An upright object: texture plus how to place and size it. */
export interface Sprite3D {
  texture: Texture;
  /** Width / height of the image, for sizing. */
  aspect: number;
  /** Which point of the image sits on the ground position (0..1 of width and height). */
  anchor: [number, number];
  /** Drawn width, in tiles. */
  widthInTiles: number;
  /** Width of the soft shadow under it, in tiles (the image is usually wider than the object that casts it). */
  shadowInTiles: number;
}

interface ManifestEntry {
  file: string;
  anchor?: [number, number];
  widthInTiles?: number;
  /** Width of the shadow under the object, in tiles (default 0.9 x widthInTiles). */
  shadowInTiles?: number;
  weight?: number;
  /** Water only: how many grid cells one copy of the image covers (default 1). */
  cells?: number;
}
type Manifest = Record<string, ManifestEntry[]>;

/** A manifest entry whose image loaded. */
interface Art {
  entry: ManifestEntry;
  img: HTMLImageElement;
}

type Ctx = CanvasRenderingContext2D;

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: Ctx } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d')! };
}

/** Small deterministic generator for placeholder drawing (never Math.random). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load ' + url));
    img.src = url;
  });
}

/** Fill a band along one side of a flat tile: solid at the edge, fading to nothing `depth` px inside. */
function sideBand(g: Ctx, side: Side, depth: number, color: string, fade: boolean): void {
  const rect: [number, number, number, number] =
    side === 0 ? [TS - depth, 0, depth, TS] : side === 1 ? [0, TS - depth, TS, depth] : side === 2 ? [0, 0, depth, TS] : [0, 0, TS, depth];
  if (!fade) {
    g.fillStyle = color;
    g.fillRect(...rect);
    return;
  }
  // gradient from the edge (opaque) inwards (transparent)
  const [x0, y0, x1, y1] =
    side === 0 ? [TS, 0, TS - depth, 0] : side === 1 ? [0, TS, 0, TS - depth] : side === 2 ? [0, 0, depth, 0] : [0, 0, 0, depth];
  const grad = g.createLinearGradient(x0, y0, x1, y1);
  grad.addColorStop(0, color);
  grad.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
  g.fillStyle = grad;
  g.fillRect(...rect);
}

// ---- placeholder drawing -----------------------------------------------------------------------------

function ellipse(g: Ctx, x: number, y: number, rx: number, ry: number, fill: string): void {
  g.fillStyle = fill;
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  g.fill();
}

function poly(g: Ctx, pts: [number, number][], fill: string): void {
  g.fillStyle = fill;
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts.slice(1)) g.lineTo(p[0], p[1]);
  g.closePath();
  g.fill();
}

function softShadow(g: Ctx, x: number, y: number, rx: number, ry: number, alpha: number): void {
  g.save();
  g.translate(x, y);
  g.scale(1, ry / rx);
  const grad = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  grad.addColorStop(0, `rgba(${P.shadow},${alpha})`);
  grad.addColorStop(1, `rgba(${P.shadow},0)`);
  g.fillStyle = grad;
  g.beginPath();
  g.arc(0, 0, rx, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** A flat ground square: base colour with a few soft blotches kept away from the edges (so tiles join cleanly). */
function placeholderGround(kind: 'grass' | 'sand' | 'dirt', variant: number): HTMLCanvasElement {
  const { c, g } = canvas(TS, TS);
  const rnd = seeded(variant * 7919 + (kind === 'grass' ? 11 : kind === 'dirt' ? 53 : 97));
  g.fillStyle = kind === 'grass' ? P.grass : kind === 'dirt' ? P.dirt : P.sand;
  g.fillRect(0, 0, TS, TS);
  for (let n = 0; n < 7; n++) {
    const x = 24 + rnd() * (TS - 48);
    const y = 24 + rnd() * (TS - 48);
    const r = 8 + rnd() * 14;
    ellipse(g, x, y, r, r * (0.6 + rnd() * 0.4), rnd() < 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)');
  }
  if (kind === 'sand') {
    for (let n = 0; n < 16; n++) {
      g.fillStyle = 'rgba(160,130,70,0.18)';
      g.fillRect(8 + rnd() * (TS - 16), 8 + rnd() * (TS - 16), 2, 2);
    }
  }
  return c;
}

/** Tileable water: flat colour plus faint pale lines (period divides the texture size, so it wraps). */
function placeholderWater(depth: 0 | 1 | 2): HTMLCanvasElement {
  const { c, g } = canvas(WATER_PX, WATER_PX);
  g.fillStyle = '#' + WATER[depth].toString(16).padStart(6, '0');
  g.fillRect(0, 0, WATER_PX, WATER_PX);
  g.strokeStyle = P.waterLine;
  g.lineWidth = depth === 0 ? 3 : 2;
  for (let k = -8; k <= 8; k++) {
    g.beginPath();
    g.moveTo(-WATER_PX, k * 64 - WATER_PX);
    g.lineTo(2 * WATER_PX, k * 64 + 2 * WATER_PX);
    g.stroke();
  }
  return c;
}

/** A small house: light left wall, darker right wall, triangular roof. `w` is the wall width in px. */
function drawHut(g: Ctx, cx: number, baseY: number, w: number, roof: string): void {
  const h = w * 0.55;
  softShadow(g, cx + w * 0.1, baseY, w * 0.7, w * 0.22, 0.35);
  poly(g, [[cx - w / 2, baseY - h], [cx, baseY - h + w * 0.1], [cx, baseY + w * 0.1], [cx - w / 2, baseY]], P.hutLeft);
  poly(g, [[cx, baseY - h + w * 0.1], [cx + w / 2, baseY - h], [cx + w / 2, baseY], [cx, baseY + w * 0.1]], P.hutRight);
  const eave = w * 0.08;
  const apex: [number, number] = [cx, baseY - h - w * 0.55];
  poly(g, [[cx - w / 2 - eave, baseY - h], [cx, baseY - h + w * 0.1 + eave * 0.5], apex], roof);
  poly(g, [[cx, baseY - h + w * 0.1 + eave * 0.5], [cx + w / 2 + eave, baseY - h], apex], roof);
  poly(g, [[cx, baseY - h + w * 0.1 + eave * 0.5], [cx + w / 2 + eave, baseY - h], apex], 'rgba(0,0,0,0.22)');
}

const HUT_SIZES = { small: 22, medium: 30, large: 40 } as const;
type HutSize = keyof typeof HUT_SIZES;

/** Hut positions (0..1 of the village canvas) for villages of 2..6 huts. */
const VILLAGE_LAYOUTS: [number, number, HutSize][][] = [
  [[0.35, 0.55, 'medium'], [0.68, 0.72, 'small']],
  [[0.3, 0.5, 'medium'], [0.68, 0.55, 'large'], [0.5, 0.85, 'small']],
  [[0.28, 0.45, 'small'], [0.7, 0.45, 'medium'], [0.32, 0.8, 'medium'], [0.7, 0.85, 'small']],
  [[0.3, 0.4, 'medium'], [0.68, 0.4, 'small'], [0.5, 0.6, 'large'], [0.25, 0.85, 'small'], [0.72, 0.85, 'medium']],
  [[0.22, 0.45, 'small'], [0.5, 0.35, 'medium'], [0.78, 0.45, 'small'], [0.3, 0.8, 'medium'], [0.58, 0.72, 'large'], [0.82, 0.88, 'small']],
];

// ---- kit -----------------------------------------------------------------------------------------------

export class TileKit {
  private art: Map<string, Art[]>;
  private placeholders = new Map<string, Sprite3D[]>();
  private warned = new Set<string>();
  private cache = new Map<string, Texture>();
  private waterTex = new Map<string, Texture>();
  private groundBase = new Map<string, HTMLCanvasElement[]>();

  private atlases: { c: HTMLCanvasElement; g: Ctx; tex: Texture; next: number }[] = [];
  private dirty = new Set<number>();

  constructor(art: Map<string, Art[]>) {
    this.art = art;
  }

  /** Pick one entry of a category by seeded weight. Never random: the same hash always gives the same one. */
  pick(category: string, hash: number): Sprite3D {
    const list = this.sprites(category);
    if (list.length === 1) return list[0];
    const real = this.art.get(category);
    let total = 0;
    const weights = list.map((_, i) => {
      const w = real?.[i]?.entry.weight ?? 1;
      total += w;
      return w;
    });
    let r = (((Math.imul(hash | 0, 2654435761) >>> 0) / 4294967296) * total) % total;
    for (let i = 0; i < list.length; i++) {
      r -= weights[i];
      if (r < 0) return list[i];
    }
    return list[list.length - 1];
  }

  /** Sprites for a category: real art if the manifest has it, otherwise the placeholder (warns once). */
  private sprites(category: string): Sprite3D[] {
    const real = this.art.get(category);
    if (real && real.length > 0) {
      let cached = this.placeholders.get('real:' + category);
      if (!cached) {
        cached = real.map(({ entry, img }) => {
          const texture = Texture.from(img);
          // Hand-drawn pixel art: crisp up close (nearest), smooth when zoomed out (mipmaps).
          texture.source.style.magFilter = 'nearest';
          texture.source.style.minFilter = 'linear';
          texture.source.style.mipmapFilter = 'linear';
          texture.source.autoGenerateMipmaps = true;
          const widthInTiles = entry.widthInTiles ?? 0.8;
          return {
            texture,
            aspect: img.width / img.height,
            anchor: entry.anchor ?? [0.5, 0.94],
            widthInTiles,
            shadowInTiles: entry.shadowInTiles ?? widthInTiles * 0.9,
          };
        });
        this.placeholders.set('real:' + category, cached);
      }
      return cached;
    }
    let ph = this.placeholders.get(category);
    if (!ph) {
      if (!this.warned.has(category)) {
        this.warned.add(category);
        console.warn(`TileKit: no art for "${category}", using a placeholder`);
      }
      ph = this.makePlaceholder(category);
      this.placeholders.set(category, ph);
    }
    return ph;
  }

  private sprite(c: HTMLCanvasElement, anchor: [number, number], widthInTiles: number): Sprite3D {
    return { texture: Texture.from(c), aspect: c.width / c.height, anchor, widthInTiles, shadowInTiles: widthInTiles * 0.9 };
  }

  private makePlaceholder(category: string): Sprite3D[] {
    const out: Sprite3D[] = [];
    switch (category) {
      case 'objects.tree.leafy':
        for (const col of P.leafy) {
          const { c, g } = canvas(64, 96);
          softShadow(g, 32, 88, 22, 6, 0.3);
          g.fillStyle = P.trunk;
          g.fillRect(28, 52, 8, 38);
          ellipse(g, 32, 34, 24, 26, col);
          ellipse(g, 22, 44, 14, 14, col);
          ellipse(g, 42, 44, 14, 14, col);
          ellipse(g, 26, 26, 10, 10, 'rgba(255,255,255,0.12)');
          out.push(this.sprite(c, [0.5, 0.94], 0.8));
        }
        break;
      case 'objects.tree.conifer':
        for (const col of P.conifer) {
          const { c, g } = canvas(64, 96);
          softShadow(g, 32, 88, 18, 5, 0.3);
          g.fillStyle = P.trunk;
          g.fillRect(29, 70, 6, 20);
          poly(g, [[32, 4], [54, 40], [10, 40]], col);
          poly(g, [[32, 22], [58, 62], [6, 62]], col);
          poly(g, [[32, 40], [60, 78], [4, 78]], col);
          poly(g, [[32, 4], [54, 40], [32, 40]], 'rgba(0,0,0,0.15)');
          out.push(this.sprite(c, [0.5, 0.94], 0.7));
        }
        break;
      case 'objects.tree.bush': {
        const { c, g } = canvas(64, 44);
        softShadow(g, 32, 38, 24, 5, 0.25);
        ellipse(g, 32, 26, 24, 14, P.bush);
        ellipse(g, 20, 28, 12, 10, P.bush);
        ellipse(g, 44, 28, 12, 10, P.bush);
        ellipse(g, 28, 22, 8, 6, 'rgba(255,255,255,0.12)');
        out.push(this.sprite(c, [0.5, 0.9], 0.42));
        break;
      }
      case 'objects.tree.dead': {
        const { c, g } = canvas(64, 96);
        softShadow(g, 32, 88, 16, 4, 0.25);
        g.strokeStyle = P.dead;
        g.lineCap = 'round';
        g.lineWidth = 6;
        g.beginPath();
        g.moveTo(32, 90); g.lineTo(32, 30);
        g.moveTo(32, 60); g.lineTo(14, 40);
        g.moveTo(32, 46); g.lineTo(50, 28);
        g.stroke();
        out.push(this.sprite(c, [0.5, 0.94], 0.6));
        break;
      }
      case 'objects.rock': {
        const { c, g } = canvas(48, 36);
        softShadow(g, 24, 30, 20, 5, 0.3);
        ellipse(g, 24, 20, 19, 13, P.rockDark);
        ellipse(g, 24, 17, 17, 11, P.rock);
        ellipse(g, 19, 13, 6, 4, 'rgba(255,255,255,0.2)');
        out.push(this.sprite(c, [0.5, 0.9], 0.34));
        break;
      }
      case 'objects.tuft': {
        const { c, g } = canvas(40, 32);
        g.strokeStyle = P.tuft;
        g.lineWidth = 3;
        g.lineCap = 'round';
        g.beginPath();
        for (const x of [10, 16, 22, 28]) {
          g.moveTo(x, 28);
          g.quadraticCurveTo(x + (x - 19) * 0.4, 16, x + (x - 19) * 0.8, 6);
        }
        g.stroke();
        out.push(this.sprite(c, [0.5, 0.9], 0.34));
        break;
      }
      case 'objects.coral':
        for (let v = 0; v < 4; v++) {
          const { c, g } = canvas(64, 64);
          const rnd = seeded(300 + v);
          g.lineCap = 'round';
          const n = 3 + (v % 3);
          for (let k = 0; k < n; k++) {
            const x = 14 + rnd() * 36;
            const y = 52 - rnd() * 8;
            const col = P.coral[(v + k) % P.coral.length];
            g.strokeStyle = col;
            g.lineWidth = 4;
            const tx = x + (rnd() - 0.5) * 20;
            const ty = y - 14 - rnd() * 18;
            g.beginPath();
            g.moveTo(x, y); g.lineTo(tx, ty);
            g.moveTo((x + tx) / 2, (y + ty) / 2); g.lineTo(tx + 8, ty + 6);
            g.stroke();
            ellipse(g, tx, ty, 4, 4, col);
          }
          out.push(this.sprite(c, [0.5, 0.82], 0.45));
        }
        break;
      case 'objects.port': {
        const { c, g } = canvas(96, 48);
        softShadow(g, 48, 38, 40, 6, 0.25);
        g.fillStyle = P.dock;
        g.fillRect(8, 16, 80, 16);
        g.fillStyle = P.dockDark;
        for (let x = 14; x < 88; x += 14) g.fillRect(x, 16, 2, 16);
        g.fillRect(8, 32, 80, 4);
        for (const x of [10, 44, 82]) g.fillRect(x, 10, 5, 26);
        out.push(this.sprite(c, [0.5, 0.6], 0.9));
        break;
      }
      case 'objects.campfire': {
        const { c, g } = canvas(32, 32);
        softShadow(g, 16, 24, 11, 4, 0.3);
        for (let a = 0; a < 8; a++) ellipse(g, 16 + Math.cos(a * 0.785) * 9, 24 + Math.sin(a * 0.785) * 3.2, 2.4, 1.8, P.stone);
        poly(g, [[16, 7], [22, 20], [10, 20]], P.fire[0]);
        poly(g, [[16, 11], [20, 21], [12, 21]], P.fire[1]);
        poly(g, [[16, 15], [18, 22], [14, 22]], P.fire[2]);
        out.push(this.sprite(c, [0.5, 0.8], 2.2));
        break;
      }
      case 'objects.shadow': {
        const { c, g } = canvas(64, 32);
        softShadow(g, 32, 16, 30, 14, 0.45);
        out.push(this.sprite(c, [0.5, 0.5], 1));
        break;
      }
      default:
        if (category.startsWith('objects.hut.')) {
          const size = category.slice('objects.hut.'.length) as HutSize;
          const w = HUT_SIZES[size] ?? HUT_SIZES.medium;
          for (const roof of P.roofs) {
            const { c, g } = canvas(Math.ceil(w * 1.4), Math.ceil(w * 1.6));
            drawHut(g, c.width / 2, c.height - w * 0.3, w, roof);
            out.push(this.sprite(c, [0.5, 0.85], 0.2 + w / 160));
          }
          break;
        }
        if (category === 'objects.village') {
          // Code-arranged cluster of 2-6 houses, in several variants.
          for (let v = 0; v < VILLAGE_LAYOUTS.length * 2; v++) out.push(this.villageVariant(v));
          break;
        }
        console.warn(`TileKit: unknown category "${category}"`);
        out.push(this.sprite(canvas(8, 8).c, [0.5, 0.5], 0.1));
    }
    return out;
  }

  /** A village cluster: houses laid out by code (placeholder or real hut art), tinted roofs, three sizes. */
  private villageVariant(v: number): Sprite3D {
    const layout = VILLAGE_LAYOUTS[v % VILLAGE_LAYOUTS.length];
    const W = 256;
    const H = 192;
    const { c, g } = canvas(W, H);
    const rnd = seeded(500 + v);
    const order = [...layout].sort((a, b) => a[1] - b[1]);
    for (const [px, py, size] of order) {
      const w = HUT_SIZES[size] * 1.5;
      const x = px * W;
      const y = py * (H - 20) + 14;
      const real = this.art.get('objects.hut.' + size);
      if (real && real.length > 0) {
        g.imageSmoothingEnabled = false; // pixel art stays crisp
        const a = real[Math.floor(rnd() * real.length)];
        const hh = (w * 1.4) / (a.img.width / a.img.height);
        const ax = a.entry.anchor ?? [0.5, 0.85];
        g.drawImage(a.img, x - w * 1.4 * ax[0], y - hh * ax[1], w * 1.4, hh);
      } else {
        drawHut(g, x, y, w, P.roofs[Math.floor(rnd() * P.roofs.length)]);
      }
    }
    return this.sprite(c, [0.5, 0.6], 1);
  }

  // ---- convenience wrappers (the renderer uses these) ----

  /** Does the manifest have real art for this category? (placeholders do not count) */
  hasArt(category: string): boolean {
    return (this.art.get(category)?.length ?? 0) > 0;
  }
  /** One house of the given size (a file or function); `hash` picks the variant. */
  hut(size: 'small' | 'medium' | 'large', hash: number): Sprite3D {
    return this.pick('objects.hut.' + size, hash);
  }

  /** A whole village: a small cluster of houses. `hash` picks the variant. */
  village(hash: number): Sprite3D {
    return this.pick('objects.village', hash);
  }
  rock(hash: number): Sprite3D {
    return this.pick('objects.rock', hash);
  }
  tuft(hash: number): Sprite3D {
    return this.pick('objects.tuft', hash);
  }
  tree(kind: TreeKind, hash: number): Sprite3D {
    return this.pick('objects.tree.' + kind, hash);
  }
  /** A campfire (flames in a ring of stones). */
  campfire(hash: number): Sprite3D {
    return this.pick('objects.campfire', hash);
  }
  coral(hash: number): Sprite3D {
    return this.pick('objects.coral', hash);
  }
  port(hash: number): Sprite3D {
    return this.pick('objects.port', hash);
  }
  /** Soft ellipse drawn under every standing object. */
  get shadow(): Sprite3D {
    return this.pick('objects.shadow', 0);
  }

  /** How many grid cells one copy of the water texture covers (real art: per manifest, default 1). */
  waterCells(depth: 0 | 1 | 2): number {
    const real = this.art.get(['water.deep', 'water.shallow', 'water.reef'][depth])?.[0];
    return real ? real.entry.cells ?? 1 : 4;
  }

  /** Water texture by depth (ocean `variant`): 0 deep, 1 shallow, 2 reef. Tileable. */
  water(depth: 0 | 1 | 2): Texture {
    const name = ['water.deep', 'water.shallow', 'water.reef'][depth];
    let t = this.waterTex.get(name);
    if (t) return t;
    const real = this.art.get(name)?.[0];
    if (real) {
      t = Texture.from(real.img);
      // Hand-drawn (pixel) art stays crisp up close and smooth when zoomed out.
      t.source.style.magFilter = 'nearest';
    } else {
      if (!this.warned.has(name)) {
        this.warned.add(name);
        console.warn(`TileKit: no art for "${name}", using a placeholder`);
      }
      t = Texture.from(placeholderWater(depth));
    }
    // Water is minified a lot when zoomed out: mipmaps keep it smooth instead of noisy.
    t.source.autoGenerateMipmaps = true;
    if (!real) t.source.style.scaleMode = 'linear';
    t.source.style.minFilter = 'linear';
    t.source.style.mipmapFilter = 'linear';
    t.source.update();
    this.waterTex.set(name, t);
    return t;
  }

  private groundVariants(kind: 'grass' | 'sand' | 'dirt'): HTMLCanvasElement[] {
    let v = this.groundBase.get(kind);
    if (v) return v;
    const real = this.art.get('ground.' + kind);
    if (real && real.length > 0) {
      v = real.map(({ img }) => {
        const { c, g } = canvas(TS, TS);
        g.imageSmoothingEnabled = false; // pixel art stays crisp when scaled up to the tile size
        g.drawImage(img, 0, 0, TS, TS);
        return c;
      });
    } else {
      const cat = 'ground.' + kind;
      if (!this.warned.has(cat)) {
        this.warned.add(cat);
        console.warn(`TileKit: no art for "${cat}", using a placeholder`);
      }
      v = [0, 1, 2, 3].map((i) => placeholderGround(kind, i));
    }
    this.groundBase.set(kind, v);
    return v;
  }

  /** The flat square texture for a ground tile (grass or sand) with the given edges. Cached in the atlas. */
  ground(kind: 'grass' | 'sand' | 'dirt', variant: number, edges: Edge[]): Texture {
    const bases = this.groundVariants(kind);
    const n = bases.length;
    const v = ((variant % n) + n) % n;
    const rot = this.art.get('ground.' + kind)?.length ? ((Math.floor(variant / n) % 4) + 4) % 4 : 0;
    const key = `${kind}|${v}|${rot}|${edges.join('')}`;
    let t = this.cache.get(key);
    if (t) return t;
    const { c, g } = canvas(TS, TS);
    g.save();
    g.translate(TS / 2, TS / 2);
    g.rotate((rot * Math.PI) / 2);
    g.drawImage(bases[v], -TS / 2, -TS / 2);
    g.restore();
    for (const s of SIDES) {
      if (kind !== 'grass' || edges[s] !== Edge.Sand) continue;
      if (this.art.get('ground.sand')?.length) {
        // Real sand art: blend a strip of the sand texture itself in from the edge.
        const { c: band, g: bg } = canvas(TS, TS);
        bg.drawImage(this.groundVariants('sand')[0], 0, 0);
        bg.globalCompositeOperation = 'destination-in';
        sideBand(bg, s, 26, 'rgba(0,0,0,1)', true);
        g.drawImage(band, 0, 0);
      } else sideBand(g, s, 26, P.sandBlend, true);
    }
    for (const s of SIDES) if (edges[s] === Edge.Water) {
      sideBand(g, s, 10, 'rgba(255,255,255,0.35)', false);
      sideBand(g, s, 5, P.foam, false);
    }
    t = this.slot(c);
    this.cache.set(key, t);
    return t;
  }

  /**
   * A whole shore tile (water, foam and sand drawn together) from the manifest, e.g. 'shore.edge.n',
   * 'shore.outer.ne', 'shore.inner.sw', 'shore.water'. Null when there is no such art (then the renderer
   * falls back to ground tiles). Flat square, mapped onto the diamond like ground.
   */
  shore(category: string, hash: number): Texture | null {
    const list = this.art.get(category);
    if (!list || list.length === 0) return null;
    let total = 0;
    for (const a of list) total += a.entry.weight ?? 1;
    let r = ((Math.imul(hash | 0, 2654435761) >>> 0) / 4294967296) * total;
    let k = 0;
    for (; k < list.length - 1; k++) {
      r -= list[k].entry.weight ?? 1;
      if (r < 0) break;
    }
    const key = `${category}|${k}`;
    let t = this.cache.get(key);
    if (t) return t;
    const { c, g } = canvas(TS, TS);
    g.imageSmoothingEnabled = false;
    g.drawImage(list[k].img, 0, 0, TS, TS);
    t = this.slot(c);
    this.cache.set(key, t);
    return t;
  }

  /** Re-upload atlases if new tiles were composed since the last call. */
  flush(): void {
    for (const i of this.dirty) this.atlases[i].tex.source.update();
    this.dirty.clear();
  }

  /** Copy a composed tile into the next free atlas slot (1px extruded border not needed: tiles are drawn oversized). */
  private slot(tile: HTMLCanvasElement): Texture {
    const perRow = Math.floor(ATLAS / TS);
    let ai = this.atlases.length - 1;
    if (ai < 0 || this.atlases[ai].next >= perRow * perRow) {
      const { c, g } = canvas(ATLAS, ATLAS);
      this.atlases.push({ c, g, tex: Texture.from(c), next: 0 });
      ai++;
    }
    const a = this.atlases[ai];
    const x = (a.next % perRow) * TS;
    const y = Math.floor(a.next / perRow) * TS;
    a.next++;
    a.g.drawImage(tile, x, y);
    this.dirty.add(ai);
    return new Texture({ source: a.tex.source, frame: new Rectangle(x, y, TS, TS) });
  }
}

/** Load the manifest (if any) and the images it names. Never throws: missing art means placeholders. */
export async function loadTileKit(): Promise<TileKit> {
  const art = new Map<string, Art[]>();
  let manifest: Manifest = {};
  try {
    const res = await fetch(BASE + 'manifest.json');
    // The dev server answers unknown paths with index.html; only accept real JSON.
    if (res.ok) manifest = JSON.parse(await res.text());
  } catch {
    // no manifest: all placeholders
  }
  await Promise.all(
    Object.entries(manifest).map(async ([category, entries]) => {
      if (!Array.isArray(entries)) return;
      const loaded: Art[] = [];
      for (const entry of entries) {
        try {
          loaded.push({ entry, img: await loadImage(BASE + entry.file) });
        } catch (e) {
          console.warn(`TileKit: ${category}: ${(e as Error).message}`);
        }
      }
      if (loaded.length > 0) art.set(category, loaded);
    }),
  );
  return new TileKit(art);
}
