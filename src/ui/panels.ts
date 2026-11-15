import type { RepoNode, Tile } from '../types';
import './style.css';

export function renderBreadcrumb(
  el: HTMLElement,
  stack: RepoNode[],
  onSelect: (index: number) => void,
): void {
  el.replaceChildren();
  stack.forEach((node, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'sep';
      sep.textContent = '>';
      el.appendChild(sep);
    }
    if (i === stack.length - 1) {
      const cur = document.createElement('span');
      cur.className = 'current';
      cur.textContent = node.name;
      el.appendChild(cur);
    } else {
      const b = document.createElement('button');
      b.textContent = node.name;
      b.onclick = () => onSelect(i);
      el.appendChild(b);
    }
  });
}

/** What a tile is, in words (not its raw type name). */
export function describeTile(tile: Tile, node: RepoNode | null, loose = false): string {
  if (loose) return 'Home islet (loose files)';
  if (node) return node.kind === 'file' ? 'House (file)' : tile.type === 'ocean' || tile.type === 'coral' ? 'Waters of a folder' : 'Island (folder)';
  switch (tile.type) {
    case 'ocean': return tile.variant === 0 ? 'Deep sea' : 'Shallows';
    case 'coast': return 'Shore';
    case 'port': return 'Harbour';
    case 'village': return tile.variant === 1 ? 'Plaza' : tile.variant === 2 ? 'Campfire' : 'Path';
    case 'house': return 'House';
    case 'tree': return 'Woodland';
    default: return 'Land';
  }
}

export function renderInspect(el: HTMLElement, tile: Tile | null, node: RepoNode | null, container: RepoNode | null = null, loose = false): void {
  el.replaceChildren();
  const line = (label: string, value: string) => {
    const d = document.createElement('div');
    const l = document.createElement('span');
    l.className = 'dim';
    l.textContent = label + ': ';
    d.append(l, document.createTextNode(value));
    el.appendChild(d);
  };
  if (!tile) {
    line('Hover', 'a tile');
    return;
  }
  line('Tile', describeTile(tile, node, loose));
  if (node && !loose) {
    line('Name', node.name);
    line('Size', `${node.size} ${node.kind === 'file' ? 'lines' : 'in total'}`);
  } else if (container) {
    line('In', container.path || container.name);
  }
}

/** Status / error line under the top bar. Empty text hides it. */
export function renderLiveStatus(el: HTMLElement, text: string, kind: 'info' | 'error' | 'warn' = 'info'): void {
  el.textContent = text;
  el.className = kind === 'info' ? '' : kind;
  el.hidden = text === '';
}
