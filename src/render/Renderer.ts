import { Application, Container, Graphics, Matrix, Sprite, Text, TilingSprite, type Texture } from 'pixi.js';
import { GRID_SIZE, type Grid, type RepoNode, type Tile } from '../types';
import { effectiveChildren, forgetNode, isVillage, LOOSE_FILES_SUFFIX } from '../layout/children';
import { gridToScreen, screenToCell, TILE_H, TILE_W } from './iso';
import { HIGHLIGHT, PALETTE, WATER } from './palette';
import { Edge, loadTileKit, type Sprite3D, type TileKit } from './tiles';

export interface HoverInfo {
  x: number;
  y: number;
  tile: Tile;
}

export type Layout = (node: RepoNode, depth: number, allowed?: boolean[][]) => Grid;

/** Where a child's grid sits inside its island on the parent's grid (parent cell units). */
interface Footprint {
  bx: number;
  by: number;
  s: number;
}

interface Island {
  child: RepoNode;
  footprint: Footprint;
}

/**
 * One node's grid, nested inside its parent's view. All views live in a single continuous world:
 * a child's container is positioned/scaled into its island's footprint, so zooming never swaps scenes.
 */
interface View {
  node: RepoNode;
  depth: number;
  grid: Grid;
  /** Cells of this grid where land was allowed (undefined for the root). */
  allowed?: boolean[][];
  parent?: View;
  footprint?: Footprint;
  /** Cumulative scale and origin (root world units) of this view's local space. */
  f: number;
  ox: number;
  oy: number;
  container: Container;
  gfx: Graphics;
  /** Textured tiles and sprites (used instead of gfx when the tile art loaded). */
  layer: Container;
  drawn: boolean;
  alpha: number;
  /** Name label anchored at the island's centroid; kept at constant screen size. */
  label: Text | null;
  /** Label size in screen pixels (it is kept at constant screen size). */
  labelSize: { w: number; h: number } | null;
  islands: Island[] | null;
  /** Files shown here that have no children yet (live mode may still load their functions). */
  pending: Island[];
  kids: Map<string, View>;
}

interface Cell {
  i: number;
  j: number;
  type: Tile['type'];
  /** Water depth for ocean cells (0 deep, 1 shallow, 2 reef); reef for coral. */
  variant: number;
}

const MIN_SCALE = 0.15;
const MAX_SCALE = 5000;
/** Detail fades in between these sizes (view size relative to the fit scale). */
const DETAIL_START = 0.15;
const DETAIL_FULL = 0.75;
/** Level d appears at camera zoom START + (d-1)*STEP (relative to fit) and is solid FADE later. */
const DEPTH_ZOOM_START = 0.4;
const DEPTH_ZOOM_STEP = 1.6;
const DEPTH_FADE = 0.8;
/** A view counts as "the current level" for the breadcrumb once it is this fraction of fit size. */
const CURRENT_R = 0.7;

