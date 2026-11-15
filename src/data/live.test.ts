import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { buildTree } from './buildTree';
import type { RepoNode } from '../types';
import { loadFunctions, loadRepoLive, type LiveMeta } from './live';
import { parseRepoUrl } from './repoUrl';
import { buildFromEntries, countLines, type Entry } from './treeCore';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);
afterEach(() => fetchMock.mockReset());

describe('parseRepoUrl', () => {
  it.each([
    ['https://github.com/o/r', { owner: 'o', repo: 'r' }],
    ['http://www.github.com/o/r', { owner: 'o', repo: 'r' }],
    ['github.com/o/r', { owner: 'o', repo: 'r' }],
    ['o/r', { owner: 'o', repo: 'r' }],
    ['  o/r  ', { owner: 'o', repo: 'r' }],
    ['o/r.git', { owner: 'o', repo: 'r' }],
    ['https://github.com/o/r/', { owner: 'o', repo: 'r' }],
    ['https://github.com/o/r.git', { owner: 'o', repo: 'r' }],
    ['https://github.com/o/my.repo-x_y', { owner: 'o', repo: 'my.repo-x_y' }],
    ['https://github.com/o/r/tree/main', { owner: 'o', repo: 'r', ref: 'main' }],
    ['github.com/o/r/tree/v1.2/src/lib/', { owner: 'o', repo: 'r', ref: 'v1.2', subPath: 'src/lib' }],
  ])('accepts %s', (input, expected) => {
    expect(parseRepoUrl(input)).toEqual(expected);
  });

  it.each(['', 'justaname', 'github.com/owner', 'https://gitlab.com/o/r', 'a/b/c', 'o/r/blob/main/x.ts', 'https://github.com/', '../x'])(
    'rejects %j',
    (input) => {
      expect(() => parseRepoUrl(input)).toThrow(/not a GitHub link/);
    },
  );
});

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true, maxRetries: 5 })));

describe('buildFromEntries', () => {
  it('matches buildTree byte for byte for the same files', () => {
    const files: Record<string, string> = {
      'a.txt': 'one\ntwo\nthree\n',
      'src/b.py': 'def f():\n    return 1\n\ndef f():\n    pass\n',
      'src/deep/only/x.ts': 'export function hi() {\n  return 1;\n}\n',
      'docs/readme.md': '# hi\n',
      'docs/guide.md': '# a\n# b\n# c\n# d\n',
      'package-lock.json': '{}',
      'node_modules/x/index.js': 'function nope() {}\n',
      'logo.png': 'not really a png',
    };
    const dir = mkdtempSync(join(tmpdir(), 'core-test-'));
    dirs.push(dir);
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(dir, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
    const fromDisk = buildTree(dir, 'demo');
    const entries: Entry[] = Object.entries(files).map(([path, content]) => ({ path, size: countLines(content), content }));
    const fromEntries = buildFromEntries(entries, 'demo');
    expect(JSON.stringify(fromEntries.root)).toBe(JSON.stringify(fromDisk.root));
    expect(fromEntries.stats.files).toBe(fromDisk.stats.files);
    expect(fromEntries.stats.functions).toBe(fromDisk.stats.functions);
    // input order must not matter
    const reversed = buildFromEntries([...entries].reverse(), 'demo');
    expect(JSON.stringify(reversed.root)).toBe(JSON.stringify(fromDisk.root));
  });

  it('caps a folder at 100 children', () => {
    const entries: Entry[] = Array.from({ length: 150 }, (_, i) => ({ path: `f${i}.txt`, size: 1 }));
    const { root } = buildFromEntries(entries, 'big');
    expect(root.children).toHaveLength(100);
    expect(root.children[99]).toMatchObject({ id: '__other__', name: '(51 more)' });
  });
});

function jsonRes(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers: init.headers });
}

const TREE = {
  sha: 'abcdef1234567890',
  truncated: false,
  tree: [
    { path: 'src', type: 'tree', mode: '040000' },
    { path: 'src/a.ts', type: 'blob', mode: '100644', size: 350 },
    { path: 'src/lib/b.ts', type: 'blob', mode: '100644', size: 700 },
    { path: 'README.md', type: 'blob', mode: '100644', size: 35 },
    { path: 'link', type: 'blob', mode: '120000', size: 5 },
    { path: 'logo.png', type: 'blob', mode: '100644', size: 9000 },
    { path: 'huge.txt', type: 'blob', mode: '100644', size: 5_000_000 },
  ],
};

