# How GitHub repos work with this project

This is the spec for the **data layer** (`src/data/`): how a GitHub repo becomes the `RepoNode` tree that `layoutNode` consumes. Read `CLAUDE.md` and `src/types.ts` first. The data owner edits only `src/data/` and `public/demo/`.

## Principles

1. **The demo never depends on the network.** Repos are converted ahead of time to JSON in `public/demo/`. GitHub's rate limits (60 requests/hour unauthenticated) and venue wifi must not be able to break the demo.
2. **Output is exactly `RepoNode`.** Do not change the contract. Extra metadata (owner, commit) goes in a separate manifest, not in the tree.
3. **Deterministic.** The same repo at the same commit always produces byte-identical JSON: children sorted, ids derived from paths, no timestamps in the tree.
4. **Lazy where possible.** The world is generated lazily per node, so function parsing can be lazy too (see Live mode).

## Two modes

### Mode 1: pre-generated (required, used for the demo)

A Node CLI turns a repo into a JSON file.

```
npm run fetch-repo -- https://github.com/owner/repo [--ref main] [--out public/demo]
```

Steps:

1. Parse the URL into `owner`, `repo`, optional `ref`.
2. `git clone --depth 1 [--branch <ref>]` into a temp directory (use the system `git`; no GitHub API needed, so no rate limit). Record the commit SHA with `git rev-parse HEAD`.
3. Walk the working tree, applying the ignore rules below.
4. Build the `RepoNode` tree (rules below), parsing functions from supported languages.
5. Write `public/demo/<owner>__<repo>.json` (the root `RepoNode`) and update `public/demo/manifest.json`.
6. Delete the temp clone.

Put the CLI in `src/data/cli/` (Node-only; never imported by browser code) and add the `fetch-repo` script to `package.json`.

### Mode 2: live from GitHub (stretch goal)

Lets a user paste any public repo URL in the app.

- Use one call to the Git Trees API (`GET /repos/{owner}/{repo}/git/trees/{ref}?recursive=1`) to get every path and file size in a single request. Build folders and files from that, with `size` = bytes (as a stand-in for lines).
- **Do not fetch file contents up front.** Function nodes are fetched **lazily**: when the user enters a file's village, fetch that file from `raw.githubusercontent.com`, parse it, and return its function children. This matches the lazy-zoom design and keeps requests low.
- Handle the rate limit: show a clear message, cache every response in memory and `localStorage`, and support an optional token in a local `.env` (`VITE_GITHUB_TOKEN`). Never commit a token and never log it.
- If the tree response has `truncated: true`, show a warning and fall back to the top levels only.
- Always keep Mode 1 as the fallback: if live mode fails, the app still works from `public/demo/`.

## Mapping a repo to `RepoNode`

| Repo thing | `kind` | `name` | `path` | `id` | `size` |
|---|---|---|---|---|---|
| Repo root | `folder` | repo name | `""` (empty) | `"root"` | sum of children |
| Directory | `folder` | directory name | `src/data` | same as `path` | sum of children |
| File | `file` | file name | `src/data/index.ts` | same as `path` | line count (bytes in live mode) |
| Function | `function` | function name | `src/data/index.ts#parseTree` | same as `path` | line count of the function |

Rules:

- **`id` is the `path`**, so it is stable across runs. If two functions in one file share a name, append the start line: `file.ts#handler:42`.
- **Children are sorted**: by `size` descending, then `name` ascending. This is required for determinism.
- **File size = number of lines** (count `\n`, minimum 1). Bytes are only used in live mode before contents are loaded.
- **Folder size = sum of descendants' file sizes.** A folder with no usable files is dropped.
- **Files with no parseable functions** (or unsupported languages) are leaf `file` nodes with an empty `children` array. The layout renders them as a village with a single generic house.
- **Collapse single-child folder chains** (`src/main/java/com/acme` with one child at each level becomes one node named `src/main/java/com/acme`). This stops boilerplate nesting from turning real projects into coral. Collapsed folders keep the full path as `path`.

## Ignore rules (skip entirely)

Directories: `.git`, `node_modules`, `dist`, `build`, `out`, `target`, `.next`, `.venv`, `venv`, `__pycache__`, `vendor`, `coverage`, `.idea`, `.vscode`.

Files: lockfiles (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `Cargo.lock`, `poetry.lock`), minified files (`*.min.js`, `*.map`), binaries and media (images, fonts, archives, `.exe`, `.dll`, `.pdf`, `.mp4` and similar), and any file over 1 MB or any file that fails a binary check (contains a NUL byte in the first 8 KB). Skip symlinks.

