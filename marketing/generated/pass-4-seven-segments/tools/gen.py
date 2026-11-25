#!/usr/bin/env python3
"""gen.py OUT.png "prompt" [ref1.png ref2.png ...]  -- one image from Gemini; key read from env, never printed."""
import base64, json, os, subprocess, sys, tempfile
out, prompt, refs = sys.argv[1], sys.argv[2], sys.argv[3:]
model = os.environ.get("IMG_MODEL", "gemini-3-pro-image")
parts = [{"text": prompt}]
for r in refs:
    mime = "image/png" if r.endswith(".png") else "image/jpeg"
    parts.append({"inline_data": {"mime_type": mime, "data": base64.b64encode(open(r, "rb").read()).decode()}})
body = {"contents": [{"parts": parts}],
        "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": dict({"aspectRatio": os.environ.get("ASPECT", "16:9")}, **({"imageSize": os.environ["IMAGE_SIZE"]} if os.environ.get("IMAGE_SIZE") else {}))}}
with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as b: json.dump(body, b); bpath = b.name
with tempfile.NamedTemporaryFile("w", delete=False) as h:
    os.chmod(h.name, 0o600); h.write("x-goog-api-key: " + os.environ["GEMINI_API_KEY"] + "\n"); hpath = h.name
try:
    r = subprocess.run(["curl", "-4", "-s", "--max-time", "240", "-H", "@" + hpath, "-H", "Content-Type: application/json",
                        "-d", "@" + bpath, f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"],
                       capture_output=True, text=True)
finally:
    os.unlink(hpath); os.unlink(bpath)
try: d = json.loads(r.stdout)
except Exception: print("bad response", r.stdout[:200]); sys.exit(1)
if "error" in d: print("error:", d["error"].get("status"), d["error"].get("message", "")[:300]); sys.exit(1)
for p in d["candidates"][0]["content"]["parts"]:
    data = p.get("inlineData") or p.get("inline_data")
    if data:
        open(out, "wb").write(base64.b64decode(data["data"])); print("saved", out); sys.exit(0)
print("no image:", json.dumps(d)[:300]); sys.exit(1)
