import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
// side-effect import: without it Mesh.prototype.thinInstanceSetBuffer is a no-op stub
import "@babylonjs/core/Meshes/thinInstanceMesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Material } from "@babylonjs/core/Materials/material";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3, Matrix, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { Constants } from "@babylonjs/core/Engines/constants";
import type { Scene } from "@babylonjs/core/scene";
import type { LabCtx } from "../main";

/**
 * ROAD AND SHOULDER. Owns the asphalt carriageway, the double-yellow centreline
 * and edge lines, the loose-gravel shoulder, the dirt verge, and everything
 * standing on them (loose stones, dry scrub).
 *
 * ---------------------------------------------------------------------------
 * THE SURFACES ARE PHOTOGRAPHS AT THREE SCALES (Poly Haven, CC0)
 * ---------------------------------------------------------------------------
 * Every repeat is a real measurement taken from the asset's own `dimensions`
 * field - Poly Haven publishes that in CENTIMETRES - and every repeat is baked
 * into a mesh UV set instead of being cloned into a material, so one upload
 * serves any number of surfaces built from it.
 *
 *   layer    asphalt                          dirt / shoulder                UV
 *   macro    asphalt_04,      40.4 m tile     cracked_red_ground, 20.0 m     uv
 *   middle   asphalt_02 crop,  9.4 m tile     sandy_gravel_02 crop, 9.6 m    uv3
 *   detail   asphalt_02 crop, 3.75 m tile     sandy_gravel_02 crop, 3.16 m   uv2
 *   relief   asphalt_02 4k,    9.4 m          sandy_gravel_02 4k,   9.6 m    uv3
 *
 * The middle and detail layers are 1024 crops cut out of the 8k masters at the
 * size they are drawn, so they carry 137 and 273 pixels per metre rather than
 * the 25 px/m that a 1k download of a 40 m tile can offer. A crop cannot tile,
 * so both are sampled with MIRROR addressing instead of WRAP.
 *
 * TWO KINDS OF LAYER, TWO KINDS OF MATHS
 *  - detail: the engine's DetailMap plugin,  baseColor * 2 * mix(0.5, d, k).
 *            The JPEG is baked to a mean of exactly 0.5, so the multiplier is
 *            1.0 on average: the layer adds frequency at driving distance,
 *            where one tiled photo mips to a flat colour, without retinting or
 *            re-exposing anything under it.
 *  - middle and wear: unlit MULTIPLY overlays (dst *= src). The value stored in
 *            the texture IS the multiplier, clamped into [lo, 1.0] when it is
 *            generated, so an overlay can only darken. It can never come out
 *            brighter than the surface beneath it and read as a painted stripe.
 *            Each overlay's mean is below 1.0 and the base tint is divided by
 *            that mean, so switching a layer on shifts nothing.
 *
 * COLOUR. Only the macro layer carries hue - the other two are achromatic
 * multipliers - so desaturating the macro is the same operation as desaturating
 * the finished albedo after all layers are multiplied. That happens once, in
 * the asset build, at 55%: the scans are photographs of already-lit, already
 * warm sand, and a warm sun over warm sand doubles the warmth.
 */

const A = "/assets/road/";

// --- layout, metres from the painted centreline (x = 0) ---------------------
const Z_FROM = -60;
const Z_TO = 560;
const LANE = 3.6; // one lane; the carriageway is two, so 7.2 m of traffic lanes
const HARD = 0.45; // sealed shoulder outside the lane line
const ASPHALT = LANE + HARD; // 4.05 m half width
const EDGE_LINE_X = 3.5;
const GRAVEL_OUT = ASPHALT + 2.55; // 6.6 m: the loose gravel band
const VERGE_OUT = 44;

// --- tiles, straight from the scans' published dimensions ------------------
const T_BASE_A = 3.75; // the 8k master cropped to 1024 px
const T_MID_A = 9.4;
const T_MACRO_A = 40.4;
const T_NRM_A = 7.5;
const T_BASE_D = 3.16;
const T_MID_D = 9.6;
const T_MACRO_D = 20.0;
const T_NRM_D = 6.3;

/**
 * Albedo gain. A 1.0 albedo on this ground measures luma 74 under the current
 * placeholder light rig (hemi 0.5 plus a 12 degree sun), so the ground is
 * ceiling-bound rather than exposure-bound: these gains put the surfaces at the
 * pale, sun-bleached end of the physical range, which is as far as albedo can
 * reach. When the sun part raises irradiance, scale all three down together.
 */
const GAIN_ASPHALT = 3.35;
const GAIN_GRAVEL = 3.82;
const GAIN_DIRT = 3.99;

/**
 * Albedo tints, as vertex colours. Warmth has to live here rather than in
 * diffuseColor because that multiplies the light term the shader clamps at 1.0,
 * and a clamped term crushes chroma back toward neutral. Each is divided by the
 * mean of the multiply overlays on that surface, so the layers cost nothing.
 */
/**
 * Target albedo per surface, and what the base scan already measures. The
 * vertex tint is the ratio of the two, divided by the means of the multiply
 * overlays - so every number in the pipeline is a measurement, and the tint is
 * a correction rather than a taste call. Warmth lives here because
 * diffuseColor multiplies the light term the shader clamps at 1.0, and a
 * clamped term crushes chroma back toward neutral.
 */