Put these in one config object (`src/data/ignore.ts`) so they are easy to tune per repo.

## Caps (keep the world readable)

- **More than 100 children** in one folder: keep the 99 largest and merge the rest into one extra node named `(N more)`, `kind: 'file'`, `id` `<parent path>/__other__`, `size` = their combined size, no children.
- **More than 200 functions** in one file: keep the 199 largest and merge the rest the same way.
- **Depth** is not capped in the data layer. Layout turns anything deeper than `MAX_ISLAND_DEPTH` into coral.
- A repo that still produces more than about 20,000 nodes should log a warning when generating the demo file, so the team can choose a smaller repo or tighten the ignores.

## Function parsing

- **Supported at first: Python (`.py`) and JS/TS (`.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`).** Everything else is a leaf file.
- Prefer `web-tree-sitter` (WASM) with the two grammars for accuracy. If setup costs more than about an hour, use regexes instead, with the accuracy trade-off accepted for a hackathon:
  - Python: `^\s*(async\s+)?def\s+(\w+)`; function ends at the next line with equal-or-lower indentation.
  - JS/TS: `function name(`, `name = (...) =>` / `name = function`, class methods `name(...) {`; function ends at the matching closing brace.
- Include methods (named `Class.method`) and top-level functions. Skip anonymous callbacks.
- `size` is the line count of the function body. If an end cannot be found, use 1.
- Nested functions are not separate nodes; they count towards their parent.
- A parse failure in one file must never fail the run. Log it and treat the file as a leaf.

## Output files

`public/demo/<owner>__<repo>.json`: the root `RepoNode` and nothing else.

`public/demo/manifest.json`: the index the UI reads to list available repos.

```json
{
  "repos": [
    {
      "id": "yusufabbas10__durhack",
      "owner": "YusufAbbas10",
      "repo": "DurHack",
      "url": "https://github.com/YusufAbbas10/DurHack",
      "ref": "main",
      "commit": "<full sha>",
      "file": "yusufabbas10__durhack.json",
      "nodeCount": 123,
      "generatedAt": "2026-11-14T12:00:00Z"
    }
  ]
}
```

`generatedAt` lives only in the manifest, never in the tree.

## How the app uses it

1. On load, fetch `manifest.json` and show the repos in a picker (the repo input UI is owned by `src/ui/`).
2. Fetch the chosen repo's JSON file and pass the root `RepoNode` to the renderer.
3. Entering a tile with a `nodeId` looks the node up by `id` (build a `Map<string, RepoNode>` once after loading) and calls `layoutNode(child, depth + 1)`.

Expose a small API from `src/data/index.ts` for the UI and renderer to use:

```ts
export async function loadManifest(): Promise<ManifestEntry[]>;
export async function loadRepo(entry: ManifestEntry): Promise<RepoNode>;
export function indexNodes(root: RepoNode): Map<string, RepoNode>;
// Live mode only:
export async function loadRepoLive(url: string): Promise<RepoNode>;
export async function loadFunctions(repoUrl: string, ref: string, fileNode: RepoNode): Promise<RepoNode[]>;
```

## Choosing demo repos

Generate at least three, and commit them:

1. **Small** (about 20-50 files): this project's own repo, to prove the idea quickly.
2. **Medium** (a few hundred files, Python or TS): shows multiple islands, subfolders and coral. A well-known small library works well.
3. **Large** (thousands of files): proves the caps and the "(N more)" grouping work and the app stays fast. Pick one that parses in under about a minute.

Prefer permissively licensed, public repos and make sure each looks good on screen before the demo.

## Tests

In `src/data/*.test.ts`, with a small fixture directory under `src/data/fixtures/`:

- Mapping: file, folder and function nodes get the right `kind`, `path`, `id` and `size`.
- Sorting and determinism: building twice gives identical JSON.
- Ignore rules: `node_modules`, lockfiles and binaries are excluded.
- Caps: 150 children produce 99 + one `(N more)` node whose size is the sum of the rest.
- Single-child chain collapsing.
- Function parsing: a Python and a TS fixture with known function names and line counts, including a duplicate name.

## Done when

- `npm run fetch-repo -- <url>` produces a valid JSON file and manifest entry for a real repo, with no network use after the clone.
- The generated JSON loads in the app and renders islands, villages and houses.
- Running the command twice on the same commit gives identical JSON.
- `npm test` and `npm run build` pass.
- The three demo repos are committed in `public/demo/`.
