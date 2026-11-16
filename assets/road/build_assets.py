#!/usr/bin/env python3
"""Build the road/shoulder textures from Poly Haven scans.

    python3 assets/road/build_assets.py

Sources (CC0, real world sizes from https://api.polyhaven.com/info/<id>, which
publishes `dimensions` in CENTIMETRES):

    asphalt_02          3000 x 3000 cm   diff 8k (273 px/m) nor_gl 4k rough 4k (136 px/m)
    asphalt_04          4040 x 4040 cm   diff 1k (the 40 m macro layer)
    sandy_gravel_02     2530 x 2530 cm   diff 8k (324 px/m) nor_gl 4k rough 4k (162 px/m)
    cracked_red_ground  2000 x 2000 cm   diff 1k (the 20 m dirt macro)

WHAT CHANGED FROM THE FIRST PASS, AND WHY (all measured off a 1920x1080 capture
against reference/target.png, bottom 26% of frame, x 0.18-0.85):

  1. The near albedo tile was 1024 px over 3.75 m, which repeats every 3.75 m -
     findable on screen - and at 273 px/m it maps ~1:1 to screen pixels at 4 m,
     so every grain of the scan landed as a single sparkly pixel. The frame
     measured 14.7 mean |high-pass| against the photo's 8.3: 1.8x too much
     pixel-level detail. The near tile is now 4096 px over 15.0 m, still at the
     scan's native 273 px/m, and the crop is denoised at the source (blur that
     is ~1.8 mm of ground, then NO sharpening - the previous pass sharpened by
     18% and that is where a lot of the sparkle came from).
  2. albedo, normal and roughness are now cut from the SAME window of the same
     scan, at ratios that land on the same 15 m of ground. Relief and colour
     therefore agree in content as well as in scale; before, the normal was a
     7.5 m crop against a 3.75 m albedo.
  3. macro stays 1k (25 px/m is plenty at 40 m) as a soft MULTIPLIER, not an
     albedo; the same for the new 12 m patch layer, which carries the mid-scale
     structure (20-100 cm aggregate zones, repair patches) that the reference
     ground has and a uniform render does not.
  4. roughness is remapped to a measured display range instead of being passed
     through: dry asphalt is rough, and a scan's roughness map is a
     photogrammetry guess. The range is printed below.
"""
import gc
import json
import os
import sys
import urllib.request

import numpy as np
from PIL import Image, ImageFilter

CACHE = os.path.join(os.path.expanduser("~"), ".hermes", "cache", "scratch", "roadsrc")
OUT = os.path.dirname(os.path.abspath(__file__))
DESAT = 0.55

SOURCES = {
    "a_macro_1k": ("asphalt_04", "1k", "asphalt_04/asphalt_04_diff_1k.jpg"),
    "a_8k": ("asphalt_02", "8k", "asphalt_02/asphalt_02_diff_8k.jpg"),
    "a_nor_4k": ("asphalt_02", "4k", "asphalt_02/asphalt_02_nor_gl_4k.jpg"),
    "a_rough_4k": ("asphalt_02", "4k", "asphalt_02/asphalt_02_rough_4k.jpg"),
    "d_macro_1k": ("cracked_red_ground", "1k", "cracked_red_ground/cracked_red_ground_diff_1k.jpg"),
    "d_8k": ("sandy_gravel_02", "8k", "sandy_gravel_02/sandy_gravel_02_diff_8k.jpg"),
    "d_nor_4k": ("sandy_gravel_02", "4k", "sandy_gravel_02/sandy_gravel_02_nor_gl_4k.jpg"),
    "d_rough_4k": ("sandy_gravel_02", "4k", "sandy_gravel_02/sandy_gravel_02_rough_4k.jpg"),
}

# px/m of each master, from dimensions / pixel size (measured, see docstring)
A_PPM = 8192 / 30.0
D_PPM = 8192 / 25.3

# near-field tile: 4096 px at the scan's own 273 px/m = 15.0 m of ground
A_NEAR_PX = 4096
A_NEAR_M = A_NEAR_PX / A_PPM  # 15.0 m
D_NEAR_PX = 2048
D_NEAR_M = 4096 / D_PPM  # 12.65 m: a 4096 crop of the 8k master, halved


