#!/usr/bin/env python3
"""falrun.py ENDPOINT BODY.json OUT  - queue call; saves the audio or video file the model returns. Key from env FAL_KEY, never printed."""
import json, os, subprocess, sys, tempfile, time
ep, bodyf, out = sys.argv[1:4]
h = tempfile.NamedTemporaryFile("w", delete=False); os.chmod(h.name, 0o600)
h.write("Authorization: Key " + os.environ["FAL_KEY"] + "\n"); h.close()
def curl(*x):
    r = subprocess.run(["curl", "-4", "-s", "--max-time", "180", "-H", "@" + h.name, *x], capture_output=True, text=True)
    try: return json.loads(r.stdout)
    except Exception: return {"raw": r.stdout[:300]}
try:
    s = curl("-H", "Content-Type: application/json", "-d", "@" + bodyf, "https://queue.fal.run/" + ep)
    if "status_url" not in s: print(out, "submit failed:", json.dumps(s)[:400]); sys.exit(1)
    json.dump({k: s.get(k) for k in ("request_id", "status_url", "response_url")}, open(out + ".job.json", "w"))
    t0 = time.time(); bad = 0
    while True:
        time.sleep(5); st = curl(s["status_url"]); status = st.get("status")
        if status == "COMPLETED": break
        if status in ("IN_QUEUE", "IN_PROGRESS"): bad = 0
        else:
            bad += 1
            if bad >= 20 or status in ("FAILED", "ERROR"): print(out, "status:", json.dumps(st)[:400]); sys.exit(1)
        if time.time() - t0 > 1500: print(out, "still running"); sys.exit(2)
    res = curl(s["response_url"]); url = (res.get("audio") or res.get("video") or {}).get("url")
    if not url: print(out, "no file:", json.dumps(res)[:500]); sys.exit(1)
    subprocess.run(["curl", "-4", "-s", "-L", "--max-time", "300", "-o", out, url], check=True)
    print("saved", out, int(time.time() - t0), "s")
finally:
    os.unlink(h.name)
