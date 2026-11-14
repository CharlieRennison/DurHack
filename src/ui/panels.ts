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

/** Time left until the next local midnight, as HH:MM:SS. Exported for testing. */
export function untilMidnight(now: Date): string {
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const total = Math.max(0, Math.round((midnight.getTime() - now.getTime()) / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

/** Live "pizza at midnight" countdown, updated every second. */
export function startPizzaCountdown(el: HTMLElement): void {
  const tick = () => {
    const now = new Date();
    // The first 10 minutes after midnight: pizza is here.
    el.textContent = now.getHours() === 0 && now.getMinutes() < 10 ? '🍕 Pizza time!' : `🍕 Pizza in ${untilMidnight(now)}`;
  };
  tick();
  window.setInterval(tick, 1000);
}
