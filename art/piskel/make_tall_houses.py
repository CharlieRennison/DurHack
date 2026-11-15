"""Houses with 1 to 4 floors, all the same width, in the style of the original hut. Saved as a .piskel file.

Usage: python make_tall_houses.py <original_hut.png> <out_dir> [<tileset_dir>]

A bigger file is a taller house, not a wider one: every house is 16 px wide and the walls grow by one floor (7 px)
at a time, with the same broad roof on top. Three styles per height (thatch, red tile, slate on stone), 12 houses.
The canvas is 32 x 48 and the foot of every wall is row 44, so all of them share one anchor.

With <tileset_dir> (public/assets/tileset) the houses are exported as PNGs and merged into manifest.json under
objects.house.1 .. objects.house.4 (the original hut joins objects.house.1). Entries carry `buildingPx` (the width of
the building inside the image) so the game can draw every building at exactly the same width.
"""
import base64, io, json, math, sys
from PIL import Image

SRC, OUT_DIR = sys.argv[1], sys.argv[2]
TILESET = sys.argv[3] if len(sys.argv) > 3 else None
W, H, CX, BASE = 32, 48, 16, 44
WW = 8  # half width of the walls: 16 px wide

WALL, WALL_D = (180, 146, 42, 255), (135, 105, 11, 255)
ROOF_BROWN = ((103, 83, 19, 255), (90, 71, 13, 255))
ROOF_RED = ((150, 58, 26, 255), (118, 42, 18, 255))
ROOF_SLATE = ((92, 98, 112, 255), (68, 74, 88, 255))
WALL_WHITE, WALL_WHITE_D = (222, 210, 178, 255), (170, 158, 124, 255)
WALL_STONE, WALL_STONE_D = (160, 152, 138, 255), (118, 110, 96, 255)
BLACK = (0, 0, 0, 255)
WIN_FRAME, WIN_GLOW, SILL = (213, 121, 12, 255), (217, 180, 30, 255), (103, 83, 19, 255)
BUSH, FLOWER = (16, 83, 5, 255), (191, 65, 195, 255)
STONE, STONE_D = (150, 148, 140, 255), (112, 110, 104, 255)
FLOOR = 7  # px per floor


class Canvas:
    def __init__(self):
        self.img = Image.new('RGBA', (W, H))
        self.px = self.img.load()

    def put(self, x, y, c):
        if 0 <= x < W and 0 <= y < H:
            self.px[x, y] = c

    def rect(self, x0, y0, x1, y1, c):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.put(x, y, c)


def roof(c, top, rows, colours):
    main, dark = colours
    top_hw, bottom_hw = 5, WW + 1.5
    for r in range(rows):
        t = r / max(1, rows - 1)
        hw = top_hw + (bottom_hw - top_hw) * t
        x0 = CX - int(round(hw)) - (1 if r % 2 else 0)
        x1 = CX + int(round(hw)) - 1 + (1 if r % 3 == 2 else 0)
        for x in range(x0, x1 + 1):
            c.put(x, top + r, dark if x > x1 - (2 if r < 3 else 3) else main)
    for r in range(2, rows, 3):
        y = top + r
        for x in range(CX - top_hw - 2, CX + int(bottom_hw), 5):
            if main == c.px[x, y]:
                c.put(x + (r % 2), y, dark)
    y0 = top + rows
    for k, w in enumerate((int(bottom_hw) - 2, 3)):
        for x in range(CX - w, CX + w):
            c.put(x, y0 + k, dark if x >= CX + w - 1 else main)


def window(c, x, y):
    c.put(x, y - 1, WIN_FRAME)
    c.put(x - 1, y, WIN_FRAME); c.put(x + 1, y, WIN_FRAME); c.put(x, y, WIN_GLOW)
    c.put(x, y + 1, SILL)


