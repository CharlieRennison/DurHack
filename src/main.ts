import { indexNodes, loadDefaultRoot, loadFunctions, loadManifest, loadRepo, loadRepoLive, type LiveMeta } from './data';
import { layoutNode } from './layout/layoutNode';
import { loadCollaborators, type RepoRef } from './render/collaborators';
import { loadImports } from './render/importsData';
import { Renderer } from './render/Renderer';
import { renderBreadcrumb, renderInspect, renderLiveStatus, startBreakfastCountdown } from './ui/panels';
import type { RepoNode } from './types';

/** Repos offered in the top-left switcher (others stay reachable with ?repo=<id>). */
const SWITCHER_REPOS = ['facebook__react', 'pallets__flask'];
const TOKEN_KEY = 'islands.ghToken';

/** `?gh=owner/repo[@ref][:sub/path]` -> input accepted by loadRepoLive. */
function ghParamToInput(param: string): string {
  const [head, ...rest] = param.split(':');
  const sub = rest.join(':');
  const at = head.indexOf('@');
  const slug = at < 0 ? head : head.slice(0, at);
  const ref = at < 0 ? '' : head.slice(at + 1);
  if (!ref && !sub) return slug;
  return `github.com/${slug}/tree/${ref || 'HEAD'}${sub ? `/${sub}` : ''}`;
}

function ghParamOf(meta: LiveMeta, explicitRef: boolean): string {
  return `${meta.owner}/${meta.repo}${explicitRef ? `@${meta.ref}` : ''}${meta.subPath ? `:${meta.subPath}` : ''}`;
}

function readToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}
function writeToken(value: string): void {
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage unavailable: the token just is not remembered
  }
}

