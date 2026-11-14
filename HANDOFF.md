# Handoff: data layer for the island world

A brief for an AI session (e.g. Claude Code) with access to the repo. Read `CLAUDE.md` first, then `src/types.ts`, then this file. Do not commit; report what you did.

## The project in one paragraph

DurHack hackathon project (team of 4, ~18 hours). It visualises a GitHub repo as an isometric island world in PixiJS. Top-level folder = island, subfolder = smaller island (coral if deeper than `MAX_ISLAND_DEPTH`), file = village, function = house. Clicking a tile with a `nodeId` calls `layoutNode(child, depth + 1)` and shows that node's children. Stack: TypeScript, Vite, PixiJS v8, `simplex-noise`, Vitest.

## Your area

The **data layer**: `src/data/` and `public/demo/` only. Do not edit `src/layout/`, `src/render/`, `src/ui/` or `src/types.ts`. If a contract must change, report it and stop.

Goal: a repo becomes a `RepoNode` tree (JSON) that the rest of the app loads. The demo must never depend on the network, so repos are converted ahead of time by a Node CLI.

## Contract (confirm against `src/types.ts`, which is the source of truth)

```ts
type NodeKind = 'folder' | 'file' | 'function';
interface RepoNode { id: string; kind: NodeKind; name: string; path: string;
                     size: number; children: RepoNode[]; }
```

| Thing | kind | path / id | size |
|---|---|---|---|
| Root | folder | path `""`, id `"root"` | sum of children |
| Directory | folder | `src/data` (id = path) | sum of children |
| File | file | `src/data/index.ts` (id = path) | line count (min 1) |
| Function | function | `src/data/index.ts#name`, `:startLine` appended if the name repeats in the file | function line count |

Rules: children sorted by `size` desc then `name` asc; deterministic output (no timestamps in the tree); single-child folder chains collapsed; more than 100 children becomes 99 + one `(N more)` node; more than 200 functions per file becomes 199 + one `(N more)` node.

## What already exists (written but NOT yet run or tested)

All under `src/data/`:

| File | Purpose |
|---|---|
| `ignore.ts` | One config object: ignored dirs, files, extensions, name patterns, size limit, caps |
| `parseFunctions.ts` | Regex parser for Python and JS/TS. Methods named `Class.method`, nested functions folded into the parent, never throws |
| `buildTree.ts` | Node-only. Walks a directory and builds the `RepoNode` tree, applying ignore rules, sorting, caps and chain collapsing |
| `cli/fetch-repo.ts` | Node-only. `git clone --depth 1`, build tree, write `public/demo/<owner>__<repo>.json`, update `manifest.json`, delete the clone |
| `index.ts` | Browser-safe: `loadManifest`, `loadRepo`, `loadDefaultRoot` (falls back to `mock.json`), `indexNodes` |
| `data.test.ts` | Vitest: mapping, determinism, ignore rules, 150-children cap, chain collapsing, Python and TS parsing |

Also changed: `tsconfig.json` gets `"node"` added to `types`.

## Current repo state (from screenshots)

- `index.html` is in the project root with `#canvas-host`, `#overlay`, `#breadcrumb`, `#inspect`, and loads `/src/main.ts`.
- `package.json`: `"type": "module"`, scripts `dev`, `build` (`tsc --noEmit && vite build`), `test` (`vitest run`). Dependencies `pixi.js`, `simplex-noise`; dev `typescript ^7.0.2`, `vite ^8.3.8`, `vitest ^5.1.0`.
- **Missing and still to add:** `tsx` and `@types/node` (dev), and the `fetch-repo` script.
- `.gitignore` has only `node_modules` and `dist`.

## Tasks, in order

1. **Install and configure.** `npm i -D tsx @types/node`; add `"fetch-repo": "tsx src/data/cli/fetch-repo.ts"` to scripts; add `"node"` to `types` in `tsconfig.json`. Optionally add `.env.local` to `.gitignore`. These two dependencies are the only new ones, justified by the Node-only CLI.
2. **Run `npm test` and `npm run build`.** Fix any failures in `src/data/` only. The parser tests (line counts for the Python and TS cases) are the most likely to need adjusting; decide whether the code or the test expectation is wrong before changing either.
3. **Run the CLI** on this project's own repo: `npm run fetch-repo -- https://github.com/YusufAbbas10/DurHack`. Open the JSON and sanity-check it. Run it twice at the same commit and confirm the JSON is byte-identical.
4. **Wire the app.** In `src/main.ts` (check who owns it first), use `loadDefaultRoot()` and `indexNodes(root)`, and use the map to resolve `tile.nodeId` on click. Keep this change minimal.
5. **Generate the three demo repos** (small, medium of a few hundred files, large of thousands) and confirm the caps and the "(N more)" grouping work. Warn if a repo exceeds about 20,000 nodes. Prefer permissively licensed repos.
6. **Look at it.** Run `npm run dev` and check the real data renders as islands, villages and houses. Visual problems with very uneven sizes (one huge file next to tiny ones) should be reported to the layout owner rather than fixed in the data layer.

## Known risks and open questions

- **`src/types.ts` was never seen.** The code assumes the `RepoNode` shape above. Verify exact names and that no fields were added.
- **Node version.** Vitest 5.1 needs Node `^22.12 || ^24 || >=26`. Check `node -v`.
- **TypeScript 7.0.2** is a new major. If `tsc --noEmit` gives odd errors, suspect config or version first.
- **Cap node kind for functions.** The spec says "merge the rest the same way" for functions, but only states `kind: 'file'` for the folder cap. The code uses `kind: 'function'` for the function "(N more)" node, with id `<file>#__other__`. Confirm with the layout owner.
- **Manifest typing in `cli/fetch-repo.ts`.** The manifest array is loosely typed with a cast. Replace it with a proper `ManifestEntry` type, ideally shared from a Node-safe place, without importing `import.meta.env` code into the CLI.
- **Regex parser accuracy.** Known gaps: class property arrow functions, multi-line strings or docstrings containing `def`/`function`, braces in regex literals or block comments, return types containing `{`. Acceptable for a hackathon. Only move to `web-tree-sitter` if a demo repo clearly breaks.
- **Vite dev server quirk.** A missing file under `public/` can come back as `index.html` with status 200, so "file not found" shows up as a JSON parse error. `loadDefaultRoot` already handles this for the manifest.
- **Windows.** Deleting the temp clone can fail on read-only git files. The CLI retries with `maxRetries`.
- **Live mode** (paste any repo URL in the app, Git Trees API, lazy function fetch, `VITE_GITHUB_TOKEN`) is a stretch goal. Do not start it until everything above works.

## Rules that apply to everything

- Never call `Math.random()`. Data output must be deterministic.
- `buildTree.ts` and `cli/` are Node-only: never import them from browser code. Only `src/data/index.ts` is browser-safe.
- Keep dependencies minimal. No new ones beyond `tsx` and `@types/node` without a clear reason.
- Small commits if asked to commit, but by default do not commit.
- No cross-folder edits without telling the owner.

## Done when

- `npm run fetch-repo -- <url>` writes a valid JSON file and manifest entry for a real repo, with no network use after the clone.
- Running it twice on the same commit gives identical JSON.
- The generated JSON loads in the app and renders islands, villages and houses.
- `npm test` and `npm run build` pass.
- Three demo repos are present in `public/demo/`.

## Report back with

What you changed, what you ran and the results, anything in the contract that looked wrong, and anything you were unsure about.
