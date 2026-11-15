import type { RepoNode } from '../types';

/**
 * A folder's "sub folder depth": 0 if it holds only files (a village of houses), otherwise
 * 1 + the deepest sub-folder below it. Used to decide coral (>= MAX_ISLAND_DEPTH) vs island.
 */
const heights = new WeakMap<RepoNode, number>();
export function folderHeight(node: RepoNode): number {
  let h = heights.get(node);
  if (h === undefined) {
    h = 0;
    for (const c of node.children) {
      if (c.kind === 'folder') h = Math.max(h, 1 + folderHeight(c));
    }
    heights.set(node, h);
  }
  return h;
}

/** True when a folder has only files (or functions) in it: a village island full of houses. */
export function isVillage(node: RepoNode): boolean {
  return node.children.length > 0 && node.children.every((c) => c.kind !== 'folder');
}

/** Id suffix of the synthetic village that collects a mixed folder's loose files. */
export const LOOSE_FILES_SUFFIX = '#files';

const effective = new WeakMap<RepoNode, RepoNode[]>();
/**
 * The children the world actually shows for a node. A folder holding both sub-folders and loose
 * files shows its sub-folders plus ONE synthetic village island that collects the loose files, so
 * every group of houses lives on an island. Everything else is returned unchanged. Memoised, so
 * layout and renderer always see the same ids and objects.
 */
export function effectiveChildren(node: RepoNode): RepoNode[] {
  let out = effective.get(node);
  if (out) return out;
  const folders = node.children.filter((c) => c.kind === 'folder');
  const loose = node.children.filter((c) => c.kind !== 'folder');
  if (node.kind === 'folder' && folders.length > 0 && loose.length > 0) {
    const id = node.id + LOOSE_FILES_SUFFIX;
    const village: RepoNode = {
      id,
      kind: 'folder',
      name: node.name, // the home islet is named after its folder

      path: id,
      size: loose.reduce((a, c) => a + c.size, 0),
      children: loose,
    };
    out = [...folders, village];
  } else {
    out = node.children;
  }
  effective.set(node, out);
  return out;
}

/** Drop a node's memoised height and effective children after its `children` were replaced (lazy loading). */
export function forgetNode(node: RepoNode): void {
  heights.delete(node);
  effective.delete(node);
}
