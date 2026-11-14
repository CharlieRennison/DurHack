import { Application, Container, Graphics, Matrix, Sprite, Text, TilingSprite, type Texture } from 'pixi.js';
import { GRID_SIZE, type Grid, type RepoNode, type Tile } from '../types';
import { neighbors } from '../grid';
import { effectiveChildren, isVillage } from '../layout/children';
import { gridToScreen, screenToCell, TILE_H, TILE_W } from './iso';
import { CORAL_BORDER, HIGHLIGHT, LAGOON, PALETTE } from './palette';
import { Edge, loadTileKit, type TileKit } from './tiles';

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
  /** Soft pink band under a coral's border art; only needed when zoomed out, so it fades away. */
  rim: Graphics | null;
  drawn: boolean;
  alpha: number;
  /** Name label anchored at the island's centroid; kept at constant screen size. */
  label: Text | null;
  islands: Island[] | null;
  kids: Map<string, View>;
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
  private chain: View[] = [];
  private chainKey = '';
  /** Tile art; null if it failed to load, in which case flat-colour tiles are drawn. */
  private kit: TileKit | null = null;

  onHover: (info: HoverInfo | null) => void = () => {};
  /** Called with the node stack (root first) whenever the current level changes. */
  onLevelChange: (nodes: RepoNode[]) => void = () => {};

  async init(host: HTMLElement): Promise<void> {
    // Ocean-coloured background: the sea extends infinitely beyond the root grid.
    await this.app.init({ resizeTo: host, background: PALETTE.ocean, antialias: true });
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
    this.chainKey = ''; // a new root must refresh the breadcrumb even if its id ("root") is unchanged
    this.world.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.labels = new Container();
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
      f, ox, oy, container, gfx, layer, rim: null, drawn: false, alpha: 1, label: null, islands: null, kids: new Map(),
    };
  }

  /**
   * Child-grid cells where sub-islands may sit: the interior of this island on the parent grid
   * (its coast ring stays as a shoreline margin). Thin islands fall back to their full footprint.
   */
  private allowedFor(parent: View, fp: Footprint, node: RepoNode): boolean[][] {
    const build = (margin: number) => {
      let count = 0;
      const a = Array.from({ length: GRID_SIZE }, (_, j) =>
        Array.from({ length: GRID_SIZE }, (_, i) => {
          const cx = Math.floor(fp.bx + (i + 0.5) * fp.s);
          const cy = Math.floor(fp.by + (j + 0.5) * fp.s);
          if (cx < 0 || cy < 0 || cx >= GRID_SIZE || cy >= GRID_SIZE) return false;
          const t = parent.grid[cy][cx];
          let yes = t.nodeId === node.id && (margin === 0 || t.type !== 'coast');
          if (yes && margin === 2) {
            yes = neighbors(cx, cy).every(([nx, ny]) => {
              const n = parent.grid[ny][nx];
              return n.nodeId === node.id && n.type !== 'coast';
            });
          }
          if (yes) count++;
          return yes;
        }),
      );
      return { a, count };
    };
    // Prefer a thick (2-cell) shoreline, then a thin one, then the whole footprint.
    const thick = build(2);
    if (thick.count >= 60) return thick.a;
    const thin = build(1);
    return thin.count >= 60 ? thin.a : build(0).a;
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
    for (const child of effectiveChildren(v.node)) {
      const b = bounds.get(child.id);
      if (!b || child.children.length === 0) continue;
      const w = b.x1 - b.x0 + 1;
      const h = b.y1 - b.y0 + 1;
      const side = Math.max(w, h);
      v.islands.push({
        child,
        footprint: { bx: b.x0 + w / 2 - side / 2, by: b.y0 + h / 2 - side / 2, s: side / GRID_SIZE },
      });
    }
    return v.islands;
  }

  /**
   * The cells of a view that get drawn, back to front. In a child view only cells inside its island's
   * silhouette count; its ocean cells are either lake water ("lagoon"), the coral's own water, or skipped
   * so the parent's land shows through.
   */
  private viewCells(v: View): {
    cells: { i: number; j: number; type: Tile['type']; water: 'lagoon' | 'coral' | null }[];
    cx: number;
    cy: number;
  } {
    const fp = v.footprint;
    const parentGrid = v.parent?.grid;
    const village = isVillage(v.node);
    const cells: { i: number; j: number; type: Tile['type']; water: 'lagoon' | 'coral' | null }[] = [];
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    // Back-to-front: ascending x+y diagonals.
    for (let sum = 0; sum <= (GRID_SIZE - 1) * 2; sum++) {
      for (let i = Math.max(0, sum - (GRID_SIZE - 1)); i <= Math.min(GRID_SIZE - 1, sum); i++) {
        const j = sum - i;
        const type = v.grid[j][i].type;
        if (fp && parentGrid) {
          const cx = Math.floor(fp.bx + (i + 0.5) * fp.s);
          const cy = Math.floor(fp.by + (j + 0.5) * fp.s);
          if (cx < 0 || cy < 0 || cx >= GRID_SIZE || cy >= GRID_SIZE) continue;
          if (parentGrid[cy][cx].nodeId !== v.node.id) continue;
          sumX += i + 0.5;
          sumY += j + 0.5;
          count++;
          if (type === 'ocean') {
            if (village || !v.allowed?.[j][i]) continue;
            cells.push({ i, j, type, water: parentGrid[cy][cx].type === 'coral' ? 'coral' : 'lagoon' });
            continue;
          }
        }
        cells.push({ i, j, type, water: null });
      }
    }
    return { cells, cx: count ? sumX / count : 0, cy: count ? sumY / count : 0 };
  }

  private drawView(v: View): void {
    v.drawn = true;
    const { cells, cx, cy } = this.viewCells(v);
    if (this.kit) this.drawTextured(v, this.kit, cells);
    else this.drawFlat(v, cells);

    if (v.footprint && cells.length > 0) {
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
    }
  }

  /** Placeholder look: flat-coloured diamonds. Used when the tile art could not be loaded. */
  private drawFlat(
    v: View,
    cells: { i: number; j: number; type: Tile['type']; water: 'lagoon' | 'coral' | null }[],
  ): void {
    const g = v.gfx;
    for (const { i, j, type, water } of cells) {
      if (water) diamond(g, i, j).fill(water === 'coral' ? PALETTE.coral : LAGOON);
      else diamond(g, i, j).fill(type === 'coral' && this.isEdgeOfRegion(v.grid, i, j) ? CORAL_BORDER : PALETTE[type]);
    }
  }

  /** Real art: ground tile variants with blended shores, tiling water, coral borders, huts and trees. */
  private drawTextured(
    v: View,
    kit: TileKit,
    cells: { i: number; j: number; type: Tile['type']; water: 'lagoon' | 'coral' | null }[],
  ): void {
    const layer = v.layer;
    const grid = v.grid;

    // --- water: the open sea at the root; inside an island, the lake that holds its sub-folders ---
    if (!v.footprint) {
      layer.addChild(this.waterSheet(kit.water, -200, -200, 700));
    } else {
      const lagoon = cells.filter((c) => c.water === 'lagoon');
      if (lagoon.length > 0) {
        const mask = new Graphics();
        for (const c of lagoon) diamond(mask, c.i, c.j).fill(0xffffff);
        const sheet = this.waterSheet(kit.water, 0, 0, GRID_SIZE);
        layer.addChild(sheet, mask);
        sheet.mask = mask;
      }
    }

    // A soft pink band under the coral art: the art alone is a sparse scatter that disappears when small.
    const rim = new Graphics();
    layer.addChild(rim);
    v.rim = rim;

    // --- ground, coral borders; collect hut and tree decorations to draw after (sorted) ---
    const decor: { gx: number; gy: number; sprite: Sprite }[] = [];
    const houses = new Map<string, { sx: number; sy: number; n: number }>();
    const classOf = (x: number, y: number): 'grass' | 'sand' | 'water' | 'none' => {
      if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) return 'water';
      switch (grid[y][x].type) {
        case 'island': case 'village': case 'tree': return 'grass';
        case 'coast': case 'port': return 'sand';
        case 'house': return 'none';
        default: return 'water'; // ocean and coral interiors are open water
      }
    };
    const SIDE_DX = [1, 0, -1, 0];
    const SIDE_DY = [0, 1, 0, -1];

    for (const { i, j, type, water } of cells) {
      if (water) continue;
      const hash = ((Math.imul(i + 1, 73856093) ^ Math.imul(j + 1, 19349663) ^ Math.imul(v.depth + 7, 83492791)) >>> 0) % 1000;
      if (type === 'island' || type === 'coast' || type === 'village' || type === 'port' || type === 'tree') {
        const kind = type === 'coast' || type === 'port' ? 'sand' : 'grass';
        const edges: Edge[] = [0, 1, 2, 3].map((s) => {
          const n = classOf(i + SIDE_DX[s], j + SIDE_DY[s]);
          if (n === 'water') return Edge.Water;
          if (kind === 'grass' && n === 'sand') return Edge.Sand;
          return Edge.None;
        });
        layer.addChild(this.groundSprite(kit.ground(kind, hash, edges), i, j));
        // Scenery on inland grass. Bigger things need more room around them, so a narrow strip of
        // land only gets tufts and rocks and never a tree that would hang over the water.
        if (kind === 'grass' && type === 'island' && edges.every((e) => e === Edge.None) && hash % 7 === 0) {
          const roll = Math.floor(hash / 7) % 20;
          let art = kit.tuft(roll);
          let widthInTiles = 0.35;
          if (hash % 91 === 0 && this.grassAround(grid, i, j, 3)) {
            art = kit.forest;
            widthInTiles = 2.2;
          } else if (roll < 5 && this.grassAround(grid, i, j, 2)) {
            art = kit.pine(roll);
            widthInTiles = 0.7;
          } else if (roll < 10) {
            art = kit.rock(roll);
            widthInTiles = 0.42;
          }
          const sp = new Sprite(art.texture);
          sp.anchor.set(0.5, 0.92);
          sp.width = TILE_W * widthInTiles;
          sp.height = sp.width / art.aspect;
          const p = gridToScreen(i + 0.5, j + 0.5);
          sp.position.set(p.x, p.y + TILE_H * 0.3);
          decor.push({ gx: i + j, gy: 0, sprite: sp });
        }
      } else if (type === 'coral') {
        const id = grid[j][i].nodeId;
        const outside = [0, 1, 2, 3].map((s) => {
          const x = i + SIDE_DX[s];
          const y = j + SIDE_DY[s];
          return x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE || grid[y][x].nodeId !== id;
        });
        if (outside.some(Boolean)) diamond(rim, i, j).fill({ color: CORAL_BORDER, alpha: 0.4 });
        for (const t of kit.coralPieces(outside)) layer.addChild(this.groundSprite(t, i, j));
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
        const art = kit.village;
        const sp = new Sprite(art.texture);
        sp.anchor.set(0.5, 0.6);
        sp.width = TILE_W * width;
        sp.height = sp.width / art.aspect;
        if (hv % 2 === 1) sp.scale.x *= -1; // mirror every other village so they do not repeat
        const q = gridToScreen(p.x, p.y);
        sp.position.set(q.x, q.y);
        decor.push({ gx: p.x + p.y, gy: 0, sprite: sp });
      }
    }
    decor.sort((a, b) => a.gx - b.gx);
    for (const d of decor) layer.addChild(d.sprite);

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
  private groundSprite(tex: Texture, gx: number, gy: number): Sprite {
    const pad = 0.03;
    const sp = new Sprite(tex);
    const n = 1 + 2 * pad;
    const px = tex.width;
    const a = ((TILE_W / 2) * n) / px;
    const b = ((TILE_H / 2) * n) / px;
    const o = gridToScreen(gx - pad, gy - pad);
    sp.setFromMatrix(new Matrix(a, b, -a, b, o.x, o.y));
    return sp;
  }

  /** A tiling water sheet covering `cells` x `cells` grid cells from (gx0, gy0); one texture tile spans 4 cells. */
  private waterSheet(tex: Texture, gx0: number, gy0: number, cells: number): TilingSprite {
    const PX_PER_CELL = 64;
    const size = cells * PX_PER_CELL;
    const sheet = new TilingSprite({ texture: tex, width: size, height: size });
    const a = TILE_W / 2 / PX_PER_CELL;
    const b = TILE_H / 2 / PX_PER_CELL;
    const o = gridToScreen(gx0, gy0);
    sheet.setFromMatrix(new Matrix(a, b, -a, b, o.x, o.y));
    return sheet;
  }

  /** Does this tile touch a different node (or the grid edge)? Used for a coral's red border. */
  private isEdgeOfRegion(grid: Grid, x: number, y: number): boolean {
    const id = grid[y][x].nodeId;
    const near = neighbors(x, y);
    return near.length < 4 || near.some(([nx, ny]) => grid[ny][nx].nodeId !== id);
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

  /** Create, show, fade and hide views for the current camera. Called whenever the camera moves. */
  private updateView(v: View): void {
    if (!v.drawn) this.drawView(v);
    v.gfx.alpha = v.alpha;
    v.layer.alpha = v.alpha;
    // The pink rim gives a coral border body at small scale; up close the coral art carries it alone.
    if (v.rim) v.rim.alpha = 1 - clamp01((this.world.scale.x / this.fit - 1.3) / 1.0);
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

    // The opening view is framed on the land itself, so islands are not lost in empty ocean.
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const grid = this.root?.grid;
    if (grid) {
      for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
          if (grid[y][x].type === 'ocean') continue;
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
