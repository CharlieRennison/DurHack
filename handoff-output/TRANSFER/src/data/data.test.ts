import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { RepoNode } from '../types';
import { buildTree } from './buildTree';
import { IGNORE } from './ignore';
import { indexNodes } from './index';
import { parseFunctions } from './parseFunctions';

const dirs: string[] = [];
function fixture(files: Record<string, string | Buffer>): string {
  const dir = mkdtempSync(join(tmpdir(), 'data-test-'));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true, maxRetries: 5 })));

const find = (n: RepoNode, id: string): RepoNode | undefined =>
  n.id === id ? n : n.children.map((c) => find(c, id)).find(Boolean);

describe('buildTree mapping', () => {
  const dir = fixture({
    'a.txt': 'one\ntwo\nthree\n',
    'src/b.py': 'def f():\n    return 1\n',
    'src/c.txt': 'x',
    'docs/readme.md': '# hi\n',
    'docs/guide.md': '# a\n# b\n# c\n# d\n',
  });
  const { root, stats } = buildTree(dir, 'demo');

  it('uses the contract for the root', () => {
    expect(root).toMatchObject({ id: 'root', kind: 'folder', name: 'demo', path: '' });
  });
  it('sizes folders as the sum of their children and files as line counts', () => {
    expect(find(root, 'a.txt')!.size).toBe(3);
    expect(find(root, 'docs')!.size).toBe(5);
    expect(root.size).toBe(root.children.reduce((a, c) => a + c.size, 0));
  });
  it('sorts children by size desc then name asc', () => {
    const sizes = root.children.map((c) => c.size);
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    expect(root.children.map((c) => c.name)).toEqual(['docs', 'a.txt', 'src']);
  });
  it('uses paths as ids and builds function ids', () => {
    expect(find(root, 'src/b.py')!.kind).toBe('file');
    const fn = find(root, 'src/b.py#f')!;
    expect(fn).toMatchObject({ kind: 'function', path: 'src/b.py#f', size: 2 });
  });
  it('reports stats', () => {
    expect(stats.files).toBe(5);
    expect(stats.functions).toBe(1);
  });
});

describe('determinism', () => {
  it('produces identical JSON for identical input', () => {
    const files = { 'x/a.ts': 'export function a() {\n  return 1;\n}\n', 'x/b.ts': 'const b = () => 2;\n', 'z.py': 'def z():\n  pass\n' };
    const a = JSON.stringify(buildTree(fixture(files), 'r').root);
    const b = JSON.stringify(buildTree(fixture(files), 'r').root);
    expect(a).toBe(b);
  });
});

describe('ignore rules', () => {
  const dir = fixture({
    'node_modules/pkg/index.js': 'function x() {}\n',
    '.git/config': 'x\n',
    'dist/out.js': 'x\n',
    'src/keep.ts': 'export const a = 1;\n',
    'src/logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]),
    'src/blob.dat2': Buffer.from([1, 2, 0, 3, 4]), // NUL byte: detected as binary
    'src/app.min.js': 'var a=1;',
    'package-lock.json': '{}\n',
    'big.txt': 'x'.repeat(IGNORE.maxFileBytes + 10),
  });
  const { root } = buildTree(dir, 'r');
  it('skips ignored directories, files, extensions, patterns, binaries and big files', () => {
    expect(find(root, 'src/keep.ts')).toBeTruthy();
    for (const id of ['node_modules', '.git', 'dist', 'src/logo.png', 'src/blob.dat2', 'src/app.min.js', 'package-lock.json', 'big.txt']) {
      expect(find(root, id), id).toBeUndefined();
    }
  });
});

