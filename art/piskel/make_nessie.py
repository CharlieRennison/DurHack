"""The Loch Ness monster: the dino's lavender cousin, seen as a sea serpent. A long neck and head, two humps, a pink
tail tip and glassy spikes rise out of the water, with ripples at the waterline. 24x18 pixels, facing right, three
bobbing frames. Writes public/assets/tileset/objects/nessie_<frame>.png and the manifest entry objects.nessie."""
import json, os
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
OUT = os.path.join(ROOT, 'public', 'assets', 'tileset', 'objects')
MANIFEST = os.path.join(ROOT, 'public', 'assets', 'tileset', 'manifest.json')

LAV = (192, 160, 226)
SHADE = (160, 124, 204)
BELLY = (226, 214, 236)
SPIKE = (238, 244, 252)
SPIKE2 = (196, 232, 236)
PINK = (232, 168, 226)
MOUTH = (206, 72, 118)
EYE = (40, 30, 60)
FOAM = (214, 240, 248)
W, H = 24, 18
WATER = 15  # the waterline: everything below is hidden by the sea, ripples sit on it


def frame(neck_lift, hump_lift):
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    n = neck_lift
    # tail tip, then two humps
    d.ellipse([0, 12, 3, 16], fill=LAV); d.point((0, 12), fill=PINK); d.point((1, 12), fill=PINK); d.point((0, 13), fill=PINK)
    h1 = hump_lift
    d.ellipse([3, 10 - h1, 9, 18], fill=LAV)
    d.ellipse([9, 11 - hump_lift, 15, 18], fill=LAV)
    # neck rising to the head
    d.line([(15, 14), (16, 9 - n), (18, 5 - n)], fill=LAV, width=3)
    d.line([(14, 14), (15, 10 - n)], fill=LAV, width=2)
    # head and snout
    d.ellipse([17, 1 - n, 22, 5 - n], fill=LAV)
    d.rectangle([21, 3 - n, 23, 4 - n], fill=LAV)
    d.point((23, 4 - n), fill=MOUTH); d.point((22, 4 - n), fill=MOUTH)
    d.point((20, 2 - n), fill=EYE)
    d.point((18, 0 - n), fill=SPIKE); d.point((20, 0 - n), fill=SPIKE)
    # pale throat
    for y in range(3 - n, 12 - n):
        for x in range(19, 22):
            if 0 <= y < H and im.getpixel((x, y))[3]:
                im.putpixel((x, y), BELLY)
    # glassy spikes down the back
    for (x, y, c) in [(15, 7 - n, SPIKE), (16, 6 - n, SPIKE2), (12, 9 - hump_lift, SPIKE), (13, 8 - hump_lift, SPIKE2),
                      (6, 8 - h1, SPIKE), (7, 8 - h1, SPIKE2), (3, 11, SPIKE2)]:
        if 0 <= y < H:
            d.point((x, y), fill=c)
    # the sea hides everything below the waterline
    for y in range(WATER, H):
        for x in range(W):
            im.putpixel((x, y), (0, 0, 0, 0))
    # ripples around the bases
    for x in (0, 1, 2, 4, 5, 8, 9, 10, 13, 14, 15, 16, 17, 20, 21):
        im.putpixel((x, WATER - 1 if x % 3 == 0 else WATER), FOAM + (255,))
    return im


FRAMES = [frame(0, 0), frame(1, 1), frame(0, 1)]

manifest = json.load(open(MANIFEST, encoding='utf-8'))
manifest['objects.nessie'] = [{'file': f'objects/nessie_{i}.png', 'anchor': [0.5, 0.85], 'widthInTiles': 1.0} for i in range(3)]
for i, im in enumerate(FRAMES):
    im.save(os.path.join(OUT, f'nessie_{i}.png'))
raw = open(MANIFEST, encoding='utf-8', newline='').read()
text = json.dumps(manifest, indent=2)
open(MANIFEST, 'w', encoding='utf-8', newline='').write(text.replace('\n', '\r\n') if '\r\n' in raw else text)

big = Image.new('RGBA', (W * 3 * 10 + 40, H * 10), (28, 168, 184, 255))
for k, im in enumerate(FRAMES):
    b = im.resize((W * 10, H * 10), Image.NEAREST)
    big.paste(b, (k * (W * 10 + 20), 0), b)
big.save(os.path.join(os.environ.get('PREVIEW_DIR', '.'), 'nessie_preview.png'))
print('ok')
