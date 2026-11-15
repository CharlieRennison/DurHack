/** Where a repo's files live on GitHub, for "click a house to open its file". */
export interface RepoLink {
  owner: string;
  repo: string;
  /** Branch, tag or commit; "HEAD" means the default branch. */
  ref: string;
  /** Folder inside the repo when only a subfolder was loaded (node paths are relative to it). */
  subPath?: string;
}

/** The github.com page of the file at `path` (relative to what was loaded). */
export function fileUrl(link: RepoLink, path: string): string {
  const full = [link.subPath, path].filter(Boolean).join('/');
  const enc = (s: string) => s.split('/').map(encodeURIComponent).join('/');
  return `https://github.com/${encodeURIComponent(link.owner)}/${encodeURIComponent(link.repo)}/blob/${enc(link.ref || 'HEAD')}/${enc(full)}`;
}
