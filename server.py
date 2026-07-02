#!/usr/bin/env python3
"""FADI LAB live-preview server.

Serves the review site AND re-renders comp previews on demand with custom
params — the debug panel in comps.html goes fully live when the page is
opened through this server.

    ./start.sh             → http://localhost:8477/comps.html

POST /api/preview  {"comp": "mood_grid", "sd": {...}, "base": "fx2"}
  → renders a 2.5s preview (480x270) through the REAL pipeline comps registry
  → {"url": "/previews/<hash>.mp4"}
"""
import hashlib
import json
import os
import subprocess
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, "/Users/adamghaleb/.claude/skills/fadifiles-music-video/scripts")
from layers import comps as comps_mod            # noqa: E402  (merged registry)

FF = "/opt/homebrew/bin/ffmpeg"
LAYERS = "/Users/adamghaleb/awo-fx/VIDEOS/_edits/_layers"
PREVIEWS = os.path.join(HERE, "previews")
os.makedirs(PREVIEWS, exist_ok=True)

FADI = [(255, 0, 96), (255, 164, 5), (255, 228, 0), (17, 255, 5),
        (5, 211, 255), (111, 5, 255), (246, 5, 255)]
W, H, FPS, SECS = 480, 270, 30, 2.5
N = int(FPS * SECS)
SEG_T0 = {"fx": 34, "fx2": 18, "fx3": 16}
BOARD_PATHS = {
    "webcore": "~/Pictures/Moodboards/webcore/webcore.mp4",
    "metro!": "~/Pictures/Moodboards/metro!/metro!.mp4",
    "lightland": "~/Pictures/Moodboards/lightland/lightland.mp4",
    "new core": "~/Pictures/Moodboards/new core/new core.mp4",
    "spectral": "~/Pictures/Moodboards/spectral/spectral.mp4",
}

_seg_cache = {}
_render_lock = threading.Lock()


def _decode(mov, t0, gray=False):
    ch = 1 if gray else 3
    p = subprocess.Popen(
        [FF, "-v", "error", "-ss", f"{t0}", "-t", f"{SECS + 0.2}", "-i", mov,
         "-vf", f"scale={W}:{H},fps={FPS}", "-f", "rawvideo",
         "-pix_fmt", "gray" if gray else "rgb24", "-"], stdout=subprocess.PIPE)
    fs, sz = [], W * H * ch
    while len(fs) < N:
        b = p.stdout.read(sz)
        if len(b) < sz:
            break
        fs.append(np.frombuffer(b, np.uint8).reshape(H, W, ch).astype(np.float32))
    p.stdout.close()
    p.wait()
    while fs and len(fs) < N:
        fs.append(fs[-1])
    return fs


def _segment(base):
    if base not in _seg_cache:
        d = f"{LAYERS}/all-works-out-{base}"
        t0 = SEG_T0.get(base, 18)
        _seg_cache[base] = (_decode(f"{d}/fx.mov", t0),
                            _decode(f"{d}/matte.mov", t0, gray=True))
    return _seg_cache[base]


def render_preview(comp, sd, base):
    fn = comps_mod.COMPS.get(comp)
    if fn is None:
        return None, f"unknown comp: {comp}"
    sd = dict(sd or {})
    if "board" in sd:                          # panel sends a board NAME
        path = BOARD_PATHS.get(sd.pop("board"))
        if path:
            sd["src"] = os.path.expanduser(path)
    key = hashlib.md5(json.dumps([comp, sd, base, W, H],
                                 sort_keys=True).encode()).hexdigest()[:16]
    out = os.path.join(PREVIEWS, f"{key}.mp4")
    if os.path.exists(out):
        return f"/previews/{key}.mp4", None
    frs, mts = _segment(base if base in SEG_T0 else "fx2")
    ctx = SimpleNamespace(W=W, H=H, FADI=FADI, NCOL=7, CYCLE=3)
    enc = subprocess.Popen(
        [FF, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
         "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
         "-c:v", "libx264", "-crf", "23", "-preset", "veryfast",
         "-pix_fmt", "yuv420p", "-movflags", "+faststart", out],
        stdin=subprocess.PIPE)
    try:
        for n in range(min(len(frs), len(mts))):
            am = mts[n] / 255.0
            scol = np.array(FADI[(n // 3) % 7], np.float32)
            f = fn(frs[n].copy(), am, ctx, n, scol, dict(sd))
            enc.stdin.write(np.clip(f, 0, 255).astype(np.uint8).tobytes())
    except Exception as e:                     # comp blew up on these params
        enc.stdin.close(); enc.wait()
        if os.path.exists(out):
            os.remove(out)
        return None, f"{type(e).__name__}: {e}"
    enc.stdin.close()
    enc.wait()
    return f"/previews/{key}.mp4", None


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=HERE, **kw)

    def log_message(self, *a):                 # quiet
        pass

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/ping":
            return self._json(200, {"ok": True, "live": True})
        return super().do_GET()

    def do_POST(self):
        if self.path != "/api/preview":
            return self._json(404, {"error": "nope"})
        try:
            ln = int(self.headers.get("Content-Length", 0))
            req = json.loads(self.rfile.read(ln))
            with _render_lock:
                url, err = render_preview(req.get("comp", ""),
                                          req.get("sd"), req.get("base", "fx2"))
            if err:
                return self._json(400, {"error": err})
            return self._json(200, {"url": url})
        except Exception as e:
            return self._json(500, {"error": str(e)})


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8477
    print(f"FADI LAB live · http://localhost:{port}/comps.html")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
