import { describe, expect, it } from 'vitest';
import type { RepoNode } from '../types';
import { buildIndex, isSubsequence, MAX_RESULTS, searchIndex } from './search';

const file = (path: string): RepoNode => ({ id: path, kind: 'file', name: path.split('/').pop()!, path, size: 5, children: [{ id: path + '#f', kind: 'function', name: 'fn', path: path + '#f', size: 1, children: [] }] });
const folder = (path: string, children: RepoNode[]): RepoNode => ({ id: path, kind: 'folder', name: path.split('/').pop() || 'root', path, size: 10, children });

const root = folder('', [
  folder('src', [folder('src/flask', [file('src/flask/app.py'), file('src/flask/helpers.py')]), file('src/main.py')]),
  folder('tests', [file('tests/test_app.py'), file('tests/test_helpers.py')]),
  file('README.md'),
  file('pyproject.toml'),
]);
const index = buildIndex(root);

describe('buildIndex', () => {
  it('lists every folder and file once, and never the root or functions', () => {
    const names = index.map((e) => e.path).sort();
    expect(names).toEqual(['README.md', 'pyproject.toml', 'src', 'src/flask', 'src/flask/app.py', 'src/flask/helpers.py', 'src/main.py', 'tests', 'tests/test_app.py', 'tests/test_helpers.py'].sort());
    expect(index.some((e) => e.id.endsWith('#f'))).toBe(false);
  });
  it('gives folders the island chain to fly through, and files the village they are in plus themselves', () => {
    const flask = index.find((e) => e.path === 'src/flask')!;
    expect(flask.chain).toEqual(['src', 'src/flask']);
    expect(flask.target).toBeUndefined();
    const app = index.find((e) => e.path === 'src/flask/app.py')!;
    expect(app.chain).toEqual(['src', 'src/flask']);
    expect(app.target).toBe('src/flask/app.py');
  });
  it('sends loose files of a folder that also has sub-folders to its home islet', () => {
    const src = index.find((e) => e.path === 'src/main.py')!;
    expect(src.chain).toEqual(['src', 'src#files']); // src has the sub-folder flask AND the loose file main.py
    const readme = index.find((e) => e.path === 'README.md')!;
    expect(readme.chain).toEqual(['#files']); // the root has folders too, so its loose files live on the root's home islet
  });
});

describe('searchIndex', () => {
  it('finds a file by name, case-insensitively, with the best match first', () => {
    const r = searchIndex(index, 'APP');
    expect(r[0].path).toBe('src/flask/app.py');
    expect(r.map((e) => e.path)).toContain('tests/test_app.py');
  });
  it('prefers an exact or prefix match over a looser one, and a higher folder on a tie', () => {
    expect(searchIndex(index, 'tests')[0].path).toBe('tests');
    expect(searchIndex(index, 'helpers')[0].path).toBe('src/flask/helpers.py');
  });
  it('needs every word to match somewhere in the name or path', () => {
    expect(searchIndex(index, 'flask app').map((e) => e.path)).toEqual(['src/flask/app.py']);
    expect(searchIndex(index, 'flask nonsense')).toEqual([]);
  });
  it('matches by path and by a loose fuzzy match', () => {
    expect(searchIndex(index, 'src/flask').map((e) => e.path)).toContain('src/flask/helpers.py');
    expect(searchIndex(index, 'pyprj').map((e) => e.path)).toEqual(['pyproject.toml']);
    expect(isSubsequence('abc', 'a1b2c3')).toBe(true);
    expect(isSubsequence('abd', 'abc')).toBe(false);
  });
  it('gives nothing for an empty query and caps the results', () => {
    expect(searchIndex(index, '   ')).toEqual([]);
    const many = buildIndex(folder('', Array.from({ length: 40 }, (_, i) => file(`a/f${i}.py`).kind === 'file' ? file(`f${i}.py`) : file(''))));
    expect(searchIndex(many, 'f').length).toBe(MAX_RESULTS);
  });
  it('is deterministic', () => {
    expect(searchIndex(index, 'test')).toEqual(searchIndex(index, 'test'));
  });
});
