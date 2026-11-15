#!/usr/bin/env python3
"""Offline screen of sky bake parameters against the measured frame bands.

Renders nothing: it takes a baked .hdr, cuts the strip the hero camera actually
sees (elevation and azimuth from the lab camera), pushes it through an ACES-like
print curve, and reports the same band statistics scripts/bands.py measures, so
tuning does not cost a SwiftShader screenshot per iteration.

    ./venv/bin/python assets/sky/sim_frame.py assets/sky/storm_sunset_2k.hdr --level 0.546 --rot 138
"""
import argparse
import sys

import numpy as np

sys.path.insert(0, __file__.rsplit("/", 1)[0])
import bake_sky as B  # noqa: E402

# reference target.png, measured with the same band layout
REF = {
    "upper": {"luma": 68.8, "sd": 17.1, "warm": -22.0},
    "lower": {"luma": 78.7, "sd": 32.6, "warm": 3.8},
    "whole": {"luma": 75.0, "sd": 28.3, "warm": -5.9},
}


def aces(x):
    return np.clip((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0)


def to_display(rgb, level, exposure):
    v = np.maximum(rgb * level * exposure, 0.0)
    return 255.0 * np.power(aces(v), 1.0 / 2.2)


def strip(f, rot_deg, cam_az=128.0, half_fov=30.5, el_hi=20.7, el_lo=7.8, width=700):
    """Cut the visible sky window out of the equirect (u from camera azimuth)."""
    h, w, _ = f.shape
    el = np.linspace(el_hi, el_lo, 300)              # top row of frame -> bottom of band
    theta = np.linspace(cam_az - half_fov, cam_az + half_fov, width)
    u = (0.5 + (theta - rot_deg) / 360.0) % 1.0
    rows = np.clip(((0.5 - el / 180.0) * h).astype(int), 0, h - 1)
    cols = np.clip((u * w).astype(int), 0, w - 1)
    return f[np.ix_(rows, cols)]


def stats(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    return {
        "luma": float(luma.mean()),
        "sd": float(luma.std()),
        "warm": float(r.mean() - b.mean()),
        "p99": float(np.percentile(luma, 99)),
        "max": float(luma.max()),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("hdr")
    ap.add_argument("--level", type=float, default=0.546)
    ap.add_argument("--rot", type=float, default=138.0)
    ap.add_argument("--exposure", type=float, default=0.62)
    ap.add_argument("--calibrate", action="store_true", help="solve exposure from a known frame luma")
    ap.add_argument("--known-luma", type=float, default=77.9)
    args = ap.parse_args()

    scan, w, h = B.read_hdr(args.hdr)
    f = B.rgbe_to_float(scan)
    img = strip(f, args.rot)

    exposure = args.exposure
    if args.calibrate:
        lo, hi = 0.05, 4.0
        for _ in range(40):
            mid = 0.5 * (lo + hi)
            if stats(to_display(img, args.level, mid))["luma"] < args.known_luma:
                lo = mid
            else:
                hi = mid
        exposure = 0.5 * (lo + hi)
        print("calibrated exposure %.3f for band luma %.1f at level %.3f" % (exposure, args.known_luma, args.level))

    d = to_display(img, args.level, exposure)
    hh = d.shape[0]
    print("%-8s %6s %6s %7s | ref" % ("", "luma", "sd", "warm"))
    for name, sl in (("upper", slice(0, int(hh * 0.38))), ("lower", slice(int(hh * 0.38), hh)), ("whole", slice(0, hh))):
        s = stats(d[sl])
        r = REF[name]
        print("%-8s %6.1f %6.1f %+7.1f | %5.1f %5.1f %+6.1f   p99 %5.1f max %5.1f"
              % (name, s["luma"], s["sd"], s["warm"], r["luma"], r["sd"], r["warm"], s["p99"], s["max"]))


if __name__ == "__main__":
    main()
