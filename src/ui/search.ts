import type { RepoNode } from '../types';
import { buildIndex, searchIndex, type SearchEntry } from '../render/search';

/**
 * The search box (top right, beside the settings button). Type part of a folder or file name, pick a result (click, or
 * arrow keys and Enter) and `onPick` flies the camera there. "/" or Ctrl/Cmd+K focuses the box from anywhere; Esc closes it.
 * It builds its own DOM and styles so nothing else in the page has to change.
 */
export interface SearchBox {
  /** Re-index when a different repository is shown. */
  setRoot(root: RepoNode | null): void;
}

const CSS = `
#search { position: absolute; top: 12px; right: 56px; width: 240px; pointer-events: auto; font: 14px system-ui, sans-serif; }
#search input {
  width: 100%; box-sizing: border-box; background: rgba(10, 20, 35, 0.8); color: #fff; border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 6px; padding: 6px 10px; font: 14px system-ui, sans-serif; outline: none;
}
#search input:focus { border-color: #8fd0ff; }
#search input::placeholder { color: rgba(255, 255, 255, 0.55); }
#search-results {
  margin-top: 4px; background: rgba(10, 20, 35, 0.94); border-radius: 6px; overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.18); max-height: 60vh; overflow-y: auto;
}
#search-results[hidden] { display: none; }
#search-results button {
  display: flex; gap: 8px; align-items: baseline; width: 100%; text-align: left; background: none; border: none; color: #fff;
  padding: 7px 10px; cursor: pointer; font: 13px system-ui, sans-serif;
}
#search-results button.active, #search-results button:hover { background: rgba(143, 208, 255, 0.18); }
#search-results .name { font-weight: 600; white-space: nowrap; }
#search-results .path { opacity: 0.55; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }
#search-results .none { padding: 8px 10px; opacity: 0.6; font-size: 13px; }
`;

export function mountSearch(onPick: (entry: SearchEntry) => void): SearchBox {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const wrap = document.createElement('div');
  wrap.id = 'search';
  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = 'Search files and folders  ( / )';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', 'Search files and folders');
  const list = document.createElement('div');
  list.id = 'search-results';
  list.hidden = true;
  list.setAttribute('role', 'listbox');
  wrap.append(input, list);
  (document.getElementById('overlay') ?? document.body).appendChild(wrap);

  let index: SearchEntry[] = [];
  let results: SearchEntry[] = [];
  let active = 0;

  const close = () => {
    list.hidden = true;
  };
  const pick = (e: SearchEntry) => {
    close();
    input.blur();
    input.value = '';
    onPick(e);
  };
  const render = () => {
    list.replaceChildren();
    if (!input.value.trim()) return close();
    list.hidden = false;
    if (results.length === 0) {
      const none = document.createElement('div');
      none.className = 'none';
      none.textContent = 'Nothing found';
      list.appendChild(none);
      return;
    }
    results.forEach((e, k) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'option');
      if (k === active) b.className = 'active';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = (e.kind === 'folder' ? '\u{1F4C1} ' : '\u{1F4C4} ') + e.name;
      const path = document.createElement('span');
      path.className = 'path';
      path.textContent = e.path.includes('/') ? e.path.slice(0, e.path.lastIndexOf('/')) : '';
      b.append(name, path);
      b.onmousedown = (ev) => ev.preventDefault(); // keep focus in the box until the click lands
      b.onclick = () => pick(e);
      b.onmouseenter = () => {
        active = k;
        list.querySelectorAll('button').forEach((x, i) => x.classList.toggle('active', i === k));
      };
      list.appendChild(b);
    });
  };

  input.oninput = () => {
    results = searchIndex(index, input.value);
    active = 0;
    render();
  };
  input.onfocus = () => {
    if (input.value.trim()) render();
  };
  input.onkeydown = (ev) => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (results.length) {
        active = (active + (ev.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
        render();
        list.querySelector('button.active')?.scrollIntoView({ block: 'nearest' });
      }
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      if (results[active]) pick(results[active]);
    } else if (ev.key === 'Escape') {
      input.value = '';
      close();
      input.blur();
    }
  };
  input.onblur = () => window.setTimeout(close, 120);
  document.addEventListener('keydown', (ev) => {
    const typing = ev.target instanceof HTMLElement && /^(input|textarea|select)$/i.test(ev.target.tagName);
    if ((ev.key === '/' && !typing) || ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k')) {
      ev.preventDefault();
      input.focus();
      input.select();
    }
  });

  return {
    setRoot(root) {
      index = root ? buildIndex(root) : [];
      results = searchIndex(index, input.value);
      active = 0;
      if (!list.hidden) render();
    },
  };
}
