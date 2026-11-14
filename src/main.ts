import { layoutNode } from './layout/layoutNode';
import { Renderer } from './render/Renderer';
import { renderBreadcrumb, renderInspect } from './ui/panels';
import type { RepoNode } from './types';

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

  let stack: RepoNode[] = [root];

  const show = () => {
    const current = stack[stack.length - 1];
    renderer.setGrid(layoutNode(current, stack.length - 1));
    renderBreadcrumb(breadcrumb, stack, (i) => {
      stack = stack.slice(0, i + 1);
      show();
    });
  };

  renderer.onHover = (info) => {
    const node = info?.tile.nodeId ? byId.get(info.tile.nodeId) ?? null : null;
    renderInspect(inspect, info?.tile ?? null, node);
  };
  renderer.onTileClick = ({ tile }) => {
    const child = tile.nodeId ? byId.get(tile.nodeId) : undefined;
    if (!child || child.children.length === 0) return;
    stack.push(child);
    show();
  };

  show();
}

main();
