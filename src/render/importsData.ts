import type { ImportEdge } from './seaLanes';
import type { RepoRef } from './collaborators';

/**
 * Which files import which: pre-generated for the demo repos (public/demo/<id>.imports.json, made by
 * tools/make_imports.py). Live repos have none yet, so they get no boats. Failure means no boats, never an error.
 */
export async function loadImports(ref: RepoRef): Promise<ImportEdge[]> {
  if (!ref.id) return [];
  try {
    const res = await fetch(`/demo/${ref.id}.imports.json`);
    if (!res.ok) return [];
    const data = JSON.parse(await res.text()) as { edges?: unknown };
    if (!Array.isArray(data.edges)) return [];
    return data.edges.filter(
      (e): e is ImportEdge => Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'string' && typeof e[2] === 'number',
    );
  } catch {
    return [];
  }
}
