# CLAUDE.md

Guidance for AI assistants working in this repo. Read this fully before writing code.

## Project

A hackathon project (DurHack, ~18 hours, team of 4) that **visualises a GitHub repo as a 2.5D island world**, in the style of Freeciv / kingdoms-and-castles tile games.

The repo is the world. The metaphor:

| Repo concept | World concept |
|---|---|
| Whole repo | The ocean / world |
| Top-level folder | An island |
| Subfolder | A smaller island (or a lake with an island inside) |
| Folder nested too deep (depth > `MAX_ISLAND_DEPTH`) | Coral reef (its own sub-world) |
| File | A village |
| Function | A house |
| Decoration | Trees scattered on land |

Tile types: `ocean`, `island`, `coast` (island/ocean transition, autotiled), `port` (harbour; where you enter/leave a node), `coral`, `village`, `house`, `tree`.

## Core mechanic: semantic zoom

Tiles zoom into more tiles. Every tile that represents a repo node carries a `nodeId`. Entering it generates and shows that node's **child grid**:

- L0: ocean with top-level islands (tile = top-level folder)
- L1: inside an island: subfolder islands, lakes, villages (tile = subfolder or file)
- L2: inside a village: houses (tile = function)

World generation is **lazy and per node**: `layoutNode(node, depth) -> Grid`. Never generate the whole repo at once. Initial UX is click-to-dive with a breadcrumb back to the parent; smooth continuous zoom is a stretch goal.

## Stack

- TypeScript, Vite, PixiJS (2D WebGL), isometric square tiles (diamonds).
- `simplex-noise` and a small seeded PRNG (mulberry32) for generation.
- Runs entirely in the browser. Demo repos are pre-generated to JSON in `public/demo/` so the demo never depends on GitHub rate limits.
- Keep the grid code behind a neighbor function and coordinate helpers so a switch to hexagons stays possible. Do not assume 4 neighbors outside those helpers.

## Folder ownership (strict)

Four people, four AI sessions. Only edit your own folder. If you need a change elsewhere, change `src/types.ts` only after telling the team, or ask the owner.

| Folder | Owner area |
|---|---|
| `src/types.ts` | Shared contracts. Everyone reads, changes need team agreement |
| `src/data/` | Repo fetching, tree walking, function parsing, weights -> `Node` |
| `src/layout/` | World generation: `layoutNode`, noise, island growth, autotiling |
| `src/render/` | PixiJS engine: iso projection, depth sorting, camera, picking, transitions |
| `src/ui/` and `public/assets/` | HTML/CSS panels, breadcrumb, tooltips, sprites, palette |
| `public/demo/` | Pre-generated demo repo JSON |

## Contracts (summary; `src/types.ts` is the source of truth)

```ts
type NodeKind = 'folder' | 'file' | 'function';
interface RepoNode { id: string; kind: NodeKind; name: string; path: string;
                     size: number; children: RepoNode[]; }   // data -> layout

type TileType = 'ocean' | 'island' | 'coast' | 'port' | 'coral' | 'village' | 'house' | 'tree';
interface Tile { type: TileType; variant: number; height: number; nodeId?: string; }
type Grid = Tile[][];                                          // layout -> render

layoutNode(node: RepoNode, depth: number): Grid
```

A tile with `nodeId` is zoomable into that node.

## Rules

1. **Determinism.** Never call `Math.random()`. All randomness comes from a PRNG seeded with `hash(node.path)`. The same repo must always produce the same world.
2. **Lazy generation.** `layoutNode` only lays out one node's direct children.
3. **Cap complexity.** More than ~100 children: group extras into an "other" village. Skip `node_modules`, `.git`, build output and binaries.
4. **Placeholders first.** Render flat-colour diamonds until real sprites exist. Art must never block the pipeline.
5. **No cross-folder edits** without telling the owner. Avoid merge conflicts: small commits, pull before starting, push often.
6. **Look at it.** Visual bugs (iso projection, depth sorting, autotile bitmask order) cannot be caught by reading code. Run the app and check a seeded debug view. Add quick tests for deterministic logic (layout with a fixed seed, autotile lookup).
7. **Language support.** Only parse Python and JS/TS functions at first. Other files render as villages with a generic house.
8. Keep dependencies minimal and avoid new ones without a clear reason.

## World generation overview (`src/layout/`)

1. Allocate land area to each child proportional to `sqrt(size)` (about 45% of the grid is land).
2. Place one seed point per child (Poisson-disk or jittered grid), biggest child nearest the centre.
3. Region-grow each child's island to its area budget with noise-weighted preference.
4. Add simplex noise to coastlines, smooth with 1-2 cellular-automata passes, remove specks.
5. Classify tiles: land, coast (land with ocean neighbour), shallow/deep ocean.
6. Autotile coasts via neighbour bitmask -> `variant`.
7. Place content: subfolder islands (coral if too deep), villages, houses, ports.
8. Scatter trees with noise clusters, avoiding occupied tiles.

## Commands

(Filled in once the scaffold exists.)

- `npm install`
- `npm run dev` starts the Vite dev server
- `npm run build` production build
- `npm test` unit tests

## Build order / priorities

P0: ocean + one island, multiple islands, coast autotiling, villages and houses, click-to-dive with breadcrumb, hover/inspect panel.
P1: ports, trees, coral and lakes, water animation.
P2: minimap, search/highlight, smooth continuous zoom.

Feature freeze at hour 16 of 18. Then test on demo repos and rehearse.
