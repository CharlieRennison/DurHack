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

/** Breakfast time (local), as hour and minute. */
export const BREAKFAST = { hour: 9, minute: 30 };

/** Time left until the next local hour:minute (today if still ahead, else tomorrow), as HH:MM:SS. Exported for testing. */
export function untilTime(now: Date, hour: number, minute: number): string {
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  if (target.getTime() < now.getTime()) target.setDate(target.getDate() + 1);
  const total = Math.max(0, Math.round((target.getTime() - now.getTime()) / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

/** Live "breakfast at 9:30" countdown, updated every second. */
export function startBreakfastCountdown(el: HTMLElement): void {
  const tick = () => {
    const now = new Date();
    const mins = now.getHours() * 60 + now.getMinutes() - (BREAKFAST.hour * 60 + BREAKFAST.minute);
    // The first 10 minutes after 9:30: breakfast is here.
    el.textContent = mins >= 0 && mins < 10 ? '🥐 Breakfast time!' : `🥐 Breakfast in ${untilTime(now, BREAKFAST.hour, BREAKFAST.minute)}`;
  };
  tick();
  window.setInterval(tick, 1000);
}

/** Status / error line under the top bar. Empty text hides it. */
export function renderLiveStatus(el: HTMLElement, text: string, kind: 'info' | 'error' | 'warn' = 'info'): void {
  el.textContent = text;
  el.className = kind === 'info' ? '' : kind;
  el.hidden = text === '';
}
