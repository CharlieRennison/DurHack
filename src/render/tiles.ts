/**
 * Turns the art in public/assets/tiles/ (shrunk by tools/shrink-textures.ps1) into usable tiles.
 *
 *  - Ground (grass, sand): several variants each, cut from different parts of the texture and
 *    rotated/flipped, so a field of tiles does not look like a repeating stamp.
 *  - Coasts and shores: the "sand to water" and "sand to grass" art is turned into edge masks, so a
 *    sand tile gets a ragged water edge on each side that faces water, and a grass tile gets sand
 *    blended in on each side that faces sand. Combinations are built on demand and cached.
 *  - Water: one seamless tiling texture (drawn as a TilingSprite, so there are no tile seams).
 *  - Coral: the coral art becomes cut-outs laid along a coral region's border.
 *  - Huts and trees: sprites cut from the cluster art, with the glow around them removed.
 *
 * All flat tiles are drawn on a square canvas in grid axes (u = +x, v = +y); the renderer maps the
 * square onto the isometric diamond with an affine transform.
 */
import { Rectangle, Texture } from 'pixi.js';

/** Pixel size of one flat ground tile. */
const TS = 96;
const ATLAS = 2048;
const BASE = '/assets/tiles/';

/** Directions in grid axes, in the order used for edge arrays: +x, +y, -x, -y. */
export type Side = 0 | 1 | 2 | 3;
export const SIDES: Side[] = [0, 1, 2, 3];

/** What a ground tile touches on one side. */
export const Edge = {
  None: 0,
  /** Sand blends into this (grass) tile along the edge. */
  Sand: 1,
  /** Water: the tile's own ground is cut away with a ragged shoreline, revealing the water below. */
  Water: 2,
} as const;
export type Edge = (typeof Edge)[keyof typeof Edge];

type Ctx = CanvasRenderingContext2D;

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: Ctx } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d', { willReadFrequently: true })! };
}

function loadImage(name: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load ' + name));
    img.src = name.startsWith('/') ? name : BASE + name;
  });
}

/** Draw `src` (or a sub-rect of it) into a size x size tile, optionally rotated/flipped about the centre. */
function drawTile(g: Ctx, src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, rot: number, flip: boolean, size = TS): void {
  g.save();
  g.translate(size / 2, size / 2);
  g.rotate((rot * Math.PI) / 2);
  if (flip) g.scale(-1, 1);
  g.drawImage(src, sx, sy, sw, sh, -size / 2, -size / 2, size, size);
  g.restore();
}

/** Canvas whose alpha is computed from each pixel of `img` (scaled to a TS square). */
function alphaMask(img: HTMLImageElement, alphaOf: (r: number, g: number, b: number) => number): HTMLCanvasElement {
  const { c, g } = canvas(TS, TS);
  g.drawImage(img, 0, 0, TS, TS);
  const d = g.getImageData(0, 0, TS, TS);
  for (let i = 0; i < d.data.length; i += 4) {
    const a = alphaOf(d.data[i], d.data[i + 1], d.data[i + 2]);
    d.data[i] = d.data[i + 1] = d.data[i + 2] = 255;
    d.data[i + 3] = Math.round(Math.min(1, Math.max(0, a)) * 255);
  }
  g.putImageData(d, 0, 0);
  return c;
}

/** Rotate/flip a mask so its "other material" side faces `side` (the source art has it on +x). */
function maskForSide(base: HTMLCanvasElement, side: Side): HTMLCanvasElement {
  const { c, g } = canvas(TS, TS);
  switch (side) {
    case 0: // +x: as drawn
      g.drawImage(base, 0, 0);
      break;
    case 2: // -x: mirror
      g.translate(TS, 0);
      g.scale(-1, 1);
      g.drawImage(base, 0, 0);
      break;
    case 1: // +y: transpose
      g.setTransform(0, 1, 1, 0, 0, 0);
      g.drawImage(base, 0, 0);
      break;
    case 3: // -y: mirror then transpose
      g.setTransform(0, 1, 1, 0, 0, 0);
      g.translate(TS, 0);
      g.scale(-1, 1);
      g.drawImage(base, 0, 0);
      break;
  }
  return c;
}

/** A rectangle of a sprite sheet, in the sheet's original pixel size. */
interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The hut art is a finished village (five huts round a campfire) on a transparent background. The huts
 * overlap each other and the props, so cutting single huts out with rectangles drags in neighbours;
 * the whole village is used instead (coordinates in the original full-size image).
 */
