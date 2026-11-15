import { describe, expect, it } from 'vitest';
import type { RepoNode } from '../types';
import { hueOf, keyRows, languageCounts, languageOf, OTHER, recolourPixels } from './language';

const file = (name: string): RepoNode => ({ id: name, kind: 'file', name, path: name, size: 1, children: [] });

describe('languageOf', () => {
  it('goes by extension, ignoring case', () => {
    expect(languageOf('app.py').id).toBe('python');
    expect(languageOf('App.TSX').id).toBe('typescript');
    expect(languageOf('README.md').id).toBe('docs');
  });
  it('treats unknown, dotfiles and extensionless names as other', () => {
    expect(languageOf('Makefile')).toBe(OTHER);
    expect(languageOf('.gitignore')).toBe(OTHER);
    expect(languageOf('weird.zzz')).toBe(OTHER);
    expect(languageOf('trailing.')).toBe(OTHER);
  });
});

describe('languageCounts', () => {
  it('counts files across nested folders, most common first', () => {
    const root: RepoNode = {
      id: 'r', kind: 'folder', name: 'r', path: '', size: 3,
      children: [file('a.py'), { id: 'd', kind: 'folder', name: 'd', path: 'd', size: 2, children: [file('b.py'), file('c.js')] }],
    };
    const out = languageCounts(root).map((e) => [e.lang.id, e.count]);
    expect(out).toEqual([['python', 2], ['javascript', 1]]);
  });
});

describe('recolourPixels', () => {
  it('paints the lit wall exactly the colour and the shaded wall darker; leaves roofs and the rest alone', () => {
    const data = new Uint8ClampedArray([180, 146, 42, 255, 135, 105, 11, 255, 103, 83, 19, 255, 10, 20, 30, 0, 213, 121, 12, 255]);
    recolourPixels(data, 0x34c972);
    expect(Array.from(data.slice(0, 3))).toEqual([0x34, 0xc9, 0x72]); // lit wall is the colour itself
    expect(data[4] + data[5] + data[6]).toBeLessThan(data[0] + data[1] + data[2]); // shaded wall is darker
    expect(data[5]).toBeGreaterThan(data[4]); // ... but still the same green hue
    expect(Array.from(data.slice(8, 12))).toEqual([103, 83, 19, 255]); // roof
    expect(Array.from(data.slice(12, 16))).toEqual([10, 20, 30, 0]); // transparent
    expect(Array.from(data.slice(16, 20))).toEqual([213, 121, 12, 255]); // window
  });
  it('hueOf finds the hue of a colour', () => {
    expect(hueOf(0xff0000)).toBe(0);
    expect(hueOf(0x00ff00)).toBeCloseTo(1 / 3, 3);
  });
});

describe('keyRows', () => {
  it('always lists python and c/c++ (with 0 when absent) and adds other languages the repo has', () => {
    const root: RepoNode = { id: 'r', kind: 'folder', name: 'r', path: '', size: 2, children: [file('a.py'), file('b.go')] };
    const rows = keyRows(root);
    const ids = rows.map((r) => r.lang.id);
    expect(ids.slice(0, 8)).toEqual(['javascript', 'typescript', 'python', 'web', 'rust', 'c', 'docs', 'other']);
    expect(rows.find((r) => r.lang.id === 'python')!.count).toBe(1);
    expect(rows.find((r) => r.lang.id === 'c')!.count).toBe(0);
    expect(ids[ids.length - 1]).toBe('go');
  });
});
