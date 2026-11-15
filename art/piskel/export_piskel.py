"""Export frame 0 of any .piskel file into the game's tileset as a PNG plus a manifest entry.

Usage: python export_piskel.py <file.piskel> <tileset_dir> <category> <name> [anchor_x anchor_y widthInTiles [shadowInTiles]]

Example: python export_piskel.py Campfire.piskel public/assets/tileset objects.campfire campfire_00 0.5 0.8 1.2
The PNG goes to <tileset_dir>/objects/<name>.png and the entry is appended to <category> in manifest.json
(an existing entry with the same file is replaced, so re-running is safe).
"""
import base64, io, json, os, sys
from PIL import Image

src, tileset, category, name = sys.argv[1:5]
anchor = (float(sys.argv[5]), float(sys.argv[6])) if len(sys.argv) > 6 else (0.5, 0.875)
width = float(sys.argv[7]) if len(sys.argv) > 7 else 1.0
shadow = float(sys.argv[8]) if len(sys.argv) > 8 else None

data = json.load(open(src, encoding='utf-8'))
layer = json.loads(data['piskel']['layers'][0])
sheet = Image.open(io.BytesIO(base64.b64decode(layer['chunks'][0]['base64PNG'].split(',')[1]))).convert('RGBA')
w, h = data['piskel']['width'], data['piskel']['height']
frame = sheet.crop((0, 0, w, h))
os.makedirs(f'{tileset}/objects', exist_ok=True)
frame.save(f'{tileset}/objects/{name}.png')

path = f'{tileset}/manifest.json'
manifest = json.load(open(path)) if os.path.exists(path) else {}
entry = {'file': f'objects/{name}.png', 'anchor': list(anchor), 'widthInTiles': width}
if shadow is not None:
    entry['shadowInTiles'] = shadow
entries = [e for e in manifest.get(category, []) if e['file'] != entry['file']] + [entry]
manifest[category] = entries
json.dump(manifest, open(path, 'w'), indent=2)
print('exported', name, 'to', category)
