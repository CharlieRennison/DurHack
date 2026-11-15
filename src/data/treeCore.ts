/**
 * Browser-safe tree builder shared by the Node CLI (buildTree.ts) and the live GitHub loader (live.ts).
 * Pure: no fs, no network, no randomness. The same entries always give the same RepoNode tree.
 *
 * Mapping (see HANDOFF.md): root = folder id "root" path ""; directory = folder (id = path);
 * file = file (id = path); function = function (id = "<file>#<name>").
 * Children sorted by size desc then name asc.
 */
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

/** One file. `size` becomes the file node's size (a line count, min 1). Byte-size and binary checks happen in the caller. */
export interface Entry {
  path: string;
  size: number;
  content?: string;
}

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** size desc, then name asc (plain code-point order, so output never depends on locale). */
export function sortNodes(nodes: RepoNode[]): RepoNode[] {
  return nodes.sort((a, b) => b.size - a.size || cmpStr(a.name, b.name));
}

/** Keep (max - 1) nodes and merge the rest into one "(N more)" node. */
export function capChildren(children: RepoNode[], max: number, otherId: string, kind: RepoNode['kind']): RepoNode[] {
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

export function countLines(text: string): number {
  if (text.length === 0) return 1;
  let n = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  if (text.charCodeAt(text.length - 1) === 10) n--; // trailing newline does not start a new line
  return Math.max(1, n);
}

export function isIgnoredFile(name: string): boolean {
  if (IGNORE.files.has(name)) return true;
  if (IGNORE.extensions.has(extOf(name))) return true;
  return IGNORE.namePatterns.some((re) => re.test(name));
}

/** Function nodes for one file (same ids, sizes, sort and cap as the CLI). Empty for unparseable files. */
export function functionNodes(rel: string, name: string, text: string): RepoNode[] {
  if (!isParseable(name)) return [];
  const parsed = parseFunctions(text, name);
  // A name that repeats in the file gets ":startLine" on every occurrence so ids stay unique.
  const seen = new Map<string, number>();
  for (const f of parsed) seen.set(f.name, (seen.get(f.name) ?? 0) + 1);
  let children: RepoNode[] = parsed.map((f) => {
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
  return children;
}

interface Dir {
  dirs: Map<string, Dir>;
  files: Map<string, Entry>;
}
const newDir = (): Dir => ({ dirs: new Map(), files: new Map() });

function buildFile(entry: Entry, name: string, stats: BuildStats): RepoNode {
  const children = entry.content !== undefined ? functionNodes(entry.path, name, entry.content) : [];
  stats.files++;
  stats.functions += children.length;
  return { id: entry.path, kind: 'file', name, path: entry.path, size: Math.max(1, entry.size), children };
}

function buildDir(dir: Dir, rel: string, name: string, stats: BuildStats): RepoNode | null {
  let children: RepoNode[] = [];
  for (const [childName, sub] of dir.dirs) {
    const childRel = rel === '' ? childName : `${rel}/${childName}`;
    const built = buildDir(sub, childRel, childName, stats);
    if (built) children.push(built);
  }
  for (const [childName, entry] of dir.files) children.push(buildFile(entry, childName, stats));
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

/** Build the RepoNode tree from a flat list of files (paths are "/"-separated, relative to the root). */
export function buildFromEntries(entries: Entry[], rootName = 'root'): BuildResult {
  const stats: BuildStats = { nodes: 0, files: 0, functions: 0, skippedFiles: 0 };
  const top = newDir();
  for (const entry of entries) {
    const parts = entry.path.split('/');
    const file = parts.pop()!;
    if (parts.some((p) => IGNORE.dirs.has(p))) continue;
    if (isIgnoredFile(file)) {
      stats.skippedFiles++;
      continue;
    }
    let dir = top;
    for (const p of parts) {
      let next = dir.dirs.get(p);
      if (!next) dir.dirs.set(p, (next = newDir()));
      dir = next;
    }
    dir.files.set(file, entry);
  }
  const built = buildDir(top, '', rootName, stats);
  const root: RepoNode = built ?? { id: 'root', kind: 'folder', name: rootName, path: '', size: 1, children: [] };
  stats.nodes = countNodes(root);
  return { root, stats };
}