describe('caps and collapsing', () => {
  it('groups more than 100 children into 99 + "(N more)"', () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 150; i++) files[`many/f${String(i).padStart(3, '0')}.txt`] = 'l\n'.repeat(i + 1);
    const { root } = buildTree(fixture(files), 'r');
    const many = find(root, 'many')!;
    expect(many.children).toHaveLength(100);
    const other = many.children[99];
    expect(other.name).toBe('(51 more)');
    expect(other.id).toBe('many/__other__');
    expect(many.size).toBe(many.children.reduce((a, c) => a + c.size, 0));
    expect(indexNodes(root).size).toBe(new Set([...indexNodes(root).keys()]).size);
  });

  it('groups more than 200 functions per file', () => {
    const src = Array.from({ length: 250 }, (_, i) => `def fn${i}():\n    pass\n`).join('\n');
    const { root } = buildTree(fixture({ 'big.py': src }), 'r');
    const file = find(root, 'big.py')!;
    expect(file.children).toHaveLength(200);
    expect(file.children[199]).toMatchObject({ name: '(51 more)', id: 'big.py#__other__' });
  });

  it('collapses single-child folder chains but never the root', () => {
    const { root } = buildTree(fixture({ 'a/b/c/file.txt': 'x\n', 'top.txt': 'y\n' }), 'r');
    const chain = find(root, 'a/b/c')!;
    expect(chain.name).toBe('a/b/c');
    expect(chain.kind).toBe('folder');
    expect(find(root, 'a')).toBeUndefined();

    const only = buildTree(fixture({ 'solo/x/file.txt': 'x\n' }), 'r').root;
    expect(only.id).toBe('root');
    expect(only.children[0].name).toBe('solo/x');
  });

  it('disambiguates repeated function names with the start line', () => {
    const { root } = buildTree(fixture({ 'dup.py': 'def go():\n  pass\n\ndef go():\n  pass\n' }), 'r');
    const ids = find(root, 'dup.py')!.children.map((c) => c.id).sort();
    expect(ids).toEqual(['dup.py#go:1', 'dup.py#go:4']);
  });
});

describe('parseFunctions: Python', () => {
  const src = [
    'import os',
    '',
    'def top(a, b):',
    '    """doc"""',
    '    def inner():',
    '        return 1',
    '    return inner()',
    '',
    'class Foo:',
    '    x = 1',
    '',
    '    def method(self):',
    '        return 2',
    '',
    '    async def amethod(self):',
    '        pass',
    '',
    'async def last():',
    '    pass',
  ].join('\n');
  const fns = parseFunctions(src, 'x.py');
  it('finds functions and methods, folding nested functions', () => {
    expect(fns.map((f) => f.name)).toEqual(['top', 'Foo.method', 'Foo.amethod', 'last']);
  });
  it('computes inclusive line ranges', () => {
    expect(fns[0]).toMatchObject({ startLine: 3, endLine: 7 });
    expect(fns[1]).toMatchObject({ startLine: 12, endLine: 13 });
    expect(fns[3]).toMatchObject({ startLine: 18, endLine: 19 });
  });
});

describe('parseFunctions: JS/TS', () => {
  const src = [
    "import x from 'y';",
    '',
    'export function alpha(a: number): number {',
    '  const s = "}{ not a brace";',
    '  // } comment brace',
    '  return a;',
    '}',
    '',
    'export const beta = async (x: string) => {',
    '  return x;',
    '};',
    '',
    'const gamma = (n) => n + 1;',
    '',
    'class Box<T> {',
    '  private v: T;',
    '  constructor(v: T) {',
    '    this.v = v;',
    '  }',
    '  get(): T {',
    '    if (this.v) {',
    '      return this.v;',
    '    }',
    '    return this.v;',
    '  }',
    '}',
    '',
    'function outer() {',
    '  function innerOne() {}',
    '  return innerOne;',
    '}',
  ].join('\n');
  const fns = parseFunctions(src, 'x.ts');
  it('finds declarations, arrows, class methods; folds nested functions; ignores braces in strings/comments', () => {
    expect(fns.map((f) => f.name)).toEqual(['alpha', 'beta', 'gamma', 'Box.constructor', 'Box.get', 'outer']);
  });
  it('computes inclusive line ranges', () => {
    const by = Object.fromEntries(fns.map((f) => [f.name, f]));
    expect(by.alpha).toMatchObject({ startLine: 3, endLine: 7 });
    expect(by.beta).toMatchObject({ startLine: 9, endLine: 11 });
    expect(by.gamma).toMatchObject({ startLine: 13, endLine: 13 });
    expect(by['Box.get']).toMatchObject({ startLine: 20, endLine: 25 });
    expect(by.outer).toMatchObject({ startLine: 28, endLine: 31 });
  });
  it('never throws and returns [] for unsupported languages', () => {
    expect(parseFunctions('def (((', 'x.py')).toBeInstanceOf(Array);
    expect(parseFunctions('function {{{{', 'x.js')).toBeInstanceOf(Array);
    expect(parseFunctions('fn main() {}', 'x.rs')).toEqual([]);
  });
});
