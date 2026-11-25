"""Darken the window and its light spill in a keyframe. Usage: python3 darken_window.py IN.png OUT.png STRENGTH (0.8 night, 1.0 dawn).
The window box is set for the 1376x768 frames in frames/."""
import sys
from PIL import Image, ImageFilter, ImageDraw, ImageChops
src, out, strength = sys.argv[1], sys.argv[2], float(sys.argv[3])
im = Image.open(src).convert("RGB"); W, H = im.size
knee = 90
lut = [v if v < knee else int(knee + (v - knee) * 0.35) for v in range(256)]
dark = im.point(lut * 3)
m = Image.new("L", (W, H), 0); ImageDraw.Draw(m).rectangle((470, 110, 770, 390), fill=255)
m = m.filter(ImageFilter.GaussianBlur(40))
halo = Image.new("L", (W, H), 0); ImageDraw.Draw(halo).ellipse((150, -150, 1150, 650), fill=140)
halo = halo.filter(ImageFilter.GaussianBlur(120))
mask = ImageChops.lighter(m, halo).point(lambda v: int(v * strength))
Image.composite(dark, im, mask).save(out)