async function main(): Promise<void> {
  // ?repo=<manifest id> picks a demo repo, e.g. ?repo=facebook__react; otherwise the manifest default.
  // ?gh=owner/repo loads a live GitHub repo instead; if that fails we fall back to the demo and show why.
  const manifest = await loadManifest();
  const params = new URLSearchParams(location.search);
  const wanted = params.get('repo');
  const entry = manifest.find((r) => r.id === wanted) ?? manifest.find((r) => r.default) ?? manifest[0];

  const liveStatus = document.getElementById('live-status')!;
  let root: RepoNode | null = null;
  let initialLive: { input: string; meta: LiveMeta; root: RepoNode; param: string } | null = null;
  let initialError = '';
  const ghParam = params.get('gh');
  if (ghParam) {
    const input = ghParamToInput(ghParam);
    try {
      const res = await loadRepoLive(input, { token: readToken() || undefined });
      initialLive = { input, meta: res.meta, root: res.root, param: ghParam };
      root = res.root;
    } catch (e) {
      initialError = e instanceof Error ? e.message : String(e);
    }
  }
  if (!root) root = entry ? await loadRepo(entry) : await loadDefaultRoot();
  let byId = indexNodes(root);

  const breadcrumb = document.getElementById('breadcrumb')!;
  const inspect = document.getElementById('inspect')!;
  startBreakfastCountdown(document.getElementById('pizza')!);
  const renderer = new Renderer();
  await renderer.init(document.getElementById('canvas-host')!);

  renderer.onLevelChange = (nodes) => renderBreadcrumb(breadcrumb, nodes, (i) => renderer.goTo(i));
  renderer.onHover = (info) => {
    const node = info?.tile.nodeId ? byId.get(info.tile.nodeId) ?? null : null;
    renderInspect(inspect, info?.tile ?? null, node);
  };

  // Live repos only fetched the file list; function nodes load lazily when a file comes into view.
  let currentMeta: LiveMeta | null = initialLive?.meta ?? null;
  renderer.loadChildren = async (node) => {
    if (!currentMeta) return false;
    const meta = currentMeta;
    const kids = await loadFunctions(meta, node);
    if (kids.length === 0 || meta !== currentMeta) return false;
    node.children = kids;
    kids.forEach((k) => byId.set(k.id, k));
    return true;
  };

  // The repository's collaborators walk its root island (their names come from GitHub's contributors list).
  let peopleToken = 0;
  const showPeople = (ref: RepoRef | null) => {
    const mine = ++peopleToken;
    renderer.setCollaborators([]);
    renderer.setImports([]);
    if (!ref) return;
    void loadCollaborators(ref, readToken() || undefined).then((names) => {
      if (mine === peopleToken) renderer.setCollaborators(names);
    });
    // which modules import which: boats sail between them
    void loadImports(ref).then((edges) => {
      if (mine === peopleToken) renderer.setImports(edges);
    });
  };

  const show = (next: RepoNode, meta: LiveMeta | null = null, ref: RepoRef | null = meta ? { owner: meta.owner, repo: meta.repo } : null) => {
    currentMeta = meta;
    byId = indexNodes(next);
    renderer.setRoot(next, layoutNode);
    showPeople(ref);
  };

  const describe = (meta: LiveMeta): void => {
    const where = `${meta.owner}/${meta.repo}${meta.subPath ? `/${meta.subPath}` : ''} @ ${meta.ref} (tree ${meta.commit.slice(0, 7)}, ${meta.fileCount} files)`;
    if (meta.truncated) renderLiveStatus(liveStatus, `${where}. Large repo: only part of it was loaded.`, 'warn');
    else renderLiveStatus(liveStatus, where);
  };

  // Repo switcher (top left): demo repos plus any live repos loaded this session.
  const select = document.getElementById('repo-select') as HTMLSelectElement;
  const choices = manifest.filter((r) => SWITCHER_REPOS.includes(r.id));
  const liveOptions = new Map<string, string>(); // option value -> loadRepoLive input
  for (const r of choices) {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.repo.charAt(0).toUpperCase() + r.repo.slice(1);
    select.appendChild(opt);
  }
  select.hidden = choices.length <= 1;
  select.value = entry?.id ?? '';

  const addLiveOption = (meta: LiveMeta, input: string): string => {
    const label = `${meta.owner}/${meta.repo}${meta.subPath ? `/${meta.subPath}` : ''}`;
    const value = `gh:${label}@${meta.ref}`;
    if (!liveOptions.has(value)) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      select.appendChild(opt);
      liveOptions.set(value, input);
    }
    select.hidden = false;
    select.value = value;
    return value;
  };

  const form = document.getElementById('gh-form') as HTMLFormElement;
  const input = document.getElementById('gh-input') as HTMLInputElement;
  const loadBtn = document.getElementById('gh-load') as HTMLButtonElement;
  const tokenInput = document.getElementById('gh-token') as HTMLInputElement;
  tokenInput.value = readToken();
  // Settings (top right): optional GitHub token, kept only in localStorage.
  const settingsBtn = document.getElementById('settings-btn') as HTMLButtonElement;
  const settingsPanel = document.getElementById('settings-panel')!;
  const tokenState = document.getElementById('gh-token-state')!;
  const showTokenState = () => (tokenState.textContent = readToken() ? 'Token saved' : '');
  const saveToken = () => {
    writeToken(tokenInput.value.trim());
    showTokenState();
  };
  const openSettings = (open: boolean) => {
    settingsPanel.hidden = !open;
    settingsBtn.setAttribute('aria-expanded', String(open));
    if (open) tokenInput.focus();
  };
  settingsBtn.onclick = () => openSettings(Boolean(settingsPanel.hidden));
  document.getElementById('gh-token-save')!.onclick = saveToken;
  document.getElementById('gh-token-clear')!.onclick = () => {
    tokenInput.value = '';
    saveToken();
  };
  tokenInput.onkeydown = (ev) => {
    if (ev.key === 'Enter') saveToken();
  };
  showTokenState();

  const setBusy = (busy: boolean) => {
    input.disabled = loadBtn.disabled = select.disabled = busy;
  };

  /** Load a live repo and show it. On failure the current world stays and the error is shown. */
  const loadLive = async (text: string): Promise<boolean> => {
    setBusy(true);
    try {
      const { root: next, meta } = await loadRepoLive(text, {
        token: readToken() || undefined,
        onStatus: (m) => renderLiveStatus(liveStatus, m),
      });
      show(next, meta);
      addLiveOption(meta, text);
      describe(meta);
      history.replaceState(null, '', `?gh=${ghParamOf(meta, /\/tree\//.test(text))}`);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      renderLiveStatus(liveStatus, msg, 'error');
      if (/token/i.test(msg)) openSettings(true); // GitHub says a token would help
      return false;
    } finally {
      setBusy(false);
    }
  };

  form.onsubmit = (ev) => {
    ev.preventDefault();
    const text = input.value.trim();
    if (text) void loadLive(text);
  };

  select.onchange = async () => {
    const live = liveOptions.get(select.value);
    if (live) {
      await loadLive(live); // cached after the first load
      return;
    }
    const next = choices.find((r) => r.id === select.value);
    if (!next) return;
    select.disabled = true;
    try {
      show(await loadRepo(next), null, { owner: next.owner, repo: next.repo, id: next.id });
      renderLiveStatus(liveStatus, '');
      history.replaceState(null, '', `?repo=${next.id}`);
    } finally {
      select.disabled = false;
    }
  };

  if (initialLive) {
    addLiveOption(initialLive.meta, initialLive.input);
    input.value = initialLive.input;
    describe(initialLive.meta);
  } else if (initialError) {
    renderLiveStatus(liveStatus, `${initialError} Showing the demo instead.`, 'error');
  }

  // Semantic zoom: scroll to zoom into islands; scroll out to return to the parent.
  renderer.setRoot(root, layoutNode);
  showPeople(initialLive ? { owner: initialLive.meta.owner, repo: initialLive.meta.repo } : entry ? { owner: entry.owner, repo: entry.repo, id: entry.id } : null);
}

main();
