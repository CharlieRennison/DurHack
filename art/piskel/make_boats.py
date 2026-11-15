"""A small pixel-art sailing boat (2 bobbing frames), saved as a .piskel file.

Usage: python make_boats.py <out_dir> [<tileset_dir>]

16 x 14 canvas, facing right (the game mirrors it to sail left). Wooden hull, white sail on a mast, a red pennant.
Frame 1 is the same boat a pixel lower with the sail filled a little more, so it bobs on the water.
With <tileset_dir> the frames are exported and merged into manifest.json under objects.boat (frame order 0, 1).
The waterline is row 12 (anchor y = 12 / 14).
"""
import base64, io, json, os, sys
from PIL import Image

OUT_DIR = sys.argv[1]
TILESET = sys.argv[2] if len(sys.argv) > 2 else None
W, H = 16, 14
HULL, HULL_D, RIM = (128, 82, 40, 255), (92, 58, 28, 255), (170, 118, 62, 255)
SAIL, SAIL_D = (244, 240, 228, 255), (206, 200, 186, 255)
MAST, FLAG = (70, 48, 26, 255), (214, 64, 48, 255)
FOAM = (255, 255, 255, 200)


def boat(frame):
    img = Image.new('RGBA', (W, H))
    p = img.load()
    d = frame  # 0 or 1: bob down a pixel
    # hull: a shallow boat shape, rim highlight on top, darker below
    rows = [(2, 13), (3, 12), (4, 11)]
    for k, (x0, x1) in enumerate(rows):
        y = 9 + k + d
        if y >= H:
            continue
        for x in range(x0, x1 + 1):
            p[x, y] = RIM if k == 0 else (HULL if k == 1 else HULL_D)
    p[14, 9 + d] = RIM  # the bow sticks out a little (facing right)
    # mast and sail
    for y in range(2 + d, 9 + d):
        p[7, y] = MAST
    belly = 1 if frame == 1 else 0
    for y in range(3 + d, 8 + d):
        width = min(4 + belly, (y - (2 + d)) + 1)
        for x in range(8, 8 + width):
            p[x, y] = SAIL if x < 8 + width - 1 else SAIL_D
    # pennant
    p[6, 2 + d] = FLAG
    p[5, 2 + d] = FLAG
    # a touch of foam at the waterline
    if 12 + d < H:
        p[1, 12 + d - 1] = FOAM
        p[14, 12 + d - 1] = FOAM
    return img


frames = [boat(0), boat(1)]
sheet = Image.new('RGBA', (W * 2, H))
for i, fr in enumerate(frames):
    sheet.paste(fr, (i * W, 0))
buf = io.BytesIO()
sheet.save(buf, 'PNG')
layer = {'name': 'Boat', 'opacity': 1, 'frameCount': 2,
         'chunks': [{'layout': [[0], [1]], 'base64PNG': 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()}]}
with open(f'{OUT_DIR}/boat.piskel', 'w') as fh:
    json.dump({'modelVersion': 2, 'piskel': {'name': 'boat', 'description': 'sailing boat, 2 bob frames, facing right',
               'fps': 2, 'height': H, 'width': W, 'layers': [json.dumps(layer)], 'hiddenFrames': []}}, fh)
S = 12
prev = Image.new('RGBA', (2 * (W * S + 10) + 10, H * S + 20), (24, 167, 180, 255))
for i, fr in enumerate(frames):
    prev.alpha_composite(fr.resize((W * S, H * S), Image.NEAREST), (10 + i * (W * S + 10), 10))
prev.save(f'{OUT_DIR}/boat_preview.png')

if TILESET:
    os.makedirs(f'{TILESET}/objects', exist_ok=True)
    entries = []
    for i, fr in enumerate(frames):
        fr.save(f'{TILESET}/objects/boat_{i}.png')
        entries.append({'file': f'objects/boat_{i}.png', 'anchor': [0.5, 12 / 14], 'widthInTiles': 1.0})
    path = f'{TILESET}/manifest.json'
    manifest = json.load(open(path)) if os.path.exists(path) else {}
    manifest['objects.boat'] = entries
    with open(path, 'w') as fh:
        json.dump(manifest, fh, indent=2)
    print('exported boat frames to', TILESET)
