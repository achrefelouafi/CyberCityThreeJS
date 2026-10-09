"""Assemble docs/kit/*.png into docs/kit_sheet.png with labels (requires Pillow)."""
import glob
import json
import os
from PIL import Image, ImageDraw, ImageFont

root = os.path.join(os.path.dirname(__file__), "..")
manifest = json.load(open(os.path.join(root, "public", "assets", "manifest.json")))
info = {p["name"]: p for p in manifest["pieces"]}
files = sorted(glob.glob(os.path.join(root, "docs", "kit", "*.png")), key=lambda f: list(info).index(os.path.basename(f)[:-4]) if os.path.basename(f)[:-4] in info else 99)
cols, cell, pad = 7, 300, 44
rows = (len(files) + cols - 1) // cols
sheet = Image.new("RGB", (cols * cell, rows * (cell + pad) + 90), (10, 6, 16))
d = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype("arial.ttf", 17)
    small = ImageFont.truetype("arial.ttf", 13)
    big = ImageFont.truetype("arialbd.ttf", 30)
except OSError:
    font = small = big = ImageFont.load_default()
d.text((20, 24), f"CYBERCITY MODULAR KIT  -  {len(files)} Geometry Nodes pieces  ({manifest['generator']})", fill=(255, 80, 190), font=big)
for i, f in enumerate(files):
    name = os.path.basename(f)[:-4]
    im = Image.open(f).convert("RGB").resize((cell, cell), Image.LANCZOS)
    x, y = (i % cols) * cell, 90 + (i // cols) * (cell + pad)
    sheet.paste(im, (x, y))
    p = info.get(name, {})
    d.text((x + 10, y + cell + 4), name, fill=(120, 220, 255), font=font)
    d.text((x + 10, y + cell + 24), f"{p.get('nodeGroup', '')}  ·  {p.get('triangles', '?')} tris", fill=(170, 160, 190), font=small)
out = os.path.join(root, "docs", "kit_sheet.png")
sheet.save(out)
print(out, sheet.size)

# car studio stills -> one strip
cars = [os.path.join(root, "docs", f"car_{i}.png") for i in range(4)]
if all(os.path.exists(c) for c in cars):
    ims = [Image.open(c).convert("RGB").resize((800, 450), Image.LANCZOS) for c in cars]
    strip = Image.new("RGB", (1600, 900))
    for i, im in enumerate(ims):
        strip.paste(im, ((i % 2) * 800, (i // 2) * 450))
    strip.save(os.path.join(root, "docs", "car_sheet.jpg"), quality=90)
    print("docs/car_sheet.jpg")
