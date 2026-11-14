import { Application, Container, Graphics, Text } from 'pixi.js';
import { GRID_SIZE, type Grid, type RepoNode, type Tile } from '../types';
import { neighbors } from '../grid';
import { gridToScreen, screenToCell, TILE_H, TILE_W } from './iso';
import { CORAL_BASE, CORAL_COLORS, HIGHLIGHT, PALETTE } from './palette';

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

  private layout: Layout = () => [];
  private gridCache = new Map<string, Grid>();
  private root: View | null = null;
  private fit = 1;
  private pointer: { x: number; y: number } | null = null;
  private hover: { view: View; x: number; y: number } | null = null;
  private chain: View[] = [];
  private chainKey = '';

  onHover: (info: HoverInfo | null) => void = () => {};
  /** Called with the node stack (root first) whenever the current level changes. */
  onLevelChange: (nodes: RepoNode[]) => void = () => {};

  async init(host: HTMLElement): Promise<void> {
    // Ocean-coloured background: the sea extends infinitely beyond the root grid.
    await this.app.init({ resizeTo: host, background: PALETTE.ocean, antialias: true });
    host.appendChild(this.app.canvas);
    this.app.stage.addChild(this.world);
    this.bindInput(this.app.canvas);
  }

  setRoot(root: RepoNode, layout: Layout): void {
    this.layout = layout;
    this.gridCache.clear();
    this.world.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.root = this.makeView(root, 0, undefined, undefined);
    this.world.addChild(this.root.container);
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
    const scale = this.fit / v.f;
    // Centre of the view's grid in root world units.
    const cx = v.ox;
    const cy = v.oy + v.f * ((GRID_SIZE * TILE_H) / 2);
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
    container.addChild(gfx);
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
      f, ox, oy, container, gfx, drawn: false, alpha: 1, label: null, islands: null, kids: new Map(),
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
    for (const child of v.node.children) {
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

  private drawView(v: View): void {
    v.drawn = true;
    const g = v.gfx;
    const fp = v.footprint;
    const parentGrid = v.parent?.grid;
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    // Back-to-front: ascending x+y diagonals.
    for (let sum = 0; sum <= (GRID_SIZE - 1) * 2; sum++) {
      for (let i = Math.max(0, sum - (GRID_SIZE - 1)); i <= Math.min(GRID_SIZE - 1, sum); i++) {
        const j = sum - i;
        const type = v.grid[j][i].type;
        if (fp && parentGrid) {
          // Detail lives on the parent's land: clip to this island's tiles and leave the child's
          // ocean undrawn so the parent's land shows through (no lakes).
          const cx = Math.floor(fp.bx + (i + 0.5) * fp.s);
          const cy = Math.floor(fp.by + (j + 0.5) * fp.s);
          if (cx < 0 || cy < 0 || cx >= GRID_SIZE || cy >= GRID_SIZE) continue;
          if (parentGrid[cy][cx].nodeId !== v.node.id) continue;
          sumX += i + 0.5;
          sumY += j + 0.5;
          count++;
          // Water between sub-islands is drawn in the allowed interior (the lake); the shoreline
          // margin keeps showing the parent's own coast.
          if (type === 'ocean' && !v.allowed?.[j][i]) continue;
        }
        if (type === 'coral') this.drawCoralTile(g, i, j, v.grid[j][i].variant);
        else diamond(g, i, j).fill(PALETTE[type]);
      }
    }
    if (fp && count > 0) {
      const label = new Text({
        text: v.node.name,
        style: { fontSize: 14, fontWeight: '700', fill: 0xffffff, stroke: { color: 0x10233a, width: 4 } },
        resolution: 2,
      });
      label.anchor.set(0.5);
      const p = gridToScreen(sumX / count, sumY / count);
      label.position.set(p.x, p.y);
      v.container.addChild(label);
      v.label = label;
    }
  }

  /** A reef tile: turquoise shallows with a fan of forked coral branches (variant 0 = bare floor). */
  private drawCoralTile(g: Graphics, x: number, y: number, variant: number): void {
    diamond(g, x, y).fill(CORAL_BASE);
    if (variant === 0) return;
    const [main, tip] = CORAL_COLORS[(variant - 1) % CORAL_COLORS.length];
    const c = gridToScreen(x + 0.5, y + 0.5);
    const bx = c.x;
    const by = c.y + 5;
    for (let k = 0; k < 3; k++) {
      const lean = (k - 1) * (7 + variant);
      const h = 9 + ((variant * 3 + k * 5) % 8);
      const tx = bx + lean * 0.7;
      const ty = by - h;
      g.moveTo(bx + (k - 1) * 2, by).lineTo(tx, ty).stroke({ width: 3.2, color: main, cap: 'round' });
      g.moveTo(tx, ty).lineTo(tx - 3.5, ty - 4).moveTo(tx, ty).lineTo(tx + 3.5, ty - 4)
        .stroke({ width: 2.2, color: tip, cap: 'round' });
    }
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
    v.label.alpha = v.alpha * (1 - this.depthT(v.depth + 1));
    v.label.visible = v.label.alpha > 0.01;
    v.label.scale.set(1 / (this.world.scale.x * v.f));
  }

  /** Create, show, fade and hide views for the current camera. Called whenever the camera moves. */
  private updateView(v: View): void {
    if (!v.drawn) this.drawView(v);
    v.gfx.alpha = v.alpha;
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
        if (kid) kid.container.visible = false;
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
    this.fit = Math.min(w / worldW, h / worldH) * 0.9;
    this.world.scale.set(this.fit);
    // Grid centre in world space is (0, worldH / 2).
    this.world.position.set(w / 2, h / 2 - (worldH / 2) * this.fit);
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
