import type { RepoNode } from '../types';
import { hex, keyRows } from '../render/language';

/** The language colour key: the fixed languages plus any others in the repo, each with its file count (dimmed when there are none). */
export function renderLegend(el: HTMLElement, root: RepoNode): void {
  el.replaceChildren();
  for (const { lang, count } of keyRows(root)) {
    const row = document.createElement('div');
    row.className = count === 0 ? 'row none' : 'row';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = hex(lang.color);
    const name = document.createElement('span');
    name.textContent = lang.label;
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = String(count);
    row.append(dot, name, n);
    el.appendChild(row);
  }
}
