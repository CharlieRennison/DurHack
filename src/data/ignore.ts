/**
 * Single source of truth for what the data layer skips and how large things may get.
 * Browser-safe (plain data), but only buildTree.ts consumes it.
 */
export const IGNORE = {
  /** Directory names skipped anywhere in the tree. */
  dirs: new Set([
    'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', 'target', 'vendor',
    '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox', '.venv', 'venv',
    '.next', '.nuxt', '.svelte-kit', '.turbo', '.parcel-cache', '.cache', 'coverage',
    '.idea', '.vscode', '.gradle', 'Pods', 'bower_components', '.terraform',
  ]),
  /** Exact file names skipped. */
  files: new Set([
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'Cargo.lock', 'poetry.lock',
    'Pipfile.lock', 'composer.lock', 'Gemfile.lock', 'go.sum', '.DS_Store', 'Thumbs.db',
  ]),
  /** Lower-case extensions (with dot) treated as binary or generated. */
  extensions: new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.avif', '.svg', '.psd',
    '.mp3', '.mp4', '.wav', '.ogg', '.mov', '.avi', '.webm', '.flac',
    '.zip', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.rar', '.jar', '.war',
    '.exe', '.dll', '.so', '.dylib', '.a', '.o', '.obj', '.class', '.pyc', '.pyo', '.wasm',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.ttf', '.otf', '.woff', '.woff2', '.eot',
    '.bin', '.dat', '.db', '.sqlite', '.lock', '.map', '.parquet', '.pkl', '.npy', '.onnx', '.pt', '.h5',
  ]),
  /** File name patterns skipped (minified or generated bundles). */
  namePatterns: [/\.min\.(js|css)$/i, /\.bundle\.js$/i, /\.d\.ts\.map$/i],
  /** Files larger than this are skipped (not read, not shown). */
  maxFileBytes: 1_000_000,
  /** More children than this in one folder: keep (max - 1) and group the rest into "(N more)". */
  maxChildren: 100,
  /** More functions than this in one file: keep (max - 1) and group the rest into "(N more)". */
  maxFunctions: 200,
  /** The CLI warns when a repo yields more nodes than this. */
  warnNodes: 20_000,
};

export const PARSEABLE_PY = new Set(['.py']);
export const PARSEABLE_JS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);
