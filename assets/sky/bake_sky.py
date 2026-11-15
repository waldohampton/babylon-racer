#!/usr/bin/env python3
"""Bake a tuned equirectangular storm sky from a Poly Haven CC0 .hdr.

Reads RGBE (flat or RLE) Radiance .hdr, applies a horizontal roll (to put the
sunset glow on a chosen azimuth), per-channel gains (white balance / warmth)
and a soft highlight knee so nothing in the sky clips, then writes a compact
new-RLE .hdr that Babylon's HDRCubeTexture parses.

    ./venv/bin/python assets/sky/bake_sky.py \
        --src /tmp/wasteland_clouds_puresky_2k.hdr \
        --out assets/sky/storm_sunset_2k.hdr \
        --roll 0.0 --gain 1.0,1.0,1.0 --cap 0.55
"""
import argparse
import numpy as np


def read_hdr(path):
    raw = open(path, "rb").read()
    if raw[:2] != b"#?":
        raise SystemExit("not a Radiance HDR")
    pos, fmt, size = 0, None, None
    while True:
        end = raw.index(b"\n", pos)
        line = raw[pos:end].decode("ascii", "replace")
        pos = end + 1
        if line.startswith("FORMAT="):
            fmt = line
        if line == "":
            break
    if fmt != "FORMAT=32-bit_rle_rgbe":
        raise SystemExit("unsupported format: %r" % fmt)
    end = raw.index(b"\n", pos)
    res = raw[pos:end].decode("ascii")
    pos = end + 1
    if not res.startswith("-Y "):
        raise SystemExit("only -Y +X panoramas supported, got %r" % res)
    h = int(res.split()[1])
    w = int(res.split()[3])

    scan = np.zeros((h, w, 4), np.uint8)
    d = pos
    for y in range(h):
        a, b, c, e = raw[d], raw[d + 1], raw[d + 2], raw[d + 3]
        if a == 2 and b == 2 and not (c & 0x80) and ((c << 8) | e) == w:
            d += 4
            for ch in range(4):
                x = 0
                while x < w:
                    n = raw[d]
                    d += 1
                    if n > 128:
                        run = n - 128
                        scan[y, x:x + run, ch] = raw[d]
                        d += 1
                        x += run
                    else:
                        scan[y, x:x + n, ch] = np.frombuffer(raw, np.uint8, n, d)
                        d += n
                        x += n
        else:  # flat scanline
            n = w * 4
            scan[y] = np.frombuffer(raw, np.uint8, n, d).reshape(w, 4)
            d += n
    return scan, w, h


def rgbe_to_float(scan):
    e = scan[..., 3].astype(np.int32)
    f = np.zeros(scan.shape[:2] + (3,), np.float32)
    nz = e > 0
    scale = np.zeros(e.shape, np.float32)
    scale[nz] = np.ldexp(1.0, e[nz] - 136)
    f[nz] = scan[..., :3][nz].astype(np.float32) * scale[nz][:, None]
    return f


def float_to_rgbe(f):
    mx = f.max(axis=2)
    e = np.zeros(mx.shape, np.int32)
    nz = mx > 1e-8
    mant, exp = np.frexp(mx[nz])
    e[nz] = exp + 128
    s = np.zeros(mx.shape, np.float32)
    s[nz] = np.ldexp(1.0, 8 - exp)  # m = v * 2^(8-exp), v = m * 2^(E-136) with E = exp+8
    out = np.zeros(f.shape[:2] + (4,), np.uint8)
    for c in range(3):
        out[..., c] = np.clip(f[..., c] * s, 0, 255).astype(np.uint8)
    out[..., 3] = np.where(nz, np.clip(e, 1, 255), 0).astype(np.uint8)
    return out


def write_rle(path, rgbe, header_extra=()):
    h, w, _ = rgbe.shape
    lines = ["#?RADIANCE", "FORMAT=32-bit_rle_rgbe"] + list(header_extra) + ["", "-Y %d +X %d" % (h, w)]
    buf = bytearray(("\n".join(lines) + "\n").encode("ascii"))
    hi, lo = (w >> 8) & 0xFF, w & 0xFF
    for y in range(h):
        row = rgbe[y]
        buf += bytes((2, 2, hi, lo))
        for ch in range(4):
            vals = row[:, ch]
            x = 0
            while x < w:
                # find run of equal values
                run = 1
                while x + run < w and run < 127 and vals[x + run] == vals[x]:
                    run += 1
                if run >= 4:
                    buf += bytes((128 + run, int(vals[x])))
                    x += run
                else:
                    lit = x
                    n = 0
                    while lit + n < w and n < 128:
                        # stop the literal just before a long run begins
                        if n > 0 and lit + n + 3 < w and np.all(vals[lit + n:lit + n + 4] == vals[lit + n]):
                            break
                        n += 1
                    buf += bytes((n,)) + vals[lit:lit + n].tobytes()
                    x += n
    open(path, "wb").write(bytes(buf))


def elevation_degrees(h):
    """Per-row elevation in degrees for a -Y +X equirect (row 0 = zenith)."""
    return 90.0 - (np.arange(h, dtype=np.float32) + 0.5) * (180.0 / h)