const ALBEDO_ASPHALT: [number, number, number] = [0.665, 0.541, 0.35];
const ALBEDO_GRAVEL: [number, number, number] = [0.505, 0.304, 0.091];
const ALBEDO_DIRT: [number, number, number] = [0.474, 0.284, 0.08];
const BASE_ASPHALT: [number, number, number] = [0.349, 0.346, 0.337];
const BASE_DIRT: [number, number, number] = [0.55, 0.482, 0.425];

/**
 * Multiplier means, measured - not assumed. The two middle layers are baked by
 * assets/road/build_assets.py, which prints these; the wear layers are canvas
 * textures and are measured as they are drawn. Every base tint is divided by
 * the product of the means of the overlays that sit on it, so a layer can be
 * switched off without the surface changing brightness.
 */
const MACRO_MEAN_ASPHALT = 0.9615;
const MACRO_MEAN_DIRT = 0.9505;

export function installRoad(ctx: LabCtx) {
  const { scene } = ctx;

  // ---------------------------------------------------------------- textures
  const tiled = (file: string) => {
    const t = new Texture(A + file, scene, false, false, Texture.TRILINEAR_SAMPLINGMODE);
    t.anisotropicFilteringLevel = 16; // grazing angles: without this a road smears to a band
    t.wrapU = Texture.WRAP_ADDRESSMODE;
    t.wrapV = Texture.WRAP_ADDRESSMODE;
    return t;
  };
  const cropped = (file: string) => {
    const t = tiled(file);
    t.wrapU = Texture.MIRROR_ADDRESSMODE;
    t.wrapV = Texture.MIRROR_ADDRESSMODE;
    return t;
  };

  const aBase = cropped("asphalt_base.jpg"); // uv  (3.75 m, 273 px/m)
  const aDetail = cropped("asphalt_detail.jpg"); // uv2 (9.4 m)
  const aMacro = cropped("asphalt_macro.jpg"); // uv3 (40.4 m)
  const aNormal = cropped("asphalt_nrm.jpg"); // uv4 (7.5 m)
  const aRough = cropped("asphalt_rough.jpg"); // uv4 (7.5 m)

  const dBase = cropped("dirt_base.jpg"); // uv  (3.16 m, 324 px/m)
  const dDetail = cropped("dirt_detail.jpg"); // uv2 (9.6 m)
  const dMacro = cropped("dirt_macro.jpg"); // uv3 (20 m)
  const dNormal = cropped("dirt_nrm.jpg"); // uv4 (6.3 m)

  // --------------------------------------------------------------- materials
  const groundMat = (name: string, macro: Texture, detail: Texture, normal: Texture, gain: number, spec: number) => {
    const m = new StandardMaterial(name, scene);
    m.diffuseTexture = macro;
    // diffuseColor multiplies the LIGHT term, which the shader clamps to 1.0 -
    // so this is a neutral exposure lift only (kept below the clamp, so the
    // normal map still shades). Colour lives in the vertex tint instead.
    m.diffuseColor = new Color3(gain, gain, gain);
    m.detailMap.isEnabled = true;
    detail.coordinatesIndex = 1; // uv2: the 9.4 m / 9.6 m middle layer
    m.detailMap.texture = detail;
    m.detailMap.diffuseBlendLevel = 1.0;
    m.detailMap.bumpLevel = 0; // relief comes from the scanned normal map
    normal.coordinatesIndex = 3; // uv4: relief at 7.5 m / 6.3 m
    m.bumpTexture = normal;
    m.bumpTexture.level = 1.0;
    m.invertNormalMapY = true; // nor_gl is OpenGL handed (Y up)
    m.specularColor = new Color3(spec, spec * 0.97, spec * 0.93);
    m.specularPower = 64;
    m.ambientColor = Color3.Black();
    return m;
  };

  // wear maps are built first: their measured means feed the base tints
  const wearA = wearTexture(scene, "wearAsphalt", "asphalt");
  const wearD = wearTexture(scene, "wearDirt", "dirt");
  if (typeof window !== "undefined") {
    (window as any).HERO_ROAD = { wearAsphaltMean: wearA.mean, wearDirtMean: wearD.mean };
  }

  const asphaltMat = groundMat("roadAsphalt", aBase, aDetail, aNormal, GAIN_ASPHALT, 0.025);
  aRough.coordinatesIndex = 3;
  asphaltMat.specularTexture = aRough;

  const gravelMat = groundMat("roadGravel", dBase, dDetail, dNormal, GAIN_GRAVEL, 0.018);
  const dirtMat = groundMat("roadVerge", dBase, dDetail, dNormal, GAIN_DIRT, 0.012);

  // vertex tint = target albedo / what the scan already measures / the means of
  // the multiply overlays sitting on top of it
  const tintOf = (target: [number, number, number], base: [number, number, number], overlayMean: number): [number, number, number] => [
    target[0] / base[0] / overlayMean,
    target[1] / base[1] / overlayMean,
    target[2] / base[2] / overlayMean,
  ];
  const tintAsphalt = tintOf(ALBEDO_ASPHALT, BASE_ASPHALT, MACRO_MEAN_ASPHALT * wearA.mean);
  const tintGravel = tintOf(ALBEDO_GRAVEL, BASE_DIRT, MACRO_MEAN_DIRT * wearD.mean);
  const tintDirt = tintOf(ALBEDO_DIRT, BASE_DIRT, MACRO_MEAN_DIRT * wearD.mean);

  // Unlit multiply: diffuse black + emissive white means the shader's
  // clamp(diffuse*black + white) * texture passes the texture through exactly,
  // with no contribution from any light in the scene.
  const multiplyOverlay = (name: string, tex: Texture, uvIndex: number) => {
    tex.coordinatesIndex = uvIndex;
    const m = new StandardMaterial(name, scene);
    // The unlit path: emissive is added with no light of its own, and it has to
    // go in the emissive *slot* because Babylon only binds vEmissiveColor when
    // an emissive texture exists. diffuseColor black kills the lit term, so the
    // shader reduces to  clamp(0 + texture) * 1  - the texture, unlit.
    m.emissiveTexture = tex;
    m.emissiveColor = new Color3(1, 1, 1);
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.ambientColor = Color3.Black();
    // force the transparent pass without an alpha value: ALPHA_MULTIPLY only
    // reads the source colour, so alpha itself is never multiplied in
    m.needAlphaBlending = () => true;
    m.alphaMode = Constants.ALPHA_MULTIPLY; // dst *= src
    m.disableDepthWrite = true;
    return m;
  };

  const aMacroMat = multiplyOverlay("roadAsphaltMacro", aMacro, 2);
  const dMacroMat = multiplyOverlay("roadDirtMacro", dMacro, 2);
  const aWearMat = multiplyOverlay("roadAsphaltWear", wearA.texture, 0);
  const dWearMat = multiplyOverlay("roadDirtWear", wearD.texture, 0);

  // ------------------------------------------------------------------ ground
  /** Ragged sealed edge: the pavement wanders a few centimetres either way. */
  const asphaltGeom = (z: number): number[] => {
    const w = ASPHALT + edgeJitter(z);
    const cols: number[] = [];
    const N = 44; // ~18 cm across, fine enough to hold the crown and the wear
    for (let i = 0; i <= N; i++) cols.push(-w + 2 * w * (i / N));
    return cols;
  };

  const base = ribbon(scene, "roadAsphaltMesh", {
    zFrom: Z_FROM,
    zTo: Z_TO,
    dz: 2.0,
    xs: asphaltGeom,
    y: asphaltY,
    tiles: [T_BASE_A, T_MID_A, T_MACRO_A, T_NRM_A],
    material: asphaltMat,
    tint: tintAsphalt,
    shade: (x, z) => 0.95 + 0.1 * vnoise(x * 0.21, z * 0.16),
  });
  overlayMesh(scene, "roadAsphaltMacroMesh", asphaltGeom, asphaltY, 2.0, aMacroMat, { tile: T_MACRO_A, slot: 2 });
  overlayMesh(scene, "roadAsphaltWearMesh", asphaltGeom, asphaltY, 2.0, aWearMat, { width: ASPHALT * 2 });

  for (const s of [-1, 1] as const) {
    const tag = s < 0 ? "L" : "R";

    const gravelGeom = (z: number): number[] => {
      const e = edgeJitter(z);
      const a = ASPHALT + e - 0.18; // tucked 18 cm under the pavement lip
      const b = GRAVEL_OUT + 0.4 * e;
      const cols: number[] = [];
      for (let i = 0; i <= 5; i++) cols.push(s * (a + ((b - a) * i) / 5));
      return s < 0 ? cols.reverse() : cols;
    };
    const gravelY = (x: number, z: number) => shoulderY(z) - Math.max(0, Math.abs(x) - ASPHALT) * 0.014;
    const gravelWidth = GRAVEL_OUT - ASPHALT + 0.18;

    ribbon(scene, "roadGravelMesh" + tag, {
      zFrom: Z_FROM,
      zTo: Z_TO,
      dz: 2.5,
      xs: gravelGeom,
      y: gravelY,
      tiles: [2.6, 6.5, 14.0, 5.5], // same scans at larger tiles: the gravel reads coarser
      material: gravelMat,
      tint: tintGravel,
      shade: (x, z) => 0.96 + 0.09 * vnoise(x * 0.5, z * 0.45),
    });
    overlayMesh(scene, "roadGravelMacroMesh" + tag, gravelGeom, gravelY, 2.5, dMacroMat, { tile: 14.0, slot: 2 });
    overlayMesh(scene, "roadGravelWearMesh" + tag, gravelGeom, gravelY, 2.5, dWearMat, { width: gravelWidth });

    const vergeGeom = (z: number): number[] => {
      const inner = GRAVEL_OUT - 0.15;
      const cols: number[] = [];
      for (let i = 0; i <= 7; i++) {
        const t = Math.pow(i / 7, 1.75); // columns crowd toward the road
        cols.push(s * (inner + (VERGE_OUT - inner) * t));
      }
      return s < 0 ? cols.reverse() : cols;
    };
    const vergeY = (x: number, z: number) =>
      shoulderY(z) - 0.04 + 0.06 * (vnoise(x * 0.1, z * 0.065) - 0.5) + 0.014 * (vnoise(x * 0.65, z * 0.3) - 0.5);

    ribbon(scene, "roadVergeMesh" + tag, {
      zFrom: Z_FROM,
      zTo: Z_TO,
      dz: 4.0,
      xs: vergeGeom,
      y: vergeY,
      tiles: [T_BASE_D, T_MID_D, T_MACRO_D, T_NRM_D],
      material: dirtMat,
      tint: tintDirt,
      shade: (x, z) => 1.0 + 0.14 * vnoise(x * 0.13, z * 0.11) - 0.05 * vnoise(x * 0.9, z * 0.8),
    });
    overlayMesh(scene, "roadVergeMacroMesh" + tag, vergeGeom, vergeY, 4.0, dMacroMat, { tile: T_MACRO_D, slot: 2 });
    overlayMesh(scene, "roadVergeWearMesh" + tag, vergeGeom, vergeY, 4.0, dWearMat, { width: VERGE_OUT - GRAVEL_OUT + 0.15 });
  }

  // ------------------------------------------------------------------- paint
  const wear = paintWearTexture(scene);
  // The paint is lit by the same rig as the asphalt and multiplied by the same
  // exposure gain, so it reads as paint ON the road: a touch lighter and much
  // yellower than the asphalt, never a bright stripe that blooms.
  const yellow = paintMaterial(scene, "roadPaintYellow", wear, new Color3(1.1, 0.72, 0.26), GAIN_ASPHALT);
  const white = paintMaterial(scene, "roadPaintWhite", wear, new Color3(1.0, 0.92, 0.8), GAIN_ASPHALT);

  paintRibbon(scene, "roadCentreLine", -0.23, 0.23, 0, 1, 0, yellow);
  for (const s of [-1, 1] as const) {
    // the white edge line samples one stripe's u span, so it inherits the same
    // chips and dirt from the same upload
    paintRibbon(scene, "roadEdgeLine" + (s < 0 ? "L" : "R"), s * EDGE_LINE_X - 0.05, s * EDGE_LINE_X + 0.05, 0.087, 0.326, 0.5, white);
  }

  // ------------------------------------------------------- stones and scrub
  scatterStones(scene);
  scatterScrub(scene);

  base.freezeWorldMatrix();
}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

