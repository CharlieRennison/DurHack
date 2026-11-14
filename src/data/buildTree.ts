/**
 * Node-only: walk a directory on disk and build the RepoNode tree. Never import this from browser code.
 *
 * Mapping (see HANDOFF.md): root = folder id "root" path ""; directory = folder (id = path);
 * file = file (size = line count, min 1); function = function (id = "<file>#<name>").
 * Children sorted by size desc then name asc. Deterministic: no timestamps, no randomness.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { RepoNode } from '../types';
import { IGNORE } from './ignore';
import { extOf, isParseable, parseFunctions } from './parseFunctions';

export interface BuildStats {
  nodes: number;
  files: number;
  functions: number;
  skippedFiles: number;
}

export interface BuildResult {
  root: RepoNode;
  stats: BuildStats;
}

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** size desc, then name asc (plain code-point order, so output never depends on locale). */
export function sortNodes(nodes: RepoNode[]): RepoNode[] {
  return nodes.sort((a, b) => b.size - a.size || cmpStr(a.name, b.name));
}

/** Keep (max - 1) nodes and merge the rest into one "(N more)" node. */
function capChildren(children: RepoNode[], max: number, otherId: string, kind: RepoNode['kind']): RepoNode[] {
  if (children.length <= max) return children;
  const kept = children.slice(0, max - 1);
  const rest = children.slice(max - 1);
  kept.push({
    id: otherId,
    kind,
    name: `(${rest.length} more)`,
    path: otherId,
    size: rest.reduce((a, c) => a + c.size, 0),
    children: [],
  });
  return kept;
}

function countLines(text: string): number {
  if (text.length === 0) return 1;
  let n = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  if (text.charCodeAt(text.length - 1) === 10) n--; // trailing newline does not start a new line
  return Math.max(1, n);
}

function isIgnoredFile(name: string): boolean {
  if (IGNORE.files.has(name)) return true;
  if (IGNORE.extensions.has(extOf(name))) return true;
  return IGNORE.namePatterns.some((re) => re.test(name));
}

function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function buildFile(abs: string, rel: string, name: string, stats: BuildStats): RepoNode | null {
  let st;
  try {
    st = statSync(abs);
  } catch {
    stats.skippedFiles++;
    return null;
  }
  if (!st.isFile() || st.size > IGNORE.maxFileBytes) {
    stats.skippedFiles++;
    return null;
  }
  const buf = readFileSync(abs);
  if (looksBinary(buf)) {
    stats.skippedFiles++;
    return null;
  }
  const text = buf.toString('utf8');
  const lines = countLines(text);

  let children: RepoNode[] = [];
  if (isParseable(name)) {
    const parsed = parseFunctions(text, name);
    // A name that repeats in the file gets ":startLine" on every occurrence so ids stay unique.
    const seen = new Map<string, number>();
    for (const f of parsed) seen.set(f.name, (seen.get(f.name) ?? 0) + 1);
    children = parsed.map((f) => {
      const suffix = (seen.get(f.name) ?? 0) > 1 ? `:${f.startLine}` : '';
      const id = `${rel}#${f.name}${suffix}`;
      return {
        id,
        kind: 'function' as const,
        name: f.name,
        path: id,
        size: Math.max(1, f.endLine - f.startLine + 1),
        children: [],
      };
    });
    sortNodes(children);
    children = capChildren(children, IGNORE.maxFunctions, `${rel}#__other__`, 'function');
  }
  stats.files++;
  stats.functions += children.length;
  return { id: rel, kind: 'file', name, path: rel, size: lines, children };
}

function buildDir(abs: string, rel: string, name: string, stats: BuildStats): RepoNode | null {
  let entries;
  try {
    entries = readdirSync(abs, { withFileTypes: true });
  } catch {
    return null;
  }
  entries.sort((a, b) => cmpStr(a.name, b.name));

  let children: RepoNode[] = [];
  for (const e of entries) {
    const childRel = rel === '' ? e.name : `${rel}/${e.name}`;
    const childAbs = join(abs, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) {
      if (IGNORE.dirs.has(e.name)) continue;
      const sub = buildDir(childAbs, childRel, e.name, stats);
      if (sub) children.push(sub);
    } else if (e.isFile()) {
      if (isIgnoredFile(e.name)) {
        stats.skippedFiles++;
        continue;
      }
      const f = buildFile(childAbs, childRel, e.name, stats);
      if (f) children.push(f);
    }
  }
  if (children.length === 0) return null; // empty (or fully ignored) directories do not exist in the world

  sortNodes(children);
  children = capChildren(children, IGNORE.maxChildren, rel === '' ? '__other__' : `${rel}/__other__`, 'file');

  // Collapse single-child folder chains: a/b/c becomes one node named "a/b/c" (never the root).
  if (rel !== '' && children.length === 1 && children[0].kind === 'folder') {
    const only = children[0];
    return { ...only, name: `${name}/${only.name}` };
  }
  return {
    id: rel === '' ? 'root' : rel,
    kind: 'folder',
    name,
    path: rel,
    size: children.reduce((a, c) => a + c.size, 0),
    children,
  };
}

function countNodes(n: RepoNode): number {
  return 1 + n.children.reduce((a, c) => a + countNodes(c), 0);
}

export function buildTree(rootDir: string, rootName = 'root'): BuildResult {
  const stats: BuildStats = { nodes: 0, files: 0, functions: 0, skippedFiles: 0 };
  const built = buildDir(rootDir, '', rootName, stats);
  const root: RepoNode = built ?? { id: 'root', kind: 'folder', name: rootName, path: '', size: 1, children: [] };
  stats.nodes = countNodes(root);
  return { root, stats };
}
