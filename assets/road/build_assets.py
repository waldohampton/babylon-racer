#!/usr/bin/env python3
"""Build the road/shoulder textures from Poly Haven scans.

    python3 assets/road/build_assets.py

Sources (CC0, downloaded from the Poly Haven API):
    https://api.polyhaven.com/files/<id>          -> 1k / 4k / 8k jpg urls
    https://api.polyhaven.com/info/<id>           -> "dimensions" in CENTIMETRES

The dimensions are the whole point: every tile size below is a real measurement
of the scanned patch of ground, not a taste call. Where a scan is too coarse to
serve a near-field layer (a 1k download of a 40 m tile is 25 px/m), a 1024 crop
is cut out of the 8k master at the size the layer is drawn, which is how the
middle and detail layers get 137 and 273 px/m.

Two encodings come out of here:

  *_detail.jpg   greyscale, mean baked to exactly 0.500, clamped to +-13% of
                 that. StandardMaterial's DetailMap plugin computes
                 baseColor * 2 * mix(0.5, d, k), so a mean of 0.500 makes the
                 multiplier average 1.0 and the layer adds frequency without
                 retinting or re-exposing anything.

  *_mid.jpg      the multiplier itself, clamped into [lo, 1.0] so an overlay can
                 only ever darken. Its mean is printed below; the base tint in
                 road.ts is divided by it, so switching the layer on shifts
                 nothing. The same encoding is used for the canvas-generated
                 wear layers in road.ts.

Desaturation is applied once to the macro layer, which is the only chromatic
layer: the other layers are achromatic multipliers, so desaturating the macro is
the same operation as desaturating the finished albedo after all layers are
multiplied. The scans are photographs of already-lit, already-warm sand, and a
warm sun over warm sand doubles the warmth.
"""
import gc
import json
import os
import sys
import urllib.request

import numpy as np
from PIL import Image

CACHE = os.path.join(os.path.expanduser("~"), ".hermes", "cache", "scratch", "roadsrc")
OUT = os.path.dirname(os.path.abspath(__file__))
DESAT = 0.55

# layer id, poly haven asset, resolution, remote path
SOURCES = {
    "a_macro_1k": ("asphalt_04", "1k", "asphalt_04/asphalt_04_diff_1k.jpg"),
    "a_8k": ("asphalt_02", "8k", "asphalt_02/asphalt_02_diff_8k.jpg"),
    "a_nor_4k": ("asphalt_02", "4k", "asphalt_02/asphalt_02_nor_gl_4k.jpg"),
    "a_rough_4k": ("asphalt_02", "4k", "asphalt_02/asphalt_02_rough_4k.jpg"),
    "d_macro_1k": ("cracked_red_ground", "1k", "cracked_red_ground/cracked_red_ground_diff_1k.jpg"),
    "d_8k": ("sandy_gravel_02", "8k", "sandy_gravel_02/sandy_gravel_02_diff_8k.jpg"),
    "d_nor_4k": ("sandy_gravel_02", "4k", "sandy_gravel_02/sandy_gravel_02_nor_gl_4k.jpg"),
}


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


def desaturate(img, k):
    a = np.asarray(img).astype(np.float32)
    l = lum(a)[..., None]
    return Image.fromarray(np.clip(a * (1 - k) + l * k, 0, 255).astype(np.uint8), "RGB")


def recentre(v, target, clip_lo, clip_hi, iters=16):
    for _ in range(iters):
        v = np.clip(v, clip_lo, clip_hi)
        v = v + (target - v.mean())
    return np.clip(v, clip_lo, clip_hi)


def flatten(img, k):
    """Pull a macro layer toward its own mean.

    A 40 m tile is unavoidably visible as a repeat across a 500 m road; the
    macro's job is broad tonal drift, and at full contrast its blotches read as
    tiling. Pulling it 40% toward its mean keeps the drift and drops the tell.
    """
    a = np.asarray(img).astype(np.float32)
    m = a.reshape(-1, 3).mean(axis=0)
    return Image.fromarray(np.clip(m + (a - m) * k, 0, 255).astype(np.uint8), "RGB")


def deblotch(img, sigma=26, amount=0.6, sharpen=1.18):
    """Subtract the low frequencies a 3.75 m crop carries (big soft blotches that
    read as 'blurry blob' and give a mirrored tile away) and put a little of the
    high frequency back. The aggregate and cracks survive; the splotches do not.
    """
    from PIL import ImageFilter
    a = np.asarray(img).astype(np.float32)
    low = np.asarray(img.filter(ImageFilter.GaussianBlur(sigma))).astype(np.float32)
    out = a - (low - low.reshape(-1, 3).mean(axis=0)) * amount
    m = out.reshape(-1, 3).mean(axis=0)
    out = m + (out - m) * sharpen
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB")


def detail_png(img, gain=1.55):
    """Mean-normalised, clamped detail layer; the shader doubles it."""
    g = np.asarray(img.convert("L")).astype(np.float32) / 255.0
    v = recentre(0.5 + (g - g.mean()) * gain, 0.5, 0.37, 0.63)
    return Image.fromarray(np.round(v * 255).astype(np.uint8), "L").convert("RGB"), v.mean()