def smoothstep(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def grade_deck(f, el0=11.0, el1=21.0, r=-0.26, g=-0.18, b=0.05):
    """Cool and deepen everything above el0, ramping in by el1.

    A thick storm deck scatters cool light; the amber you see near the horizon is
    the low sun, not the deck. This applies that vertical white balance as a
    grade on the photographed radiance (the cloud forms are untouched).
    """
    h = f.shape[0]
    t = smoothstep((elevation_degrees(h) - el0) / max(el1 - el0, 1e-6))
    gain = np.stack([1.0 + r * t, 1.0 + g * t, 1.0 + b * t], axis=1)
    return (f * gain[:, None, :]).astype(np.float32), t


def blur_wrap(a, sigma):
    """Separable 3-pass box blur approximating a Gaussian, wrapping in x."""
    if isinstance(sigma, (int, float)):
        sigma = (sigma, sigma)
    sy, sx = sigma
    out = a.astype(np.float32)
    for s, axis in ((sx, 1), (sy, 0)):
        r = max(1, int(round(s / 1.7)))
        for _ in range(3):
            acc = np.zeros_like(out)
            for d in range(-r, r + 1):
                acc += np.roll(out, d, axis=axis)
            out = acc / (2 * r + 1)
    return out


def grade_horizon(f, el_lo=13.0, el_hi=16.0, r=0.12, g=0.03, b=-0.09):
    """Warm the low sky (the sunset band) without touching the deck above it."""
    h = f.shape[0]
    t = 1.0 - smoothstep((elevation_degrees(h) - el_lo) / max(el_hi - el_lo, 1e-6))
    gain = np.stack([1.0 + r * t, 1.0 + g * t, 1.0 + b * t], axis=1)
    return (f * gain[:, None, :]).astype(np.float32)


def punch_clouds(f, k=1.35, sigma=(3.0, 6.0), lo=0.55, hi=2.0):
    """Raise the low-frequency cloud-form contrast above the horizon.

    Poly Haven's sky is smooth at this scale; the reference deck is not. The
    envelope (luminance blurred at cloud scale) is stretched as a power curve
    around its own median, and RGB is scaled by the same factor so hue and
    texture survive. Nothing is invented: it is a contrast grade on measured
    cloud radiance.
    """
    h = f.shape[0]
    luma = 0.2126 * f[..., 0] + 0.7152 * f[..., 1] + 0.0722 * f[..., 2]
    low = blur_wrap(luma, sigma)
    ref = float(np.median(low))
    gain = np.clip(np.power(np.maximum(low, 1e-6) / ref, k - 1.0), lo, hi)
    # only above the horizon, fading out below it so the ground bounce stays put
    el = elevation_degrees(h)
    mask = smoothstep((el + 2.0) / 6.0)[:, None]
    gain = 1.0 + (gain - 1.0) * mask
    return (f * gain[..., None]).astype(np.float32)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--roll", type=float, default=0.0, help="degrees of horizontal rotation")
    ap.add_argument("--gain", default="1,1,1", help="R,G,B linear gains")
    ap.add_argument("--cap", type=float, default=0.0, help="soft-knee radiance cap (0 = off)")
    ap.add_argument("--cap-start", type=float, default=0.0, help="radiance where the knee begins")
    ap.add_argument("--gamma", type=float, default=1.0)
    ap.add_argument("--deck", default="", help="deck grade: el0,el1,dr,dg,db")
    ap.add_argument("--glow", default="", help="horizon warm grade: el_lo,el_hi,dr,dg,db")
    ap.add_argument("--punch", type=float, default=0.0, help="cloud form contrast multiplier")
    args = ap.parse_args()

    scan, w, h = read_hdr(args.src)
    f = rgbe_to_float(scan)
    print("read %s  %dx%d  luma mean %.3f" % (args.src, w, h,
          0.2126 * f[..., 0].mean() + 0.7152 * f[..., 1].mean() + 0.0722 * f[..., 2].mean()))

    if args.roll:
        shift = int(round(w * (args.roll % 360.0) / 360.0))
        f = np.roll(f, shift, axis=1)

    if args.deck:
        p = [float(x) for x in args.deck.split(",")]
        f, _t = grade_deck(f, *p)
        print("deck grade %s applied" % (p,))

    if args.glow:
        p = [float(x) for x in args.glow.split(",")]
        f = grade_horizon(f, *p)
        print("horizon glow %s applied" % (p,))

    if args.punch > 1.0:
        f = punch_clouds(f, k=args.punch)
        print("cloud punch x%.2f applied" % args.punch)

    g = [float(x) for x in args.gain.split(",")]
    f = f * np.array(g, np.float32)

    if args.gamma != 1.0:
        f = np.power(f, args.gamma).astype(np.float32)

    if args.cap > 0:
        start = args.cap_start if args.cap_start > 0 else args.cap * 0.6
        over = f > start
        f[over] = start + (args.cap - start) * (1.0 - np.exp(-(f[over] - start) / (args.cap - start)))

    rgbe = float_to_rgbe(f)
    write_rle(args.out, rgbe)
    import os
    print("wrote %s  %.2f MB  max %.3f" % (args.out, os.path.getsize(args.out) / 1e6, float(f.max())))

    # self-check: re-read and compare
    s2, w2, h2 = read_hdr(args.out)
    f2 = rgbe_to_float(s2)
    err = np.abs(f2 - f)
    print("roundtrip: max abs err %.5f  mean abs err %.6f" % (err.max(), err.mean()))


if __name__ == "__main__":
    main()