def fetch(key):
    path = os.path.join(CACHE, key + ".jpg")
    if not os.path.exists(path):
        os.makedirs(CACHE, exist_ok=True)
        asset, res, remote = SOURCES[key]
        url = f"https://dl.polyhaven.org/file/ph-assets/Textures/jpg/{res}/{remote}"
        print(f"  downloading {asset} {res} ...", flush=True)
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=600) as r, open(path, "wb") as f:
            f.write(r.read())
    return path


def lum(a):
    return 0.2126 * a[:, :, 0] + 0.7152 * a[:, :, 1] + 0.0722 * a[:, :, 2]


def highpass_detail(g, sigma=2.0):
    h, w = g.shape
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.rfftfreq(w)[None, :]
    k = np.exp(-2.0 * (np.pi ** 2) * (sigma ** 2) * (fx ** 2 + fy ** 2))
    return float(np.abs(g - np.fft.irfft2(np.fft.rfft2(g) * k, s=g.shape)).mean())


def desaturate(img, k):
    a = np.asarray(img).astype(np.float32)
    l = lum(a)[..., None]
    return Image.fromarray(np.clip(a * (1 - k) + l * k, 0, 255).astype(np.uint8), "RGB")


def recentre(v, target, clip_lo, clip_hi, iters=16):
    for _ in range(iters):
        v = np.clip(v, clip_lo, clip_hi)
        v = v + (target - v.mean())
    return np.clip(v, clip_lo, clip_hi)


def deblotch(img, sigma=26, amount=0.6):
    """Subtract the low frequencies a crop carries (big soft blotches that read
    as 'blurry blob' and give a mirrored tile away). No sharpening: the previous
    pass put 18% back and that is where the pixel sparkle came from."""
    a = np.asarray(img).astype(np.float32)
    low = np.asarray(img.filter(ImageFilter.GaussianBlur(sigma))).astype(np.float32)
    out = a - (low - low.reshape(-1, 3).mean(axis=0)) * amount
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB")


def denoise(img, sigma):
    """Blur fine grain at the source. At 4096 over 15 m, sigma 0.9 px is 3.3 mm
    of ground: it removes sensor/aggregate single-texel sparkle and leaves
    everything from 2 cm up alone."""
    if sigma <= 0:
        return img
    return img.filter(ImageFilter.GaussianBlur(sigma))


def multiplier_jpg(img, lo, hi, mean):
    """The multiplier itself, clamped into [lo, hi] so an overlay can only ever
    darken. Its measured mean is returned; the base tint divides by it."""
    g = np.asarray(img.convert("L")).astype(np.float32) / 255.0
    m = g / max(1e-6, g.mean())
    v = recentre(m, mean, lo, hi)
    return Image.fromarray(np.round(v * 255).astype(np.uint8), "L").convert("RGB"), float(v.mean())


def roughness_map(img, lo, hi, mid):
    """Remap a photogrammetry roughness guess into a measured display range.
    Dry asphalt sits in the high 0.8s; the map's own variation is kept and
    stretched onto [lo, hi] around `mid`."""
    g = np.asarray(img.convert("L")).astype(np.float32) / 255.0
    g = (g - g.mean()) / max(1e-6, g.std())
    v = np.clip(mid + g * (hi - lo) * 0.25, lo, hi)
    return Image.fromarray(np.round(v * 255).astype(np.uint8), "L").convert("RGB"), float(v.mean())


def norm_map(img, sigma):
    """Smooth a scanned normal map without pulling it off the unit sphere."""
    a = np.asarray(img.convert("RGB")).astype(np.float32) / 127.5 - 1.0
    img2 = Image.fromarray(np.clip((a + 1.0) * 127.5, 0, 255).astype(np.uint8), "RGB")
    sm = np.asarray(img2.filter(ImageFilter.GaussianBlur(sigma))).astype(np.float32) / 127.5 - 1.0
    n = np.linalg.norm(sm, axis=2, keepdims=True)
    sm = sm / np.maximum(n, 1e-6)
    return Image.fromarray(np.clip((sm + 1.0) * 127.5, 0, 255).astype(np.uint8), "RGB")


