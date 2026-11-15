"""Shore tileset (edges, variants, outer and inner corners) in the style of the original tile, as a .piskel file.

Usage: python make_shore_tiles.py <out_dir> <preview.png> <test_map.png> [<tileset_dir>]

With <tileset_dir> (public/assets/tileset), the tiles are also exported as PNGs the game loads, and their
entries are merged into <tileset_dir>/manifest.json.

Everything is drawn in tile space from two textures that wrap seamlessly every 32 px, in both directions:
  - the white foam net (a wrapped Voronoi pattern), and
  - a small noise field that makes the band edges wavy.
Because every tile reads the same wrapped textures at the same pixel positions, the white lines carry straight
on from one tile into the next, whichever tiles sit side by side.

Each tile only decides *where the water is*: a shore depth s per pixel (0 = water side, 32 = sand side).
The bands come from s, using depths measured from the original tile:
  deep water < 14.3 <= shallow < 19.7 <= wet sand < 23.8 <= dry sand
Foam is drawn over deep water, shallow water and wet sand, like the original.
"""
import base64, io, json, math, sys
from PIL import Image

OUT_DIR, PREVIEW, TEST_MAP = sys.argv[1], sys.argv[2], sys.argv[3]
TILESET = sys.argv[4] if len(sys.argv) > 4 else None
N = 32

# Palette of the original tile
DEEP = (24, 167, 180, 255)
SHALLOW = (74, 208, 221, 255)
WET = (182, 159, 66, 255)
SAND = (255, 217, 3, 255)
FOAM = (255, 255, 255, 255)

# Band depths measured from the original (mean first row of each band), and how much they wobble
T_SHALLOW, T_WET, T_SAND = 14.3, 19.7, 23.8
WOBBLE = (1.8, 2.5, 1.5)
# How far (px) out from the shallow band the foam net reaches; 0 = foam starts at the shallow band
FOAM_REACH = 2


