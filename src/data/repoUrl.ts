/** Browser-safe GitHub link parser. Used by the live loader and the Node CLI. */
export interface RepoRef {
  owner: string;
  repo: string;
  ref?: string;
  /** Folder inside the repo to use as the world's root (no leading/trailing slash). */
  subPath?: string;
}

const NAME = '[A-Za-z0-9_.-]+';
const RE = new RegExp(
  `^(?:(?:https?://)?(?:www\\.)?github\\.com/)?(${NAME})/(${NAME}?)(?:\\.git)?(?:/tree/([^/?#]+)(?:/([^?#]*))?)?/?(?:[?#].*)?$`,
  'i',
);

/**
 * Accepts https://github.com/o/r, github.com/o/r, o/r, a trailing .git or /,
 * and /tree/<ref>[/<sub/path>]. Anything else throws a readable error.
 */
export function parseRepoUrl(input: string): RepoRef {
  const text = (input ?? '').trim();
  const m = RE.exec(text);
  if (!m || m[1].toLowerCase() === 'github.com' || m[1] === '.'|| m[1] === '..' || m[2] === '.' || m[2] === '..') {
    throw new Error(`"${text}" is not a GitHub link. Use github.com/owner/repo or owner/repo.`);
  }
  const [, owner, repo, ref, sub] = m;
  let subPath = '';
  let refName = ref ?? '';
  try {
    subPath = sub ? sub.split('/').filter(Boolean).map(decodeURIComponent).join('/') : '';
    refName = refName ? decodeURIComponent(refName) : '';
  } catch {
    throw new Error(`"${text}" is not a GitHub link (bad % escape).`);
  }
  return {
    owner,
    repo,
    ...(refName ? { ref: refName } : {}),
    ...(subPath ? { subPath } : {}),
  };
}
