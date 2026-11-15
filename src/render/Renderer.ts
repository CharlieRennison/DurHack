import { Application, Container, Graphics, Matrix, Sprite, Text, TilingSprite, Texture } from 'pixi.js';
import { GRID_SIZE, type Grid, type RepoNode, type Tile } from '../types';
import { effectiveChildren, forgetNode, isVillage, LOOSE_FILES_SUFFIX } from '../layout/children';
import { gridToScreen, screenToCell, TILE_H, TILE_W } from './iso';
import { HIGHLIGHT, PALETTE, WATER } from './palette';
import { Gulls } from './gulls';
import { makeWalkers, stepWalker, walkableCells, walkerFrame, type Walker } from './people';
import { languageOf, recolourPixels } from './language';
import { kindOf, makeAnimals, makeBoats, makeDino, type Animal } from './animals';
import { placeScenery } from './scenery';
import { HOUSE_WIDTH, placeHouses } from './village';
import { Edge, loadTileKit, type Sprite3D, type TileKit } from './tiles';

export interface HoverInfo {
  x: number;
  y: number;
  tile: Tile;
  /** The folder or file whose view the tile is in. */
  container: RepoNode;
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
  /** Names of the islands inside this view, anchored at each island's middle and kept at constant screen size. */
  childLabels: IslandLabel[];
  islands: Island[] | null;
  /** Files shown here that have no children yet (live mode may still load their functions). */
  pending: Island[];
  kids: Map<string, View>;
  /** Trees the parent level draws on a village islet's grass; they fade out as that village's own view fades in. */
  villageTrees: Map<string, Container>;
  /** Names above this village view's houses. */
  houseLabels: HouseLabel[];
  /**
   * Ground and scenery of each child islet that has a view of its own, kept apart so the islet can fade out exactly as
   * its view fades in (no flat blob with oversized trees left showing through).
   */
  ownerLayers: Map<string, Container>;
}

/** A file's name floating above its house. Lives in the shared labels layer, at constant screen size. */
interface HouseLabel {
  label: Text;
  view: View;
  /** Anchor point (the top of the house) in root world units. */
  x: number;
  y: number;
  size: { w: number; h: number };
  /** Taller (more code) wins when labels overlap. */
  rank: number;
}

/** An island's name, drawn by the view that contains the island (so it exists as soon as the island is on screen). */
interface IslandLabel {
  label: Text;
  size: { w: number; h: number };
  /** The island's cumulative scale (its footprint size in root world units / one root grid) and depth. */
  f: number;
  depth: number;
}

interface Cell {
  i: number;
  j: number;
  type: Tile['type'];
  /** Water depth for ocean cells (0 deep, 1 shallow, 2 reef); reef for coral. */
  variant: number;
}