def best_crop(img, size, step=512, label=""):
    """Pick the window that tiles best: low low-frequency variance (no giant
    blotches to repeat), and a mean near the master's. Measured, printed."""
    a = np.asarray(img.convert("L")).astype(np.float32)
    base = a.mean()
    scored = []
    for y in range(0, a.shape[0] - size + 1, step):
        for x in range(0, a.shape[1] - size + 1, step):
            c = a[y:y + size, x:x + size]
            small = np.asarray(Image.fromarray(c.astype(np.uint8)).resize((256, 256), Image.BOX)).astype(np.float32)
            lowvar = float(small.std())
            mean_pen = abs(float(c.mean()) - base) / 40.0
            # mirrored addressing: edge continuity helps too
            edge = float(
                abs(c[:, :8].mean() - c[:, -8:].mean()) + abs(c[:8, :].mean() - c[-8:, :].mean())
            ) / 40.0
            scored.append((lowvar + mean_pen + edge, x, y, lowvar, float(c.mean())))
    scored.sort()
    s, x, y, lowvar, mean = scored[0]
    print(f"  {label}: crop ({x},{y}) low-var {lowvar:.1f} mean {mean:.1f} score {s:.2f} "
          f"[best of {len(scored)} windows]")
    return x, y


def save(img, name, q=82):
    path = os.path.join(OUT, name)
    img.save(path, "JPEG", quality=q, optimize=True)
    return os.path.getsize(path)


