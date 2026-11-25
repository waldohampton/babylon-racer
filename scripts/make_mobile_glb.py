"""Rebuild a GLB with smaller embedded textures, for the mobile quality tier.

    python3 scripts/make_mobile_glb.py in.glb out.glb 1024 82

Why a separate file instead of downscaling at runtime: the car's five 2k maps
are about 80 MB of GPU memory decompressed, which is what gets a phone tab
killed. Resizing them offline keeps the shipped file honest and the load path
identical. Buffer views that are not images are copied byte for byte, and every
offset is rewritten with 4 byte alignment, which glTF requires.
"""
import io
import json
import struct
import sys

from PIL import Image


def read_glb(path):
    data = open(path, "rb").read()
    magic, version, total = struct.unpack("<III", data[:12])
    assert magic == 0x46546C67, "not a GLB"
    chunks = []
    off = 12
    while off < len(data):
        clen, ctype = struct.unpack("<II", data[off : off + 8])
        off += 8
        chunks.append((ctype, data[off : off + clen]))
        off += clen
    return json.loads(chunks[0][1]), chunks[1][1]


def write_glb(path, gltf, binary):
    def pad(b, fill):
        while len(b) % 4:
            b += fill
        return b

    js = pad(json.dumps(gltf, separators=(",", ":")).encode("utf-8"), b" ")
    bn = pad(binary, b"\0")
    body = struct.pack("<II", len(js), 0x4E4F534A) + js
    body += struct.pack("<II", len(bn), 0x004E4942) + bn
    open(path, "wb").write(struct.pack("<III", 0x46546C67, 2, 12 + len(body)) + body)


def main():
    src, dst = sys.argv[1], sys.argv[2]
    size = int(sys.argv[3]) if len(sys.argv) > 3 else 1024
    quality = int(sys.argv[4]) if len(sys.argv) > 4 else 82

    gltf, binary = read_glb(src)
    image_views = {img["bufferView"]: img for img in gltf.get("images", []) if "bufferView" in img}

    out = bytearray()
    resized = []
    for i, view in enumerate(gltf["bufferViews"]):
        start = view.get("byteOffset", 0)
        blob = binary[start : start + view["byteLength"]]

        img = image_views.get(i)
        if img:
            im = Image.open(io.BytesIO(blob))
            before = im.size
            im.thumbnail((size, size), Image.LANCZOS)
            buf = io.BytesIO()
            if "png" in img.get("mimeType", ""):
                im.save(buf, "PNG", optimize=True)
            else:
                im.convert("RGB").save(buf, "JPEG", quality=quality, optimize=True)
            blob = buf.getvalue()
            resized.append((img.get("name") or img.get("mimeType"), before, im.size, len(blob)))

        while len(out) % 4:
            out.append(0)
        view["byteOffset"] = len(out)
        view["byteLength"] = len(blob)
        out += blob

    gltf["buffers"][0]["byteLength"] = len(out)
    write_glb(dst, gltf, bytes(out))

    for name, before, after, n in resized:
        print(f"  {name:24s} {before[0]}x{before[1]} -> {after[0]}x{after[1]}  {n/1024:.0f} KB")
    print(f"{dst}  {len(open(dst,'rb').read())/1e6:.2f} MB (was {len(open(src,'rb').read())/1e6:.2f} MB)")


if __name__ == "__main__":
    main()
