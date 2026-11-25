#!/usr/bin/env python3
"""Ask Gemini to transcribe a generated film and list visible problems.

  python3 check.py FILM.mp4 "Don't give it back."

Needs GEMINI_API_KEY and ffmpeg; films over 12 MB are checked from a 480p copy. Gemini samples about one frame a second, so read its lip-sync
and object notes as hints and confirm them on a 2-frames-per-second contact sheet.
"""
import base64, json, os, subprocess, sys, tempfile

film, line = sys.argv[1], sys.argv[2]
small = None
if os.path.getsize(film) > 12_000_000:  # inline requests are capped at 20 MB after base64
    small = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False).name
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", film, "-vf", "scale=-2:480", "-crf", "30", small], check=True)
    film = small
question = ("You are checking an AI-generated 30-second film. Answer briefly, as JSON with keys: "
            "lines (one item per spoken line: start_s, end_s, words, speaker, on_screen_lips_match, accent, notes); "
            "missing_or_extra_lines compared with the expected script: " + line + "; voice_consistency; music_present; "
            "per_shot_visual_problems (time and problem: hands, faces, costumes, objects, text, flicker); "
            "story_clear (true or false and why); overall_1_to_10.")
body = {"contents": [{"parts": [{"inline_data": {"mime_type": "video/mp4",
                                                 "data": base64.b64encode(open(film, "rb").read()).decode()}},
                                {"text": question}]}],
        "generationConfig": {"responseMimeType": "application/json"}}
b = tempfile.NamedTemporaryFile("w", delete=False); json.dump(body, b); b.close()
h = tempfile.NamedTemporaryFile("w", delete=False); os.chmod(h.name, 0o600)
h.write("x-goog-api-key: " + os.environ["GEMINI_API_KEY"] + "\n"); h.close()
try:
    r = subprocess.run(["curl", "-s", "--max-time", "180", "-H", "@" + h.name, "-H", "Content-Type: application/json",
                        "-d", "@" + b.name,
                        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent"],
                       capture_output=True, text=True)
finally:
    os.unlink(h.name); os.unlink(b.name)
    if small: os.unlink(small)
try:
    d = json.loads(r.stdout)
except ValueError:
    sys.exit("no reply from Gemini: " + (r.stdout or r.stderr)[:200])
if "error" in d:
    sys.exit("error: " + d["error"].get("message", "")[:200])
print(d["candidates"][0]["content"]["parts"][0]["text"])
