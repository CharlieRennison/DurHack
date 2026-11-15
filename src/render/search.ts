/**
 * Search: find a folder or a file by name and say how to get there in the archipelago.
 *
 * Pure (no drawing): `buildIndex` lists every folder and file once, each with the chain of island ids to fly through
 * (the same ids the camera uses, including the "home islet" that holds a folder's loose files) and, for a file, which
 * house to go to. `searchIndex` ranks the entries for what the user typed. Functions are not searchable: files are the
 * deepest level there is.
 */
import type { RepoNode } from '../types';
import { effectiveChildren, LOOSE_FILES_SUFFIX } from '../layout/children';

export interface SearchEntry {
  id: string;
  name: string;
  /** The path shown to the user (the folder's or file's path; "" for the root). */
  path: string;
  kind: 'folder' | 'file';
  /** Island ids from below the root down to the island to go to (a folder's own island, or the village a file is in). */
  chain: string[];
  /** For a file: its id, the house to fly to inside that village. */
  target?: string;
  /** How many folders deep it is (for tie-breaking: higher up first). */
  depth: number;
  lowerName: string;
  lowerPath: string;
}

export const MAX_RESULTS = 8;

/** Every folder and file under `root`, once each, with the way there. The root itself is not listed. */
export function buildIndex(root: RepoNode): SearchEntry[] {
  const out: SearchEntry[] = [];
  const add = (n: RepoNode, kind: 'folder' | 'file', chain: string[], depth: number, target?: string) => {
    out.push({
      id: n.id,
      name: n.name,
      path: n.path,
      kind,
      chain,
      target,
      depth,
      lowerName: n.name.toLowerCase(),
      lowerPath: n.path.toLowerCase(),
    });
  };
  const walk = (node: RepoNode, chain: string[], depth: number) => {
    for (const c of effectiveChildren(node)) {
      if (c.kind === 'function') continue;
      if (c.id.endsWith(LOOSE_FILES_SUFFIX)) {
        // the home islet: its files are houses on it; the islet itself is not a separate thing to search for
        for (const f of c.children) if (f.kind === 'file') add(f, 'file', [...chain, c.id], depth, f.id);
      } else if (c.kind === 'folder') {
        add(c, 'folder', [...chain, c.id], depth + 1);
        walk(c, [...chain, c.id], depth + 1);
      } else if (c.kind === 'file') {
        add(c, 'file', chain, depth, c.id);
      }
    }
  };
  walk(root, [], 0);
  return out;
}

/** True if every character of `q` appears in `s` in order (a loose "fuzzy" match). */
export function isSubsequence(q: string, s: string): boolean {
  let i = 0;
  for (let k = 0; k < s.length && i < q.length; k++) if (s[k] === q[i]) i++;
  return i === q.length;
}

/** How well one token matches an entry (higher is better, 0 means no match). */
function scoreToken(e: SearchEntry, t: string): number {
  const name = e.lowerName;
  if (name === t) return 100;
  if (name.startsWith(t)) return 80;
  const stem = name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name;
  if (stem === t) return 90;
  // the start of a word inside the name (after - _ . space)
  if (new RegExp('(^|[-_. ])' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(name)) return 60;
  if (name.includes(t)) return 45;
  if (e.lowerPath.includes(t)) return 25;
  if (t.length >= 3 && isSubsequence(t, name)) return 12;
  return 0;
}

/**
 * The best matches for `query` (case-insensitive; several words must all match somewhere in the name or path), best
 * first, at most `limit`. A tie goes to the shallower and then the shorter path; folders before files.
 */
export function searchIndex(index: SearchEntry[], query: string, limit = MAX_RESULTS): SearchEntry[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const scored: { e: SearchEntry; score: number }[] = [];
  for (const e of index) {
    let total = 0;
    let ok = true;
    for (const t of tokens) {
      const s = scoreToken(e, t);
      if (s === 0) {
        ok = false;
        break;
      }
      total += s;
    }
    if (ok) scored.push({ e, score: total });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.e.depth - b.e.depth ||
      (a.e.kind === b.e.kind ? 0 : a.e.kind === 'folder' ? -1 : 1) ||
      a.e.path.length - b.e.path.length ||
      a.e.path.localeCompare(b.e.path),
  );
  return scored.slice(0, limit).map((s) => s.e);
}
