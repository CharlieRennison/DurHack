import { layoutNode } from './layout/layoutNode';
import { Renderer } from './render/Renderer';
import { renderBreadcrumb, renderInspect } from './ui/panels';
import { MAX_ISLAND_DEPTH, type RepoNode } from './types';

async function main(): Promise<void> {
  const root: RepoNode = await (await fetch('/demo/mock.json')).json();
  const byId = new Map<string, RepoNode>();
  const index = (n: RepoNode) => {
    byId.set(n.id, n);
    n.children.forEach(index);
  };
  index(root);

  const breadcrumb = document.getElementById('breadcrumb')!;
  const inspect = document.getElementById('inspect')!;
  const renderer = new Renderer();
  await renderer.init(document.getElementById('canvas-host')!);

  renderer.onLevelChange = (nodes) => renderBreadcrumb(breadcrumb, nodes, (i) => renderer.goTo(i));
  renderer.onHover = (info) => {
    const node = info?.tile.nodeId ? byId.get(info.tile.nodeId) ?? null : null;
    renderInspect(inspect, info?.tile ?? null, node);
  };

  // Semantic zoom: scroll to zoom into islands; scroll out to return to the parent.
  renderer.setRoot(root, layoutNode);

  // Shortcut to the coral reef: the first folder deeper than MAX_ISLAND_DEPTH, whose children are all coral.
  const findReef = (n: RepoNode, path: string[]): string[] | null => {
    if (path.length === MAX_ISLAND_DEPTH + 1 && n.kind === 'folder' && n.children.length > 0) return path;
    for (const c of n.children) {
      const r = findReef(c, [...path, c.id]);
      if (r) return r;
    }
    return null;
  };
  const reef = findReef(root, []);
  const btn = document.getElementById('reef-btn') as HTMLButtonElement;
  if (reef) btn.onclick = () => renderer.focusPath(reef);
  else btn.hidden = true;
  if (new URLSearchParams(location.search).has('reef') && reef) renderer.focusPath(reef, true);
}

main();
