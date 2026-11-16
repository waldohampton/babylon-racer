#!/usr/bin/env python3
"""Floor (bottom-of-frame ground) structure measurement, A/B against the reference.

    ./venv/bin/python scripts/floor.py out/frame.png

Measures the bottom 26% of the frame, x 0.18-0.85, on both the given frame and
reference/target.png, and prints one table so the comparison is one command.

Why these five numbers: a photoreal ground is not a contrast problem, it is a
*scale* problem. `detail` (mean absolute response of a 2 px gaussian high-pass)
says how much pixel-level sparkle the surface has; a real asphalt photo at this
camera distance sits near 8, a procedurally-lit render with too much fine noise
sits at 15 and reads as gravel. `p1` says whether the surface has real darks -
cracks, tar, oil, pooled shadow - and a uniform mid-tone render has none.
"""
import sys

import numpy as np
from PIL import Image

# bottom 26% of frame, x 0.18-0.85: the near-field floor band, excluding the
# car's own shadow edge at the left and the gravel pile at the right
Y0, Y1 = 0.74, 1.00
X0, X1 = 0.18, 0.85
REFERENCE = "reference/target.png"


def highpass_detail(g, sigma=2.0):
    """Mean |g - blur(g)| with a gaussian of the given sigma in pixels."""
    h, w = g.shape
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.rfftfreq(w)[None, :]
    k = np.exp(-2.0 * (np.pi ** 2) * (sigma ** 2) * (fx ** 2 + fy ** 2))
    blur = np.fft.irfft2(np.fft.rfft2(g) * k, s=g.shape)
    return np.abs(g - blur)


def measure(path):
    a = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
    h, w, _ = a.shape
    box = a[int(h * Y0):int(h * Y1), int(w * X0):int(w * X1)]
    r, g, b = box[:, :, 0], box[:, :, 1], box[:, :, 2]
    grey = 0.2126 * r + 0.7152 * g + 0.0722 * b
    mx = box.max(axis=2)
    mn = box.min(axis=2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1.0), 0.0)
    return {
        "mean": float(grey.mean()),
        "detail": float(highpass_detail(grey).mean()),
        "std": float(grey.std()),
        "p1": float(np.percentile(grey, 1)),
        "p99": float(np.percentile(grey, 99)),
        "warm": float(r.mean() - b.mean()),
        "sat": float(sat.mean() * 100),
    }


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    ours = measure(sys.argv[1])
    ref = measure(REFERENCE)
    keys = ["mean", "detail", "std", "p1", "p99", "warm", "sat"]
    head = ["mean", "hi-freq detail", "std", "p1", "p99", "warm R-B", "sat %"]
    print(f"floor band y {Y0:.2f}-{Y1:.2f}, x {X0:.2f}-{X1:.2f}")
    print(f"{'':22s} {'ours':>8s} {'ref':>8s} {'d':>8s}")
    for k, h_ in zip(keys, head):
        o, r = ours[k], ref[k]
        print(f"{h_:22s} {o:8.2f} {r:8.2f} {o - r:+8.2f}")


if __name__ == "__main__":
    main()
