import { indexNodes, loadDefaultRoot, loadManifest, loadRepo } from './data';
import { layoutNode } from './layout/layoutNode';
import { Renderer } from './render/Renderer';
import { renderBreadcrumb, renderInspect, startPizzaCountdown } from './ui/panels';

/** Repos offered in the top-left switcher (others stay reachable with ?repo=<id>). */
const SWITCHER_REPOS = ['facebook__react', 'pallets__flask'];

async function main(): Promise<void> {
  // ?repo=<manifest id> picks a demo repo, e.g. ?repo=facebook__react; otherwise the manifest default.
  const manifest = await loadManifest();
  const wanted = new URLSearchParams(location.search).get('repo');
  const entry = manifest.find((r) => r.id === wanted) ?? manifest.find((r) => r.default) ?? manifest[0];
  const root = entry ? await loadRepo(entry) : await loadDefaultRoot();
  let byId = indexNodes(root);

  const breadcrumb = document.getElementById('breadcrumb')!;
  const inspect = document.getElementById('inspect')!;
  startPizzaCountdown(document.getElementById('pizza')!);
  const renderer = new Renderer();
  await renderer.init(document.getElementById('canvas-host')!);

  renderer.onLevelChange = (nodes) => renderBreadcrumb(breadcrumb, nodes, (i) => renderer.goTo(i));
  renderer.onHover = (info) => {
    const node = info?.tile.nodeId ? byId.get(info.tile.nodeId) ?? null : null;
    renderInspect(inspect, info?.tile ?? null, node);
  };

  // Repo switcher (top left): one option per manifest entry.
  const select = document.getElementById('repo-select') as HTMLSelectElement;
  const choices = manifest.filter((r) => SWITCHER_REPOS.includes(r.id));
  if (choices.length > 1) {
    for (const r of choices) {
      const opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = r.repo.charAt(0).toUpperCase() + r.repo.slice(1);
      select.appendChild(opt);
    }
    select.value = entry?.id ?? '';
    select.onchange = async () => {
      const next = choices.find((r) => r.id === select.value);
      if (!next) return;
      select.disabled = true;
      try {
        const nextRoot = await loadRepo(next);
        byId = indexNodes(nextRoot);
        renderer.setRoot(nextRoot, layoutNode);
        history.replaceState(null, '', `?repo=${next.id}`);
      } finally {
        select.disabled = false;
      }
    };
  } else {
    select.hidden = true;
  }

  // Semantic zoom: scroll to zoom into islands; scroll out to return to the parent.
  renderer.setRoot(root, layoutNode);
}

main();
