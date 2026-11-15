/**
 * The collaborators: little people who wander about the root island (the repository's own home village).
 *
 * Pure and seeded (no Math.random), so it can be tested without drawing anything: given the walkable cells they make
 * a Walker per collaborator, and `stepWalker` moves a walker a little each frame. A walker stands about for a while,
 * picks somewhere to go, finds a route with breadth-first search over walkable cells (4-neighbour), walks it at its own
 * speed, and stands again. Which of the person designs and which walking speed someone gets comes from their name, so
 * the same person always looks the same.
 */

export type Rng = () => number;

export interface Walker {
  name: string;
  /** Which person design (0..PEOPLE_VARIANTS-1). */
  variant: number;
  /** Position in cells (cell centre = integer + 0.5). */
  x: number;
  y: number;
  /** Cells still to walk to, as cell centres; empty while standing. */
  route: [number, number][];
  /** Seconds left standing before the next walk. */
  rest: number;
  /** Cells per second. */
  speed: number;
  /** Walking-animation frames per second and the walker's own starting point in the cycle. */
  fps: number;
  phase: number;
  /** Which way the person last moved on the screen (iso: screen x grows with x - y). */
  facingRight: boolean;
  moving: boolean;
  rng: Rng;
}

export const PEOPLE_VARIANTS = 8;
/** At most this many people are drawn, however many collaborators there are. */
export const MAX_PEOPLE = 12;
export const MIN_SPEED = 0.55;
export const MAX_SPEED = 0.95;
export const WALK_FPS = 4;
/** How far, in cells, someone usually wanders in one go. */
const WANDER = 14;

export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
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

/** Shortest 4-neighbour route from one cell to another over walkable cells (excluding the start), or null. */
export function findRoute(walkable: boolean[][], from: [number, number], to: [number, number]): [number, number][] | null {
  const h = walkable.length;
  const w = walkable[0]?.length ?? 0;
  const key = (x: number, y: number) => y * w + x;
  if (!walkable[to[1]]?.[to[0]]) return null;
  if (from[0] === to[0] && from[1] === to[1]) return [];
  const prev = new Map<number, number>([[key(from[0], from[1]), -1]]);
  const queue: [number, number][] = [from];
  for (let qi = 0; qi < queue.length; qi++) {
    const [x, y] = queue[qi];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || !walkable[ny][nx] || prev.has(key(nx, ny))) continue;
      prev.set(key(nx, ny), key(x, y));
      if (nx === to[0] && ny === to[1]) {
        const route: [number, number][] = [];
        for (let c = key(nx, ny); c !== -1; c = prev.get(c)!) {
          if (prev.get(c) !== -1) route.push([(c % w) + 0.5, ((c / w) | 0) + 0.5]);
        }
        return route.reverse();
      }
      queue.push([nx, ny]);
    }
  }
  return null;
}

/** Walkable cells as a list. */
export function walkableCells(walkable: boolean[][]): [number, number][] {
  const out: [number, number][] = [];
  walkable.forEach((row, y) => row.forEach((ok, x) => ok && out.push([x, y])));
  return out;
}

/** One walker per collaborator (up to MAX_PEOPLE), starting at a spread of walkable cells. */
export function makeWalkers(names: string[], walkable: boolean[][], seed: string): Walker[] {
  const cells = walkableCells(walkable);
  if (cells.length === 0) return [];
  const rng = mulberry32(hashString('people:' + seed));
  return names.slice(0, MAX_PEOPLE).map((name) => {
    const h = hashString(name);
    const own = mulberry32(h ^ hashString(seed));
    const [cx, cy] = cells[Math.floor(rng() * cells.length)];
    return {
      name,
      variant: h % PEOPLE_VARIANTS,
      x: cx + 0.5,
      y: cy + 0.5,
      route: [],
      rest: own() * 3,
      speed: MIN_SPEED + own() * (MAX_SPEED - MIN_SPEED),
      fps: WALK_FPS + (own() - 0.5) * 1.2,
      phase: own() * 2,
      facingRight: own() < 0.5,
      moving: false,
      rng: own,
    };
  });
}

/** Advance a walker by `dt` seconds. */
export function stepWalker(w: Walker, dt: number, walkable: boolean[][], cells: [number, number][]): void {
  let left = dt;
  while (left > 1e-6) {
    if (w.route.length === 0) {
      w.moving = false;
      if (w.rest > 0) {
        const used = Math.min(left, w.rest);
        w.rest -= used;
        left -= used;
        if (left <= 1e-6) return;
      }
      // pick somewhere to go: a walkable cell within a wander of here (or anywhere, if nothing is near)
      const here: [number, number] = [Math.floor(w.x), Math.floor(w.y)];
      const near = cells.filter(([cx, cy]) => Math.hypot(cx - here[0], cy - here[1]) <= WANDER && Math.hypot(cx - here[0], cy - here[1]) >= 2);
      const pool = near.length > 0 ? near : cells;
      const goal = pool[Math.floor(w.rng() * pool.length)];
      const route = findRoute(walkable, here, goal);
      w.rest = 1 + w.rng() * 4; // stand for a bit after arriving
      if (!route || route.length === 0) {
        w.rest = 0.5 + w.rng() * 2;
        return;
      }
      w.route = route;
    }
    const [tx, ty] = w.route[0];
    const dx = tx - w.x;
    const dy = ty - w.y;
    const dist = Math.hypot(dx, dy);
    w.moving = true;
    if (Math.abs(dx - dy) > 1e-6) w.facingRight = dx - dy > 0;
    const step = w.speed * left;
    if (step >= dist) {
      w.x = tx;
      w.y = ty;
      left -= dist / w.speed;
      w.route.shift();
    } else {
      w.x += (dx / dist) * step;
      w.y += (dy / dist) * step;
      left = 0;
    }
  }
}

/** Which animation frame to show: 0 standing; 1 and 2 are the two steps. */
export function walkerFrame(w: Walker, time: number): number {
  if (!w.moving) return 0;
  return 1 + (Math.floor(w.fps * time + w.phase) % 2);
}
