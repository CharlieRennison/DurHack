"""More houses in the style of the original 32x32 hut, saved as a .piskel file.

Usage: python make_houses.py <original_hut.png> <out_dir> [<tileset_dir>]

With <tileset_dir> (public/assets/tileset) the houses are also exported as PNGs and merged into its manifest.json
under objects.hut.small / .medium / .large (the original hut counts as a medium house).

Same look as the original: a broad brown roof with a darker right edge, light tan walls with a darker right edge,
a black doorway, plus-shaped orange windows with a yellow centre, and little green bushes with magenta flowers at
the foot. Light comes from the upper left. Every house stands with its wall bottom on row 22 and is centred on x = 16,
so they all share one anchor point. Frames 0-8 are the new houses (small, medium, large).
"""
import base64, io, json, math, sys
from PIL import Image

SRC, OUT_DIR = sys.argv[1], sys.argv[2]
TILESET = sys.argv[3] if len(sys.argv) > 3 else None
N, CX, BASE = 32, 16, 22

# colours taken from the original
WALL, WALL_D = (180, 146, 42, 255), (135, 105, 11, 255)
ROOF_BROWN = ((103, 83, 19, 255), (90, 71, 13, 255))
BLACK = (0, 0, 0, 255)
WIN_FRAME, WIN_GLOW, SILL = (213, 121, 12, 255), (217, 180, 30, 255), (103, 83, 19, 255)
BUSH, FLOWER = (16, 83, 5, 255), (191, 65, 195, 255)
# a few extra roofs / walls in the same muted, earthy range
ROOF_RED = ((150, 58, 26, 255), (118, 42, 18, 255))
ROOF_SLATE = ((92, 98, 112, 255), (68, 74, 88, 255))
ROOF_MOSS = ((74, 104, 34, 255), (52, 78, 24, 255))
ROOF_THATCH = ((196, 160, 52, 255), (150, 118, 32, 255))
STONE, STONE_D = (150, 148, 140, 255), (112, 110, 104, 255)
WALL_WHITE, WALL_WHITE_D = (222, 210, 178, 255), (170, 158, 124, 255)
WALL_STONE, WALL_STONE_D = (160, 152, 138, 255), (118, 110, 96, 255)


class Canvas:
    def __init__(self):
        self.img = Image.new('RGBA', (N, N))
        self.px = self.img.load()

    def put(self, x, y, c):
        if 0 <= x < N and 0 <= y < N:
            self.px[x, y] = c

    def rect(self, x0, y0, x1, y1, c):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.put(x, y, c)


def roof(c, top, rows, top_hw, bottom_hw, colours, drop=True):
    """Broad roof: widens from top_hw to bottom_hw, darker right edge, a short pointed 'drop' under the middle."""
    main, dark = colours
    for r in range(rows):
        t = r / max(1, rows - 1)
        hw = top_hw + (bottom_hw - top_hw) * t
        x0 = CX - int(round(hw)) - (1 if r % 2 else 0)
        x1 = CX + int(round(hw)) - 1 + (1 if r % 3 == 2 else 0)
        for x in range(x0, x1 + 1):
            c.put(x, top + r, dark if x > x1 - (2 if r < 3 else 3) else main)
    # a few shingle / thatch ticks
    for r in range(2, rows, 3):
        y = top + r
        for x in range(CX - int(top_hw) - 2, CX + int(bottom_hw), 5):
            if main == c.px[x, y]:
                c.put(x + (r % 2), y, dark)
    if drop:  # the roof reaches down the middle of the front, like the original
        y0 = top + rows
        for k, w in enumerate((int(bottom_hw) - 2, 3)):
            for x in range(CX - w, CX + w):
                c.put(x, y0 + k, dark if x >= CX + w - 1 else main)


def walls(c, ww, top, colours):
    light, dark = colours
    c.rect(CX - ww, top, CX + ww - 1, BASE, light)
    c.rect(CX + ww - 1, top, CX + ww - 1, BASE, dark)
    if ww >= 6:
        c.rect(CX + ww - 2, top + 1, CX + ww - 2, BASE, dark if (top + 1) % 2 else light)  # small step in the shade
    c.rect(CX - ww, BASE, CX + ww - 1, BASE, dark)  # base line


def door(c, x, w=4, h=5, colour=BLACK):
    c.rect(x, BASE - h, x + w - 1, BASE - 1, colour)
    c.rect(x, BASE, x + w - 1, BASE, colour)


def window(c, x, y):
    """The plus-shaped window of the original, centred on (x, y)."""
    c.put(x, y - 1, WIN_FRAME)
    c.put(x - 1, y, WIN_FRAME); c.put(x + 1, y, WIN_FRAME); c.put(x, y, WIN_GLOW)
    c.put(x, y + 1, SILL)


def bushes(c, x, flowers=1):
    for dx, dy in [(0, 0), (1, 0), (2, 0), (0, -1), (1, -1), (0, 1), (1, 1), (-1, 1)]:
        c.put(x + dx, BASE - 3 + dy, BUSH)
    for k in range(flowers):
        c.put(x + 1 + k, BASE - 2 + k, FLOWER)
    c.put(x - 1, BASE - 1, BUSH); c.put(x, BASE - 1, BUSH); c.put(x + 1, BASE - 1, BUSH)


def chimney(c, x, y):
    c.rect(x, y, x + 2, y + 4, STONE)
    c.rect(x + 2, y, x + 2, y + 4, STONE_D)
    c.rect(x - 1, y - 1, x + 3, y - 1, STONE_D)


