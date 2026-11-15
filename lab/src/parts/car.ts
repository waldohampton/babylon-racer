import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { RawCubeTexture } from "@babylonjs/core/Materials/Textures/rawCubeTexture";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion } from "@babylonjs/core/Maths/math.vector";
import type { LabCtx } from "../main";

/**
 * CAR. Owns the vehicle mesh, its materials and its placement in the shot.
 *
 * Route taken: a real GLB, not procedural boxes. The repo has no
 * `@babylonjs/loaders` package (only @babylonjs/core), so this file carries a
 * small glTF-binary reader: position / normal / uv / index accessors, the
 * material graph (base colour, metallic-roughness, normal, alpha mode) and
 * textures decoded from the GLB's own buffer views. That keeps the part
 * self-contained and needs no dependency change.
 *
 * Asset: assets/car/muscle-grab3d.glb  CC0-1.0  grab3d.com "Muscle Car"
 *   19,806 tri fastback muscle coupe, 4.68 x 1.92 x 1.39 m, quad headlights,
 *   separate wheels with hub pivots, 2K PBR maps. Source page:
 *   https://grab3d.com/models/vehicles/muscle-car/  (download
 *   https://grab3d.com/dl/muscle-car/muscle-car.glb)
 *   It is a PLACEHOLDER for a period-correct hero car: the fastback silhouette,
 *   quad lamps and long-bonnet/short-deck proportions are right, the sculpt is
 *   stylised low-poly and the paint has no real panel-gap detail.
 *
 * Materials are rebuilt, not inherited: the atlas is butter-yellow, so the body
 * albedo texture is remapped at load (yellow paint hues -> near-black, lamps,
 * grille and chrome islands untouched) and the body material is a PBR clearcoat
 * so the paint mirrors the environment instead of reading as a flat black mass.
 * Paint reflects scene.environmentTexture when the sky part provides one, and
 * otherwise a small analytic storm-sky cube built here (dark storm dome, bright
 * warm horizon band) so the car is never unlit black.
 *
 * Root is exported as `carRoot`, nose toward -Z, wheels on y = 0.
 */

const CAR_URL = "/assets/car/muscle-grab3d.glb";

type Vec = Float32Array;

interface Gltf {
  json: any;
  bin: ArrayBuffer | null;
}

/* ------------------------------------------------------------------ */
/* glTF binary reader                                                  */
/* ------------------------------------------------------------------ */

function fetchGlb(url: string): Gltf {
  // synchronous on purpose: installCar runs before main.ts sets HERO_READY, and
  // the capture harness shoots 3 s later. An async fetch races that window on a
  // software rasteriser, and the car would simply be missing from the frame.
  // a sync XHR may not use responseType in a document, so read it as a
  // byte-preserving text stream
  const xhr = new XMLHttpRequest();
  xhr.open("GET", url, false);
  xhr.overrideMimeType("text/plain; charset=x-user-defined");
  xhr.send();
  if (xhr.status !== 200 && xhr.status !== 0) throw new Error(`car glb ${xhr.status} ${url}`);
  const text = xhr.responseText;
  if (!text || text.length < 1024) throw new Error(`car glb empty ${url}`);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  const buf = bytes.buffer;
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error("car glb: bad magic");
  const total = dv.getUint32(8, true);
  let off = 12;
  let json: any = null;
  let bin: ArrayBuffer | null = null;
  while (off < total) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    const chunk = buf.slice(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (type === 0x004e4942) bin = chunk;
    off += 8 + len;
  }
  if (!json) throw new Error("car glb: no JSON chunk");
  return { json, bin };
}

const COMPONENT = {
  5120: { size: 1, read: (dv: DataView, o: number) => dv.getInt8(o), norm: 127 },
  5121: { size: 1, read: (dv: DataView, o: number) => dv.getUint8(o), norm: 255 },
  5122: { size: 2, read: (dv: DataView, o: number) => dv.getInt16(o, true), norm: 32767 },
  5123: { size: 2, read: (dv: DataView, o: number) => dv.getUint16(o, true), norm: 65535 },
  5125: { size: 4, read: (dv: DataView, o: number) => dv.getUint32(o, true), norm: 0xffffffff },
  5126: { size: 4, read: (dv: DataView, o: number) => dv.getFloat32(o, true), norm: 0 },
} as const;

