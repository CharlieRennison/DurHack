# Data layer: transfer package

Output of following `HANDOFF.md`. Nothing here is committed. Built and tested in a copy of the repo, then verified by applying it to a fresh clone of `main` at commit `1d605b9` (patches apply, 19 tests pass, `npm run build` passes).

## What is in this folder

| Path | What |
|---|---|
| `src/data/` | The data layer: `ignore.ts`, `parseFunctions.ts`, `buildTree.ts` (Node-only), `cli/fetch-repo.ts` (Node-only), `manifest.ts`, `index.ts` (browser-safe), `data.test.ts`, `README.md` |
| `public/demo/` | `manifest.json` + three generated repos: `sindresorhus__is` (small), `pallets__flask` (medium, **default**), `facebook__react` (large). `mock.json` is left alone and stays the fallback |
| `patches/` | `package.json.patch`, `tsconfig.json.patch`, `gitignore.patch`, `main.ts.patch` (all against `main` @ `1d605b9`) |

## How to apply (from the repo root, on a clean `main`)

```bash
git pull
git apply handoff-output/TRANSFER/patches/package.json.patch
git apply handoff-output/TRANSFER/patches/tsconfig.json.patch
git apply handoff-output/TRANSFER/patches/gitignore.patch
git apply handoff-output/TRANSFER/patches/main.ts.patch   # touches src/main.ts; see "main.ts" below
cp -r handoff-output/TRANSFER/src/data/. src/data/
cp -r handoff-output/TRANSFER/public/demo/. public/demo/
npm install            # adds tsx and @types/node (the only two new dependencies)
npm test && npm run build
```

(Adjust the paths to wherever you put this folder.)

## Done-when checklist

| Item | Result |
|---|---|
| `npm run fetch-repo -- <url>` writes valid JSON and a manifest entry, no network after the clone | Done |
| Same commit twice gives identical JSON | Done: ran it twice on `YusufAbbas10/DurHack` @ `1d605b9`, `cmp` says byte-identical |
| JSON loads in the app and renders | Done: Flask renders as islands; zooming in shows `src/flask` etc. (checked in the browser) |
| `npm test` and `npm run build` pass | Done (23 tests in the workspace; 19 on a clean `main` which has fewer layout tests) |
| Three demo repos in `public/demo/` | Done |

Demo repos (all permissively licensed: MIT, BSD-3, MIT):

| Repo | Commit | Nodes | Files | Functions | JSON size |
|---|---|---|---|---|---|
| sindresorhus/is | `e9c026c` | 158 | 18 | 135 | 40 KB |
| pallets/flask | `49943b5` | 1,180 | 227 | 906 | 360 KB |
| facebook/react | `df6aa4e` | 22,567 | 7,092 | 19,406 | 10 MB |

Checked on all three: no duplicate ids, every folder's size equals the sum of its children, the 100-children and 200-functions caps fire (React has 10 `(N more)` nodes, max 200 children). The CLI printed the over-20,000-nodes warning for React, as specified. React still loads and parses in about 200 ms in the browser, but it is large for a live demo; Flask is the default. A first attempt at Django (35,205 nodes, 14 MB) was dropped as too heavy.

## What changed vs the plan in HANDOFF.md

- **The files the handoff described did not exist in the repo** (`src/data/` held only a README), so they were written from the spec rather than debugged. Their tests passed first time, so I checked the real output instead (class methods, nested functions, sizes) and it looked right.
- `types.ts` was checked: `RepoNode` matches the contract exactly, no extra fields.
- Node 22.14 is fine for Vitest 5.1. TypeScript 7.0.2 raised no config problems.
- `ManifestEntry` is now a proper type in `src/data/manifest.ts`, shared by the CLI and the browser loader (types only, so no Node code reaches the browser).
- The CLI takes extra flags: `--ref <branch|tag>`, `--out <dir>`, `--default` (marks the repo the app opens first).

## main.ts

`patches/main.ts.patch` is the minimal wiring: use `loadDefaultRoot()` and `indexNodes(root)` in place of the hard-coded `fetch('/demo/mock.json')` and the hand-rolled index. It is two hunks, and `main.ts` is not in the data folder, so check with its owner before applying. If someone has since rewritten `main.ts` (for example for continuous zoom), just make the same two changes by hand.

## Open questions for other owners

1. **Layout owner:** the `(N more)` node for folders is `kind: 'file'` with id `<folder>/__other__` (root: `__other__`), `children: []`. For functions it is `kind: 'function'` with id `<file>#__other__`. The spec only fixed the folder case; confirm the function one is right.
2. **Layout owner:** very uneven sizes (one huge file next to tiny ones) were not tuned for. Files with functions currently render as small islands containing specks; villages and houses are not drawn yet.
3. Root `id` is `"root"` with `path` `""`, so `layoutNode` seeds from an empty string at the top level. That is deterministic, just identical for every repo.

## Known limits of the parser

Regex, not a real parser. Misses: class-property arrow functions, multi-line strings or docstrings containing `def` or `function`, regex literals containing braces, object-literal methods. Nested functions are folded into their parent by design. Fine for demos; move to `web-tree-sitter` only if a demo repo clearly breaks.

## Not done

Live mode (paste any repo URL in the app, Git Trees API) is the stretch goal and was not started, as the handoff says.
