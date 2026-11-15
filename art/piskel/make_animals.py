"""Little pixel-art animals (sheep, fox, deer), facing right, three frames each: standing and two steps.
Writes public/assets/tileset/objects/animal_<kind>_<frame>.png and the manifest entries objects.animal.<kind>."""
import json, os
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
OUT = os.path.join(ROOT, 'public', 'assets', 'tileset', 'objects')
MANIFEST = os.path.join(ROOT, 'public', 'assets', 'tileset', 'manifest.json')

PAL = {
    'w': (242, 239, 230), 'd': (74, 64, 56), 'l': (90, 81, 72),
    'o': (217, 121, 43), 'n': (34, 34, 34), 'k': (74, 58, 42),
    'b': (154, 107, 63), 'c': (216, 191, 147), 'a': (217, 201, 160),
}
# body rows (6 rows), then the legs are drawn per frame under it
BODY = {
    'sheep': ["............", "..wwwww.....", ".wwwwwww.dd.", ".wwwwwwwdddd", ".wwwwwwwddd.", "..wwwwww.d.."],
    'fox':   ["........o.o.", "........ooo.", "ww.ooooooon.", "wwooooooooo.", ".oooooooooo.", "..oooooooo.."],
    'deer':  ["........a.a.", "........bbb.", "......b.bbbn", ".bbbbbbbbbb.", ".bbbbbbbbb..", ".bccccccb..."],
}
LEG = {'sheep': 'l', 'fox': 'k', 'deer': 'k'}
# leg columns per frame: standing, step one, step two (two legs near, two far)
FRAMES = [[3, 5, 8, 10], [2, 5, 7, 10], [4, 5, 9, 10]]


def draw(kind, legs):
    im = Image.new('RGBA', (12, 8), (0, 0, 0, 0))
    for y, row in enumerate(BODY[kind]):
        for x, ch in enumerate(row):
            if ch != '.':
                im.putpixel((x, y), PAL[ch] + (255,))
    for y in (6, 7):
        for x in legs:
            im.putpixel((x, y), PAL[LEG[kind]] + (255,))
    return im


manifest = json.load(open(MANIFEST, encoding='utf-8'))
for i, kind in enumerate(BODY):
    entries = []
    for f, legs in enumerate(FRAMES):
        name = f'animal_{i}_{f}.png'
        draw(kind, legs).save(os.path.join(OUT, name))
        entries.append({'file': 'objects/' + name, 'anchor': [0.5, 0.9], 'widthInTiles': 1.0})
    manifest[f'objects.animal.{i}'] = entries
raw = open(MANIFEST, encoding='utf-8', newline='').read()
text = json.dumps(manifest, indent=2)
open(MANIFEST, 'w', encoding='utf-8', newline='').write(text.replace('\n', '\r\n') if '\r\n' in raw else text)
print('ok')