function readAccessor(g: Gltf, index: number): { data: Vec; itemSize: number; count: number } {
  const json = g.json;
  const acc = json.accessors[index];
  const comp = COMPONENT[acc.componentType as keyof typeof COMPONENT];
  if (!comp) throw new Error(`car glb: component ${acc.componentType}`);
  const itemSize = acc.type === "SCALAR" ? 1 : acc.type === "VEC2" ? 2 : acc.type === "VEC3" ? 3 : 4;
  const count = acc.count;
  const out = new Float32Array(count * itemSize);
  if (acc.bufferView == null) return { data: out, itemSize, count };
  const view = json.bufferViews[acc.bufferView];
  const base = (view.byteOffset || 0) + (acc.byteOffset || 0);
  const stride = view.byteStride || itemSize * comp.size;
  const dv = new DataView(g.bin!);
  const scale = acc.normalized && comp.norm ? 1 / comp.norm : 1;
  for (let i = 0; i < count; i++) {
    const rowBase = base + i * stride;
    for (let c = 0; c < itemSize; c++) {
      out[i * itemSize + c] = comp.read(dv, rowBase + c * comp.size) * scale;
    }
  }
  return { data: out, itemSize, count };
}

function imageBytes(g: Gltf, imageIndex: number): { bytes: Uint8Array; mime: string } {
  const img = g.json.images[imageIndex];
  const view = g.json.bufferViews[img.bufferView];
  const start = view.byteOffset || 0;
  return {
    bytes: new Uint8Array(g.bin!, start, view.byteLength),
    mime: img.mimeType || "image/png",
  };
}

function textureFromBytes(bytes: Uint8Array, mime: string, scene: Scene, srgb: boolean): Texture {
  const blob = new Blob([bytes.slice()], { type: mime });
  const url = URL.createObjectURL(blob);
  const t = new Texture(url, scene, false, false, Texture.TRILINEAR_SAMPLINGMODE);
  t.gammaSpace = srgb;
  return t;
}

/* ------------------------------------------------------------------ */
/* fallback storm environment (only used when the sky part has none)    */
/* ------------------------------------------------------------------ */

