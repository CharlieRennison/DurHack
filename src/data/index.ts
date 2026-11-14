/**
 * Browser-safe data API. Do not import buildTree.ts or cli/ from here (they use Node APIs).
 * Reads the pre-generated JSON in public/demo/; never touches the network beyond the app's own origin.
 */
import type { RepoNode } from '../types';
import type { Manifest, ManifestEntry } from './manifest';

export type { Manifest, ManifestEntry } from './manifest';

const DEMO_DIR = '/demo/';

/** Fetch JSON; resolves to null for 404s or HTML fallbacks (Vite serves index.html for missing public files). */
async function getJson<T>(file: string): Promise<T | null> {
  try {
    const res = await fetch(DEMO_DIR + file);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function loadManifest(): Promise<ManifestEntry[]> {
  const m = await getJson<Manifest>('manifest.json');
  return m && Array.isArray(m.repos) ? m.repos : [];
}

export async function loadRepo(entry: ManifestEntry | string): Promise<RepoNode> {
  const file = typeof entry === 'string' ? entry : entry.file;
  const node = await getJson<RepoNode>(file);
  if (!node) throw new Error(`Could not load demo repo ${file}`);
  return node;
}

/** The manifest's default repo (else its first), falling back to the hand-written mock.json. */
export async function loadDefaultRoot(): Promise<RepoNode> {
  const repos = await loadManifest();
  const entry = repos.find((r) => r.default) ?? repos[0];
  if (entry) {
    try {
      return await loadRepo(entry);
    } catch {
      // fall through to the mock
    }
  }
  return loadRepo('mock.json');
}

/** id -> node for every node in the tree. */
export function indexNodes(root: RepoNode): Map<string, RepoNode> {
  const map = new Map<string, RepoNode>();
  const walk = (n: RepoNode) => {
    map.set(n.id, n);
    n.children.forEach(walk);
  };
  walk(root);
  return map;
}