const VILLAGE_CROP: Crop = { x: 60, y: 85, w: 1150, h: 1045 };
const HUT_SRC_W = 1254;
/** Rocks and grass tufts in the tree art are isolated objects: free variety for the grass. */
const ROCK_CROPS: Crop[] = [
  { x: 125, y: 495, w: 130, h: 90 },
  { x: 1265, y: 690, w: 110, h: 75 },
  { x: 975, y: 850, w: 100, h: 70 },
];
const TUFT_CROPS: Crop[] = [
  { x: 195, y: 565, w: 85, h: 65 },
  { x: 400, y: 850, w: 90, h: 70 },
  { x: 1335, y: 605, w: 95, h: 65 },
  { x: 1180, y: 715, w: 80, h: 70 },
];
const TREE_SRC_W = 1536;

export interface Sprite3D {
  texture: Texture;
  /** Width / height of the cut-out, for sizing. */
  aspect: number;
}

export class TileKit {
  readonly water: Texture;
  readonly grassVariants = 4;
  readonly sandVariants = 4;

  private atlas = canvas(ATLAS, ATLAS);
  private atlasTex: Texture;
  private nextSlot = 0;
  private dirty = false;
  private cache = new Map<string, Texture>();

  private grass: HTMLCanvasElement[] = [];
  private sand: HTMLCanvasElement[] = [];
  /** maskWater[side]: alpha = water. maskSand[side]: alpha = sand (blended into grass). */
  private maskWater: HTMLCanvasElement[] = [];
  private maskSand: HTMLCanvasElement[] = [];
  private coralStraight: HTMLCanvasElement;
  private coralCorner: HTMLCanvasElement;
  private villageSprite: Sprite3D;
  private rocks: Sprite3D[] = [];
  private tufts: Sprite3D[] = [];
  private treeSets: Record<TreeKind, Sprite3D[]>;

  constructor(img: Record<string, HTMLImageElement>) {
    this.water = Texture.from(img.water);
    // Water is minified a lot when zoomed out: mipmaps keep it smooth instead of noisy.
    this.water.source.autoGenerateMipmaps = true;
    this.water.source.style.scaleMode = 'linear';
    this.water.source.style.mipmapFilter = 'linear';
    this.water.source.update();

    // --- ground variants: four different quarter-crops, each rotated/flipped differently ---
    const crops: [number, number, number, boolean][] = [
      [0, 0, 0, false],
      [128, 0, 1, true],
      [0, 128, 2, false],
      [128, 128, 3, true],
    ];
    for (const [name, out] of [['grass', this.grass], ['sand', this.sand]] as const) {
      for (const [sx, sy, rot, flip] of crops) {
        const { c, g } = canvas(TS, TS);
        drawTile(g, img[name], sx, sy, 128, 128, rot, flip);
        out.push(c);
      }
    }

    // --- edge masks from the transition art (source: sand on the left, other material on the right) ---
    const waterBase = alphaMask(img.sand_water, (r, _g, b) => (b - r) / 60 + 0.5);
    // "sand to grass" has sand on the LEFT and grass on the right; we want the SAND side, which means
    // the grass-blend mask must be mirrored so sand sits on +x.
    const sandOnRight = (() => {
      const m = alphaMask(img.sand_grass, (r, g) => (12 - (g - r)) / 30);
      const { c, g } = canvas(TS, TS);
      g.translate(TS, 0);
      g.scale(-1, 1);
      g.drawImage(m, 0, 0);
      return c;
    })();
    for (const side of SIDES) {
      this.maskWater[side] = maskForSide(waterBase, side);
      // sandOnRight already has the sand mask at +x after mirroring the "sand on left" art:
      // here the mask is the *grass-free* (sand) area, which in the source is on the left; mirrored, on the right.
      this.maskSand[side] = maskForSide(sandOnRight, side);
    }

    // --- coral cut-outs (coral pixels only, water removed) ---
    const cut = (im: HTMLImageElement) => alphaMaskWithColor(im, (r, g) => (r - g + 12) / 30);
    this.coralStraight = cut(img.coral_straight);
    this.coralCorner = cut(img.coral_corner);

    // --- huts and trees: clean the glow, then cut individual sprites ---
    const hutSheet = cleanSprite(img.huts);
    const treeSheet = cleanSprite(img.trees);
    const hutTex = Texture.from(hutSheet);
    const treeTex = Texture.from(treeSheet);
    this.villageSprite = cropTexture(hutTex, hutSheet.width / HUT_SRC_W, VILLAGE_CROP);
    const ts = treeSheet.width / TREE_SRC_W;
    this.rocks = ROCK_CROPS.map((r) => cropTexture(treeTex, ts, r));
    this.tufts = TUFT_CROPS.map((r) => cropTexture(treeTex, ts, r));
    // Trees: the sheet of single trees on magenta is keyed out and cut into separate sprites.
    this.treeSets = sliceTreeSheet(img.tree_sheet);

    this.atlasTex = Texture.from(this.atlas.c);
  }

