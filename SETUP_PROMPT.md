# Initial setup prompt

Paste everything below the line into Claude Code, run once by one person, then commit and push so the other three pull the skeleton.

---

Read `CLAUDE.md` fully first. Then scaffold the initial website for this project. Do the following and nothing outside it.

## 1. Project setup
- Create a Vite + TypeScript project in the repo root (vanilla TS template, no framework) with PixiJS (v8) as the renderer, plus `simplex-noise` and `vitest`.
- Add scripts: `dev`, `build`, `test`.
- Create the folders from `CLAUDE.md`: `src/data`, `src/layout`, `src/render`, `src/ui`, `public/assets`, `public/demo`. Add a short `README.md` file inside each of `src/data`, `src/layout`, `src/render`, `src/ui` naming its responsibility (one or two lines).
- Add a `.gitignore` (node_modules, dist).
- Update the "Commands" section in `CLAUDE.md` with the real commands.

## 2. Shared contracts: `src/types.ts`
Define exactly the types from the "Contracts" section of `CLAUDE.md` (`RepoNode`, `Tile`, `TileType`, `Grid`), plus:
- `export const GRID_SIZE = 32;`
- `export const MAX_ISLAND_DEPTH = 4;`
- helper functions `neighbors(x, y)` (returns in-bounds 4-neighbours) and `inBounds(x, y)`, in `src/grid.ts`, so neighbour logic lives in one place.

## 3. Mock data
- `public/demo/mock.json`: a hand-written `RepoNode` tree with about 3 top-level folders, each with subfolders and files, and some files containing function children. Include one folder nested 5+ levels deep to exercise coral. Use realistic names and varied `size` values.

## 4. Stub layout: `src/layout/layoutNode.ts`
- Export `layoutNode(node: RepoNode, depth: number): Grid`.
- Implement a **simple but real** version: seeded PRNG (mulberry32 seeded from a string hash of `node.path`, in `src/layout/rng.ts`), ocean everywhere, one island blob per child grown from seeded points using simplex noise, `island` tiles with `nodeId` set to the child's id for folders/files, ocean otherwise. Mark tiles adjacent to ocean as `coast` (variant 0 for now). No trees, ports or autotile variants yet.
- Add a vitest test proving determinism: the same node gives an identical grid twice.

## 5. Renderer: `src/render/`
- Isometric diamond tiles drawn as flat-colour polygons (no sprites): ocean blue, island green, coast sand, village orange, house red, coral pink, tree dark green, port brown. Colours defined in one palette object in `src/render/palette.ts`.
- Correct depth sorting (draw back-to-front), a `gridToScreen` / `screenToGrid` pair in `src/render/iso.ts`, with a test for round-tripping.
- Camera: mouse-drag pan and wheel zoom (clamped).
- Tile picking: hovering highlights the tile under the cursor and emits the tile's info.
- Click on a tile with a `nodeId`: look up that node in the loaded tree, call `layoutNode(child, depth + 1)`, and re-render (click-to-dive). Maintain a stack of visited nodes.

## 6. UI: `src/ui/`
- `index.html` with a full-screen canvas and an overlay.
- Breadcrumb bar at the top showing the path (repo > folder > ...); clicking an entry returns to that level.
- A tooltip/inspect panel (bottom-left) showing hovered tile type, node name, kind and size.
- On load, fetch `public/demo/mock.json` and show the root level.

## 7. Done when
- `npm run dev` shows the mock repo as islands in an ocean; pan, zoom and hover work.
- Clicking an island dives into it and regenerates a new grid; the breadcrumb returns to the parent.
- `npm test` passes.
- `npm run build` succeeds.

Run the dev server, check it visually in the browser (take a screenshot), and fix any visible problems (inverted depth order, off-centre grid, picking offset) before finishing. Do not commit; just report what you built and anything you were unsure about.
