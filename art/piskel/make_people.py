"""Tiny pixel-art people (the collaborators), saved as a .piskel file.

Usage: python make_people.py <out_dir> [<tileset_dir>]

8 people (different hair, skin, shirt and trousers), 3 frames each on an 8 x 10 canvas: standing, and the two steps of
a walk. They are drawn at the same pixel scale as the houses, so a person is about as tall as a door. A little
asymmetry (a bag strap on one shoulder) shows which way they face when the sprite is mirrored.
Frames in the .piskel are ordered person 0 (stand, step A, step B), person 1 (...), and so on.

With <tileset_dir> the frames are exported as PNGs and merged into manifest.json under objects.person.0 ..
objects.person.7 (frame order: stand, step A, step B). The feet are on row 9 of the canvas (anchor y = 9 / 10).
"""
import base64, io, json, math, os, sys
from PIL import Image

OUT_DIR = sys.argv[1]
TILESET = sys.argv[2] if len(sys.argv) > 2 else None
W, H = 8, 10

SKIN = [(244, 205, 170, 255), (226, 170, 124, 255), (186, 124, 84, 255), (130, 86, 56, 255)]
HAIR = [(52, 36, 24, 255), (120, 78, 36, 255), (214, 170, 70, 255), (28, 28, 34, 255), (170, 70, 40, 255), (200, 200, 205, 255)]
SHIRT = [(200, 56, 48, 255), (52, 112, 190, 255), (70, 150, 84, 255), (226, 176, 48, 255), (140, 86, 180, 255), (232, 232, 226, 255), (232, 120, 48, 255), (52, 170, 170, 255)]
PANTS = [(54, 62, 96, 255), (70, 56, 44, 255), (44, 44, 52, 255), (92, 98, 70, 255)]
SHOE = (36, 28, 24, 255)
EYE = (30, 24, 24, 255)
STRAP = (96, 66, 34, 255)


def person(v, frame):
    """frame 0 = standing, 1 = left foot forward, 2 = right foot forward."""
    skin, hair = SKIN[v % 4], HAIR[(v * 3 + 1) % 6]
    shirt, pants = SHIRT[v], PANTS[(v // 2 + v) % 4]
    img = Image.new('RGBA', (W, H))
    p = img.load()

    def put(x, y, c):
        p[x, y] = c

    bob = 1 if frame in (1, 2) else 0  # the whole figure dips a pixel while stepping
    top = 1 + bob
    # head: hair on top, face with two eyes
    for x in (2, 3, 4): put(x, top, hair)
    put(1, top + 1, hair) if v % 3 == 0 else None  # a longer tuft of hair on some
    for x in (2, 3, 4): put(x, top + 1, skin)
    put(2, top + 1, EYE); put(4, top + 1, EYE)
    # body: shirt with arms; arms swing while walking
    for y in (top + 2, top + 3):
        for x in (2, 3, 4): put(x, y, shirt)
    swing = {0: (0, 0), 1: (-1, 1), 2: (1, -1)}[frame]
    put(1, top + 2 + (1 if swing[0] > 0 else 0), skin); put(5, top + 2 + (1 if swing[1] > 0 else 0), skin)
    put(1, top + 3, shirt) if swing[0] <= 0 else None
    put(5, top + 3, shirt) if swing[1] <= 0 else None
    put(3, top + 2, STRAP) if v % 2 == 1 else None  # bag strap across the chest on every other person
    put(4, top + 3, STRAP) if v % 2 == 1 else None
    # legs and feet
    ly = top + 4
    if frame == 0:
        for x in (2, 4): put(x, ly, pants); put(x, ly + 1, SHOE)
        put(3, ly, pants)
    elif frame == 1:
        put(2, ly, pants); put(3, ly, pants); put(2, ly + 1, SHOE)
        put(4, ly, pants); put(5, ly + 1 - 1, SHOE) if False else None
        put(4, ly + 1, SHOE) if bob == 0 else None
        put(5, ly, pants)
    else:
        put(3, ly, pants); put(4, ly, pants); put(4, ly + 1, SHOE)
        put(2, ly, pants); put(1, ly, pants) if False else None
        put(2, ly + 1, SHOE) if bob == 0 else None
    return img


PEOPLE = [[person(v, f) for f in range(3)] for v in range(8)]
frames = [im for fs in PEOPLE for im in fs]

sheet = Image.new('RGBA', (W * len(frames), H))
for i, fr in enumerate(frames):
    sheet.paste(fr, (i * W, 0))
buf = io.BytesIO()
sheet.save(buf, 'PNG')
layer = {'name': 'People', 'opacity': 1, 'frameCount': len(frames),
         'chunks': [{'layout': [[i] for i in range(len(frames))], 'base64PNG': 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()}]}
piskel = {'modelVersion': 2, 'piskel': {'name': 'people', 'description': '8 people x 3 frames (stand, step A, step B)',
          'fps': 6, 'height': H, 'width': W, 'layers': [json.dumps(layer)], 'hiddenFrames': []}}
with open(f'{OUT_DIR}/people.piskel', 'w') as fh:
    json.dump(piskel, fh)

S = 12
prev = Image.new('RGBA', (3 * (W * S + 10) + 10, 8 * (H * S + 10) + 10), (95, 174, 82, 255))
for v, fs in enumerate(PEOPLE):
    for f, im in enumerate(fs):
        prev.alpha_composite(im.resize((W * S, H * S), Image.NEAREST), (10 + f * (W * S + 10), 10 + v * (H * S + 10)))
prev.save(f'{OUT_DIR}/people_preview.png')

if TILESET:
    os.makedirs(f'{TILESET}/objects', exist_ok=True)
    entries = {}
    for v, fs in enumerate(PEOPLE):
        for f, im in enumerate(fs):
            name = f'person_{v}_{f}'
            im.save(f'{TILESET}/objects/{name}.png')
            entries.setdefault(f'objects.person.{v}', []).append(
                {'file': f'objects/{name}.png', 'anchor': [0.5, 9 / 10], 'widthInTiles': 1.0})
    path = f'{TILESET}/manifest.json'
    manifest = json.load(open(path)) if os.path.exists(path) else {}
    manifest.update(entries)
    with open(path, 'w') as fh:
        json.dump(manifest, fh, indent=2)
    print('exported', len(frames), 'person frames to', TILESET)
print('people', len(PEOPLE))
