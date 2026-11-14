/**
 * Node-only CLI: clone a repo (shallow), build its RepoNode tree, write public/demo/<owner>__<repo>.json
 * and update public/demo/manifest.json. No GitHub API, so no rate limit; no network after the clone.
 *
 *   npm run fetch-repo -- https://github.com/owner/repo [--ref main] [--out public/demo] [--default]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildTree } from '../buildTree';
import { IGNORE } from '../ignore';
import type { Manifest, ManifestEntry } from '../manifest';

interface Args {
  url: string;
  ref?: string;
  out: string;
  makeDefault: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { url: '', out: 'public/demo', makeDefault: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ref') args.ref = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--default') args.makeDefault = true;
    else if (!a.startsWith('--') && !args.url) args.url = a;
  }
  if (!args.url) {
    throw new Error('Usage: npm run fetch-repo -- <github-url|owner/repo> [--ref <branch|tag>] [--out <dir>] [--default]');
  }
  return args;
}

/** Accepts https://github.com/o/r(.git)(/tree/<ref>) or "o/r". */
export function parseRepoUrl(input: string): { owner: string; repo: string; ref?: string; cloneUrl: string } {
  const m = /^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([^?#]+))?\/?$/.exec(input.trim());
  if (!m) throw new Error(`Cannot parse repo URL: ${input}`);
  const [, owner, repo, ref] = m;
  return { owner, repo, ref, cloneUrl: `https://github.com/${owner}/${repo}.git` };
}

function git(args: string[], cwd?: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const parsed = parseRepoUrl(args.url);
  const ref = args.ref ?? parsed.ref;
  const id = `${parsed.owner}__${parsed.repo}`;

  const tmp = mkdtempSync(join(tmpdir(), 'islands-'));
  const dest = join(tmp, 'repo');
  try {
    console.log(`Cloning ${parsed.cloneUrl}${ref ? ` @ ${ref}` : ''} ...`);
    git(['clone', '--depth', '1', ...(ref ? ['--branch', ref] : []), parsed.cloneUrl, dest]);
    const commit = git(['rev-parse', 'HEAD'], dest);

    const { root, stats } = buildTree(dest, parsed.repo);
    if (stats.nodes > IGNORE.warnNodes) {
      console.warn(`WARNING: ${stats.nodes} nodes exceeds ${IGNORE.warnNodes}; the demo may be slow. Consider a smaller repo.`);
    }

    const outDir = resolve(args.out);
    mkdirSync(outDir, { recursive: true });
    const file = `${id}.json`;
    writeFileSync(join(outDir, file), JSON.stringify(root, null, 2) + '\n');

    const manifestPath = join(outDir, 'manifest.json');
    let manifest: Manifest = { repos: [] };
    if (existsSync(manifestPath)) {
      try {
        const parsedManifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
        if (Array.isArray(parsedManifest.repos)) manifest = parsedManifest;
      } catch {
        // A corrupt manifest is rebuilt from scratch.
      }
    }
    const previous = manifest.repos.find((r) => r.id === id);
    const entry: ManifestEntry = {
      id,
      owner: parsed.owner,
      repo: parsed.repo,
      url: `https://github.com/${parsed.owner}/${parsed.repo}`,
      ...(ref ? { ref } : {}),
      commit,
      file,
      nodes: stats.nodes,
      files: stats.files,
      functions: stats.functions,
      ...(args.makeDefault || previous?.default ? { default: true } : {}),
    };
    manifest.repos = manifest.repos.filter((r) => r.id !== id).concat(entry);
    if (args.makeDefault) manifest.repos.forEach((r) => (r.default = r.id === id ? true : undefined));
    manifest.repos.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

    console.log(`Wrote ${join(outDir, file)}`);
    console.log(`${stats.nodes} nodes, ${stats.files} files, ${stats.functions} functions, ${stats.skippedFiles} files skipped, commit ${commit.slice(0, 7)}`);
  } finally {
    // Windows: git leaves read-only files in .git, so retry the delete.
    rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
}

main();