  /** The flat square texture for a ground tile (grass or sand) with the given edges. Cached. */
  ground(kind: 'grass' | 'sand', variant: number, edges: Edge[]): Texture {
    const v = ((variant % 4) + 4) % 4;
    const key = `${kind}|${v}|${edges.join('')}`;
    let t = this.cache.get(key);
    if (t) return t;
    const { c, g } = canvas(TS, TS);
    g.drawImage(kind === 'grass' ? this.grass[v] : this.sand[v], 0, 0);
    if (kind === 'grass') {
      for (const s of SIDES) {
        if (edges[s] !== Edge.Sand) continue;
        const { c: tmp, g: tg } = canvas(TS, TS);
        tg.drawImage(this.sand[(v + 1) % 4], 0, 0);
        tg.globalCompositeOperation = 'destination-in';
        tg.drawImage(this.maskSand[s], 0, 0);
        g.drawImage(tmp, 0, 0);
      }
    }
    g.globalCompositeOperation = 'destination-out';
    for (const s of SIDES) if (edges[s] === Edge.Water) g.drawImage(this.maskWater[s], 0, 0);
    t = this.slot(c);
    this.cache.set(key, t);
    return t;
  }

  /**
   * Cut-out of coral to lay along a coral region's border. `outside` flags which sides border a
   * non-coral tile; one outside side uses the straight piece, two adjacent sides the corner piece.
   * Returns one texture per piece to draw (usually 1, sometimes 2).
   */
  coralPieces(outside: boolean[]): Texture[] {
    const sides = SIDES.filter((s) => outside[s]);
    if (sides.length === 0) return [];
    const key = 'coral|' + sides.join('');
    const hit = this.cache.get(key);
    if (hit) return [hit];
    const { c, g } = canvas(TS, TS);
    const corner = this.cornerRotation(outside);
    if (corner !== null) {
      g.save();
      g.translate(TS / 2, TS / 2);
      g.rotate((corner * Math.PI) / 2);
      for (const [dx, dy] of [[0, 0], [-0.12, 0.12], [0.12, -0.12], [0.2, 0.05], [-0.2, -0.05]]) {
        g.drawImage(this.coralCorner, -TS / 2 + dx * TS, -TS / 2 + dy * TS);
      }
      g.restore();
      // Any remaining outside sides get straight pieces as well.
      for (const s of sides) if (!this.coveredByCorner(s, corner)) this.drawStraight(g, s);
    } else {
      for (const s of sides) this.drawStraight(g, s);
    }
    g.drawImage(c, 0, 0); // draw over itself once: the art is translucent and needs more body
    const t = this.slot(c);
    this.cache.set(key, t);
    return [t];
  }

  /** Corner piece rotation (0..3) if exactly an adjacent pair of sides is outside, else null. */
  private cornerRotation(outside: boolean[]): number | null {
    // Rotation 0 of the art closes off the (-y, -x) corner. Rotations step clockwise: (-y,+x), (+y,+x), (+y,-x).
    const pairs: [Side, Side][] = [[3, 2], [3, 0], [1, 0], [1, 2]];
    for (let r = 0; r < 4; r++) {
      if (outside[pairs[r][0]] && outside[pairs[r][1]]) return r;
    }
    return null;
  }
  private coveredByCorner(s: Side, rot: number): boolean {
    const pairs: [Side, Side][] = [[3, 2], [3, 0], [1, 0], [1, 2]];
    return pairs[rot].includes(s);
  }

