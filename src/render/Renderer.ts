import { Application, Container, Graphics } from 'pixi.js';
import { GRID_SIZE, type Grid, type Tile } from '../types';
import { gridToScreen, screenToGrid, TILE_H, TILE_W } from './iso';
import { HIGHLIGHT, PALETTE } from './palette';

export interface HoverInfo {
  x: number;
  y: number;
  tile: Tile;
}

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 4;
const DRAG_THRESHOLD = 4;

function diamond(g: Graphics, x: number, y: number): Graphics {
  const { x: sx, y: sy } = gridToScreen(x, y);
  return g.poly([sx, sy, sx + TILE_W / 2, sy + TILE_H / 2, sx, sy + TILE_H, sx - TILE_W / 2, sy + TILE_H / 2]);
}

export class Renderer {
  private app = new Application();
  private world = new Container();
  private tiles = new Graphics();
  private highlight = new Graphics();
  private grid: Grid | null = null;
  private hover: { x: number; y: number } | null = null;

  onHover: (info: HoverInfo | null) => void = () => {};
  onTileClick: (info: HoverInfo) => void = () => {};

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({ resizeTo: host, background: 0x0b2a4a, antialias: true });
    host.appendChild(this.app.canvas);
    this.world.addChild(this.tiles, this.highlight);
    this.app.stage.addChild(this.world);
    this.bindInput(this.app.canvas);
  }

  setGrid(grid: Grid): void {
    this.grid = grid;
    this.hover = null;
    this.highlight.clear();
    this.drawTiles();
    this.fitCamera();
    this.onHover(null);
  }

  private drawTiles(): void {
    const g = this.tiles;
    g.clear();
    if (!this.grid) return;
    // Back-to-front: ascending x+y diagonals.
    for (let sum = 0; sum <= (GRID_SIZE - 1) * 2; sum++) {
      for (let x = Math.max(0, sum - (GRID_SIZE - 1)); x <= Math.min(GRID_SIZE - 1, sum); x++) {
        const y = sum - x;
        const tile = this.grid[y][x];
        diamond(g, x, y).fill(PALETTE[tile.type]);
      }
    }
  }

  private fitCamera(): void {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const worldW = GRID_SIZE * TILE_W;
    const worldH = GRID_SIZE * TILE_H;
    const scale = Math.min(w / worldW, h / worldH) * 0.9;
    this.world.scale.set(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale)));
    // Grid centre in world space is (0, worldH / 2).
    this.world.position.set(w / 2, h / 2 - (worldH / 2) * this.world.scale.y);
  }

  private tileAt(clientX: number, clientY: number): HoverInfo | null {
    if (!this.grid) return null;
    const rect = this.app.canvas.getBoundingClientRect();
    const wx = (clientX - rect.left - this.world.position.x) / this.world.scale.x;
    const wy = (clientY - rect.top - this.world.position.y) / this.world.scale.y;
    const { x, y } = screenToGrid(wx, wy);
    if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) return null;
    return { x, y, tile: this.grid[y][x] };
  }

  private setHover(info: HoverInfo | null): void {
    const same = info?.x === this.hover?.x && info?.y === this.hover?.y;
    if (same) return;
    this.hover = info ? { x: info.x, y: info.y } : null;
    this.highlight.clear();
    if (info) {
      diamond(this.highlight, info.x, info.y).stroke({ width: 2, color: HIGHLIGHT });
    }
    this.onHover(info);
  }

  private bindInput(canvas: HTMLCanvasElement): void {
    let dragging = false;
    let moved = 0;
    let lastX = 0;
    let lastY = 0;

    canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      moved = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (dragging) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        moved += Math.abs(dx) + Math.abs(dy);
        lastX = e.clientX;
        lastY = e.clientY;
        this.world.position.x += dx;
        this.world.position.y += dy;
      }
      this.setHover(this.tileAt(e.clientX, e.clientY));
    });
    canvas.addEventListener('pointerup', (e) => {
      dragging = false;
      if (moved < DRAG_THRESHOLD) {
        const info = this.tileAt(e.clientX, e.clientY);
        if (info) this.onTileClick(info);
      }
    });
    canvas.addEventListener('pointerleave', () => this.setHover(null));
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const old = this.world.scale.x;
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, old * Math.exp(-e.deltaY * 0.001)));
        // Zoom about the cursor.
        const k = next / old;
        this.world.position.x = mx - (mx - this.world.position.x) * k;
        this.world.position.y = my - (my - this.world.position.y) * k;
        this.world.scale.set(next);
      },
      { passive: false },
    );
  }
}