def multiplier_jpg(img, amp):
    """The multiplier itself, clamped into [1-amp, 1]: darkening only."""
    g = np.asarray(img.convert("L")).astype(np.float32) / 255.0
    m = g / g.mean()
    v = recentre(m, 1.0 - amp * 0.55, 1.0 - amp, 1.0)
    return Image.fromarray(np.round(v * 255).astype(np.uint8), "L").convert("RGB"), v.mean()


def save(img, name, q=82):
    path = os.path.join(OUT, name)
    img.save(path, "JPEG", quality=q, optimize=True)
    return os.path.getsize(path)


def main():
    rows = []
    means = {}

    # ---------------- asphalt ----------------
    # macro: asphalt_04, a real 40.4 m tile, 1k (25 px/m is plenty at 40-100 m)
    mac = flatten(desaturate(Image.open(fetch("a_macro_1k")).convert("RGB"), DESAT), 0.55)
    img, means["asphalt_macro"] = multiplier_jpg(mac, 0.07)
    rows.append(("asphalt_macro.jpg", save(img, "asphalt_macro.jpg"), f"40.4 m tile, multiplier mean {means['asphalt_macro']:.4f}"))

    im = Image.open(fetch("a_8k"))  # 8192 px over 30.0 m => 273 px/m
    # BASE: a 1024 crop of the master = 3.75 m of ground at 273 px/m, which is
    # 1:1 with the screen at 5 m. This is the layer the near field is judged on,
    # so it is the albedo itself rather than a multiplier over a 40 m base -
    # a multiplier can sharpen a blurry base but it cannot rescue it.
    base = deblotch(desaturate(im.crop((3008, 5200, 4032, 6224)), DESAT))
    rows.append(("asphalt_base.jpg", save(base, "asphalt_base.jpg"), "3.75 m tile, 273 px/m"))
    # DETAIL slot: 2560 px of the master = 9.4 m, symmetric +-10% around its mean
    mid = im.crop((1200, 1800, 3760, 4360)).resize((1024, 1024), Image.LANCZOS)
    img, means["asphalt_detail"] = detail_png(mid, 0.9)
    rows.append(("asphalt_detail.jpg", save(img, "asphalt_detail.jpg"), f"9.4 m tile, detail mean {means['asphalt_detail']:.4f}"))
    del im, mid
    gc.collect()

    # relief and sheen at the middle scale (4k master = 137 px/m, 1024 crop = 7.5 m)
    for key, name in (("a_nor_4k", "asphalt_nrm.jpg"), ("a_rough_4k", "asphalt_rough.jpg")):
        crop = Image.open(fetch(key)).crop((1500, 1500, 2524, 2524)).convert("RGB")
        rows.append((name, save(crop, name), "7.5 m tile"))
        del crop
        gc.collect()

    # ---------------- dirt / shoulder ----------------
    # macro: cracked_red_ground, a real 20 m tile: red-brown cracked desert earth
    dmac = flatten(desaturate(Image.open(fetch("d_macro_1k")).convert("RGB"), DESAT), 0.6)
    img, means["dirt_macro"] = multiplier_jpg(dmac, 0.09)
    rows.append(("dirt_macro.jpg", save(img, "dirt_macro.jpg"), f"20.0 m tile, multiplier mean {means['dirt_macro']:.4f}"))

    im = Image.open(fetch("d_8k"))  # 8192 px over 25.3 m => 324 px/m
    dbase = deblotch(desaturate(im.crop((4000, 1800, 5024, 2824)), DESAT), 22, 0.5, 1.12)  # 1024 px = 3.16 m
    rows.append(("dirt_base.jpg", save(dbase, "dirt_base.jpg"), "3.16 m tile, 324 px/m"))
    mid = im.crop((2000, 2400, 5100, 5500)).resize((1024, 1024), Image.LANCZOS)  # 3100 px = 9.6 m
    img, means["dirt_detail"] = detail_png(mid, 1.0)
    rows.append(("dirt_detail.jpg", save(img, "dirt_detail.jpg"), f"9.6 m tile, detail mean {means['dirt_detail']:.4f}"))
    del im, mid
    gc.collect()

    crop = Image.open(fetch("d_nor_4k")).crop((1400, 1400, 2424, 2424)).convert("RGB")  # 6.3 m
    rows.append(("dirt_nrm.jpg", save(crop, "dirt_nrm.jpg"), "6.3 m tile"))

    total = 0
    for name, size, note in rows:
        total += size
        print(f"{name:22s} {size / 1024:7.1f} KB  {note}")
    print(f"{'TOTAL':22s} {total / 1048576:7.2f} MB")
    print()
    print("means baked into lab/src/parts/road.ts:")
    for k, v in means.items():
        print(f"  {k:16s} {v:.4f}")
    with open(os.path.join(OUT, "means.json"), "w") as f:
        json.dump({k: round(float(v), 4) for k, v in means.items()}, f, indent=1)


if __name__ == "__main__":
    sys.exit(main())