/** Campfire smoke: puffs per fire and how fast each one lives its life (1 = once per second). */
const SMOKE_PUFFS = 7;
const SMOKE_SPEED = 0.2;
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
  private islandLabels: IslandLabel[] = [];
  /** The camera flight in progress (a new one replaces it), and the ring that marks a searched-for file for a while. */
  private flyStep: (() => void) | null = null;
  private marker: { view: View; x: number; y: number; name: string; born: number } | null = null;
  private markerGfx: Graphics | null = null;
  private markerLabel: Text | null = null;
  /** Collaborators' names, and the little people who walk the root island for them. */
  private collaborators: string[] = [];
  private homeSpot: { view: View; walkable: boolean[][]; cells: [number, number][] } | null = null;
  private people: { walker: Walker; sprite: Sprite; frames: Texture[] }[] = [];
  private personLabel: Text | null = null;
  private hoveredPerson = -1;
  private peopleClock = 0;
  /** Animals wandering the islands (one or two per island), in the layer of the view they live in. */
  private animals: { a: Animal; view: View; sprite: Sprite; frames: Texture[]; boat?: boolean; nessie?: boolean }[] = [];
  private animalClock = 0;
  /** Seagulls flying across the foreground (null until the tile art is loaded). */
  private gulls: Gulls | null = null;
  private houseLabels: HouseLabel[] = [];
  /** Campfires on screen-able village views, flickered every frame while their view is visible. */
  private fires: { sprite: Sprite; glow: Sprite; view: View; phase: number; base: number; smoke: Sprite[]; x: number; y: number; h: number; w: number }[] = [];
  private chain: View[] = [];
  private chainKey = '';
  /** Tile kit (manifest art with code-drawn placeholders); null only if it failed to build, then flat colours are drawn. */
  private kit: TileKit | null = null;

  onHover: (info: HoverInfo | null) => void = () => {};
  /** Called when the pointer is clicked (pressed and released without dragging) on a tile. */
  onTileClick: (info: HoverInfo) => void = () => {};
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
    this.app.ticker.add(() => this.animateFires());
    this.app.ticker.add(() => this.gulls?.update(this.app.ticker.deltaMS / 1000));
    this.app.ticker.add(() => this.animatePeople(Math.min(this.app.ticker.deltaMS / 1000, 0.1)));
    this.app.ticker.add(() => this.animateAnimals(Math.min(this.app.ticker.deltaMS / 1000, 0.1)));
    this.app.ticker.add(() => this.animateMarker());
    try {
      this.kit = await loadTileKit();
      this.gulls = new Gulls(this.kit.frames('objects.seagull').map((f) => f.texture), () => ({ w: this.app.screen.width, h: this.app.screen.height, x: this.world.position.x, y: this.world.position.y, scale: this.world.scale.x, ref: this.fit * 3 }));
      this.app.stage.addChild(this.gulls.layer); // follows the world's camera, above it; ignores the mouse
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
    this.islandLabels = [];
    this.houseLabels = [];
    this.marker = null;
    this.flyStep = null;
    this.people = [];
    this.collaborators = []; // the new repo's names arrive with setCollaborators
    this.homeSpot = null;
    this.animals = [];
    this.personLabel = null;
    this.hoveredPerson = -1;
    this.fires = [];
    this.root = this.makeView(root, 0, undefined, undefined);
    this.world.addChild(this.root.container, this.labels);
    this.fitCamera();
    this.refresh();
  }

  /**
   * Fly to a search result. `chain` is the island ids to go through from the root (as in focusPath); the camera lands on
   * the last island that exists. With `target` (a file id) it zooms on that file's house in the village and rings it for
   * a few seconds, with its name floating above.
   */
  focusNode(chain: string[], target?: string, name = ''): void {
    let v = this.root;
    if (!v) return;
    for (const id of chain) {
      const isl = this.islandsOf(v).find((i) => i.child.id === id);
      if (!isl) break;
      let kid = v.kids.get(id);
      if (!kid) {
        kid = this.makeView(isl.child, v.depth + 1, v, isl.footprint);
        v.kids.set(id, kid);
      }
      v = kid;
    }
    const spot = target ? this.houseCentre(v, target) : null;
    if (!target || !spot) {
      this.marker = null;
      this.flyToView(v);
      return;
    }
    const p = gridToScreen(spot.x, spot.y);
    const wx = v.ox + v.f * p.x;
    const wy = v.oy + v.f * p.y;
    const scale = Math.min(MAX_SCALE, (this.fit / v.f) * 2.4);
    this.flyTo(scale, this.app.screen.width / 2 - scale * wx, this.app.screen.height / 2 - scale * (wy - v.f * TILE_H * 0.4));
    this.marker = { view: v, x: p.x, y: p.y, name, born: performance.now() };
  }

  /** The middle of a file's house patch in a village view, in cell coordinates (null if it has none). */
  private houseCentre(v: View, fileId: string): { x: number; y: number } | null {
    let sx = 0;
    let sy = 0;
    let n = 0;
    v.grid.forEach((row, j) => row.forEach((t, i) => {
      if (t.type === 'house' && t.nodeId === fileId) {
        sx += i + 0.5;
        sy += j + 0.5;
        n++;
      }
    }));
    return n ? { x: sx / n, y: sy / n } : null;
  }

  /** Two expanding rings and the file's name on the house the search flew to, fading out after a few seconds. */
  private animateMarker(): void {
    const m = this.marker;
    if (!m) {
      if (this.markerGfx) this.markerGfx.visible = false;
      if (this.markerLabel) this.markerLabel.visible = false;
      return;
    }
    const age = (performance.now() - m.born) / 1000;
    const life = 7;
    if (age > life) {
      this.marker = null;
      return;
    }
    if (!this.markerGfx) {
      this.markerGfx = new Graphics();
      this.markerLabel = new Text({
        text: '',
        style: { fontSize: 15, fontWeight: '700', fill: 0xfff3a0, stroke: { color: 0x10233a, width: 5 } },
        resolution: 2,
      });
      this.markerLabel.anchor.set(0.5, 1);
      this.labels.addChild(this.markerGfx, this.markerLabel);
    }
    const g = this.markerGfx;
    const l = this.markerLabel!;
    const v = m.view;
    const sc = this.world.scale.x;
    const wx = v.ox + v.f * m.x;
    const wy = v.oy + v.f * m.y;
    const fade = age < life - 1.5 ? 1 : (life - age) / 1.5;
    g.visible = true;
    g.clear();
    for (let k = 0; k < 2; k++) {
      const ph = ((age * 0.8 + k * 0.5) % 1 + 1) % 1; // two rings, half a cycle apart
      const radius = (14 + ph * 38) / sc; // constant on screen whatever the zoom
      g.circle(wx, wy, radius).stroke({ width: 2.5 / sc, color: 0xfff3a0, alpha: (1 - ph) * 0.9 * fade });
    }
    g.circle(wx, wy, 5 / sc).fill({ color: 0xfff3a0, alpha: 0.9 * fade });
    if (l.text !== m.name) l.text = m.name;
    l.visible = true;
    l.alpha = fade;
    l.scale.set(1 / sc);
    l.position.set(wx, wy - 30 / sc);
  }

  /** The repository's collaborators: a little person walks the root island for each of them. */
  setCollaborators(names: string[]): void {
    this.collaborators = names;
    this.spawnPeople();
  }

  /** (Re)create the walking people on the root island from the current names. */
  private spawnPeople(): void {
    for (const p of this.people) p.sprite.destroy();
    this.people = [];
    this.hoveredPerson = -1;
    const home = this.homeSpot;
    const kit = this.kit;
    if (!home || !kit || !kit.hasArt('objects.person.0') || this.collaborators.length === 0) return;
    const pxCells = HOUSE_WIDTH / 16; // the same pixel scale as the houses
    for (const walker of makeWalkers(this.collaborators, home.walkable, home.view.node.id)) {
      const frames = kit.frames('objects.person.' + walker.variant);
      const sprite = new Sprite(frames[0].texture);
      sprite.anchor.set(frames[0].anchor[0], frames[0].anchor[1]);
      sprite.width = TILE_W * frames[0].texture.width * pxCells;
      sprite.height = sprite.width / frames[0].aspect;
      home.view.layer.addChild(sprite);
      this.people.push({ walker, sprite, frames: frames.map((f) => f.texture) });
    }
  }

  /** Put one or two animals on each island of a freshly drawn view. */
  private spawnAnimals(v: View, kit: TileKit, walkable: boolean[][], isRootHome: boolean): void {
    // The root island has its collaborators and the baby dinosaur; every other island has its wildlife.
    const wild = !isRootHome && kit.hasArt('objects.animal.0') ? makeAnimals(walkable, v.node.id) : [];
    const dino = isRootHome && kit.hasArt('objects.dino') ? makeDino(walkable, v.node.id) : null;
    for (const a of dino ? [...wild, dino] : wild) {
      const frames = kit.frames(a === dino ? 'objects.dino' : 'objects.animal.' + kindOf(a.walker));
      const sprite = new Sprite(frames[0].texture);
      sprite.anchor.set(frames[0].anchor[0], frames[0].anchor[1]);
      sprite.width = TILE_W * frames[0].texture.width * (a === dino ? 0.055 : 0.045); // small: a fox is about half a person wide; the dino is about a person tall
      sprite.height = sprite.width / frames[0].aspect;
      v.layer.sortableChildren = true;
      v.layer.addChild(sprite);
      this.animals.push({ a, view: v, sprite, frames: frames.map((f) => f.texture) });
    }
  }

  /** A few cosmetic boats drifting about the open sea of the root view (deep water, clear of every island's shallows). */
  private spawnBoats(v: View, kit: TileKit): void {
    if (!kit.hasArt('objects.boat')) return;
    const frames = kit.frames('objects.boat');
    const water = v.grid.map((row) => row.map((t) => t.type === 'ocean' && !t.nodeId));
    for (const a of makeBoats(water, v.node.id, 5)) {
      const sprite = new Sprite(frames[0].texture);
      sprite.anchor.set(frames[0].anchor[0], frames[0].anchor[1]);
      sprite.width = TILE_W * 0.7;
      sprite.height = sprite.width / frames[0].aspect;
      v.layer.sortableChildren = true;
      v.layer.addChild(sprite);
      this.animals.push({ a, view: v, sprite, frames: frames.map((f) => f.texture), boat: true });
    }
    // The Loch Ness monster: one, very slow, bobbing along and now and then diving out of sight. It lives in the
    // water around the root island (the home islet), starts somewhere different on every load, and stays in that part of the sea.
    if (!kit.hasArt('objects.nessie')) return;
    const nf = kit.frames('objects.nessie');
    let hx = 0;
    let hy = 0;
    let hn = 0;
    v.grid.forEach((row, y) => row.forEach((t, x) => {
      if (t.type !== 'ocean' && t.nodeId?.endsWith(LOOSE_FILES_SUFFIX)) {
        hx += x + 0.5;
        hy += y + 0.5;
        hn++;
      }
    }));
    const around = hn > 0 ? water.map((row, y) => row.map((ok, x) => ok && Math.hypot(x + 0.5 - hx / hn, y + 0.5 - hy / hn) <= 18)) : water;
    // a time-based seed on purpose: it is only decoration, so it may differ from load to load (the map itself never does)
    for (const a of makeBoats(around, `${v.node.id}#nessie#${Date.now()}`, 1)) {
      a.walker.speed *= 0.5;
      const sprite = new Sprite(nf[0].texture);
      sprite.anchor.set(nf[0].anchor[0], nf[0].anchor[1]);
      sprite.width = TILE_W * 0.65;
      sprite.height = sprite.width / nf[0].aspect;
      v.layer.sortableChildren = true;
      v.layer.addChild(sprite);
      this.animals.push({ a, view: v, sprite, frames: nf.map((f) => f.texture), boat: true, nessie: true });
    }
  }

  /** Walk the animals of every view that is on screen. */
  private animateAnimals(dt: number): void {
    if (this.animals.length === 0) return;
    this.animalClock += dt;
    for (const an of this.animals) {
      const shown = an.view.container.visible && an.view.layer.alpha > 0.01;
      an.sprite.visible = shown;
      if (!shown) continue;
      const w = an.a.walker;
      stepWalker(w, dt, an.a.mask, an.a.cells);
      const pos = gridToScreen(w.x, w.y);
      // boats rock gently on the water and swap between their two frames; animals walk
      an.sprite.position.set(pos.x, pos.y + (an.boat ? Math.sin(this.animalClock * 2 + w.phase * 5) * 0.8 : 0));
      an.sprite.zIndex = w.x + w.y + 1;
      an.sprite.texture = an.boat ? an.frames[Math.floor(this.animalClock * 2 + w.phase * 2) % an.frames.length] : an.frames[walkerFrame(w, this.animalClock)] ?? an.frames[0];
      const sx = Math.abs(an.sprite.scale.x);
      an.sprite.scale.x = w.facingRight ? sx : -sx;
      if (an.nessie) {
        // surfaced for 28 s, then dives for about 6 s (fading out and back in) and comes up somewhere else along its way
        const t = (this.animalClock + w.phase * 36) % 36;
        an.sprite.alpha = t < 28 ? 1 : t < 30 ? (30 - t) / 2 : t < 34 ? 0 : (t - 34) / 2;
      }
    }
  }

  /** Walk the people, and show a name above whoever the pointer is on. */
  private animatePeople(dt: number): void {
    const home = this.homeSpot;
    if (!home || this.people.length === 0) return;
    this.peopleClock += dt;
    const shown = home.view.container.visible;
    const baseScale = this.people[0].sprite.scale.x < 0 ? -this.people[0].sprite.scale.x : this.people[0].sprite.scale.x;
    this.people.forEach((p, k) => {
      stepWalker(p.walker, dt, home.walkable, home.cells);
      const pos = gridToScreen(p.walker.x, p.walker.y);
      p.sprite.visible = shown;
      p.sprite.position.set(pos.x, pos.y);
      p.sprite.zIndex = p.walker.x + p.walker.y + 1 + 0.0005 * (k + 1);
      p.sprite.texture = p.frames[walkerFrame(p.walker, this.peopleClock)] ?? p.frames[0];
      p.sprite.scale.x = p.walker.facingRight ? baseScale : -baseScale;
    });
    // hover: the person under the pointer (the front-most one if several overlap)
    let hit = -1;
    if (shown && this.pointer) {
      const rect = this.app.canvas.getBoundingClientRect();
      const px = this.pointer.x - rect.left;
      const py = this.pointer.y - rect.top;
      let bestZ = -Infinity;
      this.people.forEach((p, k) => {
        const b = p.sprite.getBounds();
        const pad = 5;
        if (px >= b.x - pad && px <= b.x + b.width + pad && py >= b.y - pad && py <= b.y + b.height + pad && p.sprite.zIndex > bestZ) {
          bestZ = p.sprite.zIndex;
          hit = k;
        }
      });
    }
    if (hit !== this.hoveredPerson) {
      this.hoveredPerson = hit;
      this.app.canvas.style.cursor = hit >= 0 ? 'pointer' : '';
    }
    if (hit >= 0) {
      const p = this.people[hit];
      if (!this.personLabel) {
        this.personLabel = new Text({
          text: '',
          style: { fontSize: 13, fontWeight: '700', fill: 0xffffff, stroke: { color: 0x10233a, width: 4 } },
          resolution: 2,
        });
        this.personLabel.anchor.set(0.5, 1);
        this.labels.addChild(this.personLabel);
      }
      const l = this.personLabel;
      if (l.text !== p.walker.name) l.text = p.walker.name;
      const v = home.view;
      const sc = this.world.scale.x;
      l.position.set(v.ox + v.f * p.sprite.x, v.oy + v.f * (p.sprite.y - p.sprite.height) - 4 / sc);
      l.scale.set(1 / sc);
      l.visible = true;
    } else if (this.personLabel) {
      this.personLabel.visible = false;
    }
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
      f, ox, oy, container, gfx, layer, drawn: false, alpha: 1, childLabels: [], islands: null, pending: [], kids: new Map(), villageTrees: new Map(), houseLabels: [], ownerLayers: new Map(),
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
      // A file is a house and nothing more: there is no layer of functions to zoom into.
      if (child.kind === 'file') continue;
      const w = b.x1 - b.x0 + 1;
      const h = b.y1 - b.y0 + 1;
      const side = Math.max(w, h);
      const island = {
        child,
        footprint: { bx: b.x0 + w / 2 - side / 2, by: b.y0 + h / 2 - side / 2, s: side / GRID_SIZE },
      };
      if (child.children.length > 0) v.islands.push(island);
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
    const { cells } = this.viewCells(v);
    if (this.kit) this.drawTextured(v, this.kit, cells);
    else this.drawFlat(v, cells);

    // Name every island inside this view. The labels belong to the container, not to the islands' own views, so an
    // island is named as soon as it is on screen: its own view only exists once you have zoomed close, and deep islands
    // would otherwise go unnamed. A folder's home islet (its loose files) has no label: the cluster's label names it.
    for (const isl of this.islandsOf(v)) {
      if (isl.child.id.endsWith(LOOSE_FILES_SUFFIX)) continue;
      let sx = 0;
      let sy = 0;
      let n = 0;
      v.grid.forEach((row, j) => row.forEach((t, i) => {
        if (t.nodeId === isl.child.id) {
          sx += i + 0.5;
          sy += j + 0.5;
          n++;
        }
      }));
      if (n === 0) continue;
      const label = new Text({
        text: isl.child.name,
        style: { fontSize: 14, fontWeight: '700', fill: 0xffffff, stroke: { color: 0x10233a, width: 4 } },
        resolution: 2,
      });
      label.anchor.set(0.5);
      // position in root world units (this view's origin and scale)
      const p = gridToScreen(sx / n, sy / n);
      label.position.set(v.ox + v.f * p.x, v.oy + v.f * p.y);
      label.visible = false;
      this.labels.addChild(label);
      const il: IslandLabel = { label, size: { w: label.width, h: label.height }, f: v.f * isl.footprint.s, depth: v.depth + 1 };
      v.childLabels.push(il);
      this.islandLabels.push(il);
    }
  }


  /** Placeholder look: flat-coloured diamonds. Used when the tile art could not be loaded. */
  private drawFlat(v: View, cells: Cell[]): void {
    const g = v.gfx;
    for (const { i, j, type, variant } of cells) diamond(g, i, j).fill(type === 'ocean' ? WATER[variant] ?? WATER[0] : PALETTE[type]);
  }

  /** A standing object placed on the ground at grid position (gx, gy), sized and anchored from its kit entry. */
  /** Recoloured copies of house art, one per (texture, language): see recolour() in language.ts. Cached. */
  private recoloured = new Map<Texture, Map<number, Texture>>();
  private recolouredTexture(tex: Texture, colour: number): Texture {
    let byColour = this.recoloured.get(tex);
    if (!byColour) this.recoloured.set(tex, (byColour = new Map()));
    let out = byColour.get(colour);
    if (!out) {
      const src = this.app.renderer.extract.canvas(tex) as HTMLCanvasElement;
      const ctx = src.getContext('2d')!;
      const img = ctx.getImageData(0, 0, src.width, src.height);
      recolourPixels(img.data, colour);
      ctx.putImageData(img, 0, 0);
      out = Texture.from(src);
      out.source.scaleMode = 'nearest';
      byColour.set(colour, out);
    }
    return out;
  }

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
    const decor: { gx: number; gy: number; sprite: Sprite; shadow?: Container; owner?: string }[] = [];
    // child islets (not villages) that have a view of their own: their ground and trees go in a container each
    const fadeIds = new Set(effectiveChildren(v.node).filter((c) => c.kind === 'folder' && !isVillage(c) && c.children.length > 0).map((c) => c.id));
    const ownerLayer = (owner?: string): Container => {
      if (!owner || !fadeIds.has(owner)) return layer;
      let c = v.ownerLayers.get(owner);
      if (!c) {
        c = new Container();
        layer.addChild(c);
        v.ownerLayers.set(owner, c);
      }
      return c;
    };
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

    const smokeLayer = new Container(); // campfire smoke, above everything else in this view
    const blockedCells = new Set<number>(); // cells people cannot walk through: trees
    const sceneryCells = new Map<string, { i: number; j: number }[]>();
    // A village islet's trees are kept apart: seen from here they dress the islet, but once the village's own view
    // fades in (with its houses, paths and its own trees, all depth-sorted together) these fade out.
    const villageIds = new Set(effectiveChildren(v.node).filter((c) => isVillage(c)).map((c) => c.id));
    for (const { i, j, type } of cells) {
      const hash = ((Math.imul(i + 1, 73856093) ^ Math.imul(j + 1, 19349663) ^ Math.imul(v.depth + 7, 83492791)) >>> 0) % 1000;
      if (type === 'village') {
        // Open village ground: dirt paths and plazas; a campfire stands on its own spot.
        const dirt = this.groundSprite(kit.ground('dirt', hash, [0, 0, 0, 0]), i, j);
        if (grid[j][i].variant === 1) dirt.tint = 0xf2e6d4;
        layer.addChild(dirt);
        if (grid[j][i].variant === 2) {
          const art = kit.campfire(hash);
          const sp = this.objectSprite(art, i + 0.5, j + 0.5, 1, TILE_H * 0.1);
          const glow = this.objectSprite(kit.shadow, i + 0.5, j + 0.5, 4.6 / kit.shadow.widthInTiles, TILE_H * 0.1);
          glow.tint = 0xff9a2e;
          glow.blendMode = 'add';
          glow.alpha = 0.3;
          decor.push({ gx: i + j + 0.4, gy: 0, sprite: sp, shadow: glow });
          // Smoke: a few soft puffs that start at the top of the flames and rise (see animateFires). They sit in
          // their own layer above the houses, and use the same bounds as the campfire sprite.
          const smoke: Sprite[] = [];
          for (let k = 0; k < SMOKE_PUFFS; k++) {
            const puff = new Sprite(kit.smoke.texture);
            puff.anchor.set(0.5);
            puff.tint = 0xe6e6e6;
            puff.alpha = 0;
            smokeLayer.addChild(puff);
            smoke.push(puff);
          }
          this.fires.push({
            sprite: sp, glow, view: v, phase: ((hash * 7) % 628) / 100, base: sp.scale.y,
            smoke, x: sp.x, y: sp.y - sp.height * 0.61, h: sp.height, w: sp.width,
          });
        }
      } else if (type === 'island' || type === 'coast' || type === 'port' || type === 'tree') {
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
        ownerLayer(grid[j][i].nodeId).addChild(ground);
        if (type === 'port') {
          const dock = this.objectSprite(kit.port(hash), i + 0.5, j + 0.5);
          decor.push({ gx: i + j + 0.5, gy: 0, sprite: dock });
        }
        // Inland grass away from the shore and the village core may carry scenery; it is placed per islet after
        // this loop (src/render/scenery.ts), so density and spacing are controlled instead of rolled per cell.
        const core = villageCore.get(grid[j][i].nodeId ?? '');
        const inVillageCore = !!core && Math.hypot(i + 0.5 - core.x, j + 0.5 - core.y) < core.r * 0.3;
        const owner = grid[j][i].nodeId;
        if (owner && kind === 'grass' && !shoreTex && type === 'island' && !inVillageCore && edges.every((e) => e === Edge.None) && this.grassAround(grid, i, j, 1)) {
          const list = sceneryCells.get(owner) ?? [];
          list.push({ i, j });
          sceneryCells.set(owner, list);
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

    for (const [owner, list] of sceneryCells) {
      if (!villageIds.has(owner)) {
        this.addScenery(kit, placeScenery(list, owner), decor, owner);
        continue;
      }
      const own: { gx: number; gy: number; sprite: Sprite; shadow?: Container }[] = [];
      this.addScenery(kit, placeScenery(list, owner), own);
      own.sort((a, b) => a.gx - b.gx);
      const holder = new Container();
      for (const d of own) {
        if (d.shadow) holder.addChild(d.shadow);
        holder.addChild(d.sprite);
      }
      layer.addChild(holder);
      v.villageTrees.set(owner, holder);
    }

    // The village's own trees: on the free ground of its islet, away from houses, paths and campfires.
    if (v.footprint && v.allowed && isVillage(v.node)) {
      const allowed = v.allowed;
      const near = (x: number, y: number, r: number, test: (t: Tile) => boolean) => {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const t = grid[y + dy]?.[x + dx];
            if (t && test(t)) return true;
          }
        }
        return false;
      };
      const free: { i: number; j: number }[] = [];
      for (let j = 1; j < GRID_SIZE - 1; j++) {
        for (let i = 1; i < GRID_SIZE - 1; i++) {
          if (!allowed[j][i] || grid[j][i].type !== 'ocean') continue;
          // inland (every neighbour is usable ground) and clear of buildings, paths and plazas by a cell
          if (!allowed[j - 1][i] || !allowed[j + 1][i] || !allowed[j][i - 1] || !allowed[j][i + 1]) continue;
          if (near(i, j, 0, (t) => t.type === 'house' || t.type === 'village')) continue; // not on a house patch, path or plaza
          // and standing on real grass of the islet below, with grass all round (never on its sand or at the water)
          const fp = v.footprint;
          const px = Math.floor(fp.bx + (i + 0.5) * fp.s);
          const py = Math.floor(fp.by + (j + 0.5) * fp.s);
          if (!v.parent || px < 1 || py < 1 || px >= GRID_SIZE - 1 || py >= GRID_SIZE - 1 || !this.grassAround(v.parent.grid, px, py, 1)) continue;
          if ((i * 7 + j * 13) % 10 < 7) free.push({ i, j }); // thinned: a village is a clearing with some trees, not a wood
        }
      }
      const homes = [...houses.values()].map((h) => [h.sx / h.n, h.sy / h.n] as const);
      const trees = placeScenery(free, v.node.id + '#village').filter(
        (p) => !homes.some(([hx, hy]) => Math.hypot(hx - (p.i + 0.5 + p.dx), hy - (p.j + 0.5 + p.dy)) < 1.25),
      );
      this.addScenery(kit, trees, decor);
      for (const t of trees) if (t.kind !== 'rock' && t.kind !== 'tuft') blockedCells.add(t.j * GRID_SIZE + t.i);
    }

    // A village shows one house per file or function (src/render/village.ts): bigger code, bigger building. Every
    // house still owns its patch of tiles, so hover and zoom work per file; the art is scenery drawn over them.
    const floorArt = [1, 2, 3, 4].some((f) => kit.hasArt('objects.house.' + f));
    const hutArt = kit.hasArt('objects.hut.small') || kit.hasArt('objects.hut.medium') || kit.hasArt('objects.hut.large');
    if (houses.size > 0 && floorArt) {
      // Every building is the same width; code size only sets how many floors it has.
      const sizeOf = new Map(v.node.children.map((c) => [c.id, c.size]));
      const nameOf = new Map(v.node.children.map((c) => [c.id, c.name]));
      const inputs = [...houses.entries()].map(([id, h]) => ({ id, x: h.sx / h.n, y: h.sy / h.n, n: h.n, size: sizeOf.get(id) ?? 0 }));
      for (const p of placeHouses(inputs)) {
        let floors = p.floors;
        while (floors > 1 && !kit.hasArt('objects.house.' + floors)) floors--; // no art that tall: use a shorter one
        if (!kit.hasArt('objects.house.' + floors)) floors = [1, 2, 3, 4].find((f) => kit.hasArt('objects.house.' + f))!;
        const art = kit.house(floors, p.hash);
        // draw the whole image so that the building inside it comes out exactly p.width cells wide
        const imageCells = (p.width * art.texture.width) / art.buildingPx;
        const sp = this.objectSprite(art, p.x, p.y, imageCells / art.widthInTiles, TILE_H * 0.15);
        if (p.hash % 2 === 1) sp.scale.x = -sp.scale.x;
        const name = nameOf.get(p.id);
        // language colour: this house is drawn in a recoloured copy of the art (the walls take the language's hue, roofs stay as they are)
        const lang = name ? languageOf(name) : null;
        if (lang) sp.texture = this.recolouredTexture(art.texture, lang.color);
        if (name) {
          const text = name.length > 20 ? name.slice(0, 19) + '…' : name;
          const label = new Text({
            text,
            style: { fontSize: 11, fontWeight: '700', fill: 0xffffff, stroke: { color: 0x10233a, width: 3 } },
            resolution: 2,
          });
          label.anchor.set(0.5, 1);
          // top of the house, in local space then root world units
          const topY = sp.y - sp.height * art.anchor[1] + sp.height * (art.topPx / art.texture.height);
          const item: HouseLabel = {
            label,
            view: v,
            x: v.ox + v.f * sp.x,
            y: v.oy + v.f * topY,
            size: { w: label.width, h: label.height },
            rank: p.floors + p.hash / 4294967296,
          };
          label.visible = false;
          this.labels.addChild(label);
          v.houseLabels.push(item);
          this.houseLabels.push(item);
        }
        // Grounded: a wide soft shadow plus a tight dark one right at the foot of the wall, so the building sits
        // on the ground instead of looking pasted over it.
        const sh = new Container();
        const soft = this.objectSprite(kit.shadow, p.x, p.y, (p.shadowInTiles * 1.5) / kit.shadow.widthInTiles, TILE_H * 0.15);
        soft.alpha = 0.55;
        const tight = this.objectSprite(kit.shadow, p.x, p.y, (p.shadowInTiles * 1.05) / kit.shadow.widthInTiles, TILE_H * 0.15 - 1);
        tight.alpha = 1;
        sh.addChild(soft, tight);
        decor.push({ gx: p.x + p.y, gy: 0, sprite: sp, shadow: sh });
      }
    } else if (houses.size > 0 && hutArt) {
      const sizeOf = new Map(v.node.children.map((c) => [c.id, c.size]));
      const inputs = [...houses.entries()].map(([id, h]) => ({ id, x: h.sx / h.n, y: h.sy / h.n, n: h.n, size: sizeOf.get(id) ?? 0 }));
      for (const p of placeHouses(inputs)) {
        // fall back to a neighbouring size if the manifest has no art for this one
        const size = kit.hasArt('objects.hut.' + p.size) ? p.size : kit.hasArt('objects.hut.medium') ? 'medium' : kit.hasArt('objects.hut.small') ? 'small' : 'large';
        const art = kit.hut(size, p.hash);
        const sp = this.objectSprite(art, p.x, p.y, p.widthInTiles / art.widthInTiles, TILE_H * 0.15);
        if (p.hash % 2 === 1) sp.scale.x = -sp.scale.x;
        const sh = this.objectSprite(kit.shadow, p.x, p.y, p.shadowInTiles / kit.shadow.widthInTiles, TILE_H * 0.15);
        sh.alpha = 0.7;
        decor.push({ gx: p.x + p.y, gy: 0, sprite: sp, shadow: sh });
      }
    } else if (houses.size > 0) {
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
      const target = ownerLayer(d.owner);
      if (d.shadow) {
        d.shadow.zIndex = d.gx + 1 - 0.001;
        target.addChild(d.shadow);
      }
      d.sprite.zIndex = d.gx + 1; // used when the layer sorts (the root island, where people walk among the houses)
      target.addChild(d.sprite);
    }

    smokeLayer.zIndex = 1e6;
    layer.addChild(smokeLayer);
    // The repository's own island (the root's loose files) is where the collaborators live: mark where they may walk.
    if (v.depth === 1 && v.node.id.endsWith(LOOSE_FILES_SUFFIX) && v.allowed) {
      const allowed = v.allowed;
      const walkable = Array.from({ length: GRID_SIZE }, (_, j) =>
        Array.from({ length: GRID_SIZE }, (_, i) => {
          const t = grid[j][i];
          return allowed[j][i] && t.type !== 'house' && !(t.type === 'village' && t.variant === 2) && !blockedCells.has(j * GRID_SIZE + i);
        }),
      );
      v.layer.sortableChildren = true; // people and buildings sort by depth together
      this.homeSpot = { view: v, walkable, cells: walkableCells(walkable) };
      this.spawnPeople();
    }
    if (!v.footprint) this.spawnBoats(v, kit); // the root view: boats on the open sea
    // Animals live on every other island: walkable land, clear of houses, fires and trees.
    // Only villages (where the houses are): a cluster's islands are drawn by their own views, which would cover them.
    if (isVillage(v.node)) {
      const allowed = v.allowed;
      const walk = Array.from({ length: GRID_SIZE }, (_, j) =>
        Array.from({ length: GRID_SIZE }, (_, i) => {
          const t = grid[j][i];
          const land = t.type === 'island' || (t.type === 'village' && t.variant !== 2);
          return land && (!allowed || allowed[j][i]) && !blockedCells.has(j * GRID_SIZE + i);
        }),
      );
      this.spawnAnimals(v, kit, walk, v.depth === 1 && v.node.id.endsWith(LOOSE_FILES_SUFFIX));
    }
    kit.flush();
  }

  /** Turn scenery placements (trees, bushes, rocks, tufts) into sprites with shadows, queued for depth sorting. */
  private addScenery(
    kit: TileKit,
    placements: ReturnType<typeof placeScenery>,
    decor: { gx: number; gy: number; sprite: Sprite; shadow?: Container; owner?: string }[],
    owner?: string,
  ): void {
    for (const p of placements) {
      const art = p.kind === 'rock' ? kit.rock(p.hash) : p.kind === 'tuft' ? kit.tuft(p.hash) : kit.tree(p.kind, p.hash);
      const gx = p.i + 0.5 + p.dx;
      const gy = p.j + 0.5 + p.dy;
      const sp = this.objectSprite(art, gx, gy, 1, TILE_H * 0.3);
      if (p.hash % 2 === 1) sp.scale.x = -sp.scale.x; // mirror half of them: same tree, different look
      const shade = 232 + ((p.hash >> 5) % 24); // slight brightness variation
      sp.tint = (shade << 16) | (shade << 8) | shade;
      const sh = this.objectSprite(kit.shadow, gx, gy, art.shadowInTiles / kit.shadow.widthInTiles, TILE_H * 0.3);
      sh.alpha = 0.8;
      decor.push({ gx: p.i + p.j + p.dx + p.dy, gy: 0, sprite: sp, shadow: sh, owner });
    }
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
    // Top-level clusters are always fully drawn, at every zoom: if they faded in with the zoom, the parent's solid
    // islet (a flat green blob with oversized trees) would show through whenever you scrolled.
    if (depth <= 1) return 1;
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
    // An island's name shows while the island is a sensible size on screen: from when it is a few dozen pixels across
    // until its footprint fills the screen, when the names of the islands inside it take over. (Judging by size, not
    // by zoom thresholds, keeps deep islands named: they are small at the zoom where they appear.)
    const sc = this.world.scale.x;
    // and the names of the islands inside a cluster wait until the cluster itself nearly fills the screen (its own name
    // has handed over by then), so zoomed out you read the clusters, not a scatter of small islands
    const open = v.depth === 0 ? 1 : clamp01((sc * v.f / this.fit - 0.85) / 0.3);
    const fade = clamp01(v.alpha * 2.5) * open;
    for (const il of v.childLabels) {
      const r = (sc * il.f) / this.fit;
      const a = clamp01((r - 0.05) / 0.05) * (1 - clamp01((r - 1.1) / 0.5)) * fade;
      il.label.alpha = a;
      il.label.visible = v.container.visible && a > 0.01;
      il.label.scale.set(1 / sc);
    }
  }

  /** House names appear once the village fills a good part of the screen, and follow its fade. */
  private updateHouseLabels(v: View): void {
    if (v.houseLabels.length === 0) return;
    const sc = this.world.scale.x;
    const r = (sc * v.f) / this.fit;
    const a = clamp01((r - 0.9) / 0.5) * v.alpha;
    for (const h of v.houseLabels) {
      h.label.alpha = a;
      h.label.visible = v.container.visible && a > 0.02;
      h.label.scale.set(1 / sc);
      h.label.position.set(h.x, h.y - 4 / sc);
    }
  }

  /** A gentle flicker: the flames breathe a little and the glow pulses (only for campfires whose view is showing). */
  private animateFires(): void {
    if (this.fires.length === 0) return;
    const t = performance.now() / 1000;
    for (const f of this.fires) {
      if (!f.view.container.visible) continue;
      const a = Math.sin(t * 7 + f.phase) * 0.5 + Math.sin(t * 13.3 + f.phase * 2) * 0.5;
      f.sprite.scale.y = f.base * (1 + 0.035 * a);
      f.glow.alpha = (0.26 + 0.1 * a) * f.view.alpha;
      // smoke puffs: each is on its own point of a looping life (0 = just left the flames, 1 = gone), staggered
      for (let k = 0; k < f.smoke.length; k++) {
        const life = (t * SMOKE_SPEED + k / f.smoke.length + f.phase / 6.28) % 1;
        const puff = f.smoke[k];
        const sway = Math.sin(life * 5 + k * 1.7 + f.phase) * 0.06 + life * 0.14; // a little wobble and a drift downwind
        puff.position.set(f.x + sway * f.w, f.y - life * f.h * 1.2);
        puff.width = puff.height = f.w * (0.12 + life * 0.3);
        puff.alpha = Math.min(1, life * 8) * (1 - life * life) * 0.85 * f.view.alpha;
      }
    }
  }

  /** Labels that would overlap a bigger island's label (bigger view first) are hidden at the current zoom. */
  private hideOverlappingLabels(): void {
    const sc = this.world.scale.x;
    const shown: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const items: { text: Text; w: number; h: number; rank: number }[] = [];
    for (const il of this.islandLabels) {
      if (il.label.visible) items.push({ text: il.label, w: il.size.w, h: il.size.h, rank: 1000 + il.f - il.depth * 1e-3 });
    }
    for (const h of this.houseLabels) {
      if (h.label.visible) items.push({ text: h.label, w: h.size.w, h: h.size.h, rank: h.rank });
    }
    items.sort((a, b) => b.rank - a.rank);
    for (const it of items) {
      const l = it.text;
      const cx = this.world.position.x + sc * l.position.x;
      // the label's centre on screen (house names hang their bottom edge on the point, island names are centred)
      const cy = this.world.position.y + sc * l.position.y - (l.anchor.y - 0.5) * it.h;
      const box = { x0: cx - it.w / 2 - 4, y0: cy - it.h / 2 - 2, x1: cx + it.w / 2 + 4, y1: cy + it.h / 2 + 2 };
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
    this.updateHouseLabels(v);
    for (const isl of this.islandsOf(v)) {
      const fk = v.f * isl.footprint.s;
      const o = gridToScreen(isl.footprint.bx, isl.footprint.by);
      const kox = v.ox + v.f * o.x;
      const koy = v.oy + v.f * o.y;
      const alpha = this.alphaFor(v.depth + 1, fk);
      const visible = alpha > 0 && this.onScreen(fk, kox, koy);
      const vt = v.villageTrees.get(isl.child.id);
      if (vt) vt.alpha = visible ? 1 - alpha : 1;
      const oc = v.ownerLayers.get(isl.child.id);
      if (oc) oc.alpha = visible ? 1 - alpha : 1;
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
    for (const il of v.childLabels) il.label.visible = false;
    for (const h of v.houseLabels) h.label.visible = false;
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
    this.onHover(hit ? { x: hit.x, y: hit.y, tile: hit.tile, container: hit.view.node } : null);
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
    if (this.flyStep) this.app.ticker.remove(this.flyStep); // a new flight replaces the one in progress
    const s0 = this.world.scale.x;
    const x0 = this.world.position.x;
    const y0 = this.world.position.y;
    const t0 = performance.now();
    // farther trips take a little longer
    const dur = 1200 + 500 * Math.min(2, Math.abs(Math.log(scale / s0)) / Math.LN2 / 3);
    const step = () => {
      const t = clamp01((performance.now() - t0) / dur);
      const e = t * t * (3 - 2 * t);
      this.world.scale.set(Math.exp(Math.log(s0) + (Math.log(scale) - Math.log(s0)) * e));
      this.world.position.set(x0 + (px - x0) * e, y0 + (py - y0) * e);
      this.refresh();
      if (t >= 1) {
        this.app.ticker.remove(step);
        if (this.flyStep === step) this.flyStep = null;
      }
    };
    this.flyStep = step;
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
    let downX = 0;
    let downY = 0;

    canvas.addEventListener('pointerdown', (e) => {
      downX = e.clientX;
      downY = e.clientY;
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
    canvas.addEventListener('pointerup', (e) => {
      dragging = false;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return; // a drag, not a click
      const hit = this.pick(e.clientX, e.clientY);
      if (hit) this.onTileClick({ x: hit.x, y: hit.y, tile: hit.tile, container: hit.view.node });
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