  /** A straight coral band close to the edge on the given side. The art has a horizontal band across the middle. */
  private drawStraight(g: Ctx, side: Side): void {
    g.save();
    g.translate(TS / 2, TS / 2);
    // Rotate a quarter turn for the +x / -x sides. After that, local -y points at the target edge
    // for sides 3 (-y) and 0 (+x), and +y points at it for sides 1 (+y) and 2 (-x).
    if (side === 0 || side === 2) g.rotate(Math.PI / 2);
    const towardEdge = side === 3 || side === 0 ? -1 : 1;
    g.translate(0, towardEdge * TS * 0.3);
    // The art is a sparse scatter of small branches. Layer several offset copies, wider than the
    // original strip, so it builds into a dense reef border that reads at map zoom.
    g.scale(1, 2.2);
    for (const [dx, dy] of [[0, 0], [-0.22, 0.05], [0.22, -0.05], [-0.4, -0.04], [0.4, 0.04], [0.1, 0.1], [-0.1, -0.1]]) {
      g.drawImage(this.coralStraight, -TS / 2 + dx * TS, -TS / 2 + dy * TS);
    }
    g.restore();
  }

  /** A whole village: several huts round a campfire. */
  get village(): Sprite3D {
    return this.villageSprite;
  }
  rock(variant: number): Sprite3D {
    return this.rocks[variant % this.rocks.length];
  }
  tuft(variant: number): Sprite3D {
    return this.tufts[variant % this.tufts.length];
  }
  /** A tree of the given kind; `variant` picks one deterministically (any integer). */
  tree(kind: TreeKind, variant: number): Sprite3D {
    const set = this.treeSets[kind];
    return set[((variant % set.length) + set.length) % set.length];
  }
  treeCount(kind: TreeKind): number {
    return this.treeSets[kind].length;
  }

  /** Re-upload the atlas if new tiles were composed since the last call. */
  flush(): void {
    if (this.dirty) {
      this.atlasTex.source.update();
      this.dirty = false;
    }
  }

  /** Copy a composed tile into the next free atlas slot and return a sub-texture for it. */
  private slot(tile: HTMLCanvasElement): Texture {
    const perRow = Math.floor(ATLAS / TS);
    if (this.nextSlot >= perRow * perRow) throw new Error('tile atlas is full');
    const x = (this.nextSlot % perRow) * TS;
    const y = Math.floor(this.nextSlot / perRow) * TS;
    this.nextSlot++;
    this.atlas.g.drawImage(tile, x, y);
    this.dirty = true;
    return new Texture({ source: this.atlasTex.source, frame: new Rectangle(x, y, TS, TS) });
  }
}

/** Like alphaMask but keeps the original colours, so the result is a colour cut-out. */
function alphaMaskWithColor(img: HTMLImageElement, alphaOf: (r: number, g: number, b: number) => number): HTMLCanvasElement {
  const { c, g } = canvas(TS, TS);
  g.drawImage(img, 0, 0, TS, TS);
  const d = g.getImageData(0, 0, TS, TS);
  for (let i = 0; i < d.data.length; i += 4) {
    const a = alphaOf(d.data[i], d.data[i + 1], d.data[i + 2]);
    d.data[i + 3] = Math.round(Math.min(1, Math.max(0, a)) * 255);
  }
  g.putImageData(d, 0, 0);
  return c;
}

/** Remove the semi-transparent glow/fringe around a sprite sheet, keeping only solid pixels. */
function cleanSprite(img: HTMLImageElement): HTMLCanvasElement {
  const { c, g } = canvas(img.width, img.height);
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height);
  // The glow is semi-transparent (low alpha); the artwork itself is solid. Ramp between them so the
  // outline stays soft rather than a hard stair-stepped cut.
  for (let i = 3; i < d.data.length; i += 4) {
    const a = d.data[i];
    d.data[i] = a <= 150 ? 0 : a >= 215 ? 255 : Math.round(((a - 150) / 65) * 255);
  }
  g.putImageData(d, 0, 0);
  return c;
}

export type TreeKind = 'conifer' | 'leafy' | 'bush' | 'dead';

/**
 * Cut the tree sheet (trees laid out on a flat magenta background) into single sprites:
 *  1. key the magenta out (it is far from any foliage or bark colour), soften the edge, remove magenta spill;
 *  2. find each tree as a connected blob of solid pixels (robust: no assumptions that the grid is regular);
 *  3. classify by where the blob sits in the sheet's layout, and pack all of them into one atlas texture.
 */