def mulberry32(seed):
    a = seed & 0xFFFFFFFF
    def rnd():
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t = a
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t ^= (t + (((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296
    return rnd


# ---- wrapped foam net: Voronoi cells on a 32x32 torus; a pixel is foam where its cell meets another ----
rnd = mulberry32(20261115)
sites = []
while len(sites) < 17:
    p = (rnd() * N, rnd() * N)
    if all(min(abs(p[0] - q[0]), N - abs(p[0] - q[0])) ** 2 + min(abs(p[1] - q[1]), N - abs(p[1] - q[1])) ** 2 > 5.6 ** 2 for q in sites):
        sites.append(p)


def nearest(x, y):
    best, bd = 0, 1e9
    for i, (sx, sy) in enumerate(sites):
        dx = min(abs(x + 0.5 - sx), N - abs(x + 0.5 - sx))
        dy = min(abs(y + 0.5 - sy), N - abs(y + 0.5 - sy))
        d = dx * dx + dy * dy
        if d < bd:
            best, bd = i, d
    return best


cell = [[nearest(x, y) for x in range(N)] for y in range(N)]
NET = [[cell[y][x] != cell[y][(x + 1) % N] or cell[y][x] != cell[(y + 1) % N][x] for x in range(N)] for y in range(N)]


# ---- wrapped value noise for wavy band edges (lattice of 8 x 8, period 32 px) ----
def lattice_field(seed):
    r = mulberry32(seed)
    return [[r() * 2 - 1 for _ in range(8)] for _ in range(8)]


FIELDS = [lattice_field(s) for s in (11, 22, 33)]


def wobble(field, x, y):
    u, v = (x + 0.5) / 4, (y + 0.5) / 4
    i, j = int(math.floor(u)), int(math.floor(v))
    fu, fv = u - i, v - j
    fu, fv = fu * fu * (3 - 2 * fu), fv * fv * (3 - 2 * fv)
    g = lambda a, b: field[b % 8][a % 8]
    top = g(i, j) + (g(i + 1, j) - g(i, j)) * fu
    bot = g(i, j + 1) + (g(i + 1, j + 1) - g(i, j + 1)) * fu
    return top + (bot - top) * fv


def paint(depth):
    """depth(px, py) -> shore depth s at a pixel centre; returns the 32x32 tile."""
    img = Image.new('RGBA', (N, N))
    out = img.load()
    for y in range(N):
        for x in range(N):
            s = depth(x + 0.5, y + 0.5)
            t = [T + A * wobble(F, x, y) for T, A, F in zip((T_SHALLOW, T_WET, T_SAND), WOBBLE, FIELDS)]
            if s < t[0]: col = DEEP
            elif s < t[1]: col = SHALLOW
            elif s < t[2]: col = WET
            else: col = SAND
            # Foam only hugs the shore: open water is plain, so it cannot clash with water drawn at another zoom level.
            out[x, y] = FOAM if col != SAND and NET[y][x] and s > T_SHALLOW - FOAM_REACH else col
    return img


# ---- shore shapes ----
def bell(t, k):
    """0 at both tile edges (t = 0 and 32), smooth in between, k humps."""
    return math.sin(math.pi * k * t / N)


VARIANTS = [  # name, offset along the shore (+ = sand reaches further into the water)
    ('plain', lambda t: 0),
    ('small bump', lambda t: 2.5 * bell(t, 1)),
    ('small dip', lambda t: -2.5 * bell(t, 1)),
    ('gentle S-curve', lambda t: 2.0 * bell(t, 2)),
]


def edge(side, off):
    return {
        'N': lambda px, py: py + off(px),
        'S': lambda px, py: N - py + off(px),
        'W': lambda px, py: px + off(py),
        'E': lambda px, py: N - px + off(py),
    }[side]


def outer(cx, cy):
    """Land corner: the sand is round the corner (cx, cy); water on the two far sides."""
    return lambda px, py: N - math.hypot(px - cx, py - cy)


def inner(cx, cy):
    """Bay: the water is round the corner (cx, cy); sand everywhere else."""
    return lambda px, py: math.hypot(px - cx, py - cy)


SIDE_NAME = {'N': 'north', 'E': 'east', 'S': 'south', 'W': 'west'}
TILES = [('open water', lambda px, py: -99), ('sand', lambda px, py: 99)]
for side in 'NESW':
    for name, off in VARIANTS:
        TILES.append((f'water {SIDE_NAME[side]}, {name}', edge(side, off)))
TILES += [
    ('outer corner, water north + west (sand in SE corner)', outer(N, N)),
    ('outer corner, water north + east (sand in SW corner)', outer(0, N)),
    ('outer corner, water south + east (sand in NW corner)', outer(0, 0)),
    ('outer corner, water south + west (sand in NE corner)', outer(N, 0)),
    ('inner corner, water in NW corner', inner(0, 0)),
    ('inner corner, water in NE corner', inner(N, 0)),
    ('inner corner, water in SE corner', inner(N, N)),
    ('inner corner, water in SW corner', inner(0, N)),
]
frames = [paint(f) for _, f in TILES]
idx = {name: i for i, (name, _) in enumerate(TILES)}

# ---- .piskel: one layer, one frame per tile, frames stored as one horizontal strip ----
sheet = Image.new('RGBA', (N * len(frames), N))
for i, fr in enumerate(frames):
    sheet.paste(fr, (i * N, 0))
buf = io.BytesIO()
sheet.save(buf, 'PNG')
layer = {
    'name': 'Shore',
    'opacity': 1,
    'frameCount': len(frames),
    'chunks': [{'layout': [[i] for i in range(len(frames))], 'base64PNG': 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()}],
}
piskel = {
    'modelVersion': 2,
    'piskel': {
        'name': 'shore_tiles',
        'description': '; '.join(f'{i}: {n}' for i, (n, _) in enumerate(TILES)),
        'fps': 2, 'height': N, 'width': N, 'layers': [json.dumps(layer)], 'hiddenFrames': [],
    },
}
with open(f'{OUT_DIR}/shore_tiles.piskel', 'w') as fh:
    json.dump(piskel, fh)
sheet.save(f'{OUT_DIR}/shore_tiles_strip.png')

# ---- preview: rows = [water, sand] / each side's 4 edges / outer corners / inner corners ----
S = 5
rows = [frames[0:2], frames[2:6], frames[6:10], frames[10:14], frames[14:18], frames[18:22], frames[22:26]]
prev = Image.new('RGBA', (4 * (N * S + 6), len(rows) * (N * S + 6)), (40, 40, 40, 255))
for r, row in enumerate(rows):
    for c, fr in enumerate(row):
        prev.paste(fr.resize((N * S, N * S), Image.NEAREST), (c * (N * S + 6) + 3, r * (N * S + 6) + 3))
prev.save(PREVIEW)

# ---- test map: an island and a lake built from the tiles, butted together with no gaps ----
W_, S_ = idx['open water'], idx['sand']
e = lambda side, k=0: idx[f'water {SIDE_NAME[side]}, {VARIANTS[k][0]}']
oc = lambda tag: idx[next(n for n, _ in TILES if n.startswith('outer') and tag in n)]
ic = lambda tag: idx[next(n for n, _ in TILES if n.startswith('inner') and tag in n)]
MAP = [
    [W_, W_, W_, W_, W_, W_, W_],
    [W_, oc('SE corner'), e('N', 1), e('N', 0), e('N', 3), oc('SW corner'), W_],
    [W_, e('W', 0), S_, S_, S_, e('E', 2), W_],
    [W_, e('W', 3), S_, S_, S_, e('E', 1), W_],
    [W_, oc('NE corner'), e('S', 2), e('S', 0), e('S', 1), oc('NW corner'), W_],
    [W_, W_, W_, W_, W_, W_, W_],
]
LAKE = [
    [S_, S_, S_, S_, S_, S_],
    [S_, ic('SE corner'), e('S', 1), e('S', 3), ic('SW corner'), S_],
    [S_, e('E', 0), W_, W_, e('W', 2), S_],
    [S_, ic('NE corner'), e('N', 2), e('N', 0), ic('NW corner'), S_],
    [S_, S_, S_, S_, S_, S_],
]
Z = 3
test = Image.new('RGBA', ((7 + 6 + 1) * N * Z, 6 * N * Z), (40, 40, 40, 255))
for ox, grid in ((0, MAP), (8, LAKE)):
    for r, row in enumerate(grid):
        for c, t in enumerate(row):
            test.paste(frames[t].resize((N * Z, N * Z), Image.NEAREST), ((ox + c) * N * Z, r * N * Z))
test.save(TEST_MAP)


# ---- export for the game: PNGs + manifest entries (public/assets/tileset/) ----
if TILESET:
    import os

    def recolour(img, mapping):
        out = img.copy()
        p = out.load()
        for y in range(N):
            for x in range(N):
                p[x, y] = mapping.get(p[x, y], p[x, y])
        return out

    files = {}

    def save(category, rel, img, **extra):
        os.makedirs(os.path.dirname(f'{TILESET}/{rel}'), exist_ok=True)
        img.save(f'{TILESET}/{rel}')
        files.setdefault(category, []).append({'file': rel, **extra})

    water = frames[idx['open water']]
    # One image per grid cell ("cells": 1), so the foam lines up with the shore tiles' own water.
    save('water.shallow', 'water/shallow.png', water, cells=1)
    save('water.deep', 'water/deep.png', water, cells=1)  # light blue everywhere: the deep sea matches the shallows
    save('water.reef', 'water/reef.png', recolour(water, {DEEP: (98, 214, 200, 255)}), cells=1)
    save('shore.water', 'shore/water.png', water)
    save('shore.sand', 'shore/sand.png', frames[idx['sand']])
    save('ground.sand', 'shore/sand.png', frames[idx['sand']])
    for side in 'NESW':
        for k, (name, _) in enumerate(VARIANTS):
            save(f'shore.edge.{side.lower()}', f'shore/edge_{side.lower()}_{k}.png', frames[idx[f'water {SIDE_NAME[side]}, {name}']], weight=3 if k == 0 else 1)
    # outer corners are named by their two water sides, inner corners by the corner that holds the water
    for key, tag in (('nw', 'water north + west'), ('ne', 'water north + east'), ('se', 'water south + east'), ('sw', 'water south + west')):
        save(f'shore.outer.{key}', f'shore/outer_{key}.png', frames[idx[next(n for n, _ in TILES if tag in n)]])
    for key, tag in (('nw', 'NW corner'), ('ne', 'NE corner'), ('se', 'SE corner'), ('sw', 'SW corner')):
        save(f'shore.inner.{key}', f'shore/inner_{key}.png', frames[idx[next(n for n, _ in TILES if n.startswith('inner') and tag in n)]])

    manifest_path = f'{TILESET}/manifest.json'
    manifest = {}
    if os.path.exists(manifest_path):
        with open(manifest_path) as fh:
            manifest = json.load(fh)
    manifest.update(files)
    with open(manifest_path, 'w') as fh:
        json.dump(manifest, fh, indent=2)
    print('exported', sum(len(v) for v in files.values()), 'manifest entries to', TILESET)

print('frames', len(frames))
