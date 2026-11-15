"""Build the import graph for a demo repo: which file imports which, inside the repo.

Usage: python tools/make_imports.py <demo id>      e.g. python tools/make_imports.py pallets__flask

Reads public/demo/<id>.json (the file tree) and public/demo/manifest.json (owner, repo and the pinned commit), fetches
each Python and JS/TS file's source from raw.githubusercontent.com at that commit, finds its imports, resolves them to
files in the tree, and writes public/demo/<id>.imports.json:

    { "repo": "pallets/flask", "commit": "...", "edges": [["tests/test_basic.py", "src/flask/app.py", 3], ...] }

Each edge is [importing file, imported file, number of import statements]. Imports that do not resolve to a file in the
repo (the standard library, third-party packages) are left out. Python and JS/TS only, like the function parser.
Resolution is best-effort: relative imports, packages under the repo root or src/, __init__.py and index files.
"""
import json, re, sys, urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

DEMO = 'public/demo'
ID = sys.argv[1]
entry = next(r for r in json.load(open(f'{DEMO}/manifest.json'))['repos'] if r['id'] == ID)
tree = json.load(open(f'{DEMO}/{ID}.json'))

files = []
def walk(n):
    if n['kind'] == 'file':
        files.append(n['path'])
    for c in n.get('children', []):
        walk(c)
walk(tree)
present = set(files)
PY = ('.py',)
JS = ('.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs')
sources = [f for f in files if f.endswith(PY + JS)]


def fetch(path):
    url = f"https://raw.githubusercontent.com/{entry['owner']}/{entry['repo']}/{entry['commit']}/{path}"
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            return path, r.read().decode('utf-8', 'replace')
    except Exception:
        return path, ''


# ---- Python ----
PY_FROM = re.compile(r'^\s*from\s+(\.*)([\w.]*)\s+import\s+\(?([^#\n]*)', re.M)
PY_IMPORT = re.compile(r'^\s*import\s+([\w.,\s]+)', re.M)


def py_module(mod):
    """'a.b' -> a file in the tree (a/b.py or a/b/__init__.py), trying the repo root and src/."""
    if not mod:
        return None
    base = mod.replace('.', '/')
    for root in ('', 'src/', 'lib/'):
        for cand in (f'{root}{base}.py', f'{root}{base}/__init__.py'):
            if cand in present:
                return cand
    return None


def py_imports(path, src):
    out = []
    pkg = path.rsplit('/', 1)[0] if '/' in path else ''
    for dots, mod, names in PY_FROM.findall(src):
        if dots:
            parts = pkg.split('/') if pkg else []
            up = len(dots) - 1
            parts = parts[: len(parts) - up] if up else parts
            here = '/'.join(parts)
            base = (here + '/' + mod.replace('.', '/')).strip('/') if mod else here
            target = None
            for cand in (f'{base}.py', f'{base}/__init__.py'):
                if cand in present:
                    target = cand
            # "from . import cli": each imported name may itself be a module
            hit = False
            for name in re.split(r'[\s,()]+', names):
                name = name.split(' as ')[0].strip()
                if not name or name == '*':
                    continue
                for cand in (f'{base}/{name}.py', f'{base}/{name}/__init__.py'):
                    if cand in present:
                        out.append(cand)
                        hit = True
            if target and not hit:
                out.append(target)
        else:
            target = py_module(mod)
            hit = False
            for name in re.split(r'[\s,()]+', names):
                name = name.split(' as ')[0].strip()
                if name and name != '*':
                    sub = py_module(f'{mod}.{name}')
                    if sub:
                        out.append(sub)
                        hit = True
            if target and not hit:
                out.append(target)
    for group in PY_IMPORT.findall(src):
        for mod in group.split(','):
            mod = mod.strip().split(' as ')[0].strip()
            t = py_module(mod)
            if t:
                out.append(t)
    return out


# ---- JS / TS (relative imports only) ----
JS_IMPORT = re.compile(r'''(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s+['"]([^'"]+)['"]''', re.M)


def js_imports(path, src):
    out = []
    folder = path.rsplit('/', 1)[0] if '/' in path else ''
    for groups in JS_IMPORT.findall(src):
        spec = next((g for g in groups if g), '')
        if not spec.startswith('.'):
            continue
        parts = (folder.split('/') if folder else [])
        for seg in spec.split('/'):
            if seg in ('', '.'):
                continue
            if seg == '..':
                parts = parts[:-1]
            else:
                parts.append(seg)
        base = '/'.join(parts)
        for cand in [base] + [base + e for e in JS] + [f'{base}/index{e}' for e in JS]:
            if cand in present:
                out.append(cand)
                break
    return out


with ThreadPoolExecutor(max_workers=12) as pool:
    fetched = list(pool.map(fetch, sources))

edges = Counter()
for path, src in fetched:
    found = py_imports(path, src) if path.endswith(PY) else js_imports(path, src)
    for target in found:
        if target != path:
            edges[(path, target)] += 1

out = {'repo': f"{entry['owner']}/{entry['repo']}", 'commit': entry['commit'],
       'edges': [[a, b, n] for (a, b), n in sorted(edges.items())]}
with open(f'{DEMO}/{ID}.imports.json', 'w') as fh:
    json.dump(out, fh, indent=1)
print(f'{ID}: {len(sources)} source files, {sum(1 for _, s in fetched if s)} fetched, {len(edges)} import links')
