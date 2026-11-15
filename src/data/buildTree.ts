/**
 * Node-only: walk a directory on disk and build the RepoNode tree. Never import this from browser code.
 *
 * Reads the directory into a flat Entry[] (with contents and line counts) and hands it to the shared,
 * browser-safe builder in treeCore.ts, so the CLI and the live GitHub loader cannot drift apart.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { IGNORE } from './ignore';
import { buildFromEntries, countLines, isIgnoredFile, type BuildResult, type Entry } from './treeCore';

export { sortNodes, type BuildResult, type BuildStats } from './treeCore';

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function collect(abs: string, rel: string, out: Entry[], skipped: { n: number }): void {
  let entries;
  try {
    entries = readdirSync(abs, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => cmpStr(a.name, b.name));
  for (const e of entries) {
    const childRel = rel === '' ? e.name : `${rel}/${e.name}`;
    const childAbs = join(abs, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) {
      if (IGNORE.dirs.has(e.name)) continue;
      collect(childAbs, childRel, out, skipped);
    } else if (e.isFile()) {
      if (isIgnoredFile(e.name)) {
        skipped.n++;
        continue;
      }
      let size = -1;
      try {
        size = statSync(childAbs).size;
      } catch {
        // unreadable: skipped below
      }
      if (size < 0 || size > IGNORE.maxFileBytes) {
        skipped.n++;
        continue;
      }
      const buf = readFileSync(childAbs);
      if (looksBinary(buf)) {
        skipped.n++;
        continue;
      }
      const content = buf.toString('utf8');
      out.push({ path: childRel, size: countLines(content), content });
    }
  }
}

export function buildTree(rootDir: string, rootName = 'root'): BuildResult {
  const entries: Entry[] = [];
  const skipped = { n: 0 };
  collect(rootDir, '', entries, skipped);
  const result = buildFromEntries(entries, rootName);
  result.stats.skippedFiles += skipped.n;
  return result;
}