function diamond(g: Graphics, x: number, y: number): Graphics {
  const a = gridToScreen(x, y);
  const b = gridToScreen(x + 1, y);
  const c = gridToScreen(x + 1, y + 1);
  const d = gridToScreen(x, y + 1);
  return g.poly([a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y]);
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Deterministic hash of an integer lattice point, in [0, 1). */
function lattice(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1]: scenery clumps come from this (never Math.random). */
function valueNoise(x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = lattice(x0, y0) + (lattice(x0 + 1, y0) - lattice(x0, y0)) * sx;
  const b = lattice(x0, y0 + 1) + (lattice(x0 + 1, y0 + 1) - lattice(x0, y0 + 1)) * sx;
  return a + (b - a) * sy;
}

export class Renderer {
  private app = new Application();
  private world = new Container();
  private highlight = new Graphics();
  /** Island names live above every view so an island's silhouette mask never clips them. */
  private labels = new Container();

  private layout: Layout = () => [];
  private gridCache = new Map<string, Grid>();
  private root: View | null = null;
  private fit = 1;
  /** Opening camera: zoomed to the land, with the land's centre in root world units. */
  private homeScale = 1;
  private homeCentre = { x: 0, y: 0 };
  private pointer: { x: number; y: number } | null = null;
  private hover: { view: View; x: number; y: number } | null = null;
  private labelViews: View[] = [];
  private chain: View[] = [];
  private chainKey = '';
  /** Tile kit (manifest art with code-drawn placeholders); null only if it failed to build, then flat colours are drawn. */
  private kit: TileKit | null = null;

  onHover: (info: HoverInfo | null) => void = () => {};
  /** Called with the node stack (root first) whenever the current level changes. */
  onLevelChange: (nodes: RepoNode[]) => void = () => {};
  /**
   * Optional lazy loader: called once per visible childless file node. Resolve true after filling `node.children`
   * (the file then becomes zoomable); false when there is nothing to load. Must not throw.
   */
  loadChildren?: (node: RepoNode) => Promise<boolean>;
  private requested = new Set<string>();

  async init(host: HTMLElement): Promise<void> {
    // Ocean-coloured background: the sea extends infinitely beyond the root grid.
    await this.app.init({ resizeTo: host, background: WATER[0], antialias: true });
    host.appendChild(this.app.canvas);
    this.app.stage.addChild(this.world);
    this.bindInput(this.app.canvas);
    try {
      this.kit = await loadTileKit();
    } catch (e) {
      console.warn('Tile art unavailable, using flat colours:', e);
    }
  }

  setRoot(root: RepoNode, layout: Layout): void {
    this.layout = layout;
    this.gridCache.clear();
    this.requested.clear();
    this.chainKey = ''; // a new root must refresh the breadcrumb even if its id ("root") is unchanged
    this.world.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.labels = new Container();
    this.labelViews = [];
    this.root = this.makeView(root, 0, undefined, undefined);
    this.world.addChild(this.root.container, this.labels);
    this.fitCamera();
    this.refresh();
  }

  /** Fly the camera to the level at `index` of the current breadcrumb chain. */
  goTo(index: number): void {
    const v = this.chain[index];
    if (v) this.flyToView(v);
  }

  /**
   * Fly (or jump, if instant is set) to the node reached by following path (node ids below the root).
   * The intermediate views are created on demand, so any depth can be reached directly.
   */
  focusPath(path: string[], instant = false): void {
    let v = this.root;
    if (!v) return;
    for (const id of path) {
      const isl = this.islandsOf(v).find((i) => i.child.id === id);
      if (!isl) return;
      let kid = v.kids.get(id);
      if (!kid) {
        kid = this.makeView(isl.child, v.depth + 1, v, isl.footprint);
        v.kids.set(id, kid);
      }
      v = kid;
    }
    this.flyToView(v, instant);
  }

  private flyToView(v: View, instant = false): void {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const isRoot = v === this.root;
    const scale = isRoot ? this.homeScale : this.fit / v.f;
    // Centre of what to frame, in root world units: the land for the root, otherwise the view's grid.
    const cx = isRoot ? this.homeCentre.x : v.ox;
    const cy = isRoot ? this.homeCentre.y : v.oy + v.f * ((GRID_SIZE * TILE_H) / 2);
    this.flyTo(scale, w / 2 - scale * cx, h / 2 - scale * cy, instant);
  }

  // ---- views -------------------------------------------------------------

  private gridFor(node: RepoNode, depth: number, allowed?: boolean[][]): Grid {
    let g = this.gridCache.get(node.id);
    if (!g) {
      g = this.layout(node, depth, allowed);
      this.gridCache.set(node.id, g);
    }
    return g;
  }

  private makeView(node: RepoNode, depth: number, parent?: View, footprint?: Footprint): View {
    const container = new Container();
    const gfx = new Graphics();
    const layer = new Container();
    container.addChild(gfx, layer);
    let f = 1;
    let ox = 0;
    let oy = 0;
    let allowed: boolean[][] | undefined;
    if (parent && footprint) {
      allowed = this.allowedFor(parent, footprint, node);
      const o = gridToScreen(footprint.bx, footprint.by);
      container.position.set(o.x, o.y);
      container.scale.set(footprint.s);
      f = parent.f * footprint.s;
      ox = parent.ox + parent.f * o.x;
      oy = parent.oy + parent.f * o.y;
      parent.container.addChild(container);
      // Hard-clip the child's detail to its island's silhouette on the parent grid.
      const mask = new Graphics();
      for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
          if (parent.grid[y][x].nodeId === node.id) diamond(mask, x, y).fill(0xffffff);
        }
      }
      parent.container.addChild(mask);
      container.mask = mask;
    }
    return {
      node, depth, grid: this.gridFor(node, depth, allowed), allowed, parent, footprint,
      f, ox, oy, container, gfx, layer, drawn: false, alpha: 1, label: null, labelSize: null, islands: null, pending: [], kids: new Map(),
    };
  }

  /**
   * Child-grid cells the child may use: every cell that maps onto this child's territory on the parent grid (its
   * islet and the shallow ring round it). A village keeps to its islet's land, so its houses never stand in water.
   */
  private allowedFor(parent: View, fp: Footprint, node: RepoNode): boolean[][] {
    const village = isVillage(node);
    const build = (landOnly: 'inland' | 'land' | false) => {
      let count = 0;
      const a = Array.from({ length: GRID_SIZE }, (_, j) =>
        Array.from({ length: GRID_SIZE }, (_, i) => {
          const cx = Math.floor(fp.bx + (i + 0.5) * fp.s);
          const cy = Math.floor(fp.by + (j + 0.5) * fp.s);
          if (cx < 0 || cy < 0 || cx >= GRID_SIZE || cy >= GRID_SIZE) return false;
          const t = parent.grid[cy][cx];
          const yes = t.nodeId === node.id && (!landOnly || (t.type !== 'ocean' && (landOnly === 'land' || t.type !== 'coast')));
          if (yes) count++;
          return yes;
        }),
      );
      return { a, count };
    };
    if (!village) return build(false).a;
    // Houses keep off the shoreline when the islet is big enough.
    const inland = build('inland');
    return inland.count >= 40 ? inland.a : build('land').a;
  }

  private islandsOf(v: View): Island[] {
    if (v.islands) return v.islands;
    const bounds = new Map<string, { x0: number; y0: number; x1: number; y1: number }>();
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const id = v.grid[y][x].nodeId;
        if (!id) continue;
        const b = bounds.get(id);
        if (!b) bounds.set(id, { x0: x, y0: y, x1: x, y1: y });
        else {
          b.x0 = Math.min(b.x0, x);
          b.y0 = Math.min(b.y0, y);
          b.x1 = Math.max(b.x1, x);
          b.y1 = Math.max(b.y1, y);
        }
      }
    }
    v.islands = [];
    v.pending = [];
    for (const child of effectiveChildren(v.node)) {
      const b = bounds.get(child.id);
      if (!b) continue;
      const w = b.x1 - b.x0 + 1;
      const h = b.y1 - b.y0 + 1;
      const side = Math.max(w, h);
      const island = {
        child,
        footprint: { bx: b.x0 + w / 2 - side / 2, by: b.y0 + h / 2 - side / 2, s: side / GRID_SIZE },
      };
      if (child.children.length > 0) v.islands.push(island);
      else if (child.kind === 'file' && this.loadChildren) v.pending.push(island);
    }
    return v.islands;
  }

  /**
   * The cells of a view that get drawn, back to front. In a child view only cells inside its island's
   * silhouette (its territory) count. Its own water is drawn over the territory; a village's water is skipped so the
   * parent's islet shows through.
   */
  private viewCells(v: View): {
    cells: Cell[];
    cx: number;
    cy: number;
  } {
    const fp = v.footprint;
    const parentGrid = v.parent?.grid;
    const village = isVillage(v.node);
    const cells: Cell[] = [];
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    // Back-to-front: ascending x+y diagonals.
    for (let sum = 0; sum <= (GRID_SIZE - 1) * 2; sum++) {
      for (let i = Math.max(0, sum - (GRID_SIZE - 1)); i <= Math.min(GRID_SIZE - 1, sum); i++) {
        const j = sum - i;
        const type = v.grid[j][i].type;
        const variant = type === 'coral' ? 2 : v.grid[j][i].variant;
        if (fp && parentGrid) {
          const cx = Math.floor(fp.bx + (i + 0.5) * fp.s);
          const cy = Math.floor(fp.by + (j + 0.5) * fp.s);
          if (cx < 0 || cy < 0 || cx >= GRID_SIZE || cy >= GRID_SIZE) continue;
          if (parentGrid[cy][cx].nodeId !== v.node.id) continue;
          sumX += i + 0.5;
          sumY += j + 0.5;
          count++;
          // A village sits on its parent's islet: its own water (the ring round the islet) is not redrawn.
          if (type === 'ocean' && village) continue;
        } else if (type === 'ocean' && variant === 0) continue; // the deep sea is the background
        cells.push({ i, j, type, variant });
      }
    }
    return { cells, cx: count ? sumX / count : 0, cy: count ? sumY / count : 0 };
  }

  private drawView(v: View): void {
    v.drawn = true;
    const { cells, cx, cy } = this.viewCells(v);
    if (this.kit) this.drawTextured(v, this.kit, cells);
    else this.drawFlat(v, cells);

    // A folder's home islet (its loose files) has no label: the cluster's label already names it.
    if (v.footprint && cells.length > 0 && !v.node.id.endsWith(LOOSE_FILES_SUFFIX)) {
      const label = new Text({
        text: v.node.name,
        style: { fontSize: 14, fontWeight: '700', fill: 0xffffff, stroke: { color: 0x10233a, width: 4 } },
        resolution: 2,
      });
      label.anchor.set(0.5);
      // Position in root world units (the view's origin and scale), not in the masked view's own space.
      const p = gridToScreen(cx, cy);
      label.position.set(v.ox + v.f * p.x, v.oy + v.f * p.y);
      this.labels.addChild(label);
      v.label = label;
      v.labelSize = { w: label.width, h: label.height };
      this.labelViews.push(v);
    }
  }

  /** Placeholder look: flat-coloured diamonds. Used when the tile art could not be loaded. */
  private drawFlat(v: View, cells: Cell[]): void {
    const g = v.gfx;
    for (const { i, j, type, variant } of cells) diamond(g, i, j).fill(type === 'ocean' ? WATER[variant] ?? WATER[0] : PALETTE[type]);
  }

  /** A standing object placed on the ground at grid position (gx, gy), sized and anchored from its kit entry. */
  private objectSprite(art: Sprite3D, gx: number, gy: number, widthScale = 1, yLift = 0): Sprite {
    const sp = new Sprite(art.texture);
    sp.anchor.set(art.anchor[0], art.anchor[1]);
    sp.width = TILE_W * art.widthInTiles * widthScale;
    sp.height = sp.width / art.aspect;
    const p = gridToScreen(gx, gy);
    sp.position.set(p.x, p.y + yLift);
    return sp;
  }

  /** Kit art: ground tiles, tiling water, reef coral, houses and trees (placeholders until real art exists). */
  private drawTextured(v: View, kit: TileKit, cells: Cell[]): void {
    const layer = v.layer;
    const grid = v.grid;

    // --- water: the deep sea at the root, then shallow and reef water over the cells that have it ---
    if (!v.footprint) layer.addChild(this.waterSheet(kit.water(0), -200, -200, 700, kit.waterCells(0)));
    // A child view fills its whole grid with water; the view's mask then trims it to exactly its territory on the
    // parent. Without this, gaps along the territory's stair-stepped edge (the child's cells are smaller and do not
    // line up with the parent's) let the parent's own water show through as thin slivers.
    else if (!isVillage(v.node)) layer.addChild(this.waterSheet(kit.water(1), 0, 0, GRID_SIZE, kit.waterCells(1)));
    for (const depth of [1, 2] as const) {
      const wet = cells.filter((c) => (c.type === 'ocean' || c.type === 'coral') && c.variant === depth);
      if (wet.length === 0) continue;
      const mask = new Graphics();
      for (const c of wet) diamond(mask, c.i, c.j).fill(0xffffff);
      const sheet = this.waterSheet(kit.water(depth), 0, 0, GRID_SIZE, kit.waterCells(depth));
      layer.addChild(sheet, mask);
      sheet.mask = mask;
    }

    // --- ground; collect standing objects to draw after (sorted back to front) ---
    const decor: { gx: number; gy: number; sprite: Sprite; shadow?: Sprite }[] = [];
    const houses = new Map<string, { sx: number; sy: number; n: number }>();
    const isWater = (x: number, y: number) =>
      x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE || grid[y][x].type === 'ocean' || grid[y][x].type === 'coral';
    const hasShoreArt = !!kit.shore('shore.sand', 0);
    /** Grass with water only diagonally next to it: drawn as an inner-corner shore tile (sand), if the art exists. */
    const innerCorner = (x: number, y: number): string | null => {
      if (!hasShoreArt || isWater(x + 1, y) || isWater(x - 1, y) || isWater(x, y + 1) || isWater(x, y - 1)) return null;
      if (isWater(x - 1, y - 1)) return 'nw';
      if (isWater(x + 1, y - 1)) return 'ne';
      if (isWater(x + 1, y + 1)) return 'se';
      if (isWater(x - 1, y + 1)) return 'sw';
      return null;
    };
    const classOf = (x: number, y: number): 'grass' | 'sand' | 'water' | 'none' => {
      if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) return 'water';
      switch (grid[y][x].type) {
        case 'island': case 'village': case 'tree': return innerCorner(x, y) ? 'sand' : 'grass';
        case 'coast': case 'port': return 'sand';
        case 'house': return 'none';
        default: return 'water'; // ocean and coral interiors are open water
      }
    };
    const SIDE_DX = [1, 0, -1, 0];
    const SIDE_DY = [0, 1, 0, -1];

    // The middle of a village island belongs to the village: keep trees and rocks out of it.
    const villageCore = new Map<string, { x: number; y: number; r: number }>();
    for (const isl of this.islandsOf(v)) {
      if (!isVillage(isl.child)) continue;
      const half = (isl.footprint.s * GRID_SIZE) / 2;
      villageCore.set(isl.child.id, { x: isl.footprint.bx + half, y: isl.footprint.by + half, r: half });
    }

    let seedH = 0;
    for (let k = 0; k < v.node.id.length; k++) seedH = (seedH * 31 + v.node.id.charCodeAt(k)) >>> 0;
    const seedX = (seedH % 997) * 3.17;
    const seedY = ((seedH >>> 10) % 991) * 2.71;

    for (const { i, j, type } of cells) {
      const hash = ((Math.imul(i + 1, 73856093) ^ Math.imul(j + 1, 19349663) ^ Math.imul(v.depth + 7, 83492791)) >>> 0) % 1000;
      if (type === 'island' || type === 'coast' || type === 'village' || type === 'port' || type === 'tree') {
        const kind = type === 'coast' || type === 'port' ? 'sand' : 'grass';
        const edges: Edge[] = [0, 1, 2, 3].map((s) => {
          const n = classOf(i + SIDE_DX[s], j + SIDE_DY[s]);
          if (n === 'water') return Edge.Water;
          if (kind === 'grass' && n === 'sand') return Edge.Sand;
          return Edge.None;
        });
        // Shore art (whole tiles with water, foam and sand) when it exists, picked from which neighbours are water.
        let shoreKey: string | null = null;
        if (hasShoreArt) {
          if (kind === 'sand') {
            const dirs = ['e', 's', 'w', 'n'].filter((_, s) => edges[s] === Edge.Water);
            const has = (d: string) => dirs.includes(d);
            if (dirs.length === 0) shoreKey = innerCorner(i, j) ? 'shore.inner.' + innerCorner(i, j) : 'shore.sand';
            else if (dirs.length === 1) shoreKey = 'shore.edge.' + dirs[0];
            else if (dirs.length === 2 && has('n') !== has('s')) shoreKey = `shore.outer.${has('n') ? 'n' : 's'}${has('w') ? 'w' : 'e'}`;
            else shoreKey = 'shore.water'; // a one-cell spit of sand between waters: let the sea have it
          } else if (type === 'island' || type === 'tree') {
            const corner = innerCorner(i, j);
            if (corner) shoreKey = 'shore.inner.' + corner;
          }
        }
        const shoreTex = shoreKey ? kit.shore(shoreKey, hash) : null;
        const ground = shoreTex ? this.groundSprite(shoreTex, i, j, 0.01) : this.groundSprite(kit.ground(kind, hash, edges), i, j);
        if (kind === 'grass' && !shoreTex) {
          // Low-frequency noise tint so big stretches of grass are not one flat colour.
          const shade = 226 + Math.round(valueNoise(i * 0.09 + seedY, j * 0.09 + seedX) * 29);
          ground.tint = (shade << 16) | (shade << 8) | shade;
        }
        layer.addChild(ground);
        if (type === 'port') {
          const dock = this.objectSprite(kit.port(hash), i + 0.5, j + 0.5);
          decor.push({ gx: i + j + 0.5, gy: 0, sprite: dock });
        }
        // Scenery on inland grass. Trees grow in clumps: a smooth noise field gives dense groves and open
        // meadows, and a second, larger field makes whole patches of conifers or leafy trees. A tree needs
        // grass all around it, so narrow shoreline strips never get one hanging over the water.
        const core = villageCore.get(grid[j][i].nodeId ?? '');
        const inVillageCore = !!core && Math.hypot(i + 0.5 - core.x, j + 0.5 - core.y) < core.r * 0.55;
        if (kind === 'grass' && !shoreTex && type === 'island' && !inVillageCore && edges.every((e) => e === Edge.None)) {
          const roll = hash / 1000;
          const grove = valueNoise(i * 0.24 + seedX, j * 0.24 + seedY);
          const patch = valueNoise(i * 0.11 + seedY, j * 0.11 + seedX);
          let art: Sprite3D | null = null;
          let widthScale = 1;
          if (grove > 0.4 && roll < (grove - 0.28) * 2.2 && this.grassAround(grid, i, j, 1)) {
            const k = roll < 0.012 ? 'dead' : patch > 0.5 ? 'conifer' : 'leafy';
            art = kit.tree(k, hash);
            widthScale = 0.9 + ((hash >> 3) % 9) * 0.04; // 0.9 - 1.2 of the art's width
          } else if (grove > 0.3 && roll > 0.965) {
            art = kit.tree('bush', hash);
          } else if (hash % 13 === 0) {
            art = hash % 2 === 0 ? kit.rock(hash) : kit.tuft(hash);
          }
          if (art) {
            const gx = i + 0.5 + (((hash >> 2) % 5) - 2) * 0.06;
            const gy = j + 0.5 + (((hash >> 4) % 5) - 2) * 0.06;
            const sp = this.objectSprite(art, gx, gy, widthScale, TILE_H * 0.3);
            if (hash % 2 === 1) sp.scale.x = -sp.scale.x; // mirror half of them: same tree, different look
            const shade = 232 + ((hash >> 5) % 24); // slight brightness variation
            sp.tint = (shade << 16) | (shade << 8) | shade;
            const sh = this.objectSprite(kit.shadow, gx, gy, (art.widthInTiles * widthScale * 0.9) / kit.shadow.widthInTiles, TILE_H * 0.3);
            sh.alpha = 0.8;
            decor.push({ gx: i + j, gy: 0, sprite: sp, shadow: sh });
          }
        }
      } else if (type === 'house') {
        const id = grid[j][i].nodeId ?? '';
        const h = houses.get(id) ?? { sx: 0, sy: 0, n: 0 };
        h.sx += i + 0.5;
        h.sy += j + 0.5;
        h.n++;
        houses.set(id, h);
      }
    }

    // A village island shows village art, not one hut per file: a handful of files per cluster, each
    // cluster sized to the island so it never towers over the ground. Every house still owns its tiles
    // (hover and zoom work per file); the art is scenery drawn over them.
    if (houses.size > 0) {
      const all = [...houses.entries()].map(([id, h]) => ({ id, x: h.sx / h.n, y: h.sy / h.n, n: h.n }));
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const c of cells) {
        if (c.type !== 'house') continue;
        minX = Math.min(minX, c.i);
        maxX = Math.max(maxX, c.i);
        minY = Math.min(minY, c.j);
        maxY = Math.max(maxY, c.j);
      }
      const extent = Math.max(maxX - minX + 1, maxY - minY + 1);
      const clusters = Math.min(5, Math.max(1, Math.round(all.length / 6)));
      // Spread the clusters out: start at the biggest house, then repeatedly take the one farthest from those chosen.
      // One cluster goes in the middle of the island; several start at the biggest house.
      const mid = { id: all[0].id, x: (minX + maxX + 1) / 2, y: (minY + maxY + 1) / 2, n: 1 };
      const picks = clusters === 1 ? [mid] : [all.reduce((m, c) => (c.n > m.n ? c : m), all[0])];
      while (picks.length < clusters) {
        let best = all[0];
        let bestD = -1;
        for (const c of all) {
          const d = Math.min(...picks.map((p) => Math.hypot(p.x - c.x, p.y - c.y)));
          if (d > bestD) {
            bestD = d;
            best = c;
          }
        }
        picks.push(best);
      }
      // Small: a village is a cluster on the island, not something that fills it.
      const width = Math.min(Math.max((extent * 0.27) / Math.sqrt(clusters), 1.6), 5);
      for (const p of picks) {
        let hv = 0;
        for (let k = 0; k < p.id.length; k++) hv = (hv * 31 + p.id.charCodeAt(k)) >>> 0;
        const art = kit.village(hv);
        const sp = new Sprite(art.texture);
        sp.anchor.set(art.anchor[0], art.anchor[1]);
        sp.width = TILE_W * width;
        sp.height = sp.width / art.aspect;
        if (hv % 2 === 1) sp.scale.x *= -1; // mirror every other village so they do not repeat
        const q = gridToScreen(p.x, p.y);
        sp.position.set(q.x, q.y);
        decor.push({ gx: p.x + p.y, gy: 0, sprite: sp });
      }
    }
    decor.sort((a, b) => a.gx - b.gx);
    for (const d of decor) {
      if (d.shadow) layer.addChild(d.shadow);
      layer.addChild(d.sprite);
    }

    kit.flush();
  }

  /** True if every tile within `r` cells (a square around x, y) is plain inland grass of the same island. */
  private grassAround(grid: Grid, x: number, y: number, r: number): boolean {
    const id = grid[y][x].nodeId;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= GRID_SIZE || ny >= GRID_SIZE) return false;
        const t = grid[ny][nx];
        if (t.type !== 'island' || t.nodeId !== id) return false;
      }
    }
    return true;
  }

  /** A square ground tile mapped onto its isometric diamond, slightly oversized to hide seams. */
  private groundSprite(tex: Texture, gx: number, gy: number, pad = 0.03): Sprite {
    const sp = new Sprite(tex);
    const n = 1 + 2 * pad;
    const px = tex.width;
    const a = ((TILE_W / 2) * n) / px;
    const b = ((TILE_H / 2) * n) / px;
    const o = gridToScreen(gx - pad, gy - pad);
    sp.setFromMatrix(new Matrix(a, b, -a, b, o.x, o.y));
    return sp;
  }

  /**
   * A tiling water sheet covering `cells` x `cells` grid cells from (gx0, gy0); one copy of the texture spans
   * `tileCells` cells, lined up with the grid so per-cell water art meets the shore tiles exactly.
   */
  private waterSheet(tex: Texture, gx0: number, gy0: number, cells: number, tileCells = 4): TilingSprite {
    const PX_PER_CELL = 64;
    const size = cells * PX_PER_CELL;
    const sheet = new TilingSprite({ texture: tex, width: size, height: size });
    sheet.tileScale.set((PX_PER_CELL * tileCells) / tex.width);
    const a = TILE_W / 2 / PX_PER_CELL;
    const b = TILE_H / 2 / PX_PER_CELL;
    const o = gridToScreen(gx0, gy0);
    sheet.setFromMatrix(new Matrix(a, b, -a, b, o.x, o.y));
    return sheet;
  }

  /** Is the view's grid footprint within the viewport? (generous bounding box) */
  private onScreen(f: number, ox: number, oy: number): boolean {
    const sc = this.world.scale.x;
    const halfW = (f * GRID_SIZE * TILE_W * sc) / 2;
    const halfH = (f * GRID_SIZE * TILE_H * sc) / 2;
    const cx = this.world.position.x + sc * ox;
    const cy = this.world.position.y + sc * (oy + (f * GRID_SIZE * TILE_H) / 2);
    return cx + halfW > 0 && cx - halfW < this.app.screen.width && cy + halfH > 0 && cy - halfH < this.app.screen.height;
  }

  /** Detail opacity for a view of cumulative scale f: 0 when tiny, 1 once reasonably large. */
  private alphaFor(depth: number, f: number): number {
    const r = (this.world.scale.x * f) / this.fit;
    const sizeT = clamp01((r - DETAIL_START) / (DETAIL_FULL - DETAIL_START));
    return Math.min(this.depthT(depth), sizeT);
  }

  /** Camera-zoom gate: level `depth` detail fades in at its own zoom, like map layers. */
  private depthT(depth: number): number {
    if (depth <= 1) return 1; // top-level folders are already split into clusters at the home zoom
    const k = this.world.scale.x / this.fit;
    return clamp01((k - (DEPTH_ZOOM_START + (depth - 1) * DEPTH_ZOOM_STEP)) / DEPTH_FADE);
  }

  /** A label shows with its level and hands over to the next level's labels as you zoom further. */
  private updateLabel(v: View): void {
    if (!v.label) return;
    // Legibility only depends on how big the island is on screen and whether the next level has taken
    // over; it must not inherit the tile fade, or names ghost out when zoomed out.
    const r = (this.world.scale.x * v.f) / this.fit;
    v.label.alpha = clamp01((r - 0.1) / 0.1) * (1 - this.depthT(v.depth + 1));
    v.label.visible = v.container.visible && v.label.alpha > 0.01;
    v.label.scale.set(1 / this.world.scale.x);
  }

  /** Labels that would overlap a bigger island's label (bigger view first) are hidden at the current zoom. */
  private hideOverlappingLabels(): void {
    const sc = this.world.scale.x;
    const shown: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const byImportance = this.labelViews.filter((v) => v.label?.visible && v.labelSize).sort((a, b) => b.f - a.f || a.depth - b.depth);
    for (const v of byImportance) {
      const l = v.label!;
      const { w, h } = v.labelSize!;
      const cx = this.world.position.x + sc * l.position.x;
      const cy = this.world.position.y + sc * l.position.y;
      const box = { x0: cx - w / 2 - 4, y0: cy - h / 2 - 2, x1: cx + w / 2 + 4, y1: cy + h / 2 + 2 };
      if (shown.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) l.visible = false;
      else shown.push(box);
    }
  }

  /** Create, show, fade and hide views for the current camera. Called whenever the camera moves. */
  private updateView(v: View): void {
    if (!v.drawn) this.drawView(v);
    v.gfx.alpha = v.alpha;
    v.layer.alpha = v.alpha;
    this.updateLabel(v);
    for (const isl of this.islandsOf(v)) {
      const fk = v.f * isl.footprint.s;
      const o = gridToScreen(isl.footprint.bx, isl.footprint.by);
      const kox = v.ox + v.f * o.x;
      const koy = v.oy + v.f * o.y;
      const alpha = this.alphaFor(v.depth + 1, fk);
      const visible = alpha > 0 && this.onScreen(fk, kox, koy);
      let kid = v.kids.get(isl.child.id);
      if (!visible) {
        if (kid) this.hideView(kid);
        continue;
      }
      if (!kid) {
        kid = this.makeView(isl.child, v.depth + 1, v, isl.footprint);
        v.kids.set(isl.child.id, kid);
      }
      kid.alpha = alpha;
      kid.container.visible = true;
      this.updateView(kid);
    }
    for (const isl of v.pending) this.requestChildren(v, isl);
  }

  /** Ask the lazy loader for a visible, still-empty file's children (once per node). */
  private requestChildren(v: View, isl: Island): void {
    const load = this.loadChildren;
    const node = isl.child;
    if (!load || this.requested.has(node.id)) return;
    const fk = v.f * isl.footprint.s;
    const o = gridToScreen(isl.footprint.bx, isl.footprint.by);
    if (!(this.alphaFor(v.depth + 1, fk) > 0 && this.onScreen(fk, v.ox + v.f * o.x, v.oy + v.f * o.y))) return;
    this.requested.add(node.id);
    const generation = this.root;
    void load(node)
      .then((ok) => {
        if (!ok || this.root !== generation || node.children.length === 0) return;
        forgetNode(node); // its memoised effective children / height are now stale
        this.gridCache.delete(node.id);
        v.islands = null; // recompute so the file becomes a zoomable island
        this.refresh();
      })
      .catch(() => {});
  }

  /** Hide a view, its descendants and their labels. */
  private hideView(v: View): void {
    v.container.visible = false;
    if (v.label) v.label.visible = false;
    for (const k of v.kids.values()) this.hideView(k);
  }

  private refresh(): void {
    if (!this.root) return;
    this.updateView(this.root);
    this.hideOverlappingLabels();
    this.updateChain();
    this.refreshHover();
  }

  // ---- picking -----------------------------------------------------------

  /** Descend from the root through every nested view visible enough under the screen point. */
  private pick(clientX: number, clientY: number, collect?: View[]): { view: View; x: number; y: number; tile: Tile } | null {
    if (!this.root) return null;
    const rect = this.app.canvas.getBoundingClientRect();
    const wx = (clientX - rect.left - this.world.position.x) / this.world.scale.x;
    const wy = (clientY - rect.top - this.world.position.y) / this.world.scale.y;
    let { x: gx, y: gy } = screenToCell(wx, wy);
    let v = this.root;
    collect?.push(v);
    let best: { view: View; x: number; y: number; tile: Tile } | null = null;
    for (;;) {
      const x = Math.floor(gx);
      const y = Math.floor(gy);
      if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) return best;
      const tile = v.grid[y][x];
      best = { view: v, x, y, tile };
      const kid = tile.nodeId ? v.kids.get(tile.nodeId) : undefined;
      const r = kid ? (this.world.scale.x * kid.f) / this.fit : 0;
      if (!kid || !kid.container.visible || !kid.footprint || r < CURRENT_R) return best;
      gx = (gx - kid.footprint.bx) / kid.footprint.s;
      gy = (gy - kid.footprint.by) / kid.footprint.s;
      v = kid;
      collect?.push(v);
    }
  }

  private refreshHover(): void {
    const hit = this.pointer ? this.pick(this.pointer.x, this.pointer.y) : null;
    if (hit?.view === this.hover?.view && hit?.x === this.hover?.x && hit?.y === this.hover?.y) return;
    this.hover = hit ? { view: hit.view, x: hit.x, y: hit.y } : null;
    this.highlight.clear();
    this.highlight.parent?.removeChild(this.highlight);
    if (hit) {
      hit.view.container.addChild(this.highlight);
      diamond(this.highlight, hit.x, hit.y).stroke({ width: 2 / (this.world.scale.x * hit.view.f), color: HIGHLIGHT });
    }
    this.onHover(hit ? { x: hit.x, y: hit.y, tile: hit.tile } : null);
  }

  /** Breadcrumb follows whichever nested level fills the middle of the screen. */
  private updateChain(): void {
    const rect = this.app.canvas.getBoundingClientRect();
    const views: View[] = [];
    this.pick(rect.left + this.app.screen.width / 2, rect.top + this.app.screen.height / 2, views);
    this.chain = views;
    const key = views.map((v) => v.node.id).join('|');
    if (key !== this.chainKey) {
      this.chainKey = key;
      this.onLevelChange(views.map((v) => v.node));
    }
  }

  // ---- camera ------------------------------------------------------------

  private fitCamera(): void {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const worldW = GRID_SIZE * TILE_W;
    const worldH = GRID_SIZE * TILE_H;
    // `fit` stays "the whole grid fills the screen": every zoom threshold is measured against it.
    this.fit = Math.min(w / worldW, h / worldH) * 0.9;

    // The opening view is framed on the territories (land and the water round it), so clusters are not lost in empty ocean.
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const grid = this.root?.grid;
    if (grid) {
      for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
          if (grid[y][x].type === 'ocean' && !grid[y][x].nodeId) continue; // territory water counts
          for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
            const p = gridToScreen(x + dx, y + dy);
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y);
          }
        }
      }
    }
    if (minX === Infinity) {
      minX = -worldW / 2;
      maxX = worldW / 2;
      minY = 0;
      maxY = worldH;
    }
    const landW = Math.max(maxX - minX, TILE_W * 4);
    const landH = Math.max(maxY - minY, TILE_H * 4);
    this.homeScale = Math.max(this.fit, Math.min((w * 0.82) / landW, (h * 0.82) / landH));
    this.homeCentre = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    this.world.scale.set(this.homeScale);
    this.world.position.set(w / 2 - this.homeScale * this.homeCentre.x, h / 2 - this.homeScale * this.homeCentre.y);
  }

  private flyTo(scale: number, px: number, py: number, instant = false): void {
    if (instant) {
      this.world.scale.set(scale);
      this.world.position.set(px, py);
      this.refresh();
      return;
    }
    const s0 = this.world.scale.x;
    const x0 = this.world.position.x;
    const y0 = this.world.position.y;
    const t0 = performance.now();
    const dur = 1500;
    const step = () => {
      const t = clamp01((performance.now() - t0) / dur);
      const e = t * t * (3 - 2 * t);
      this.world.scale.set(Math.exp(Math.log(s0) + (Math.log(scale) - Math.log(s0)) * e));
      this.world.position.set(x0 + (px - x0) * e, y0 + (py - y0) * e);
      this.refresh();
      if (t >= 1) this.app.ticker.remove(step);
    };
    this.app.ticker.add(step);
  }

  /** Stop zooming in once the deepest visible level has nothing further to dive into. */
  private zoomBlocked(next: number, clientX: number, clientY: number): boolean {
    const views: View[] = [];
    this.pick(clientX, clientY, views);
    const deepest = views[views.length - 1];
    if (!deepest || this.islandsOf(deepest).length > 0) return false;
    return (next * deepest.f) / this.fit > 3;
  }

  private bindInput(canvas: HTMLCanvasElement): void {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      this.pointer = { x: e.clientX, y: e.clientY };
      if (dragging) {
        this.world.position.x += e.clientX - lastX;
        this.world.position.y += e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        this.refresh();
      } else {
        this.refreshHover();
      }
    });
    canvas.addEventListener('pointerup', () => {
      dragging = false;
    });
    canvas.addEventListener('pointerleave', () => {
      this.pointer = null;
      this.refreshHover();
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.pointer = { x: e.clientX, y: e.clientY };
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const old = this.world.scale.x;
        const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, old * Math.exp(-e.deltaY * 0.001)));
        if (next > old && this.zoomBlocked(next, e.clientX, e.clientY)) return;
        // Zoom about the cursor.
        const k = next / old;
        this.world.position.x = mx - (mx - this.world.position.x) * k;
        this.world.position.y = my - (my - this.world.position.y) * k;
        this.world.scale.set(next);
        this.refresh();
      },
      { passive: false },
    );
  }
}
