/**
 * Where the collaborators' names come from. Demo repos ship a pre-generated list (public/demo/<id>.collaborators.json,
 * so the demo never depends on GitHub's rate limits); any other repo asks GitHub's public contributors endpoint. Bots
 * are left out. Failure (offline, rate-limited, private repo) is not an error: there are simply no people.
 */
export interface RepoRef {
  owner: string;
  repo: string;
  /** The demo manifest id, if this is a demo repo. */
  id?: string;
}

export const MAX_COLLABORATORS = 12;

/** Keep human logins only (no bots), without repeats, at most MAX_COLLABORATORS. */
export function cleanNames(logins: unknown): string[] {
  if (!Array.isArray(logins)) return [];
  const out: string[] = [];
  for (const l of logins) {
    if (typeof l !== 'string' || !l || /\[bot\]$/i.test(l) || out.includes(l)) continue;
    out.push(l);
    if (out.length >= MAX_COLLABORATORS) break;
  }
  return out;
}

export async function loadCollaborators(ref: RepoRef, token?: string): Promise<string[]> {
  if (ref.id) {
    try {
      const res = await fetch(`/demo/${ref.id}.collaborators.json`);
      if (res.ok) {
        const data = JSON.parse(await res.text()) as { collaborators?: unknown };
        const names = cleanNames(data.collaborators);
        if (names.length > 0) return names;
      }
    } catch {
      // fall through to the API
    }
  }
  try {
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}/contributors?per_page=30`, { headers });
    if (!res.ok) return [];
    const list = (await res.json()) as { login?: string; type?: string }[];
    return cleanNames(list.filter((c) => c.type === 'User').map((c) => c.login));
  } catch {
    return [];
  }
}