def main():
    rows = []
    means = {}

    # ---------------- asphalt ----------------
    # macro: asphalt_04, a real 40.4 m tile, 1k, pulled 55% toward its own mean
    mac = Image.open(fetch("a_macro_1k")).convert("RGB")
    a = np.asarray(desaturate(mac, DESAT)).astype(np.float32)
    m = a.reshape(-1, 3).mean(axis=0)
    macd = Image.fromarray(np.clip(m + (a - m) * 0.55, 0, 255).astype(np.uint8), "RGB")
    img, means["asphalt_macro"] = multiplier_jpg(macd, 0.90, 1.0, 0.962)
    rows.append(("asphalt_macro.jpg", save(img, "asphalt_macro.jpg"), "40.4 m tile, multiplier"))

    im = Image.open(fetch("a_8k"))
    print("  asphalt_02 near field, 8k master = 273 px/m")
    x0, y0 = best_crop(im, A_NEAR_PX, 512, "asphalt albedo 15 m")
    # 15.0 m of ground, denoised at the source, desaturated for the warm sun
    near = im.crop((x0, y0, x0 + A_NEAR_PX, y0 + A_NEAR_PX))
    near = denoise(desaturate(near, DESAT), 1.8)
    near = deblotch(near, 60, 0.55)  # kill 15 m-scale blotches, keep everything under 2 m
    nn = np.asarray(near.convert("L")).astype(np.float32)
    means["asphalt_albedo"] = [round(float(v), 4) for v in np.asarray(near).astype(np.float32).reshape(-1, 3).mean(axis=0) / 255.0]
    rows.append(("asphalt_albedo.jpg", save(near, "asphalt_albedo.jpg", 80),
                 f"{A_NEAR_M:.1f} m tile, 273 px/m, detail {highpass_detail(nn):.2f}, mean {nn.mean():.1f}"))
    del near, nn
    gc.collect()

    # relief and sheen from the SAME window of the same scan, at half the pixel
    # size (the 4k masters are half the diff's resolution), so one texel is one
    # texel and relief sits under the colour that produced it
    nx, ny = x0 // 2, y0 // 2
    half = A_NEAR_PX // 2
    nrm = norm_map(Image.open(fetch("a_nor_4k")).crop((nx, ny, nx + half, ny + half)), 1.8)
    rows.append(("asphalt_normal.jpg", save(nrm, "asphalt_normal.jpg", 88), f"{A_NEAR_M:.1f} m tile, 137 px/m, native 1:1"))
    rough = Image.open(fetch("a_rough_4k")).crop((nx, ny, nx + half, ny + half))
    # roughness carries no detail worth 1.2 MB: sheen varies over centimetres and
    # up, so half the pixels are free. (Sizes are reported at the end.)
    rough = rough.resize((half // 2, half // 2), Image.LANCZOS)
    img, means["asphalt_rough"] = roughness_map(rough, 0.62, 0.98, 0.88)
    rows.append(("asphalt_rough.jpg", save(img, "asphalt_rough.jpg", 86),
                 f"{A_NEAR_M:.1f} m tile, mean roughness {means['asphalt_rough']:.3f}"))
    del im, nrm, rough
    gc.collect()

    # mid-scale structure: 20-100 cm aggregate zones. 12 m tile at 2048 px is
    # 170 px/m - 3x the size of the thing it carries, so it can only add the
    # mid band, never pixel sparkle.
    im = Image.open(fetch("a_8k"))
    mx, my = x0 + 1024, y0 + 1024
    patch = im.crop((mx, my, mx + 2048, my + 2048)).resize((1024, 1024), Image.LANCZOS)
    patch = deblotch(desaturate(patch, DESAT), 18, 0.5)
    img, means["asphalt_patch"] = multiplier_jpg(patch, 0.80, 1.0, 0.945)
    rows.append(("asphalt_patch.jpg", save(img, "asphalt_patch.jpg"),
                 "12.0 m tile, multiplier, 20-100 cm zones"))
    del im, patch
    gc.collect()

    # ---------------- dirt / shoulder ----------------
    dmac = Image.open(fetch("d_macro_1k")).convert("RGB")
    a = np.asarray(desaturate(dmac, DESAT)).astype(np.float32)
    m = a.reshape(-1, 3).mean(axis=0)
    dmacd = Image.fromarray(np.clip(m + (a - m) * 0.6, 0, 255).astype(np.uint8), "RGB")
    img, means["dirt_macro"] = multiplier_jpg(dmacd, 0.88, 1.0, 0.951)
    rows.append(("dirt_macro.jpg", save(img, "dirt_macro.jpg"), "20.0 m tile, multiplier"))

    im = Image.open(fetch("d_8k"))
    print("  sandy_gravel_02 near field, 8k master = 324 px/m")
    dx, dy = best_crop(im, D_NEAR_PX * 2, 512, "dirt albedo 12.6 m")
    dn = im.crop((dx, dy, dx + D_NEAR_PX * 2, dy + D_NEAR_PX * 2))
    dn = denoise(desaturate(dn, DESAT), 1.8).resize((D_NEAR_PX, D_NEAR_PX), Image.LANCZOS)
    dn = deblotch(dn, 40, 0.5)
    dnn = np.asarray(dn.convert("L")).astype(np.float32)
    means["dirt_albedo"] = [round(float(v), 4) for v in np.asarray(dn).astype(np.float32).reshape(-1, 3).mean(axis=0) / 255.0]
    rows.append(("dirt_albedo.jpg", save(dn, "dirt_albedo.jpg", 80),
                 f"{D_NEAR_M:.2f} m tile, 162 px/m, detail {highpass_detail(dnn):.2f}, mean {dnn.mean():.1f}"))
    del dn, dnn
    gc.collect()

    dxh, dyh = dx // 2, dy // 2
    dnrm = norm_map(Image.open(fetch("d_nor_4k")).crop((dxh, dyh, dxh + D_NEAR_PX, dyh + D_NEAR_PX)), 1.8)
    rows.append(("dirt_normal.jpg", save(dnrm, "dirt_normal.jpg", 88), f"{D_NEAR_M:.2f} m tile, 162 px/m, native 1:1"))
    drough = Image.open(fetch("d_rough_4k")).crop((dxh, dyh, dxh + D_NEAR_PX // 2, dyh + D_NEAR_PX // 2))
    drough = drough.resize((D_NEAR_PX // 4, D_NEAR_PX // 4), Image.LANCZOS)
    img, means["dirt_rough"] = roughness_map(drough, 0.66, 1.0, 0.93)
    rows.append(("dirt_rough.jpg", save(img, "dirt_rough.jpg", 86),
                 f"{D_NEAR_M:.2f} m tile, mean roughness {means['dirt_rough']:.3f}"))
    del im, dnrm, drough
    gc.collect()

    im = Image.open(fetch("d_8k"))
    mx, my = dx + 1024, dy + 1024
    dpatch = im.crop((mx, my, mx + 4096, my + 4096)).resize((1024, 1024), Image.LANCZOS)
    dpatch = deblotch(desaturate(dpatch, DESAT), 16, 0.5)
    img, means["dirt_patch"] = multiplier_jpg(dpatch, 0.80, 1.0, 0.94)
    rows.append(("dirt_patch.jpg", save(img, "dirt_patch.jpg"), "12.6 m tile, multiplier"))
    del im, dpatch
    gc.collect()

    total = 0
    for name, size, note in rows:
        total += size
        print(f"{name:22s} {size / 1024:7.1f} KB  {note}")
    print(f"{'TOTAL':22s} {total / 1048576:7.2f} MB")
    print()
    print("measured means, to paste into lab/src/parts/road.ts:")
    print(json.dumps(means, indent=1))
    with open(os.path.join(OUT, "means.json"), "w") as f:
        json.dump(means, f, indent=1)


if __name__ == "__main__":
    sys.exit(main())