describe('loadRepoLive', () => {

  it('looks up the default branch, loads the tree, converts bytes to lines', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes({ default_branch: 'dev' }))
      .mockResolvedValueOnce(jsonRes(TREE));
    const status: string[] = [];
    const { root, meta } = await loadRepoLive('okt/success', { onStatus: (m) => status.push(m) });
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/okt/success');
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.github.com/repos/okt/success/git/trees/dev?recursive=1');
    expect(meta).toMatchObject({ owner: 'okt', repo: 'success', ref: 'dev', commit: TREE.sha, truncated: false, fileCount: 3 });
    expect(root).toMatchObject({ id: 'root', name: 'success', path: '' });
    expect(root.children.map((c) => c.name)).toEqual(['src', 'README.md']);
    expect(root.children[0].size).toBe(30); // 10 + 20 lines
    expect(status.length).toBeGreaterThan(0);
  });

  it('caches by owner/repo@ref', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(TREE));
    const a = await loadRepoLive('github.com/cache/me/tree/main');
    const b = await loadRepoLive('cache/me@x'.replace('@x', '') + '/tree/main');
    expect(b).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('opens a sub-folder as the root', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(TREE));
    const { root, meta } = await loadRepoLive('https://github.com/sub/path/tree/main/src');
    expect(meta.subPath).toBe('src');
    expect(root.name).toBe('src');
    expect(root.children.map((c) => c.path)).toEqual(['lib', 'a.ts']);
  });

  it('errors when the sub-folder does not exist', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(TREE));
    await expect(loadRepoLive('nofolder/x/tree/main/nope')).rejects.toThrow(/Folder "nope" was not found/);
  });

  it('reports truncated trees', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ ...TREE, truncated: true }));
    const { meta } = await loadRepoLive('trunc/ated/tree/main');
    expect(meta.truncated).toBe(true);
  });

  it('explains a 404', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ message: 'Not Found' }, { status: 404 }));
    await expect(loadRepoLive('no/such')).rejects.toThrow(/not found.*private.*token/i);
  });

  it('explains a rate limit with the reset time', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonRes({}, { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1900000000' } }),
    );
    await expect(loadRepoLive('rate/limited')).rejects.toThrow(/rate limit.*resets at/i);
  });

  it('explains a network failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(loadRepoLive('off/line')).rejects.toThrow(/Could not reach GitHub/);
  });

  it('rejects a bad link without calling fetch', async () => {
    await expect(loadRepoLive('nonsense')).rejects.toThrow(/not a GitHub link/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the token only when provided', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(TREE));
    await loadRepoLive('tok/none/tree/main');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();

    fetchMock.mockResolvedValueOnce(jsonRes(TREE));
    await loadRepoLive('tok/some/tree/main', { token: 'secret' });
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer secret');
  });
});


describe('loadFunctions', () => {
  const meta: LiveMeta = { owner: 'fn', repo: 'test', ref: 'main', commit: 'abc', truncated: false, fileCount: 2 };
  const file = (path: string): RepoNode => ({ id: path, kind: 'file', name: path.split('/').pop()!, path, size: 10, children: [] });
  const text = (body: string) => new Response(body, { status: 200 });
  const PY = ['def a():', '    return 1', '', 'def b():', '    pass', '', 'def b():', '    pass', ''].join('\n');

  it('builds function nodes for a Python file', async () => {
    fetchMock.mockResolvedValueOnce(text(PY));
    const kids = await loadFunctions(meta, file('pkg/m.py'));
    expect(fetchMock.mock.calls[0][0]).toBe('https://raw.githubusercontent.com/fn/test/main/pkg/m.py');
    expect(kids.map((k) => k.id).sort()).toEqual(['pkg/m.py#a', 'pkg/m.py#b:4', 'pkg/m.py#b:7']);
    expect(kids.every((k) => k.kind === 'function')).toBe(true);
  });

  it('builds function nodes for a TS file and caches them', async () => {
    fetchMock.mockResolvedValueOnce(text('export function hello() {\n  return 1;\n}\n'));
    const a = await loadFunctions(meta, file('src/t.ts'));
    const b = await loadFunctions(meta, file('src/t.ts'));
    expect(a.map((k) => k.id)).toEqual(['src/t.ts#hello']);
    expect(b).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('prefixes the sub-path; returns [] for unparseable files, HTTP errors and network errors', async () => {
    fetchMock.mockResolvedValueOnce(text('def z():\n    pass\n'));
    await loadFunctions({ ...meta, subPath: 'lib' }, file('z.py'));
    expect(fetchMock.mock.calls[0][0]).toContain('/main/lib/z.py');
    expect(await loadFunctions(meta, file('README.md'))).toEqual([]);
    fetchMock.mockResolvedValueOnce(new Response('no', { status: 404 }));
    expect(await loadFunctions(meta, file('gone.py'))).toEqual([]);
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    expect(await loadFunctions(meta, file('off.py'))).toEqual([]);
  });
});
