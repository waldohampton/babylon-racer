#!/usr/bin/env python3
"""Measure a hero frame in bands and compare it to the reference still.

    python3 scripts/bands.py out/frame.png
    python3 scripts/bands.py out/frame.png --json

Bands are fractions of image height, sampled across the centre 70 percent of
width so the vignette at both ends does not drag the numbers down. Compare
frames only at the same aspect ratio and the same horizon height.
"""
import json
import sys

import numpy as np
from PIL import Image

# Measured off the reference still (2752x1536): do not edit to make a render
# look good, edit the render.
REFERENCE = {
    "sky": {"luma": 75.0, "warm": -5.9, "blown": 0.0, "black": 1.1},
    "horizon": {"luma": 58.0, "warm": 0.7, "blown": 0.0, "black": 13.0},
    "mid": {"luma": 56.9, "warm": 22.8, "blown": 0.0, "black": 34.0},
    "ground": {"luma": 114.2, "warm": 53.0, "blown": 0.0, "black": 8.4},
    "frame": {"luma": 76.1, "p1": 4.0, "p50": 70.4, "p99": 176.8, "sharp": 8.28},
}

# (name, y0, y1) as fractions of height, top to bottom
BANDS = [("sky", 0.03, 0.35), ("horizon", 0.35, 0.52), ("mid", 0.52, 0.70), ("ground", 0.70, 0.97)]


def measure(path):
    a = np.asarray(Image.open(path).convert("RGB")).astype(float)
    h, w, _ = a.shape
    out = {"size": [w, h], "bands": {}}
    for name, y0, y1 in BANDS:
        box = a[int(h * y0):int(h * y1), int(w * 0.15):int(w * 0.85)]
        r, g, b = box[:, :, 0].mean(), box[:, :, 1].mean(), box[:, :, 2].mean()
        luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
        grey = 0.2126 * box[:, :, 0] + 0.7152 * box[:, :, 1] + 0.0722 * box[:, :, 2]
        out["bands"][name] = {
            "luma": round(float(luma), 1),
            "warm": round(float(r - b), 1),
            "rgb": [round(float(r), 1), round(float(g), 1), round(float(b), 1)],
            "blown": round(float((grey > 200).mean() * 100), 1),
            "black": round(float((grey < 30).mean() * 100), 1),
        }
    g = 0.2126 * a[:, :, 0] + 0.7152 * a[:, :, 1] + 0.0722 * a[:, :, 2]
    out["frame"] = {
        "luma": round(float(g.mean()), 1),
        "p1": round(float(np.percentile(g, 1)), 1),
        "p50": round(float(np.percentile(g, 50)), 1),
        "p99": round(float(np.percentile(g, 99)), 1),
        "sharp": round(float(np.abs(np.diff(g, axis=0)[:, :-1] + np.diff(g, axis=1)[:-1, :]).mean()), 2),
    }
    return out


def report(m):
    print(f"frame {m['size'][0]}x{m['size'][1]}")
    print(f"{'band':8s} {'luma':>6s} {'ref':>6s} {'d':>6s} | {'warm':>6s} {'ref':>6s} {'d':>6s} | {'blown%':>6s} {'black%':>6s}")
    for name, _, _ in BANDS:
        b, r = m["bands"][name], REFERENCE[name]
        print(
            f"{name:8s} {b['luma']:6.1f} {r['luma']:6.1f} {b['luma'] - r['luma']:+6.1f} | "
            f"{b['warm']:6.1f} {r['warm']:6.1f} {b['warm'] - r['warm']:+6.1f} | "
            f"{b['blown']:6.1f} {b['black']:6.1f}"
        )
    f, r = m["frame"], REFERENCE["frame"]
    print(
        f"\nframe    luma {f['luma']:5.1f} (ref {r['luma']}) | p1 {f['p1']:5.1f} (ref {r['p1']}) | "
        f"p50 {f['p50']:5.1f} (ref {r['p50']}) | p99 {f['p99']:5.1f} (ref {r['p99']}) | "
        f"sharp {f['sharp']:5.2f} (ref {r['sharp']})"
    )


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    m = measure(sys.argv[1])
    if "--json" in sys.argv:
        print(json.dumps(m, indent=1))
    else:
        report(m)