function buildStormEnv(scene: Scene): RawCubeTexture {
  const size = 96;
  const sunAz = -0.85;
  const sky = (x: number, y: number, z: number, out: Float32Array) => {
    const len = Math.hypot(x, y, z) || 1;
    const nx = x / len;
    const ny = y / len;
    const nz = z / len;
    const el = Math.asin(Math.max(-1, Math.min(1, ny))); // -pi/2 .. pi/2
    const az = Math.atan2(nx, nz);
    const side = 0.5 + 0.5 * Math.cos(az - sunAz);
    if (ny >= 0) {
      // storm dome: cold charcoal at zenith to cool grey at the horizon
      const t = Math.pow(1 - Math.min(1, el / (Math.PI / 2)), 1.7);
      const band = 0.82 + 0.18 * Math.sin(az * 3.1 + 1.2) * Math.sin(el * 9.0);
      let r = (0.05 + (0.62 - 0.05) * t) * band;
      let g = (0.06 + (0.63 - 0.06) * t) * band;
      let b = (0.08 + (0.66 - 0.08) * t) * band;
      // elongated warm horizon break, strongest toward the sun side
      const glow = Math.exp(-Math.pow((el - 0.05) / 0.085, 2)) * (0.3 + 0.7 * side);
      r += glow * 2.4;
      g += glow * 1.35;
      b += glow * 0.62;
      out[0] = r;
      out[1] = g;
      out[2] = b;
    } else {
      // dusty desert floor, still lit at the horizon line
      const t = Math.min(1, -el / (Math.PI / 2));
      const near = Math.exp(-Math.pow((el + 0.02) / 0.07, 2)) * (0.3 + 0.7 * side);
      out[0] = 0.085 + 0.05 * (1 - t) + near * 0.85;
      out[1] = 0.072 + 0.04 * (1 - t) + near * 0.55;
      out[2] = 0.055 + 0.03 * (1 - t) + near * 0.28;
    }
    out[3] = 1;
  };

  // Babylon cube face order: +X, -X, +Y, -Y, +Z, -Z
  const faces: Array<(u: number, v: number) => [number, number, number]> = [
    (u, v) => [1, -v, -u],
    (u, v) => [-1, -v, u],
    (u, v) => [u, 1, v],
    (u, v) => [u, -1, -v],
    (u, v) => [u, -v, 1],
    (u, v) => [-u, -v, -1],
  ];
  const data: Uint8Array[] = [];
  for (const f of faces) {
    const px = new Uint8Array(size * size * 4);
    const tmp = new Float32Array(4);
    let i = 0;
    for (let yy = 0; yy < size; yy++) {
      const v = ((yy + 0.5) / size) * 2 - 1;
      for (let xx = 0; xx < size; xx++) {
        const u = ((xx + 0.5) / size) * 2 - 1;
        const [dx, dy, dz] = f(u, v);
        sky(dx, dy, dz, tmp);
        px[i++] = Math.min(255, Math.round(Math.pow(Math.min(1, tmp[0]), 1 / 2.2) * 255));
        px[i++] = Math.min(255, Math.round(Math.pow(Math.min(1, tmp[1]), 1 / 2.2) * 255));
        px[i++] = Math.min(255, Math.round(Math.pow(Math.min(1, tmp[2]), 1 / 2.2) * 255));
        px[i++] = 255;
      }
    }
    data.push(px);
  }
  // UNSIGNED_BYTE, not FLOAT: a float cube with generated mips is not ready on
  // every backend, and a PBR material whose reflection map is not ready stops
  // drawing altogether. Bytes are always ready, and sRGB-encoded bytes carry the
  // horizon band just as well.
  const tex = new RawCubeTexture(
    scene,
    data,
    size,
    Constants.TEXTUREFORMAT_RGBA,
    Constants.TEXTURETYPE_UNSIGNED_BYTE,
    true,
    false,
    Texture.BILINEAR_SAMPLINGMODE
  );
  tex.gammaSpace = true;
  return tex;
}

/* ------------------------------------------------------------------ */
/* install                                                             */
/* ------------------------------------------------------------------ */