function hash2(i: number, j: number) {
  const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function vnoise(x: number, z: number) {
  const i = Math.floor(x);
  const j = Math.floor(z);
  const fx = x - i;
  const fz = z - j;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(i, j);
  const b = hash2(i + 1, j);
  const c = hash2(i, j + 1);
  const d = hash2(i + 1, j + 1);
  return (a * (1 - ux) + b * ux) * (1 - uz) + (c * (1 - ux) + d * ux) * uz;
}

/** The pavement's ragged sealed edge, +-6 cm, two frequencies of crumble. */
function edgeJitter(z: number) {
  return 0.05 * (vnoise(z * 0.31, 11.3) - 0.5) + 0.028 * (vnoise(z * 1.6, 3.1) - 0.5);
}

/** 2% crown plus repaving undulation, a few centimetres deep. */
function asphaltY(x: number, z: number) {
  const crown = 0.022 * (1 - Math.min(1, (x / ASPHALT) ** 2));
  return crown + 0.03 * (vnoise(x * 0.09, z * 0.07) - 0.5) + 0.012 * (vnoise(x * 0.5, z * 0.4) - 0.5);
}

function shoulderY(z: number) {
  return asphaltY(ASPHALT + edgeJitter(z), z) - 0.05;
}

/** Ground height, used to plant stones and scrub on the right surface. */
function groundAt(x: number, z: number) {
  const ax = Math.abs(x);
  const e = ASPHALT + edgeJitter(z);
  if (ax < e) return asphaltY(x, z);
  if (ax < GRAVEL_OUT) return shoulderY(z) - Math.max(0, ax - e) * 0.014;
  return shoulderY(z) - 0.04 + 0.06 * (vnoise(x * 0.1, z * 0.065) - 0.5) + 0.014 * (vnoise(x * 0.65, z * 0.3) - 0.5);
}

// ---------------------------------------------------------------------------
// Ribbons: UV repeat baked in, three UV sets, vertex shading, normals from geometry
// ---------------------------------------------------------------------------

interface GridSpec {
  zFrom: number;
  zTo: number;
  dz: number;
  xs: (z: number) => number[];
  y: (x: number, z: number) => number;
  lift?: number;
}

interface Grid {
  nRow: number;
  nCol: number;
  positions: Float32Array;
  uv: Float32Array;
  uv2: Float32Array;
  uv3: Float32Array;
  uv4: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

function gridOf(spec: GridSpec): Grid {
  const rows: number[] = [];
  for (let z = spec.zFrom; z <= spec.zTo + 1e-6; z += spec.dz) rows.push(z);
  const nRow = rows.length;
  const nCol = spec.xs(rows[0]).length;
  const positions = new Float32Array(nRow * nCol * 3);
  const uv = new Float32Array(nRow * nCol * 2);
  const uv2 = new Float32Array(nRow * nCol * 2);
  const uv3 = new Float32Array(nRow * nCol * 2);
  const uv4 = new Float32Array(nRow * nCol * 2);
  let v = 0;
  for (const z of rows) {
    const cols = spec.xs(z);
    for (let c = 0; c < nCol; c++) {
      const x = cols[c];
      positions[v * 3] = x;
      positions[v * 3 + 1] = spec.y(x, z) + (spec.lift ?? 0);
      positions[v * 3 + 2] = z;
      uv[v * 2] = x;
      uv[v * 2 + 1] = z;
      uv2[v * 2] = x;
      uv2[v * 2 + 1] = z;
      uv3[v * 2] = x;
      uv3[v * 2 + 1] = z;
      uv4[v * 2] = x;
      uv4[v * 2 + 1] = z;
      v++;
    }
  }
  const indices = new Uint32Array((nRow - 1) * (nCol - 1) * 6);
  let i = 0;
  for (let r = 0; r < nRow - 1; r++) {
    for (let c = 0; c < nCol - 1; c++) {
      const a = r * nCol + c;
      const b = (r + 1) * nCol + c;
      const cc = (r + 1) * nCol + c + 1;
      const d = r * nCol + c + 1;
      // CCW seen from above: Babylon's ComputeNormals uses (p1-p2)x(p3-p2), so
      // this order is what makes the face normal +Y.
      indices[i++] = a;
      indices[i++] = d;
      indices[i++] = cc;
      indices[i++] = a;
      indices[i++] = cc;
      indices[i++] = b;
    }
  }
  const normals = new Float32Array(nRow * nCol * 3);
  VertexData.ComputeNormals(positions, indices, normals);
  return { nRow, nCol, positions, uv, uv2, uv3, uv4, normals, indices };
}

interface RibbonSpec extends GridSpec {
  /** metres per tile: [base albedo, middle, macro, relief] */
  tiles: [number, number, number, number];
  material: Material;
  /** Per-channel albedo tint. Vertex colour, not diffuseColor: see the note in
   *  installRoad - diffuseColor multiplies the *clamped* light term, so chroma
   *  put there is crushed toward neutral on a bright surface. */
  tint?: [number, number, number];
  shade?: (x: number, z: number) => number;
}

function ribbon(scene: Scene, name: string, spec: RibbonSpec): Mesh {
  const g = gridOf(spec);
  // Bake the repeat: metres-per-tile is divided out here, so one texture object
  // serves surfaces of any physical size.
  const colors = new Float32Array(g.nRow * g.nCol * 4);
  let v = 0;
  for (let r = 0; r < g.nRow; r++) {
    for (let c = 0; c < g.nCol; c++) {
      const x = g.positions[v * 3];
      const z = g.positions[v * 3 + 2];
      // Each layer gets its own rotation and a small noise warp, so the three
      // grids never line up and the repeat stops announcing itself. Baked into
      // the UV stream, so it costs nothing at draw time.
      const warp = 0.11 * (vnoise(x * 0.06, z * 0.05) - 0.5);
      const names = [g.uv, g.uv2, g.uv3, g.uv4];
      const angles = [0, -0.19, 0.31, 0.07];
      for (let k = 0; k < 4; k++) {
        const t = spec.tiles[k];
        const arr = names[k];
        const ang = angles[k];
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        const ux = x / t + (k === 0 ? warp : 0) + k * 0.37;
        const uz = z / t + (k === 0 ? warp : 0) + k * 0.61;
        arr[v * 2] = ux * ca - uz * sa;
        arr[v * 2 + 1] = ux * sa + uz * ca;
      }
      // Two scales of vertex shading: a few metres of patchiness and a 60 m
      // drift. The long one is what stops the 40 m macro tile reading as a
      // repeat down a 500 m road.
      const drift = 0.86 + 0.28 * vnoise(x * 0.011, z * 0.017);
      const s = (spec.shade ? Math.max(0.45, Math.min(1.1, spec.shade(x, z))) : 1) * drift;
      const t = spec.tint ?? [1, 1, 1];
      colors[v * 4] = s * t[0];
      colors[v * 4 + 1] = s * t[1];
      colors[v * 4 + 2] = s * t[2];
      colors[v * 4 + 3] = 1;
      v++;
    }
  }
  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = g.positions;
  vd.indices = g.indices;
  vd.normals = g.normals;
  vd.uvs = g.uv;
  vd.uvs2 = g.uv2;
  vd.uvs3 = g.uv3;
  vd.uvs4 = g.uv4;
  vd.colors = colors;
  vd.applyToMesh(mesh, false);
  mesh.material = spec.material;
  mesh.receiveShadows = true;
  mesh.isPickable = false;
  return mesh;
}

/**
 * A multiply overlay riding on the same surface: identical vertices, lifted
 * 1.5 mm, so the depth test passes everywhere and nothing fights.
 */
function overlayMesh(
  scene: Scene,
  name: string,
  xs: (z: number) => number[],
  y: (x: number, z: number) => number,
  dz: number,
  material: Material,
  uvMode: { tile: number; slot: number } | { width: number }
) {
  const g = gridOf({ zFrom: Z_FROM, zTo: Z_TO, dz, xs, y, lift: 0.0015 });
  const width = "width" in uvMode ? uvMode.width : 1;
  const centre = (xs(0)[0] + xs(0)[g.nCol - 1]) / 2;
  const slots = [g.uv, g.uv2, g.uv3, g.uv4];
  let v = 0;
  for (let r = 0; r < g.nRow; r++) {
    for (let c = 0; c < g.nCol; c++) {
      const x = g.positions[v * 3];
      const z = g.positions[v * 3 + 2];
      if ("width" in uvMode) {
        // wear layers are authored across the surface's own width (u) and along
        // the road in 64 m stretches (v)
        g.uv[v * 2] = (x - centre) / width + 0.5;
        g.uv[v * 2 + 1] = z / 64 + (vnoise(x * 0.03, z * 0.03) - 0.5) * 0.05;
      } else {
        const arr = slots[uvMode.slot];
        arr[v * 2] = x / uvMode.tile + 0.13 * (vnoise(x * 0.04, z * 0.04) - 0.5);
        arr[v * 2 + 1] = z / uvMode.tile + 0.13 * (vnoise(x * 0.04, z * 0.04) - 0.5);
      }
      v++;
    }
  }
  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = g.positions;
  vd.indices = g.indices;
  vd.normals = g.normals;
  vd.uvs = g.uv;
  vd.uvs2 = g.uv2;
  vd.uvs3 = g.uv3;
  vd.uvs4 = g.uv4;
  vd.applyToMesh(mesh, false);
  mesh.material = material;
  mesh.isPickable = false;
  mesh.receiveShadows = false;
  mesh.alphaIndex = 1; // drawn before the paint
  return mesh;
}

// ---------------------------------------------------------------------------
// Wear: a canvas multiplier with soft ramps, never a hard edge, never bright
// ---------------------------------------------------------------------------

function wearTexture(scene: Scene, name: string, kind: "asphalt" | "dirt") {
  // returns the canvas texture plus the mean of the multiplier it stores
  const W = 512;
  const H = 1024;
  const dt = new DynamicTexture(name, { width: W, height: H }, scene, true);
  const g = dt.getContext() as unknown as CanvasRenderingContext2D;
  let seed = kind === "asphalt" ? 7717 : 4231;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const img = g.createImageData(W, H);
  const d = img.data;

  const nLen = Math.floor(H / 8) + 2;
  const lenNoise = new Float32Array(nLen);
  for (let i = 0; i < nLen; i++) lenNoise[i] = rnd();
  const len = (t: number) => {
    const p = t * (nLen - 1);
    const i0 = Math.min(nLen - 2, Math.floor(p));
    const f0 = p - i0;
    const f = f0 * f0 * (3 - 2 * f0);
    return lenNoise[i0] * (1 - f) + lenNoise[i0 + 1] * f;
  };

  let sum = 0;
  for (let y = 0; y < H; y++) {
    const t = y / H;
    const drift = 0.1 * (len(t) - 0.5) * 2; // polish runs along the road
    for (let x = 0; x < W; x++) {
      const u = x / W; // 0..1 across the surface's own width
      let m = 1.0;
      if (kind === "asphalt") {
        // dust and grit banked against both edges: no darkening there at all
        const dusty = Math.max(0, 1 - Math.min(u, 1 - u) / 0.2);
        // polished wheel paths: lanes at +-1.8 m, so tracks at +-1.05 and +-2.55
        let polish = 0;
        for (const c of [0.185, 0.37, 0.63, 0.815]) polish += Math.exp(-(((u - c) / 0.04) ** 2));
        polish = Math.min(1, polish);
        // tar seam wandering down the lane joint, soft
        const seam = Math.exp(-(((u - 0.5 - 0.05 * Math.sin(t * 37)) / 0.013) ** 2));
        m = 1 - 0.11 * polish * (1 - 0.7 * dusty) + 0.6 * drift * (1 - dusty);
        m -= 0.09 * seam * (0.35 + 0.65 * len(t + 0.37));
        m -= 0.03 * (1 - dusty) * len(t * 3.1 + 0.2);
      } else {
        m = 0.95 + 0.11 * (len(t * 2.3) - 0.5) - 0.07 * len(t + 0.5);
        m -= 0.09 * Math.max(0, 1 - Math.min(u, 1 - u) / 0.08); // grime at the gravel seam
        m += 0.045 * Math.max(0, 1 - Math.abs(u - 0.4) / 0.18); // wind-blown sand
      }
      m += (rnd() - 0.5) * 0.04; // fine grain, so the wash is never flat
      const q = Math.max(0.5, Math.min(1, m));
      sum += q;
      const b = Math.round(q * 255);
      const o = (y * W + x) * 4;
      d[o] = b;
      d[o + 1] = b;
      d[o + 2] = b;
      d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  dt.update(false);
  dt.wrapU = Texture.WRAP_ADDRESSMODE;
  dt.wrapV = Texture.WRAP_ADDRESSMODE;
  dt.anisotropicFilteringLevel = 16;
  // the mean is measured, not guessed: the base tint divides by it
  return { texture: dt, mean: sum / (W * H) };
}

// ---------------------------------------------------------------------------
// Paint
// ---------------------------------------------------------------------------

function paintMaterial(scene: Scene, name: string, tex: Texture, colour: Color3, gain: number) {
  const m = new StandardMaterial(name, scene);
  m.diffuseTexture = tex;
  m.diffuseTexture.hasAlpha = true;
  m.useAlphaFromDiffuseTexture = true;
  m.transparencyMode = Material.MATERIAL_ALPHABLEND;
  m.diffuseColor = new Color3(colour.r * gain, colour.g * gain, colour.b * gain);
  m.specularColor = Color3.Black();
  m.ambientColor = Color3.Black();
  m.zOffset = -2;
  m.zOffsetUnits = -4;
  m.disableDepthWrite = true;
  return m;
}

function paintRibbon(scene: Scene, name: string, x0: number, x1: number, u0: number, u1: number, vOffset: number, mat: StandardMaterial) {
  const cols = 3;
  const g = gridOf({ zFrom: Z_FROM, zTo: Z_TO, dz: 2, xs: () => [x0, (x0 + x1) / 2, x1], y: asphaltY, lift: 0.006 });
  let v = 0;
  for (let r = 0; r < g.nRow; r++) {
    for (let c = 0; c < cols; c++) {
      const tt = c / (cols - 1);
      g.uv[v * 2] = u0 + (u1 - u0) * tt;
      g.uv[v * 2 + 1] = g.positions[v * 3 + 2] / 4.0 + vOffset;
      v++;
    }
  }
  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = g.positions;
  vd.indices = g.indices;
  vd.normals = g.normals;
  vd.uvs = g.uv;
  vd.uvs2 = g.uv2;
  vd.uvs3 = g.uv3;
  vd.uvs4 = g.uv4;
  vd.applyToMesh(mesh, false);
  mesh.material = mat;
  mesh.isPickable = false;
  mesh.alphaIndex = 10; // after the multiply overlays
}

/**
 * Paint wear: RGB is a luminance map (so one texture tints both the yellow and
 * the white), alpha is coverage. Both stripes live in one 0.46 m wide tile, so
 * the gap between them is arithmetic and the white edge line can sample a
 * single stripe's u span.
 */
function paintWearTexture(scene: Scene) {
  const W = 512;
  const H = 1024;
  const dt = new DynamicTexture("roadPaintWear", { width: W, height: H }, scene, true);
  const g = dt.getContext() as unknown as CanvasRenderingContext2D;
  g.clearRect(0, 0, W, H);
  let seed = 20261115;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  const stripes: Array<[number, number]> = [
    [0.087, 0.326],
    [0.674, 0.913],
  ];

  // ragged, worn edges rather than a ruler line
  for (const [s0, s1] of stripes) {
    for (let row = 0; row < H; row++) {
      const wob = 2.5 * Math.sin(row * 0.11) + 5 * (hash2(row * 0.7, 5.5) - 0.5);
      g.fillStyle = "rgba(196,196,196,1)";
      g.fillRect(s0 * W + wob, row, (s1 - s0) * W, 1);
    }
  }
  // longitudinal grime and tyre polish
  for (let i = 0; i < 90; i++) {
    const x = rnd() * W;
    const w = 1 + rnd() * 5;
    const dark = 60 + rnd() * 90;
    g.fillStyle = `rgba(${dark},${dark * 0.92},${dark * 0.82},${0.06 + rnd() * 0.24})`;
    g.fillRect(x, 0, w, H);
  }
  // blown sand sitting on the paint
  for (let i = 0; i < 44; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const r = 6 + rnd() * 34;
    g.fillStyle = `rgba(120,102,80,${0.05 + rnd() * 0.18})`;
    g.beginPath();
    g.ellipse(x, y, r, r * (0.4 + rnd()), rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
  // chipped paint: punch holes, biased to the stripe edges, plus cracks
  g.globalCompositeOperation = "destination-out";
  for (const [s0, s1] of stripes) {
    const x0 = s0 * W;
    const x1 = s1 * W;
    for (let i = 0; i < 1100; i++) {
      const edgeBias = rnd() < 0.55;
      const tt = edgeBias ? (rnd() < 0.5 ? rnd() ** 2 * 0.35 : 1 - rnd() ** 2 * 0.35) : rnd();
      const x = x0 + tt * (x1 - x0);
      const y = rnd() * H;
      const r = 0.8 + rnd() ** 3 * 5;
      g.beginPath();
      g.ellipse(x, y, r, r * (0.5 + rnd()), rnd() * 3, 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < 30; i++) {
      const y = rnd() * H;
      g.lineWidth = 1 + rnd() * 2.2;
      g.beginPath();
      g.moveTo(x0 - 4, y);
      g.lineTo(x1 + 4, y + (rnd() - 0.5) * 14);
      g.stroke();
    }
  }
  g.globalCompositeOperation = "source-over";
  // per-pixel grit: no area of this paint is clean
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const n = rnd();
    d[i] *= 0.86 + n * 0.26;
    d[i + 1] *= 0.86 + n * 0.26;
    d[i + 2] *= 0.86 + n * 0.26;
    d[i + 3] *= 0.55 + rnd() * 0.42;
  }
  g.putImageData(img, 0, 0);
  dt.update(false);
  dt.wrapU = Texture.WRAP_ADDRESSMODE;
  dt.wrapV = Texture.WRAP_ADDRESSMODE;
  dt.anisotropicFilteringLevel = 8;
  return dt;
}

// ---------------------------------------------------------------------------
// Loose stones: clustered, small, dark, their own matte material
// ---------------------------------------------------------------------------

function scatterStones(scene: Scene) {
  let seed = 1337;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  const rock = MeshBuilder.CreateIcoSphere("pebble", { radius: 0.5, subdivisions: 1 }, scene);
  const pos = rock.getVerticesData("position");
  if (pos) {
    for (let i = 0; i < pos.length; i += 3) {
      pos[i] *= 0.7 + rnd() * 0.5;
      pos[i + 1] *= 0.42 + rnd() * 0.2;
      pos[i + 2] *= 0.7 + rnd() * 0.5;
    }
    rock.setVerticesData("position", pos, false);
    const nr = new Float32Array(pos.length);
    VertexData.ComputeNormals(pos, rock.getIndices(), nr);
    rock.setVerticesData("normal", nr, false);
  }
  rock.refreshBoundingInfo();

  // a speck of grit, never a bright chip: untextured, dark, high roughness
  const mat = new StandardMaterial("roadPebbleMat", scene);
  mat.diffuseColor = new Color3(0.17, 0.15, 0.13);
  mat.specularColor = new Color3(0.02, 0.02, 0.02);
  mat.specularPower = 8;

  const m: number[] = [];
  const c: number[] = [];
  const push = (x: number, z: number, size: number) => {
    const y = groundAt(x, z) + size * 0.18;
    const q = Quaternion.RotationAxis(Vector3.Up(), rnd() * Math.PI * 2);
    const scl = new Vector3(size, size * (0.45 + rnd() * 0.4), size * (0.75 + rnd() * 0.5));
    Matrix.Compose(scl, q, new Vector3(x, y, z)).copyToArray(m, m.length);
    const tone = 0.8 + rnd() * 0.45;
    c.push(tone, tone * 0.93, tone * 0.85, 1);
  };

  // clustered: a centre gets one to three stones and some centres stay empty,
  // because even coverage reads as a minefield
  for (let i = 0; i < 700; i++) {
    const side = rnd() < 0.5 ? -1 : 1;
    const off = ASPHALT + 0.02 + Math.pow(rnd(), 1.5) * (GRAVEL_OUT - ASPHALT + 5);
    const cx = side * off;
    const cz = -7 + Math.pow(rnd(), 1.25) * 34; // dense where the lens is looking
    if (rnd() < 0.25) continue;
    const n = 1 + Math.floor(rnd() * 3);
    const size = 0.03 + Math.pow(rnd(), 1.8) * 0.10;
    for (let k = 0; k < n; k++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.pow(rnd(), 1.5) * 0.4;
      push(cx + Math.cos(a) * r, cz + Math.sin(a) * r, size * (0.6 + rnd() * 0.8));
    }
  }
  // spill over the pavement lip, where tyres flick it
  for (let i = 0; i < 260; i++) {
    const side = rnd() < 0.5 ? -1 : 1;
    const x = side * (ASPHALT - rnd() * 0.7);
    const z = -6 + Math.pow(rnd(), 1.2) * 26;
    push(x, z, 0.018 + Math.pow(rnd(), 2.0) * 0.04);
  }

  rock.thinInstanceSetBuffer("matrix", new Float32Array(m), 16, false);
  rock.thinInstanceSetBuffer("color", new Float32Array(c), 4, false);
  rock.thinInstanceRefreshBoundingInfo(false);
  rock.material = mat;
  rock.receiveShadows = true;
  rock.isPickable = false;
}

// ---------------------------------------------------------------------------
// Dry scrub: grey-brown straw, clustered, alpha tested
// ---------------------------------------------------------------------------

function scatterScrub(scene: Scene) {
  let seed = 90210;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  const dt = new DynamicTexture("scrubTuft", { width: 256, height: 256 }, scene, true);
  const g = dt.getContext() as unknown as CanvasRenderingContext2D;
  g.clearRect(0, 0, 256, 256);
  g.lineCap = "round";
  for (let i = 0; i < 42; i++) {
    const bx = 128 + (rnd() - 0.5) * 78;
    const dir = rnd() < 0.5 ? -1 : 1;
    const len = 80 + rnd() * 160;
    const bend = dir * (25 + rnd() * 70);
    const shade = 118 + rnd() * 78;
    // dry straw, grey-brown: no green anywhere in this tuft
    g.strokeStyle = `rgba(${shade},${shade * 0.9},${shade * 0.68},${0.75 + rnd() * 0.25})`;
    g.lineWidth = 1.1 + rnd() * 2.1;
    g.beginPath();
    g.moveTo(bx, 256);
    g.quadraticCurveTo(bx + bend * 0.35, 256 - len * 0.62, bx + bend, 256 - len);
    g.stroke();
  }
  dt.update(false);
  dt.hasAlpha = true;

  const mat = new StandardMaterial("roadScrubMat", scene);
  mat.diffuseTexture = dt;
  mat.useAlphaFromDiffuseTexture = true;
  mat.transparencyMode = Material.MATERIAL_ALPHATEST;
  mat.alphaCutOff = 0.42;
  mat.diffuseColor = new Color3(0.42, 0.37, 0.29);
  mat.specularColor = Color3.Black();
  mat.backFaceCulling = false;
  mat.twoSidedLighting = true;

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let k = 0; k < 2; k++) {
    const a = (k * Math.PI) / 2;
    const cx = Math.cos(a) * 0.5;
    const cz = Math.sin(a) * 0.5;
    const b = k * 4;
    positions.push(-cx, 0, -cz, cx, 0, cz, cx, 1, cz, -cx, 1, -cz);
    uvs.push(0, 1, 1, 1, 1, 0, 0, 0);
    indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const idx = new Uint32Array(indices);
  const normals = new Float32Array(12);
  VertexData.ComputeNormals(new Float32Array(positions), idx, normals);

  const tuft = new Mesh("scrubTuft", scene);
  const vd = new VertexData();
  vd.positions = new Float32Array(positions);
  vd.indices = idx;
  vd.normals = normals;
  vd.uvs = new Float32Array(uvs);
  vd.applyToMesh(tuft, false);
  tuft.material = mat;
  tuft.isPickable = false;

  const m: number[] = [];
  for (let i = 0; i < 420; i++) {
    const side = rnd() < 0.5 ? -1 : 1;
    const off = GRAVEL_OUT - 0.4 + Math.pow(rnd(), 1.3) * 14;
    const cx = side * off;
    const cz = -7 + Math.pow(rnd(), 1.2) * 30;
    if (rnd() < 0.35) continue;
    const n = 1 + Math.floor(rnd() * 2);
    for (let k = 0; k < n; k++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.pow(rnd(), 1.6) * 0.55;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      const h = 0.22 + Math.pow(rnd(), 1.5) * 0.45;
      const q = Quaternion.RotationAxis(Vector3.Up(), rnd() * Math.PI * 2);
      const scl = new Vector3(h * (0.7 + rnd() * 0.6), h, h * (0.7 + rnd() * 0.6));
      Matrix.Compose(scl, q, new Vector3(x, groundAt(x, z) - 0.02, z)).copyToArray(m, m.length);
    }
  }
  tuft.thinInstanceSetBuffer("matrix", new Float32Array(m), 16, false);
  tuft.thinInstanceRefreshBoundingInfo(false);
}
