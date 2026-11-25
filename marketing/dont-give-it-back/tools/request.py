#!/usr/bin/env python3
"""Build a Kling 4.0 reference-to-video request for fal and write it as JSON.

  python3 request.py PROMPT.txt OUT.json [--start IMG] [--end IMG] [--middle IMG ...]
                     [--video MP4 ...] [--duration 30] [--resolution 1080p]

Wren and the Mother from cast/ are always sent as @Element1 and @Element2.
Reference videos are uploaded to fal storage first (needs FAL_KEY); images go inline.
Submit the result with ../../generated/pass-4-seven-segments/tools/falrun.py.
"""
import argparse, base64, io, json, os, subprocess, sys, tempfile
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
CAST = os.path.join(HERE, "..", "cast")

def image(path, side):
    im = Image.open(path).convert("RGB"); im.thumbnail((side, side))
    b = io.BytesIO(); im.save(b, "JPEG", quality=90)
    return "data:image/jpeg;base64," + base64.b64encode(b.getvalue()).decode()

def element(who):
    return {"frontal_image_url": image(f"{CAST}/{who}-front.png", 1024),
            "reference_image_urls": [image(f"{CAST}/{who}-{v}.png", 1024) for v in ("threequarter", "profile", "waist")]}

def upload(path):
    header = tempfile.NamedTemporaryFile("w", delete=False); os.chmod(header.name, 0o600)
    header.write("Authorization: Key " + os.environ["FAL_KEY"] + "\n"); header.close()
    try:
        r = subprocess.run(["curl", "-s", "-H", "@" + header.name, "-H", "Content-Type: application/json",
                            "-d", json.dumps({"content_type": "video/mp4", "file_name": os.path.basename(path)}),
                            "https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3"],
                           capture_output=True, text=True)
        d = json.loads(r.stdout)
        if "upload_url" not in d:
            sys.exit("upload failed: " + r.stdout[:200])
        p = subprocess.run(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "-X", "PUT",
                            "-H", "Content-Type: video/mp4", "--data-binary", "@" + path, d["upload_url"]],
                           capture_output=True, text=True)
        if not p.stdout.startswith("2"):
            sys.exit("upload failed: HTTP " + p.stdout)
        return d["file_url"]
    finally:
        os.unlink(header.name)

a = argparse.ArgumentParser()
a.add_argument("prompt"); a.add_argument("out")
a.add_argument("--start"); a.add_argument("--end")
a.add_argument("--middle", nargs="*", default=[])
a.add_argument("--video", nargs="*", default=[])
a.add_argument("--duration", type=int, default=30)
a.add_argument("--resolution", default="1080p")
o = a.parse_args()

side = 1920 if o.resolution == "1080p" else 1280
body = {"prompt": open(o.prompt).read().strip(), "duration": o.duration,
        "elements": [element("wren"), element("mother")],
        "resolution": o.resolution, "aspect_ratio": "16:9"}
if o.start: body["start_image_url"] = image(o.start, side)
if o.end: body["end_image_url"] = image(o.end, side)
if o.middle: body["middle_image_urls"] = [image(p, side) for p in o.middle]
if o.video: body["video_urls"] = [upload(p) for p in o.video]
json.dump(body, open(o.out, "w"))
print(o.out, len(body["prompt"]), "prompt characters,", len(o.video), "reference videos")