function sliceTreeSheet(img: HTMLImageElement): Record<TreeKind, Sprite3D[]> {
  const w = img.width;
  const h = img.height;
  const { c, g } = canvas(w, h);
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, w, h);
  const px = d.data;
  const solid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = px[i * 4];
    const gr = px[i * 4 + 1];
    const b = px[i * 4 + 2];
    const magenta = Math.min(r, b) - gr; // ~250 on the background, below ~60 on trees
    const a = 1 - Math.min(1, Math.max(0, (magenta - 90) / 60));
    if (magenta > 30 && a > 0) {
      const spill = (magenta - 30) * 0.8; // pull magenta out of the blended edge pixels
      px[i * 4] = Math.max(0, r - spill);
      px[i * 4 + 2] = Math.max(0, b - spill);
    }
    px[i * 4 + 3] = Math.round(a * 255);
    solid[i] = a > 0.5 ? 1 : 0;
  }
  g.putImageData(d, 0, 0);

  // connected components (4-neighbour flood fill)
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const blobs: { x0: number; x1: number; y0: number; y1: number; cx: number; cy: number }[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!solid[start] || seen[start]) continue;
    let x0 = w, x1 = 0, y0 = h, y1 = 0, n = 0, sx = 0, sy = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w;
      const y = (p / w) | 0;
      n++; sx += x; sy += y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const q of [p - 1, p + 1, p - w, p + w]) {
        if (q < 0 || q >= w * h || seen[q] || !solid[q]) continue;
        if ((q === p - 1 && x === 0) || (q === p + 1 && x === w - 1)) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
    if (n >= 400) blobs.push({ x0, x1, y0, y1, cx: sx / n, cy: sy / n });
  }

  // The sheet is 5 rows (uneven heights) by 10 columns: row = which band the blob's centre is in.
  const rowEdges = [0.332, 0.501, 0.668, 0.833];
  const rowOf = (cy: number) => rowEdges.filter((e) => cy / h > e).length;
  const colOf = (cx: number) => Math.min(9, Math.max(0, Math.floor((cx / w - 0.0107) / 0.0979)));
  const kindOf = (cx: number, cy: number): TreeKind => {
    const r = rowOf(cy);
    const col = colOf(cx);
    if (r === 4) return col <= 4 ? 'bush' : 'dead';
    if ((r === 0 && col <= 5) || (r === 1 && col <= 4)) return 'conifer';
    return 'leafy';
  };
  blobs.sort((a, b) => rowOf(a.cy) - rowOf(b.cy) || a.cx - b.cx);

  // pack into one atlas (shelf packing) so all trees share a single texture
  const AW = 1536;
  const AH = 1024;
  const atlas = canvas(AW, AH);
  let x = 1;
  let y = 1;
  let rowH = 0;
  const placed: { kind: TreeKind; frame: Rectangle }[] = [];
  for (const b of blobs) {
    const bw = b.x1 - b.x0 + 1;
    const bh = b.y1 - b.y0 + 1;
    if (x + bw + 1 > AW) {
      x = 1;
      y += rowH + 1;
      rowH = 0;
    }
    if (y + bh + 1 > AH) throw new Error('tree atlas is full');
    atlas.g.drawImage(c, b.x0, b.y0, bw, bh, x, y, bw, bh);
    placed.push({ kind: kindOf(b.cx, b.cy), frame: new Rectangle(x, y, bw, bh) });
    x += bw + 1;
    rowH = Math.max(rowH, bh);
  }
  const base = Texture.from(atlas.c);
  const out: Record<TreeKind, Sprite3D[]> = { conifer: [], leafy: [], bush: [], dead: [] };
  for (const p of placed) {
    out[p.kind].push({ texture: new Texture({ source: base.source, frame: p.frame }), aspect: p.frame.width / p.frame.height });
  }
  for (const k of ['conifer', 'leafy', 'bush', 'dead'] as const) {
    if (out[k].length === 0) throw new Error('tree sheet: no ' + k + ' trees found');
  }
  return out;
}

function cropTexture(sheet: Texture, scale: number, r: Crop): Sprite3D {
  const w = Math.round(r.w * scale);
  const h = Math.round(r.h * scale);
  return {
    texture: new Texture({ source: sheet.source, frame: new Rectangle(Math.round(r.x * scale), Math.round(r.y * scale), w, h) }),
    aspect: w / h,
  };
}

export async function loadTileKit(): Promise<TileKit> {
  const names = ['grass', 'sand', 'water', 'sand_grass', 'sand_water', 'coral_straight', 'coral_corner', 'huts', 'trees'];
  const [imgs, treeSheet] = await Promise.all([
    Promise.all(names.map((n) => loadImage(n + '.png'))),
    loadImage('/assets/trees/trees-sheet.jpg'),
  ]);
  return new TileKit({ ...Object.fromEntries(names.map((n, i) => [n, imgs[i]])), tree_sheet: treeSheet });
}
