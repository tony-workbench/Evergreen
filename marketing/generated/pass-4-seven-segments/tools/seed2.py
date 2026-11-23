#!/usr/bin/env python3
"""seed2.py OUT.mp4 PROMPT_FILE KEYFRAME [--prev PREV.mp4] [--refs a.png b.png]
No --prev: image-to-video, KEYFRAME is the exact first frame.
With --prev: reference-to-video, [Image1]=KEYFRAME, [Image2..]=refs, [Video1]=previous clip.
env RES (480p), DUR (4). Key from env FAL_KEY, never printed. Also saves OUT.last.jpg when returned."""
import base64, json, os, subprocess, sys, tempfile, time
a = sys.argv[1:]; out, pfile, key = a[0], a[1], a[2]
prev = a[a.index("--prev") + 1] if "--prev" in a else None
refs = a[a.index("--refs") + 1:] if "--refs" in a else []
prompt = open(pfile, encoding="utf-8").read()
def uri(p, mime): return f"data:{mime};base64," + base64.b64encode(open(p, "rb").read()).decode()
body = {"prompt": prompt, "resolution": os.environ.get("RES", "480p"), "duration": os.environ.get("DUR", "4"),
        "generate_audio": os.environ.get("AUDIO", "1") != "0", "return_last_frame": True}
if prev or "--r2v" in a:  # --r2v: reference images only, no previous clip
    ep = "bytedance/seedance-2.5/reference-to-video"
    body.update({"image_urls": [uri(p, "image/jpeg") for p in [key] + refs], "aspect_ratio": "16:9"})
    if prev: body["video_urls"] = [uri(prev, "video/mp4")]
    if os.environ.get("TASK"): body["task"] = os.environ["TASK"]  # e.g. extension: continue the reference video
else:
    ep = "bytedance/seedance-2.5/image-to-video"; body["image_url"] = uri(key, "image/jpeg")
    if "--end" in a: body["end_image_url"] = uri(a[a.index("--end") + 1], "image/jpeg")  # the clip must land on this frame
h = tempfile.NamedTemporaryFile("w", delete=False); os.chmod(h.name, 0o600)
h.write("Authorization: Key " + os.environ["FAL_KEY"] + "\n"); h.close()
def curl(*x):
    r = subprocess.run(["curl", "-4", "-s", "--max-time", "180", "-H", "@" + h.name, *x], capture_output=True, text=True)
    try: return json.loads(r.stdout)
    except Exception: return {"raw": r.stdout[:300]}
try:
    if os.environ.get("RESUME") and os.path.exists(out + ".job.json"):
        s = json.load(open(out + ".job.json"))  # pick up a job that is already running instead of paying for a new one
    else:
        b = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False); json.dump(body, b); b.close()
        for attempt in range(4):
            s = curl("-H", "Content-Type: application/json", "-d", "@" + b.name, "https://queue.fal.run/" + ep)
            if "status_url" in s or "raw" not in s or s["raw"]: break
            time.sleep(10)  # empty answer means the connection failed before the request was accepted
        os.unlink(b.name)
    if "status_url" not in s: print("submit failed:", json.dumps(s)[:500]); sys.exit(1)
    json.dump({k: s.get(k) for k in ("request_id", "status_url", "response_url")}, open(out + ".job.json", "w"))
    print("submitted", ep.split("/")[-1], s.get("request_id"), flush=True); t0 = time.time(); bad = 0
    while True:
        time.sleep(8); st = curl(s["status_url"]); status = st.get("status")
        if status == "COMPLETED": break
        if status in ("IN_QUEUE", "IN_PROGRESS"): bad = 0
        else:
            bad += 1  # a failed poll is retried; only repeated failures or an error status stop the wait
            if bad >= 20 or status in ("FAILED", "ERROR"): print("status:", json.dumps(st)[:400]); sys.exit(1)
        if time.time() - t0 > 2400: print("still running; job saved in", out + ".job.json"); sys.exit(2)
    res = curl(s["response_url"]); url = (res.get("video") or {}).get("url")
    if not url: print("no video:", json.dumps(res)[:500]); sys.exit(1)
    subprocess.run(["curl", "-4", "-s", "-L", "--max-time", "300", "-o", out, url], check=True)
    lf = (res.get("last_frame") or {}).get("url")
    if lf: subprocess.run(["curl", "-4", "-s", "-L", "--max-time", "120", "-o", out + ".last.jpg", lf])
    print("saved", out, int(time.time() - t0), "s")
finally:
    os.unlink(h.name)
