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

export function renderInspect(el: HTMLElement, tile: Tile | null, node: RepoNode | null): void {
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
  line('Tile', tile.type);
  if (node) {
    line('Name', node.name);
    line('Kind', node.kind);
    line('Size', String(node.size));
  }
}
