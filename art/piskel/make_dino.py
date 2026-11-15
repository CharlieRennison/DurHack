"""The root island's baby dinosaur, drawn from the reference: a lavender long-necked dino with a pale belly, glassy
white back spikes, a pink tail tip and a little raised arm. 16x20 pixels, facing right, three frames (standing and two
steps). Writes public/assets/tileset/objects/dino_<frame>.png and the manifest entry objects.dino."""
import json, os
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
OUT = os.path.join(ROOT, 'public', 'assets', 'tileset', 'objects')
MANIFEST = os.path.join(ROOT, 'public', 'assets', 'tileset', 'manifest.json')

LAV = (192, 160, 226)    # body
SHADE = (160, 124, 204)  # far leg, underside, shadow
BELLY = (226, 214, 236)
SPIKE = (238, 244, 252)
SPIKE2 = (196, 232, 236)
PINK = (232, 168, 226)   # tail tip
MOUTH = (206, 72, 118)
EYE = (40, 30, 60)
W, H = 16, 20


def frame(back_dx, back_up, front_dx, front_up):
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    # far (back-side) leg first, darker
    bx = 4 + back_dx
    d.rectangle([bx, 13, bx + 2, 18 - back_up], fill=SHADE)
    d.rectangle([bx - 1, 18 - back_up, bx + 2, 18 - back_up], fill=SHADE)
    # tail: curves left and up, pink tip
    d.polygon([(4, 11), (2, 12), (1, 11), (1, 9), (2, 9), (2, 10), (4, 10)], fill=LAV)
    d.point((0, 8), fill=PINK); d.point((1, 8), fill=PINK); d.point((1, 9), fill=PINK); d.point((0, 9), fill=PINK)
    # body
    d.ellipse([3, 8, 12, 14], fill=LAV)
    # neck, rising to the head on the right
    d.polygon([(7, 9), (8, 4), (11, 3), (12, 4), (11, 9)], fill=LAV)
    # head and snout
    d.ellipse([9, 1, 14, 5], fill=LAV)
    d.rectangle([13, 3, 15, 4], fill=LAV)
    d.point((15, 4), fill=MOUTH); d.point((14, 4), fill=MOUTH)
    d.point((12, 2), fill=EYE)
    # pale belly and throat
    for y in range(4, 15):
        for x in range(W):
            if im.getpixel((x, y))[3] and ((x >= 10 and 5 <= y <= 13) or (x >= 7 and y >= 12)):
                im.putpixel((x, y), BELLY)
    # underside shading
    for x in range(4, 12):
        if im.getpixel((x, 14))[3]:
            im.putpixel((x, 14), SHADE)
    # head top fur tufts and glassy back spikes
    d.point((10, 0), fill=SPIKE); d.point((12, 0), fill=SPIKE)
    for (x, y, c) in [(6, 5, SPIKE), (7, 5, SPIKE2), (5, 7, SPIKE2), (6, 7, SPIKE), (4, 9, SPIKE), (5, 9, SPIKE2)]:
        d.point((x, y), fill=c)
    # little raised arm with a pale hand
    d.line([(12, 10), (13, 9), (14, 8)], fill=LAV)
    d.point((14, 8), fill=BELLY); d.point((15, 7), fill=BELLY)
    # near (front) leg on top
    fx = 9 + front_dx
    d.rectangle([fx, 13, fx + 2, 18 - front_up], fill=LAV)
    d.rectangle([fx, 18 - front_up, fx + 3, 18 - front_up], fill=LAV)
    return im


FRAMES = [frame(0, 0, 0, 0), frame(-1, 1, 1, 0), frame(1, 0, -1, 1)]

manifest = json.load(open(MANIFEST, encoding='utf-8'))
entries = []
for f, im in enumerate(FRAMES):
    name = f'dino_{f}.png'
    im.save(os.path.join(OUT, name))
    entries.append({'file': 'objects/' + name, 'anchor': [0.5, 0.95], 'widthInTiles': 1.0})
manifest['objects.dino'] = entries
raw = open(MANIFEST, encoding='utf-8', newline='').read()
text = json.dumps(manifest, indent=2)
open(MANIFEST, 'w', encoding='utf-8', newline='').write(text.replace('\n', '\r\n') if '\r\n' in raw else text)

big = Image.new('RGBA', (W * 3 * 12 + 40, H * 12), (120, 170, 90, 255))
for k, im in enumerate(FRAMES):
    b = im.resize((W * 12, H * 12), Image.NEAREST)
    big.paste(b, (k * (W * 12 + 20), 0), b)
big.save(os.path.join(os.environ.get('PREVIEW_DIR', '.'), 'dino_preview.png'))
print('ok')