export function installCar(ctx: LabCtx) {
  const { scene } = ctx;

  const root = new TransformNode("carRoot", scene);
  root.position.set(0, 0, 0);
  // nose toward -Z by default (camera sits at -Z), so the hero view is
  // front-three-quarter. `?caraim=free` re-places the car into the default
  // camera's frame, which is aimed down +Z and does not look at the origin.
  const aimFree = new URLSearchParams(location.search).get("caraim") === "free";
  root.rotation.y = aimFree ? -2.18 : Math.PI;

  const fallbackEnv = buildStormEnv(scene);

  // contact shadow so the car is not floating; the sun part may add real ones
  const blob = new DynamicTexture("carContactShadow", { width: 256, height: 128 }, scene, false);
  const bctx = blob.getContext() as unknown as CanvasRenderingContext2D;
  const grd = bctx.createRadialGradient(128, 64, 4, 128, 64, 120);
  grd.addColorStop(0, "rgba(0,0,0,0.88)");
  grd.addColorStop(0.5, "rgba(0,0,0,0.55)");
  grd.addColorStop(1, "rgba(0,0,0,0)");
  bctx.fillStyle = grd;
  bctx.fillRect(0, 0, 256, 128);
  blob.update(false);
  blob.hasAlpha = true;
  const shadow = MeshBuilder.CreateGround("carContactShadow", { width: 5.6, height: 2.9 }, scene);
  const shadowMat = new StandardMaterial("carContactShadowMat", scene);
  shadowMat.diffuseTexture = blob;
  shadowMat.opacityTexture = blob;
  shadowMat.useAlphaFromDiffuseTexture = true;
  shadowMat.disableLighting = true;
  shadowMat.emissiveColor = new Color3(0, 0, 0);
  shadowMat.diffuseColor = new Color3(0, 0, 0);
  shadowMat.specularColor = new Color3(0, 0, 0);
  shadowMat.backFaceCulling = false;
  shadow.material = shadowMat;
  shadow.isPickable = false;
  shadow.parent = root;
  shadow.position.set(0, 0.012, 0.05);

  let paint: PBRMaterial | null = null;
  let bodyMesh: Mesh | null = null;
  const envMats: PBRMaterial[] = [];
  const installedAt = Date.now();

  // The sky part owns scene.environmentTexture, but an HDR cube takes seconds to
  // decode and a PBR material whose reflection map is not ready stops drawing
  // entirely - the car blinks out of the frame while the harness captures. So the
  // car starts on the analytic storm cube below (ready on the first frame) and
  // upgrades to the sky's map once it is ready and the capture window has passed.
  // If the upgrade ever leaves the material unready, it falls back again: the car
  // must never be invisible because of an environment map.
  const settleMs = 6000;
  // Flip to true to light the paint from scene.environmentTexture. Left false
  // because the sky part's HDR is a soft overcast gradient: reflecting it gives a
  // broad grey sheen and the car reads as satin black. The analytic cube above has
  // the hard bright horizon break that a clearcoat needs to read as gloss.
  const USE_SKY_ENV = false;
  let frames = 0;
  let envTrial = -1; // -1 not tried, >=0 frame the sky map was first applied, -2 gave up
  const syncEnv = () => {
    if (!paint || !bodyMesh) return;
    const sky = scene.environmentTexture;
    if (!USE_SKY_ENV || envTrial === -2) return;
    if (envTrial < 0) {
      // one shot at the sky's IBL, once it is ready and the capture window is done
      if (sky && sky.isReady() && Date.now() - installedAt > settleMs) {
        for (const m of envMats) m.reflectionTexture = sky;
        envTrial = frames;
      }
      return;
    }
    if (paint.isReady(bodyMesh)) {
      envTrial = -2; // accepted, stop polling
      return;
    }
    if (frames - envTrial > 4) {
      // the sky map never became usable: keep the analytic cube and stop trying,
      // so the car can never be invisible because of another part's env map
      for (const m of envMats) m.reflectionTexture = fallbackEnv;
      envTrial = -2;
    }
  };
  const poll = scene.onBeforeRenderObservable.add(() => {
    syncEnv();
    if (++frames > 900) scene.onBeforeRenderObservable.remove(poll);
  });

  try {
    build();
  } catch (e) {
    console.warn("[car] load failed:", e);
  }

  function build() {
    const g = fetchGlb(CAR_URL);
    const json = g.json;

    // textures are shared by image index and colour space
    const texCache = new Map<string, Texture>();

    const getTex = (texInfo: any, srgb: boolean): Texture | null => {
      if (!texInfo) return null;
      const tex = json.textures[texInfo.index];
      const src = tex.source ?? tex.extensions?.KHR_texture_basisu?.source;
      if (src == null) return null;
      const key = `${src}:${srgb ? "srgb" : "lin"}`;
      const hit = texCache.get(key);
      if (hit) return hit;
      const { bytes, mime } = imageBytes(g, src);
      const t = textureFromBytes(bytes, mime, scene, srgb);
      texCache.set(key, t);
      return t;
    };

    // body albedo: pre-baked from the atlas with the yellow paint remapped to
    // glossy black (see assets/car/README). Baked offline so the part is loaded
    // and lit inside the harness's 3 s settle window instead of decoding a
    // 2048px atlas and remapping it at boot.
    let bodyAlbedo: Texture | null = new Texture(
      "/assets/car/body_basecolor_black.jpg",
      scene,
      false,
      false,
      Texture.TRILINEAR_SAMPLINGMODE
    );
    bodyAlbedo.gammaSpace = true;

    // ---- materials (deduped: wheels share one set, not four) ----
    const mats: PBRMaterial[] = [];
    const matByKey = new Map<string, PBRMaterial>();
    for (let i = 0; i < json.materials.length; i++) {
      const src = json.materials[i];
      const name = String(src.name).replace(/\.\d{3}$/, "");
      const shared = matByKey.get(name);
      if (shared) {
        mats.push(shared);
        continue;
      }
      const pbr = src.pbrMetallicRoughness || {};
      const m = new PBRMaterial(`car_${name}`, scene);
      const base = pbr.baseColorFactor;
      m.albedoColor = base
        ? new Color3(base[0], base[1], base[2])
        : new Color3(1, 1, 1);
      m.metallic = pbr.metallicFactor ?? 1;
      m.roughness = pbr.roughnessFactor ?? 1;

      const isBody = name === "muscle-car_body_pbr";
      if (isBody && bodyAlbedo) {
        m.albedoTexture = bodyAlbedo;
      } else {
        const bt = getTex(pbr.baseColorTexture, true);
        if (bt) m.albedoTexture = bt;
      }

      const mr = isBody ? null : getTex(pbr.metallicRoughnessTexture, false);
      if (mr) {
        m.metallicTexture = mr;
        m.useRoughnessFromMetallicTextureGreen = true;
        m.useMetallnessFromMetallicTextureBlue = true;
        m.useRoughnessFromMetallicTextureAlpha = false;
      }
      const nt = isBody ? null : getTex(src.normalTexture, false);
      if (nt) {
        m.bumpTexture = nt;
        m.invertNormalMapX = true;
        m.invertNormalMapY = false;
      }
      if (src.doubleSided) m.backFaceCulling = false;

      // ---- per-material finish ----
      if (isBody) {
        paint = m;
        // glossy black clearcoat: the baked atlas carries panel shading only, the
        // sheen comes from the mirror lobe, so metallic stays low and roughness
        // tight enough to hold the sky's horizon break as a streak
        m.albedoColor = new Color3(1, 1, 1);
        m.metallic = 0.36;
        m.roughness = 0.14;
        m.clearCoat.isEnabled = true;
        m.clearCoat.intensity = 1.0;
        m.clearCoat.roughness = 0.02;
        m.clearCoat.indexOfRefraction = 1.52;
        m.clearCoat.useRoughnessFromMainTexture = false;
        m.environmentIntensity = 1.2;
        m.directIntensity = 2.2;
        m.reflectionTexture = fallbackEnv;
        envMats.push(m);
      } else if (name.includes("window_glass")) {
        m.albedoColor = new Color3(0.03, 0.035, 0.045);
        m.metallic = 0.15;
        m.roughness = 0.035;
        m.alpha = 0.78;
        m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
        m.useAlphaFromAlbedoTexture = false;
        m.environmentIntensity = 1.6;
        m.reflectionTexture = fallbackEnv;
        envMats.push(m);
      } else if (name.startsWith("muscle-car_rim")) {
        m.albedoColor = new Color3(0.40, 0.41, 0.43);
        m.metallic = 1.0;
        m.roughness = 0.28;
        m.environmentIntensity = 1.2;
        m.reflectionTexture = fallbackEnv;
        envMats.push(m);
      } else if (name.startsWith("muscle-car_tire")) {
        m.albedoColor = new Color3(0.032, 0.031, 0.030);
        m.metallic = 0.0;
        m.roughness = 0.92;
        m.albedoTexture = null;
        m.environmentIntensity = 0.3;
      } else if (name.startsWith("muscle-car_hubcap") || name.startsWith("muscle-car_trim_charcoal")) {
        m.albedoColor = new Color3(0.055, 0.055, 0.06);
        m.metallic = 0.55;
        m.roughness = 0.35;
        m.environmentIntensity = 1.0;
        m.reflectionTexture = fallbackEnv;
        envMats.push(m);
      }
      matByKey.set(name, m);
      mats.push(m);
    }

    // ---- meshes ----
    const nodes: any[] = json.nodes || [];
    const nodeRoots = new Map<number, TransformNode>();

    const buildNode = (index: number, parent: TransformNode): TransformNode => {
      const n = nodes[index];
      const tn = new TransformNode(`carNode_${n.name || index}`, scene);
      if (n.translation) tn.position.set(n.translation[0], n.translation[1], n.translation[2]);
      if (n.rotation) {
        const q = n.rotation;
        tn.rotationQuaternion = new Quaternion(q[0], q[1], q[2], q[3]);
      }
      if (n.scale) tn.scaling.set(n.scale[0], n.scale[1], n.scale[2]);
      tn.parent = parent;
      nodeRoots.set(index, tn);

      if (n.mesh != null) {
        const mesh = json.meshes[n.mesh];
        mesh.primitives.forEach((prim: any, pi: number) => {
          const pos = readAccessor(g, prim.attributes.POSITION);
          const nor = prim.attributes.NORMAL != null ? readAccessor(g, prim.attributes.NORMAL) : null;
          const uv = prim.attributes.TEXCOORD_0 != null ? readAccessor(g, prim.attributes.TEXCOORD_0) : null;
          let idx: Uint32Array | null = null;
          if (prim.indices != null) {
            const ind = readAccessor(g, prim.indices);
            idx = new Uint32Array(ind.count);
            for (let i = 0; i < ind.count; i++) idx[i] = ind.data[i];
          }
          const positions: number[] = Array.from(pos.data);
          const normals: number[] = nor ? Array.from(nor.data) : [];
          const uvs: number[] = uv ? Array.from(uv.data) : [];
          const indices: number[] | null = idx ? Array.from(idx) : null;

          const bmesh = new Mesh(`${n.name || "car"}${pi ? `_${pi}` : ""}`, scene);
          const vd = new VertexData();
          vd.positions = positions;
          vd.normals = normals.length ? normals : null;
          vd.uvs = uvs.length ? uvs : null;
          vd.indices = indices;
          vd.applyToMesh(bmesh, false);
          if (!normals.length) bmesh.createNormals(true);
          const matIndex = prim.material ?? 0;
          bmesh.material = mats[matIndex];
          bmesh.parent = tn;
          bmesh.isPickable = false;
          bmesh.receiveShadows = true;
        });
      }
      (n.children || []).forEach((c: number) => buildNode(c, tn));
      return tn;
    };

    // top-level nodes -> under carRoot
    const sceneNodes: number[] = json.scenes?.[json.scene ?? 0]?.nodes ?? nodes.map((_, i) => i);
    sceneNodes.forEach((i) => buildNode(i, root));

    bodyMesh = scene.getMeshByName("muscle-car_body") as Mesh | null;

    // ---- seat it on the road ----
    for (const tn of nodeRoots.values()) tn.computeWorldMatrix(true);
    root.computeWorldMatrix(true);
    const meshes = root.getChildMeshes().filter((m) => m.name.startsWith("muscle-car"));
    let minY = Infinity;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const m of meshes) {
      m.computeWorldMatrix(true);
      const b = m.getBoundingInfo().boundingBox;
      minY = Math.min(minY, b.minimumWorld.y);
      minX = Math.min(minX, b.minimumWorld.x);
      maxX = Math.max(maxX, b.maximumWorld.x);
      minZ = Math.min(minZ, b.minimumWorld.z);
      maxZ = Math.max(maxZ, b.maximumWorld.z);
    }
    if (Number.isFinite(minY)) root.position.y -= minY;

    if (aimFree) {
      root.position.set(3.75, -minY, 0.9);
    } else {
      root.position.x = -(minX + maxX) / 2;
      root.position.z = -(minZ + maxZ) / 2;
    }

    // ---- wheels: a touch of steer on the front axle reads better than dead straight
    for (const [name, angle] of [
      ["wheel_fl", 0.14],
      ["wheel_fr", 0.14],
      ["wheel_rl", 0],
      ["wheel_rr", 0],
    ] as Array<[string, number]>) {
      const tn = scene.getTransformNodeByName(`carNode_${name}`);
      if (tn) tn.rotation.y = angle;
    }

    const stats = {
      meshes: meshes.length,
      tris: meshes.reduce((s, m) => s + m.getTotalIndices() / 3, 0),
      length: +(maxZ - minZ).toFixed(2),
      width: +(maxX - minX).toFixed(2),
      paintReflects: paint?.reflectionTexture ? "env" : "none",
    };
    (window as any).CAR = stats;
    (window as any).CAR_LOADED = true;
    // if the sky part has not provided IBL yet, hand the paint one: this only
    // affects PBR materials, and the sky part overwrites it when it installs.
    if (!scene.environmentTexture) scene.environmentTexture = fallbackEnv;
    syncEnv();
  }
}