def house(ww, wall_h, roof_rows, roof_colours, wall_colours=(WALL, WALL_D), top_hw=5, doors=((0, 4),), windows=(), bush_at=None, chimney_at=None, second=False):
    c = Canvas()
    wall_top = BASE - wall_h + 1
    roof_top = wall_top - roof_rows - 1
    walls(c, ww, wall_top, wall_colours)
    if second:  # a lip between two floors
        c.rect(CX - ww, wall_top + wall_h // 2 - 1, CX + ww - 1, wall_top + wall_h // 2 - 1, wall_colours[1])
    for dx, w in doors:
        door(c, CX + dx - w // 2, w, min(5, wall_h - 2))
    for wx, wy in windows:
        window(c, CX + wx, BASE - wy)
    if bush_at is not None:
        bushes(c, CX + bush_at, flowers=2)
    roof(c, roof_top, roof_rows, top_hw, ww + 1.5, roof_colours)
    if chimney_at is not None:
        chimney(c, CX + chimney_at, roof_top - 2)
    return c


HOUSES = [
    # small huts (about 10-12 px wide)
    ('small hut', house(5, 5, 5, ROOF_BROWN, top_hw=3, doors=((0, 3),))),
    ('small hut, window', house(6, 6, 5, ROOF_THATCH, top_hw=3, doors=((2, 3),), windows=((-3, 3),))),
    ('small hut, bush', house(5, 5, 5, ROOF_MOSS, top_hw=3, doors=((1, 3),), bush_at=-9)),
    # medium houses (like the original, about 17 px wide)
    ('red roof house', house(8, 8, 8, ROOF_RED, doors=((0, 4),), windows=((-5, 4), (5, 4)), bush_at=-11)),
    ('stone house, chimney', house(8, 8, 8, ROOF_SLATE, wall_colours=(WALL_STONE, WALL_STONE_D), doors=((-1, 4),), windows=((4, 4),), chimney_at=3)),
    ('cottage, two windows', house(7, 8, 7, ROOF_BROWN, wall_colours=(WALL_WHITE, WALL_WHITE_D), top_hw=4, doors=((0, 4),), windows=((-4, 4), (4, 4)), bush_at=10)),
    # large buildings (about 24 px wide)
    ('long house', house(11, 8, 8, ROOF_BROWN, top_hw=7, doors=((-4, 4), (4, 4)), windows=((0, 4), (-8, 4), (8, 4)))),
    ('two-storey house', house(8, 14, 8, ROOF_RED, wall_colours=(WALL_WHITE, WALL_WHITE_D), doors=((0, 4),), windows=((-4, 4), (4, 4), (-4, 10), (4, 10)), second=True, chimney_at=-6)),
    ('big hall', house(12, 9, 9, ROOF_SLATE, wall_colours=(WALL_STONE, WALL_STONE_D), top_hw=8, doors=((0, 5),), windows=((-6, 4), (6, 4), (-9, 4), (9, 4)), chimney_at=8)),
]
frames = [c.img for _, c in HOUSES]
original = Image.open(SRC).convert('RGBA')

sheet = Image.new('RGBA', (N * len(frames), N))
for i, fr in enumerate(frames):
    sheet.paste(fr, (i * N, 0))
buf = io.BytesIO()
sheet.save(buf, 'PNG')
layer = {'name': 'House', 'opacity': 1, 'frameCount': len(frames),
         'chunks': [{'layout': [[i] for i in range(len(frames))], 'base64PNG': 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()}]}
piskel = {'modelVersion': 2, 'piskel': {'name': 'houses', 'description': '; '.join(f'{i}: {n}' for i, (n, _) in enumerate(HOUSES)),
          'fps': 2, 'height': N, 'width': N, 'layers': [json.dumps(layer)], 'hiddenFrames': []}}
with open(f'{OUT_DIR}/houses.piskel', 'w') as fh:
    json.dump(piskel, fh)
sheet.save(f'{OUT_DIR}/houses_strip.png')

S, cols = 8, 5
rows = math.ceil((len(frames) + 1) / cols)
prev = Image.new('RGBA', (cols * (N * S + 8), rows * (N * S + 8)), (95, 174, 82, 255))
for i, fr in enumerate([original] + frames):
    prev.alpha_composite(fr.resize((N * S, N * S), Image.NEAREST), ((i % cols) * (N * S + 8) + 4, (i // cols) * (N * S + 8) + 4))
prev.save(f'{OUT_DIR}/houses_preview.png')


if TILESET:
    import os
    # Nominal size: the 32 px canvas drawn 1 tile wide; the renderer rescales each house to fit its patch of tiles.
    # Anchor: the bottom of the wall (row 22 of 32).
    PLAN = [
        ('small', 'hut_small_00', 1, frames[0]), ('small', 'hut_small_01', 1, frames[1]), ('small', 'hut_small_02', 1, frames[2]),
        ('medium', 'hut_medium_00', 2, original), ('medium', 'hut_medium_01', 1, frames[3]),
        ('medium', 'hut_medium_02', 1, frames[4]), ('medium', 'hut_medium_03', 1, frames[5]),
        ('large', 'hut_large_00', 1, frames[6]), ('large', 'hut_large_01', 1, frames[7]), ('large', 'hut_large_02', 1, frames[8]),
    ]
    os.makedirs(f'{TILESET}/objects', exist_ok=True)
    entries = {}
    for size, name, weight, img in PLAN:
        img.save(f'{TILESET}/objects/{name}.png')
        entries.setdefault(f'objects.hut.{size}', []).append({'file': f'objects/{name}.png', 'anchor': [0.5, 23 / 32], 'widthInTiles': 1.0, 'weight': weight})
    path = f'{TILESET}/manifest.json'
    manifest = json.load(open(path)) if os.path.exists(path) else {}
    manifest.update(entries)
    with open(path, 'w') as fh:
        json.dump(manifest, fh, indent=2)
    print('exported', len(PLAN), 'houses to', TILESET)

print('frames', len(frames))
