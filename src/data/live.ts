/**
 * Browser-safe live loader: one GitHub Git Trees API call builds the whole repo tree (no file contents).
 * The optional token is passed in by the caller (kept in localStorage by the UI); it is only ever sent
 * as an Authorization header to api.github.com and is never logged or stored here.
 */
import type { RepoNode } from '../types';
import { IGNORE } from './ignore';
import { parseRepoUrl } from './repoUrl';
import { isParseable } from './parseFunctions';
import { buildFromEntries, functionNodes, type Entry } from './treeCore';

export interface LiveMeta {
  owner: string;
  repo: string;
  ref: string;
  /** Sha of the tree that was loaded (identifies the exact snapshot). */
  commit: string;
  truncated: boolean;
  fileCount: number;
  subPath?: string;
}

export interface LiveOptions {
  token?: string;
  onStatus?: (msg: string) => void;
}

const API = 'https://api.github.com';
const BYTES_PER_LINE = 35;

const cache = new Map<string, { root: RepoNode; meta: LiveMeta }>();

interface TreeResponse {
  sha: string;
  truncated?: boolean;
  tree: { path: string; mode?: string; type: string; size?: number }[];
}

async function api<T>(url: string, token: string | undefined, what: string): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch {
    throw new Error('Could not reach GitHub. Check your internet connection and try again.');
  }
  if (res.ok) return (await res.json()) as T;

  const remaining = res.headers.get('x-ratelimit-remaining');
  if (res.status === 429 || (res.status === 403 && remaining === '0')) {
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    const when = reset > 0 ? ` It resets at ${new Date(reset * 1000).toLocaleTimeString()}.` : '';
    throw new Error(`GitHub rate limit reached.${when}${token ? '' : ' Adding a GitHub token raises the limit.'}`);
  }
  if (res.status === 404) {
    throw new Error(
      `${what} was not found. It may not exist, or it may be private${token ? ' (or your token cannot see it)' : ' (add a GitHub token to open private repos)'}.`,
    );
  }
  if (res.status === 401) throw new Error('GitHub rejected the token (bad or expired). Clear it and try again.');
  if (res.status === 403) throw new Error(`GitHub refused access to ${what} (403).`);
  if (res.status === 409) throw new Error(`${what} is empty (no commits).`);
  throw new Error(`GitHub returned an error (${res.status}) for ${what}.`);
}

/** Load any public GitHub repo (or sub-folder link) as a RepoNode tree. Throws a readable Error on failure. */
export async function loadRepoLive(
  input: string,
  opts: LiveOptions = {},
): Promise<{ root: RepoNode; meta: LiveMeta }> {
  const { token, onStatus } = opts;
  const parsed = parseRepoUrl(input);
  const { owner, repo, subPath } = parsed;
  const slug = `${owner}/${repo}`;

  const key = `${slug}@${parsed.ref ?? ''}#${subPath ?? ''}`.toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;

  let ref = parsed.ref;
  if (!ref) {
    onStatus?.(`Looking up ${slug}…`);
    const info = await api<{ default_branch?: string }>(`${API}/repos/${owner}/${repo}`, token, `Repository ${slug}`);
    ref = info.default_branch || 'HEAD';
  }

  onStatus?.(`Fetching file list for ${slug}@${ref}…`);
  const data = await api<TreeResponse>(
    `${API}/repos/${owner}/${repo}/git/trees/${ref.split('/').map(encodeURIComponent).join('/')}?recursive=1`,
    token,
    `${slug}@${ref}`,
  );

  onStatus?.('Building islands…');
  const prefix = subPath ? `${subPath}/` : '';
  const entries: Entry[] = [];
  for (const t of data.tree ?? []) {
    if (t.type !== 'blob' || t.mode === '120000') continue; // files only; skip symlinks
    if (prefix && !t.path.startsWith(prefix)) continue;
    const bytes = t.size ?? 0;
    if (bytes > IGNORE.maxFileBytes) continue;
    entries.push({
      path: prefix ? t.path.slice(prefix.length) : t.path,
      size: Math.max(1, Math.round(bytes / BYTES_PER_LINE)),
    });
  }
  if (subPath && entries.length === 0) {
    throw new Error(`Folder "${subPath}" was not found in ${slug}@${ref}.`);
  }

  const rootName = subPath ? subPath.split('/').pop()! : repo;
  const { root, stats } = buildFromEntries(entries, rootName);
  const meta: LiveMeta = {
    owner,
    repo,
    ref,
    commit: data.sha,
    truncated: data.truncated === true,
    fileCount: stats.files,
    ...(subPath ? { subPath } : {}),
  };
  const result = { root, meta };
  cache.set(key, result);
  return result;
}

const fnCache = new Map<string, RepoNode[]>();

/**
 * Lazily fetch one file from raw.githubusercontent.com and return its function nodes (same ids, sort and
 * caps as the CLI). Only Python and JS/TS files; never throws (returns [] on any failure). Cached per file.
 */
export async function loadFunctions(meta: LiveMeta, file: RepoNode): Promise<RepoNode[]> {
  if (file.kind !== 'file' || !isParseable(file.name)) return [];
  const repoPath = meta.subPath ? `${meta.subPath}/${file.path}` : file.path;
  const key = `${meta.owner}/${meta.repo}@${meta.ref}:${repoPath}`.toLowerCase();
  const hit = fnCache.get(key);
  if (hit) return hit;
  try {
    const ref = meta.ref.split('/').map(encodeURIComponent).join('/');
    const path = repoPath.split('/').map(encodeURIComponent).join('/');
    const res = await fetch(`https://raw.githubusercontent.com/${meta.owner}/${meta.repo}/${ref}/${path}`);
    if (!res.ok) return [];
    const nodes = functionNodes(file.path, file.name, await res.text());
    fnCache.set(key, nodes);
    return nodes;
  } catch {
    return [];
  }
}
