"""10 more trees in the style of the original 32x32 conifer, saved as a .piskel file.

Usage: python make_trees.py <original_tree.png> <out_dir> [<tileset_dir>]

With <tileset_dir> (public/assets/tileset) the trees are also exported as PNGs and merged into its manifest.json.

Same 4 colours as the original (two greens for the foliage, two browns for the trunk), light from the upper
left: the left half of the foliage is the lighter green and the right half the darker one, and the trunk is
dark just below the crown (the crown's shadow) and lighter lower down. Every tree stands on row 27 of the
32x32 canvas, centred on x = 16, so they all share one anchor point in the game.
"""
import base64, io, json, math, sys
from PIL import Image

SRC, OUT_DIR = sys.argv[1], sys.argv[2]
TILESET = sys.argv[3] if len(sys.argv) > 3 else None
N = 32
BASE = 27  # last row of the trunk
CX = 16  # the tree's middle line: pixels left of it are lit, right of it are in shade
FOL_L, FOL_D = (47, 96, 7, 255), (4, 72, 9, 255)
TRK_L, TRK_D = (72, 49, 3, 255), (53, 37, 5, 255)


def h(x, y, s=0):
    """Small deterministic hash in [0, 1)."""
    v = (x * 374761393 + y * 668265263 + s * 982451653) & 0xFFFFFFFF
    v = ((v ^ (v >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((v ^ (v >> 16)) & 0xFFFFFFFF) / 4294967296


class Canvas:
    def __init__(self):
        self.img = Image.new('RGBA', (N, N))
        self.px = self.img.load()

    def foliage(self, spans, seed, split_shift=None, speckle=True):
        """spans: {row: (x0, x1)} inclusive. Left of the middle line is light, right is dark, with leaf specks."""
        for y, (x0, x1) in spans.items():
            split = CX + (split_shift(y) if split_shift else 0)
            for x in range(x0, x1 + 1):
                col = FOL_L if x < split else FOL_D
                if speckle and (x1 - x0) > 5 and x0 < x < x1:  # a few leaf clumps in the other tone
                    r = h(x, y, seed)
                    if r < 0.07: col = FOL_D if x < split else FOL_L
                self.px[x, y] = col

    def trunk(self, top, tw, flare=False):
        """Trunk of width tw from row `top` down to BASE, centred on CX. Dark right side under the crown, light lower down."""
        x0 = CX - tw // 2
        for y in range(top, BASE + 1):
            dark = max(0, tw - (y - top))  # the crown's shadow slides off the trunk going down
            for x in range(x0, x0 + tw):
                self.px[x, y] = TRK_D if x >= x0 + tw - dark else TRK_L
        if flare:  # little root flare on the bottom row
            self.px[x0 - 1, BASE] = TRK_L
            self.px[x0 + tw, BASE] = TRK_D


def ellipse_spans(cx, cy, rx, ry, seed, rough=0.7):
    spans = {}
    for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
        dy = (y - cy) / ry
        if abs(dy) > 1: continue
        half = rx * math.sqrt(1 - dy * dy)
        half += (h(0, y, seed) - 0.5) * 2 * rough  # ragged edge
        half = max(1, half)
        spans[y] = (int(round(cx - half)), int(round(cx + half - 1)))
    return spans


def merge(*sets):
    out = {}
    for s in sets:
        for y, (a, b) in s.items():
            if y in out: out[y] = (min(out[y][0], a), max(out[y][1], b))
            else: out[y] = (a, b)
    return out


def conifer(tiers, trunk_w, seed=1, last_tier_shift=True):
    """tiers: (start_row, height, half_width_at_top, half_width_at_bottom). Returns a finished canvas."""
    c = Canvas()
    spans = {}
    for start, height, w0, w1 in tiers:
        for r in range(start, start + height):
            hw = w0 + (w1 - w0) * (r - start) / max(1, height - 1)
            spans[r] = (CX - int(round(hw)), CX + int(round(hw)) - 1)
    bottom = max(spans)
    c.trunk(bottom + 1, trunk_w, flare=trunk_w >= 4)
    last_start = tiers[-1][0]
    c.foliage(spans, seed, split_shift=(lambda y: -1 if (last_tier_shift and y >= last_start + 2) else 0), speckle=False)
    return c


def leafy(crown_spans, trunk_top, trunk_w, seed):
    c = Canvas()
    c.trunk(trunk_top, trunk_w, flare=trunk_w >= 4)
    c.foliage(crown_spans, seed, split_shift=lambda y: int(round((h(1, y, seed) - 0.5) * 2)))
    return c


def dead_tree():
    c = Canvas()
    # tapering trunk, trunk colours only
    for y in range(11, BASE + 1):
        tw = 2 if y < 16 else 3 if y < 21 else 4
        x0 = CX - tw // 2
        dark = 1 if y < 21 else 2
        for x in range(x0, x0 + tw):
            c.px[x, y] = TRK_D if x >= x0 + tw - dark else TRK_L
    c.px[CX - 3, BASE] = TRK_L; c.px[CX + 2, BASE] = TRK_D
    def branch(x, y, dx, length):
        for i in range(length):
            c.px[x + dx * i, y - i // 1 if False else y - (i * 2) // 3] = TRK_L if dx < 0 else TRK_D
    branch(CX - 1, 19, -1, 7)   # left branch up and out
    branch(CX - 1, 15, -1, 5)
    branch(CX + 1, 17, 1, 8)    # right branch
    branch(CX + 1, 13, 1, 4)
    c.px[CX - 8, 14 - 0] = TRK_L; c.px[CX + 8, 11] = TRK_D
    return c


def bush():
    c = Canvas()
    spans = merge(ellipse_spans(16, 23, 10, 5, 2), ellipse_spans(11, 24, 5, 4, 3), ellipse_spans(22, 24, 5, 4, 4))
    spans = {y: v for y, v in spans.items() if y <= BASE}
    c.foliage(spans, 9)
    return c


TREES = [
    ('slim conifer', conifer([(5, 6, 1, 4), (9, 6, 2, 5), (13, 7, 2, 6)], 2, 11)),
    ('wide conifer', conifer([(11, 5, 2, 7), (15, 7, 4, 10)], 4, 12)),
    ('conifer sapling', conifer([(14, 4, 1, 3), (17, 5, 2, 5)], 2, 13)),
    ('tall conifer', conifer([(2, 6, 1, 4), (6, 6, 2, 6), (10, 6, 3, 7), (14, 8, 3, 9)], 4, 14)),
    ('round leafy tree', leafy(ellipse_spans(16, 13, 9, 8.5, 21), 19, 4, 21)),
    ('tall oval tree', leafy(ellipse_spans(16, 12, 7, 10.5, 22), 21, 4, 22)),
    ('wide leafy tree', leafy(ellipse_spans(16, 16, 13, 7.5, 23), 21, 4, 23)),
    ('twin-crown tree', leafy(merge(ellipse_spans(11, 15, 7, 6.5, 24), ellipse_spans(21, 12, 8, 7.5, 25), ellipse_spans(16, 19, 7, 4.5, 26)), 21, 4, 24)),
    ('bush', bush()),
    ('dead tree', dead_tree()),
]
frames = [c.img for _, c in TREES]
original = Image.open(SRC).convert('RGBA')

sheet = Image.new('RGBA', (N * len(frames), N))
for i, fr in enumerate(frames):
    sheet.paste(fr, (i * N, 0))
buf = io.BytesIO()
sheet.save(buf, 'PNG')
layer = {
    'name': 'Tree', 'opacity': 1, 'frameCount': len(frames),
    'chunks': [{'layout': [[i] for i in range(len(frames))], 'base64PNG': 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()}],
}
piskel = {'modelVersion': 2, 'piskel': {
    'name': 'trees', 'description': '; '.join(f'{i}: {n}' for i, (n, _) in enumerate(TREES)),
    'fps': 2, 'height': N, 'width': N, 'layers': [json.dumps(layer)], 'hiddenFrames': []}}
with open(f'{OUT_DIR}/trees.piskel', 'w') as fh:
    json.dump(piskel, fh)
sheet.save(f'{OUT_DIR}/trees_strip.png')

# preview: the original first, then the 10 new trees, on a grass-green strip so the shading reads; 8x
S, cols = 8, 6
rows = math.ceil((len(frames) + 1) / cols)
prev = Image.new('RGBA', (cols * (N * S + 8), rows * (N * S + 8)), (95, 174, 82, 255))
for i, fr in enumerate([original] + frames):
    prev.alpha_composite(fr.resize((N * S, N * S), Image.NEAREST), ((i % cols) * (N * S + 8) + 4, (i // cols) * (N * S + 8) + 4))
prev.save(f'{OUT_DIR}/trees_preview.png')


# ---- export for the game: PNGs + manifest entries ----
if TILESET:
    import os
    # (category, file name, weight, image). The canvas is 32 px wide and drawn 1.2 tiles wide, so all trees share
    # one pixel scale (a big tree really is bigger than a sapling); the base of the trunk is row 27 (anchor y 28/32).
    by_name = {n: c.img for n, c in TREES}
    PLAN = [
        ('objects.tree.conifer', 'tree_conifer_00', 3, original),
        ('objects.tree.conifer', 'tree_conifer_01', 2, by_name['slim conifer']),
        ('objects.tree.conifer', 'tree_conifer_02', 1, by_name['wide conifer']),
        ('objects.tree.conifer', 'tree_conifer_03', 2, by_name['tall conifer']),
        ('objects.tree.leafy', 'tree_leafy_00', 3, by_name['round leafy tree']),
        ('objects.tree.leafy', 'tree_leafy_01', 2, by_name['tall oval tree']),
        ('objects.tree.leafy', 'tree_leafy_02', 1, by_name['wide leafy tree']),
        ('objects.tree.leafy', 'tree_leafy_03', 1, by_name['twin-crown tree']),
        ('objects.tree.bush', 'tree_bush_00', 3, by_name['bush']),  # drawn smaller than the trees (see SMALLER)
        ('objects.tree.bush', 'tree_bush_01', 2, by_name['conifer sapling']),
        ('objects.tree.dead', 'tree_dead_00', 1, by_name['dead tree']),
    ]
    os.makedirs(f'{TILESET}/objects', exist_ok=True)
    entries = {}
    SMALLER = {'tree_bush_00': (0.75, 0.5)}  # name -> (widthInTiles, shadowInTiles): the bush is a low shrub
    for cat, name, weight, img in PLAN:
        img.save(f'{TILESET}/objects/{name}.png')
        entries.setdefault(cat, []).append({'file': f'objects/{name}.png', 'anchor': [0.5, 0.875], 'widthInTiles': SMALLER.get(name, (1.2, 0.75))[0], 'shadowInTiles': SMALLER.get(name, (1.2, 0.75))[1], 'weight': weight})
    path = f'{TILESET}/manifest.json'
    manifest = json.load(open(path)) if os.path.exists(path) else {}
    manifest.update(entries)
    with open(path, 'w') as fh:
        json.dump(manifest, fh, indent=2)
    print('exported', len(PLAN), 'trees to', TILESET)

print('frames', len(frames))
