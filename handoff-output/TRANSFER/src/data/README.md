Data: turns a GitHub repo into the `RepoNode` tree the rest of the app loads.

- `buildTree.ts`, `cli/fetch-repo.ts`, `ignore.ts`: Node-only. `npm run fetch-repo -- <github-url>` clones shallowly, builds the tree and writes `public/demo/<owner>__<repo>.json` plus `manifest.json`.
- `parseFunctions.ts`: regex function finder for Python and JS/TS (pure, never throws).
- `index.ts`, `manifest.ts`: browser-safe. `loadDefaultRoot()`, `loadManifest()`, `loadRepo()`, `indexNodes()`.
- Never import `buildTree.ts` or `cli/` from browser code.