def tall_house(floors, roof_colours, wall_colours, chimney=False, bush=False):
    c = Canvas()
    light, dark = wall_colours
    wall_h = FLOOR * floors + 1
    wall_top = BASE - wall_h + 1
    c.rect(CX - WW, wall_top, CX + WW - 1, BASE, light)
    c.rect(CX + WW - 1, wall_top, CX + WW - 1, BASE, dark)
    c.rect(CX + WW - 2, wall_top + 1, CX + WW - 2, BASE, dark if (wall_top + 1) % 2 else light)
    c.rect(CX - WW, BASE, CX + WW - 1, BASE, dark)
    for f in range(1, floors):  # lip between floors
        c.rect(CX - WW, BASE - FLOOR * f, CX + WW - 1, BASE - FLOOR * f, dark)
    # ground floor: door in the middle, a window each side; upper floors: two windows (three when the house is tall)
    c.rect(CX - 2, BASE - 5, CX + 1, BASE, BLACK)
    window(c, CX - 5, BASE - 3); window(c, CX + 4, BASE - 3)
    for f in range(1, floors):
        y = BASE - FLOOR * f - 3
        window(c, CX - 4, y); window(c, CX + 3, y)
    roof_rows = 8
    roof_top = wall_top - roof_rows - 1
    roof(c, roof_top, roof_rows, roof_colours)
    if chimney:
        x = CX + 4
        c.rect(x, roof_top - 3, x + 2, roof_top + 2, STONE)
        c.rect(x + 2, roof_top - 3, x + 2, roof_top + 2, STONE_D)
        c.rect(x - 1, roof_top - 4, x + 3, roof_top - 4, STONE_D)
    if bush:
        bx = CX - WW - 3
        for dx, dy in [(0, 0), (1, 0), (2, 0), (0, -1), (1, -1), (0, 1), (1, 1), (-1, 1)]:
            c.put(bx + dx, BASE - 3 + dy, BUSH)
        c.put(bx + 1, BASE - 2, FLOWER); c.put(bx + 2, BASE - 1, FLOWER)
    return c


STYLES = [
    ('thatch', ROOF_BROWN, (WALL, WALL_D), False, True),
    ('red tile', ROOF_RED, (WALL_WHITE, WALL_WHITE_D), True, False),
    ('slate', ROOF_SLATE, (WALL_STONE, WALL_STONE_D), True, True),
]
HOUSES = [(f'{f} floor{"s" if f > 1 else ""}, {name}', f, tall_house(f, rc, wc, ch, bu)) for f in (1, 2, 3, 4) for name, rc, wc, ch, bu in STYLES]
frames = [c.img for _, _, c in HOUSES]
original = Image.open(SRC).convert('RGBA')

sheet = Image.new('RGBA', (W * len(frames), H))
for i, fr in enumerate(frames):
    sheet.paste(fr, (i * W, 0))
buf = io.BytesIO()
sheet.save(buf, 'PNG')
layer = {'name': 'House', 'opacity': 1, 'frameCount': len(frames),
         'chunks': [{'layout': [[i] for i in range(len(frames))], 'base64PNG': 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()}]}
piskel = {'modelVersion': 2, 'piskel': {'name': 'tall_houses', 'description': '; '.join(f'{i}: {n}' for i, (n, _, _) in enumerate(HOUSES)),
          'fps': 2, 'height': H, 'width': W, 'layers': [json.dumps(layer)], 'hiddenFrames': []}}
with open(f'{OUT_DIR}/houses_tall.piskel', 'w') as fh:
    json.dump(piskel, fh)

S, cols = 6, 6
rows = math.ceil((len(frames) + 1) / cols)
prev = Image.new('RGBA', (cols * (W * S + 8), rows * (H * S + 8)), (95, 174, 82, 255))
orig48 = Image.new('RGBA', (W, H)); orig48.paste(original, (0, H - 32 - 4))
for i, fr in enumerate([orig48] + frames):
    prev.alpha_composite(fr.resize((W * S, H * S), Image.NEAREST), ((i % cols) * (W * S + 8) + 4, (i // cols) * (H * S + 8) + 4))
prev.save(f'{OUT_DIR}/houses_tall_preview.png')

if TILESET:
    import os
    os.makedirs(f'{TILESET}/objects', exist_ok=True)
    entries = {}
    for k, (name, floors, c) in enumerate(HOUSES):
        fname = f'house_f{floors}_{k % 3}'
        c.img.save(f'{TILESET}/objects/{fname}.png')
        entries.setdefault(f'objects.house.{floors}', []).append(
            {'file': f'objects/{fname}.png', 'anchor': [0.5, (BASE + 1) / H], 'widthInTiles': 1.0, 'buildingPx': 16, 'topPx': 31 - 7 * floors, 'weight': 1})
    # the original single-storey hut is a 1-floor house too (32 x 32, wall foot on row 22, building 17 px wide)
    original.save(f'{TILESET}/objects/house_f1_hut.png')
    entries['objects.house.1'].append({'file': 'objects/house_f1_hut.png', 'anchor': [0.5, 23 / 32], 'widthInTiles': 1.0, 'buildingPx': 17, 'topPx': 6, 'weight': 2})
    path = f'{TILESET}/manifest.json'
    manifest = json.load(open(path)) if os.path.exists(path) else {}
    manifest.update(entries)
    with open(path, 'w') as fh:
        json.dump(manifest, fh, indent=2)
    print('exported', sum(len(v) for v in entries.values()), 'houses to', TILESET)
print('frames', len(frames))
