import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
// side-effect import: without it Mesh.prototype.thinInstanceSetBuffer is a no-op stub
import "@babylonjs/core/Meshes/thinInstanceMesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
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
 * and edge lines, the loose-gravel shoulder, the dirt verge, the crack and tar
 * network in the pavement, and everything standing on them (loose stones, dry
 * scrub).
 *
 * ---------------------------------------------------------------------------
 * WHAT THE SECOND PASS CHANGED, AND THE MEASUREMENT BEHIND EACH CHANGE
 * ---------------------------------------------------------------------------
 * Evidence: 1920x1080 capture vs reference/target.png, bottom 26% of frame,
 * x 0.18-0.85 (scripts/floor.py), which prints mean, 2 px gaussian high-pass
 * detail, std, p1 and p99 for both images in one table.
 *
 *   before  mean 102.6  detail 14.70  std 42.1  p1 18.9  p99 181.7  warm 48.3  sat 43.3
 *   after   mean 118.4  detail 10.52  std 34.8  p1 17.1  p99 186.4  warm 56.6  sat 39.2
 *   photo   mean 118.3  detail  8.33  std 35.0  p1  9.2  p99 181.1  warm 55.0  sat 38.3
 *
 * Two of those deltas need reading before they need fixing:
 *  - detail: with the crack meshes hidden the PAVEMENT alone measures 8.50
 *    against the photo's 8.33, so the surface texture is on target and the
 *    remaining 2.0 is crack edges. (Separately: the photo's darks are unlit -
 *    mean RGB 15,17,17 - and sit at the far edge of the band, i.e. the car's
 *    shadow. Ours are lit tar beads at 20,19,18, and no material change can
 *    turn a lit bead into a shadow.)
 *
 * Three separate faults, three separate fixes:
 *
 * 1. TOO MUCH PIXEL-LEVEL DETAIL (14.7 vs 8.3). The near albedo was 1024 px
 *    over a 3.75 m tile, i.e. the scan's native 273 px/m, which maps about 1:1
 *    to screen pixels at 4 m: every aggregate grain landed as one sparkly
 *    pixel, and the build sharpened it another 18%. The near tile is now 4096
 *    px over 15.0 m - still native 273 px/m, but the 3.75 m repeat is gone -
 *    the asset build is denoised at 6.6 mm and NOT sharpened, the engine's
 *    DetailMap multiplier (a 9.4 m layer at +-13%) is deleted because it was
 *    pure fine-band contrast, and the wear canvas's per-pixel grain is cut to
 *    a third. Contrast that used to live at 1 px now lives in the 20 cm-3 m
 *    band, where the reference puts it.
 *
 * 2. NO DARKS (p1 18.9 vs 9.2). A real highway has structure darker than its
 *    own mid-tone: cracks, tar-filled cracks, repair patches, and the seal
 *    pooling in the low spots of the crown. None of that was in the model, so
 *    the surface was one uniform mid-grey. It is now four layers:
 *      - a world-space crack network (geometry, no tiling) with authored
 *        normals that tilt the two groove walls in opposite directions, so the
 *        9 degree sun lights one wall and shadows the other. That is the depth
 *        cue; a crack painted as a flat dark line has none.
 *      - tar-sealed cracks, slightly proud and glossy (roughness 0.50 against
 *        the pavement's 0.88), which is what a tar bead actually is.
 *      - alligator-cracking clusters: block failure joined as a branching tree,
 *        because a lone crack reads as a stripe and a stripe reads as a decal.
 *      - repair patches with tar outlines, drawn into the wear canvas.
 *      - pooled darkening in the geometric lows of the pavement, computed from
 *        the SAME noise function that displaces the mesh, so a dark pool sits
 *        where the surface actually dips.
 *
 * 3. THE WRONG MATERIAL MODEL. Every ground surface was a StandardMaterial,
 *    which has no roughness slot: its roughness map drove a Blinn-Phong
 *    specular exponent, and a dry road under a 9 degree sun has a broad,
 *    low sheen, not a specular lobe. All three ground surfaces are PBRMaterial
 *    now - albedo + normal + roughness, metallic 0 - at one material model for
 *    the whole floor, which is what lets the sheen and the shading read as a
 *    photograph of a surface rather than a lit card.
 *
 * ---------------------------------------------------------------------------
 * THE SURFACES ARE PHOTOGRAPHS AT THREE SCALES (Poly Haven, CC0)
 * ---------------------------------------------------------------------------
 *   layer    asphalt                         dirt / shoulder                UV
 *   near     asphalt_albedo, 15.0 m tile     dirt_albedo, 12.65 m           uv
 *   relief   asphalt_normal, 15.0 m          dirt_normal, 12.65 m           uv
 *   sheen    asphalt_rough,  15.0 m          dirt_rough,  12.65 m           uv
 *   mid      asphalt_patch,  12.0 m          dirt_patch,  12.6 m            uv3
 *   macro    asphalt_macro,  40.4 m          dirt_macro,  20.0 m            uv2
 *
 * Tile sizes are measurements from each scan's published `dimensions` field
 * (Poly Haven publishes it in centimetres), not taste. albedo, normal and
 * roughness are cut from the SAME window of the same scan at ratios that land
 * on the same metres of ground, so relief sits under the colour that produced
 * it - the previous pass had a 7.5 m normal over a 3.75 m albedo, and relief
 * and colour disagreed about scale everywhere.
 *
 * mid and macro are unlit MULTIPLY overlays (dst *= src): the value stored in
 * the texture IS the multiplier, clamped into [lo, 1.0] when it is generated,
 * so an overlay can only darken. Each overlay's measured mean is divided into
 * the base tint, so switching a layer on shifts nothing.
 *
 * COLOUR. Only the near layer carries hue - the overlays are achromatic
 * multipliers - so desaturating the scan at 55% in the build is the same
 * operation as desaturating the finished albedo. The scans are photographs of
 * already-lit, already-warm sand, and a warm sun over warm sand doubles the
 * warmth.
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

// --- tiles, straight from the scans' published dimensions -------------------
const T_NEAR_A = 15.0; // 4096 px of the 8k master at its native 273 px/m
const T_NEAR_D = 12.65; // 2048 px of the 8k master at its native 324 px/m, halved
const T_MACRO_A = 40.4;
const T_MACRO_D = 20.0;
const T_PATCH_A = 12.0;
const T_PATCH_D = 12.6;

/**
 * Albedo the pavement is aiming at, and what the scan already measures. The
 * vertex tint is the ratio of the two, divided by the means of the multiply
 * overlays - so every number in the pipeline is a measurement, and the tint is
 * a correction rather than a taste call.
 *
 * THE HUE IS WARM ON PURPOSE, and the ratio is the point. Measured off the
 * capture: under this rig's light mix the pavement renders at G/R 0.92 and
 * B/R 0.78, while the reference photograph sits at 0.80 and 0.61. The cause is
 * not the albedo - a scan of asphalt is near neutral - it is the light. The
 * reference was shot under a warm 3000-4000 K sun with a small share of sky; in
 * this rig the cool hemispheric fill and the blue-grey IBL are a much larger
 * share of a horizontal surface's irradiance at a 9 degree sun (measured: the
 * effective light on the floor is R 1.0, G 1.02, B 1.11 - i.e. blue-dominant).
 * With a neutral albedo that lands the floor at R-B 21 against the reference's
 * 55. The tint therefore carries the difference: it is the correction that
 * makes a blue-lit surface photograph as the warm one on the wall. If the sun
 * part ever raises the sun-to-sky ratio, this ratio comes back down.
 *
 * Warmth lives in the vertex tint rather than albedoColor because a per-vertex
 * tint is per-surface and does not touch the specular term, which is where the
 * sheen lives.
 */
const ALBEDO_ASPHALT: [number, number, number] = [0.360, 0.175, 0.070];
const ALBEDO_GRAVEL: [number, number, number] = [0.0700, 0.0520, 0.0290];
const ALBEDO_DIRT: [number, number, number] = [0.0655, 0.0492, 0.0255];

/** Measured by assets/road/build_assets.py, which prints them. */
const BASE_ASPHALT: [number, number, number] = [0.3592, 0.3559, 0.3438];
const BASE_DIRT: [number, number, number] = [0.5092, 0.4350, 0.3836];
const MACRO_MEAN_ASPHALT = 0.962;
const MACRO_MEAN_DIRT = 0.951;
const PATCH_MEAN_ASPHALT = 0.945;
const PATCH_MEAN_DIRT = 0.94;

/**
 * Exposure dial on the whole floor, in one number: albedoColor, applied after
 * every measured ratio, so it moves brightness without touching hue.
 *
 * It is large because the rig is: this material's diffuse carries PBR's 1/PI
 * normalisation and the floor is then lit mostly by a blue-grey sky at a 9
 * degree sun. 4.6 lands the floor's measured RGB on the reference's
 * (143, 114, 88) with the tint above carrying the hue. Move this and the
 * floor's brightness moves; move a tint and its colour moves; nothing else
 * touches either.
 */
const GROUND_GAIN = 6.7;
/** IBL share for the ground. The sky is the fill, but a horizontal surface
 *  takes less of it than a sphere does, and the shadowed parts of the road
 *  must not glow. */
const GROUND_ENV = 0.10;
/**
 * Direct-light level. Babylon's PBR diffuse is radiance-normalised - it divides
 * the punctual term by PI - while the rest of this rig (StandardMaterial, which
 * every other part still uses) does not. Leaving it at 1.0 cost a factor of
 * 3.14 of sun against the sky, and the road measured 41 where it should have
 * been 100: dark AND colourless, because a surface lit 3x more by a cool sky
 * than by a warm sun loses its warmth. PI puts PBR on the same scale as the
 * light rig, which is where a material-model swap belongs; the albedo then
 * stays a physically honest 0.30 and the sun keeps its colour.
 */
const GROUND_DIRECT = Math.PI;
/** Relief strength. Measured at 1.0 the scanned normal added about 2.4 of
 *  high-frequency detail on its own (it is a 7 mm/texel scan), which is exactly
 *  the sparkle this pass exists to remove. */
const BUMP_LEVEL = 0.28;
/**
 * Dielectric specular share. Dry, dust-covered aggregate is a diffuse
 * reflector: the dust film scatters before light reaches the binder, so the
 * Fresnel sheen a clean dielectric would show at a grazing angle is largely
 * gone. Measured with this at 1.0 the gravel shoulder came back at luma 131
 * against the reference's 109, and the whole of the difference was specular -
 * at 0.18 it lands at 87 against the road's 99, which is the reference's own
 * relationship (shoulder 109, road 116). The sheen that is left is the wide,
 * low one a rough surface should have; it is not a mirror.
 *
 * NOTE for the sun part: 1.0 is correct for clean material. If the key stops
 * being a 9-degree raking sun this wants to come back up.
 */
const GROUND_F0 = 0.18;

export function installRoad(ctx: LabCtx) {
  const { scene } = ctx;
  // the distance falloff below is measured from the lens; main.ts owns the
  // camera and the camera part may move it, so read it here rather than bake a
  // number that a later part can invalidate
  LENS.x = ctx.camera.position.x;
  LENS.z = ctx.camera.position.z;

  // ---------------------------------------------------------------- textures
  const tex = (file: string, uvIndex: number) => {
    const t = new Texture(A + file, scene, false, false, Texture.TRILINEAR_SAMPLINGMODE);
    t.anisotropicFilteringLevel = 16; // grazing angles: without this a road smears to a band
    t.wrapU = Texture.MIRROR_ADDRESSMODE;
    t.wrapV = Texture.MIRROR_ADDRESSMODE;
    t.coordinatesIndex = uvIndex;
    return t;
  };

  const aAlbedo = tex("asphalt_albedo.jpg", 0);
  const aNormal = tex("asphalt_normal.jpg", 0); // same tile as the albedo: relief agrees with colour
  const aRough = tex("asphalt_rough.jpg", 0);
  const aMacro = tex("asphalt_macro.jpg", 2);
  const aPatch = tex("asphalt_patch.jpg", 3);

  const dAlbedo = tex("dirt_albedo.jpg", 0);
  const dNormal = tex("dirt_normal.jpg", 0);
  const dRough = tex("dirt_rough.jpg", 0);
  const dMacro = tex("dirt_macro.jpg", 2);
  const dPatch = tex("dirt_patch.jpg", 3);

  // --------------------------------------------------------------- materials
  /**
   * One material model for the whole floor. albedo + normal + roughness, no
   * metal. roughness is the map times the scalar, so the scalar stays at 1 and
   * the scanned sheen passes through unchanged (mean 0.88 asphalt, 0.92 dirt).
   *
   * The specular response this buys at the camera's grazing angle is the whole
   * point: a sunlit dry road seen at 5-10 degrees has a broad, low, slightly
   * warm sheen. StandardMaterial could only offer a Blinn-Phong lobe, which is
   * why the previous pass either looked matte or looked wet.
   */
  const groundMat = (name: string, albedo: Texture, normal: Texture, rough: Texture) => {
    const m = new PBRMaterial(name, scene);
    m.albedoTexture = albedo;
    m.albedoColor = new Color3(GROUND_GAIN, GROUND_GAIN, GROUND_GAIN);
    m.metallic = 0;
    m.roughness = 1.0; // the map carries the value; this multiplies it
    m.metallicTexture = rough;
    m.useRoughnessFromMetallicTextureGreen = true;
    m.useMetallnessFromMetallicTextureBlue = false;
    m.useAmbientOcclusionFromMetallicTextureRed = false;
    m.bumpTexture = normal;
    m.bumpTexture.level = BUMP_LEVEL;
    m.invertNormalMapY = true; // nor_gl is OpenGL handed (Y up)
    m.environmentIntensity = GROUND_ENV;
    m.directIntensity = GROUND_DIRECT;
    m.metallicF0Factor = GROUND_F0;
    m.ambientColor = Color3.Black();
    // dry ground has no clear coat and no anisotropy: leave both off so the
    // shader stays on the cheap, correct branch
    m.clearCoat.isEnabled = false;
    m.anisotropy.isEnabled = false;
    return m;
  };

  const asphaltMat = groundMat("roadAsphalt", aAlbedo, aNormal, aRough);
  const gravelMat = groundMat("roadGravel", dAlbedo, dNormal, dRough);
  const dirtMat = groundMat("roadVerge", dAlbedo, dNormal, dRough);

  // wear maps are built first: their measured means feed the base tints
  const wearA = wearTexture(scene, "wearAsphalt", "asphalt");
  const wearD = wearTexture(scene, "wearDirt", "dirt");

  // vertex tint = target albedo / what the scan already measures / the means of
  // the multiply overlays sitting on top of it
  const tintOf = (target: [number, number, number], base: [number, number, number], overlayMean: number): [number, number, number] => [
    target[0] / base[0] / overlayMean,
    target[1] / base[1] / overlayMean,
    target[2] / base[2] / overlayMean,
  ];
  const overlayMeanA = MACRO_MEAN_ASPHALT * PATCH_MEAN_ASPHALT * wearA.mean;
  const overlayMeanD = MACRO_MEAN_DIRT * PATCH_MEAN_DIRT * wearD.mean;
  const tintAsphalt = tintOf(ALBEDO_ASPHALT, BASE_ASPHALT, overlayMeanA);
  const tintGravel = tintOf(ALBEDO_GRAVEL, BASE_DIRT, overlayMeanD);
  const tintDirt = tintOf(ALBEDO_DIRT, BASE_DIRT, overlayMeanD);

  // Unlit multiply: diffuse black + emissive white means the shader's
  // clamp(diffuse*black + white) * texture passes the texture through exactly,
  // with no contribution from any light in the scene.
  const multiplyOverlay = (name: string, t: Texture, uvIndex: number) => {
    t.coordinatesIndex = uvIndex;
    const m = new StandardMaterial(name, scene);
    // The unlit path: emissive is added with no light of its own, and it has to
    // go in the emissive *slot* because Babylon only binds vEmissiveColor when
    // an emissive texture exists. diffuseColor black kills the lit term, so the
    // shader reduces to  clamp(0 + texture) * 1  - the texture, unlit.
    m.emissiveTexture = t;
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
  const aPatchMat = multiplyOverlay("roadAsphaltPatch", aPatch, 3);
  const dMacroMat = multiplyOverlay("roadDirtMacro", dMacro, 2);
  const dPatchMat = multiplyOverlay("roadDirtPatch", dPatch, 3);
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
    tiles: [T_NEAR_A, T_MACRO_A, T_PATCH_A, T_NEAR_A],
    material: asphaltMat,
    tint: tintAsphalt,
    shade: (x, z) => 0.94 + 0.12 * vnoise(x * 0.21, z * 0.16),
  });
  overlayMesh(scene, "roadAsphaltMacroMesh", asphaltGeom, asphaltY, 2.0, aMacroMat, { tile: T_MACRO_A, slot: 1 });
  overlayMesh(scene, "roadAsphaltPatchMesh", asphaltGeom, asphaltY, 2.0, aPatchMat, { tile: T_PATCH_A, slot: 2 });
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
      tiles: [T_NEAR_D, T_MACRO_D, T_PATCH_D, T_NEAR_D], // same scans at larger tiles: the gravel reads coarser
      material: gravelMat,
      tint: tintGravel,
      depth: 75,
      falloff: 0.45,
      shade: (x, z) => 0.96 + 0.09 * vnoise(x * 0.5, z * 0.45),
    });
    overlayMesh(scene, "roadGravelMacroMesh" + tag, gravelGeom, gravelY, 2.5, dMacroMat, { tile: T_MACRO_D * 0.7, slot: 1 });
    overlayMesh(scene, "roadGravelPatchMesh" + tag, gravelGeom, gravelY, 2.5, dPatchMat, { tile: T_PATCH_D * 1.1, slot: 2 });
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
      tiles: [T_NEAR_D * 2, T_MACRO_D, T_PATCH_D, T_NEAR_D * 2],
      material: dirtMat,
      tint: tintDirt,
      depth: 60,
      falloff: 0.55,
      shade: (x, z) => 1.0 + 0.14 * vnoise(x * 0.13, z * 0.11) - 0.05 * vnoise(x * 0.9, z * 0.8),
    });
    overlayMesh(scene, "roadVergeMacroMesh" + tag, vergeGeom, vergeY, 4.0, dMacroMat, { tile: T_MACRO_D, slot: 1 });
    overlayMesh(scene, "roadVergePatchMesh" + tag, vergeGeom, vergeY, 4.0, dPatchMat, { tile: T_PATCH_D, slot: 2 });
    overlayMesh(scene, "roadVergeWearMesh" + tag, vergeGeom, vergeY, 4.0, dWearMat, { width: VERGE_OUT - GRAVEL_OUT + 0.15 });
  }

  // ----------------------------------------------------------------- cracks
  // Named roadAsphalt* on purpose: sun.ts excludes /road(Asphalt|...)/ from the
  // cascade casters, because a ground mesh casting onto itself under a 9 degree
  // sun is pure acne. These ride 2.8 mm proud of the pavement and must be
  // excluded with it.
  const openMat = crackMaterial("roadCrackOpen", scene, aAlbedo, 0.95, 0.22);
  const tarMat = crackMaterial("roadCrackTar", scene, aAlbedo, 0.50, 0.28);
  buildCracks(scene, openMat, tarMat, tintAsphalt);

  // ------------------------------------------------------------------- paint
  const wear = paintWearTexture(scene);
  // The paint is lit by the same rig as the asphalt and multiplied by the same
  // exposure gain, so it reads as paint ON the road: a touch lighter and much
  // yellower than the asphalt, never a bright stripe that blooms.
  const yellow = paintMaterial(scene, "roadPaintYellow", wear, new Color3(0.80, 0.54, 0.175));
  const white = paintMaterial(scene, "roadPaintWhite", wear, new Color3(0.74, 0.69, 0.58));

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

  (window as any).HERO_ROAD = {
    asphaltMat,
    gravelMat,
    dirtMat,
    openMat,
    tarMat,
    wearAsphaltMean: wearA.mean,
    wearAsphaltRaw: { bins: wearA.rawBins, min: wearA.rawMin, max: wearA.rawMax },
    tintAsphalt,
    overlayMeanA,
    wearDirtMean: wearD.mean,
    /** live dials, for bracketing without a rebuild */
    gain: (g: number) => {
      for (const m of [asphaltMat, gravelMat, dirtMat]) m.albedoColor = new Color3(g, g, g);
      return g;
    },
    env: (v: number) => {
      for (const m of [asphaltMat, gravelMat, dirtMat]) m.environmentIntensity = v;
      return v;
    },
    bump: (v: number) => {
      for (const m of [asphaltMat, gravelMat, dirtMat]) m.bumpTexture!.level = v;
      return v;
    },
    roughness: (v: number) => {
      for (const m of [asphaltMat, gravelMat, dirtMat]) m.roughness = v;
      return v;
    },
    direct: (v: number) => {
      for (const m of [asphaltMat, gravelMat, dirtMat]) m.directIntensity = v;
      return v;
    },
    f0: (v: number) => {
      for (const m of [asphaltMat, gravelMat, dirtMat]) m.metallicF0Factor = v;
      return v;
    },
    alb: (r: number, g: number, b: number) => {
      for (const m of [asphaltMat, gravelMat, dirtMat]) m.albedoColor = new Color3(r, g, b);
      return [r, g, b];
    },
  };
}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

/** lens position, for the aerial falloff on the ground */
const LENS = { x: 0, z: 0 };

/**
 * How much of a surface's light survives at this distance from the lens.
 *
 * This is not fog - the dust part owns haze, and haze BRIGHTENS a dark ground
 * toward the sky. What this replaces is the shadowing half of a rough BRDF at a
 * 9 degree sun: the pavement you see at 60 m is the far side of the aggregate,
 * i.e. the side facing away from the key, and in the reference the road at that
 * distance measures luma 25 against 116 in the near field. Babylon has no
 * masking term, so the falloff is baked here, in the same measurement-driven
 * way as everything else, and kept deliberately mild so a future haze layer
 * adds on top of it rather than fighting it.
 */
function aerial(d: number, depth: number, amount = 0.34) {
  const t = Math.min(1, Math.max(0, (d - 8) / depth));
  return 1 - amount * (t * t * (3 - 2 * t));
}

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

/** 2% crown. */
function crownAt(x: number) {
  return 0.022 * (1 - Math.min(1, (x / ASPHALT) ** 2));
}

/** Repaving undulation only, no crown: +-2 cm, the thing the seal pools in. */
function undulation(x: number, z: number) {
  return 0.03 * (vnoise(x * 0.09, z * 0.07) - 0.5) + 0.012 * (vnoise(x * 0.5, z * 0.4) - 0.5);
}

/**
 * 0 in a crest, 1 in the deepest dip. The seal pools where the surface sits
 * low, so every darkening term on the pavement is driven by this rather than by
 * an independent noise field that would fight the relief.
 */
function lowSpot(x: number, z: number) {
  const u = undulation(x, z);
  const t = Math.min(1, Math.max(0, (0.004 - u) / 0.030));
  return t * t;
}

/** 2% crown plus repaving undulation, a few centimetres deep. */
function asphaltY(x: number, z: number) {
  return crownAt(x) + undulation(x, z);
}

/**
 * Height of the ASPHALT MESH at a point, not of the analytic surface under it.
 *
 * The crack strips have to sit a millimetre or two above the pavement, and the
 * pavement is a triangulated 2 m x 18 cm grid: between vertices its flat
 * triangles can stand several millimetres above the smooth function they were
 * sampled from, which silently buried half of the crack network in the depth
 * buffer. So the height is interpolated the same way the mesh was built -
 * bilinear in the grid's own vertices - and the lift on top of it is real.
 */
const ROAD_DZ = 2.0;
const ROAD_COLS = 44;
function asphaltMeshY(x: number, z: number) {
  const jf = (z - Z_FROM) / ROAD_DZ;
  const jMax = Math.floor((Z_TO - Z_FROM) / ROAD_DZ) - 1;
  const j0 = Math.max(0, Math.min(Math.floor(jf), jMax));
  const tz = Math.min(1, Math.max(0, jf - j0));
  const z0 = Z_FROM + j0 * ROAD_DZ;
  const z1 = z0 + ROAD_DZ;
  const w0 = ASPHALT + edgeJitter(z0);
  const w1 = ASPHALT + edgeJitter(z1);
  const col = (xx: number, w: number) => Math.min(ROAD_COLS - 1, Math.max(0, Math.floor(((xx + w) / (2 * w)) * ROAD_COLS)));
  const frac = (xx: number, w: number) => {
    const u = Math.min(1, Math.max(0, ((xx + w) / (2 * w)) * ROAD_COLS));
    return u - Math.floor(u);
  };
  const xAt = (c: number, w: number) => -w + (2 * w * c) / ROAD_COLS;
  const c0 = col(x, w0);
  const c1 = col(x, w1);
  const h00 = asphaltY(xAt(c0, w0), z0);
  const h01 = asphaltY(xAt(c0 + 1, w0), z0);
  const h10 = asphaltY(xAt(c1, w1), z1);
  const h11 = asphaltY(xAt(c1 + 1, w1), z1);
  const f0 = frac(x, w0);
  const f1 = frac(x, w1);
  const hA = h00 + (h01 - h00) * f0;
  const hB = h10 + (h11 - h10) * f1;
  return hA + (hB - hA) * tz;
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
// Ribbons: UV repeat baked in, four UV sets, vertex shading, normals from geometry
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

/** The near-field albedo's UV, in one place: the crack network has to sample
 *  the same texels as the pavement it lies on, or its edges show. */
function nearUV(x: number, z: number, tile: number, warp: number): [number, number] {
  return [x / tile + warp, z / tile + warp];
}

/** The small noise warp applied to the near layer's UV, so the tile never lines
 *  up with itself across the crown. */
function nearWarp(x: number, z: number) {
  return 0.11 * (vnoise(x * 0.06, z * 0.05) - 0.5);
}

interface RibbonSpec extends GridSpec {
  /** metres per tile: [near albedo, macro, patch, (unused)] */
  tiles: [number, number, number, number];
  material: Material;
  /** Per-channel albedo tint. Vertex colour, not albedoColor: a per-vertex tint
   *  is per-surface, and the specular term stays untouched. */
  tint?: [number, number, number];
  shade?: (x: number, z: number) => number;
  /** metres over which the aerial falloff completes; shorter = faster. */
  depth?: number;
  /** how much light is lost at the far end of that falloff */
  falloff?: number;
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
      // Each layer gets its own rotation and a small noise warp, so the grids
      // never line up and the repeat stops announcing itself. Baked into the UV
      // stream, so it costs nothing at draw time.
      const warp = nearWarp(x, z);
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
      const d = Math.hypot(x - LENS.x, z - LENS.z);
      const s =
        (spec.shade ? Math.max(0.45, Math.min(1.1, spec.shade(x, z))) : 1) *
        drift *
        aerial(d, spec.depth ?? 120, spec.falloff ?? 0.34);
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
// Cracks and tar seams
// ---------------------------------------------------------------------------
//
// A crack in a photograph is not a dark line, it is a groove: two walls, one of
// which is lit and one of which is in shadow. Painting a dark line gives a
// flat mark that reads as dirt; the reference's p1 of 9 comes from marks that
// carry their own shading.
//
// So each crack is a strip with an authored normal per column - the walls lean
// into the groove at 26 degrees and the two sides lean in opposite directions.
// Under this scene's 9 degree sun the sunward wall takes about 2.5x the flat
// pavement's light and the far wall goes to zero, which is the depth cue. The
// strip is 2.8 mm proud of the mesh (a groove cannot be cut into an opaque
// surface) and acquires the pavement's own albedo UV, so its lips inherit the
// exact texels they sit on and the edges disappear.
//
// Tar-sealed cracks are the opposite: slightly proud, near black, and glossy
// (roughness 0.42 against the pavement's 0.88), because a tar bead is a bead of
// bitumen, and at this sun angle a glossy bead picks up a sheen streak that a
// matte one cannot.

interface Stroke {
  pts: Array<{ x: number; z: number }>;
  half: number;
  tar: boolean;
  /** optional per-point half width, so a seam can breathe along its length */
  widths?: number[];
}

/** Cross-section, in units of the stroke's half width. */
const CRACK_COLS = [-1.0, -0.8, -0.55, -0.35, 0.35, 0.55, 0.8, 1.0];
/** Which way each column's normal leans (positive = toward +lateral, i.e. into
 *  the groove from the left wall). */
const CRACK_LEAN = [0, 0.85, 1, 0.5, -0.5, -1, -0.85, 0];
/**
 * Albedo multiplier per column: the lips ARE the pavement (1.0, so the strip
 * has no visible edge), the walls are half-lit, and the core is a hole - which
 * on a dry road means almost no light comes back at all. These have to be this
 * low because GROUND_GAIN multiplies them too: at 0.13 the core still measured
 * 33/255, i.e. a grey stripe, which is what the first pass's uniform mid-tone
 * was made of.
 */
const CRACK_SHADE_OPEN = [1.0, 0.80, 0.34, 0.05, 0.05, 0.34, 0.80, 1.0];
/** Bitumen is near-black and glossy; the bead reads as a black line with a
 *  specular streak down one wall, not as a darker grey. */
const CRACK_SHADE_TAR = [1.0, 0.64, 0.12, 0.003, 0.003, 0.12, 0.64, 1.0];
const CRACK_WALL_DEG = 26;
const CRACK_Z0 = -22;
const CRACK_Z1 = 110;

function crackMaterial(name: string, scene: Scene, albedo: Texture, roughness: number, f0: number) {
  const m = new PBRMaterial(name, scene);
  // Same albedo upload as the pavement, so the lips match it texel for texel.
  m.albedoTexture = albedo;
  m.albedoColor = new Color3(GROUND_GAIN, GROUND_GAIN, GROUND_GAIN);
  m.metallic = 0;
  m.roughness = roughness;
  m.bumpTexture = null; // the authored vertex normals ARE the relief here
  // a crack is a recess, so it sees a fraction of the sky the plane does:
  // baking that occlusion in is what takes a black bead from 24/255 to the
  // reference's 15, and it is the honest reason a crack reads as a hole
  m.environmentIntensity = 0.02;
  m.directIntensity = GROUND_DIRECT;
  // tar is the one thing out here that IS glossy: no dust film survives on a
  // fresh bead, so the crack materials keep a fuller dielectric response
  m.metallicF0Factor = f0;
  m.backFaceCulling = false; // stroke winding depends on direction walked
  m.zOffset = -2; // 2.8 mm proud already; this is belt and braces at 30 m
  return m;
}

function buildCracks(scene: Scene, openMat: PBRMaterial, tarMat: PBRMaterial, tint: number[]) {
  const strokes = crackNetwork();
  const open = strokes.filter((s) => !s.tar);
  const tar = strokes.filter((s) => s.tar);
  crackMesh(scene, "roadAsphaltCrackOpen", open, openMat, tint, 0.0045, CRACK_SHADE_OPEN);
  crackMesh(scene, "roadAsphaltCrackTar", tar, tarMat, tint, 0.0060, CRACK_SHADE_TAR);
}

function crackNetwork(): Stroke[] {
  let seed = 20261116;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  const out: Stroke[] = [];

  /** Walk a stroke from a point at a heading (radians from +z), wandering with
   *  a smooth noise field rather than a random walk, so the path bends the way
   *  a fatigue crack propagates: smoothly, in one direction, then again. */
  const walk = (x0: number, z0: number, heading: number, len: number, amp: number, tag: number) => {
    const pts = [{ x: x0, z: z0 }];
    let x = x0;
    let z = z0;
    let s = 0;
    const step = 0.55;
    while (s < len) {
      const h = heading + amp * (vnoise(s * 0.19 + tag, tag * 2.3) - 0.5);
      x += Math.sin(h) * step;
      z += Math.cos(h) * step;
      s += step;
      if (z < CRACK_Z0 || z > CRACK_Z1) break;
      if (Math.abs(x) > ASPHALT + edgeJitter(z) - 0.04) break;
      pts.push({ x, z });
    }
    return pts;
  };

  const add = (pts: Array<{ x: number; z: number }>, half: number, tar: boolean, widths?: number[]) => {
    if (pts.length >= 3) out.push({ pts, half, tar, widths: widths && widths.length === pts.length ? widths : undefined });
  };

  // --- transverse: the cracks that cross the road -------------------------
  // Spacing is a function of how much of the thing you can resolve. Under the
  // lens the pavement is only about 1.5 m deep and 4 m wide (a 1.1 m camera
  // with a 42 degree lens), so the near metre is where a crack either exists on
  // screen or does not: 1.0-3.2 m spacing from z -8 to 26. Past 60 m a 4 cm
  // crack is under a pixel and only aliases, so the far road gets 5-17 m.
  let z = CRACK_Z0 + 1.5;
  while (z < CRACK_Z1) {
    const near = z < 26;
    const mid = z >= 26 && z < 60;
    const gap = near ? 0.7 + rnd() * 1.4 : mid ? 2.6 + rnd() * 4.5 : 5.0 + rnd() * 12;
    z += gap;
    // In the first 8 m - the only pavement the lens resolves properly - almost
    // every joint is tar-sealed. That is what a maintained desert highway looks
    // like, and it is also the band the reference's p1 of 9 comes from: one
    // 10 cm transverse bead across a band that is 1.5 m deep and 4 m wide
    // covers 7% of it, which is the whole dark tail in one mark.
    const close = z < 8;
    const tar = rnd() < (close ? 0.92 : near ? 0.6 : mid ? 0.4 : 0.25);
    // a tar bead is 8-16 cm of black bitumen; an open crack is 1.5-4.5 cm wide
    const half = tar ? (close ? 0.050 + rnd() * 0.050 : 0.032 + rnd() * 0.048) : 0.008 + rnd() * 0.015;
    const side = rnd() < 0.5 ? -1 : 1;
    const startX = side * (ASPHALT - 0.05);
    const len = 1.4 + rnd() * (near ? 8.0 : 5.0);
    const pts = walk(startX, z + (rnd() - 0.5) * 0.8, side * (Math.PI / 2) + (rnd() - 0.5) * 0.55, len, 0.5, z * 0.41);
    add(pts, half, tar);
    // the same joint often runs on from the other edge, offset a little
    if (near && rnd() < 0.45) {
      const pts2 = walk(-startX, z + gap * 0.4 * rnd(), -side * (Math.PI / 2) + (rnd() - 0.5) * 0.5, 1.2 + rnd() * 3.5, 0.5, z * 0.53 + 5);
      add(pts2, half * (0.5 + rnd() * 0.4), tar || rnd() < 0.4);
    }

    // branch: cracks fork, and a fork is what stops a mark reading as a stripe
    if (pts.length > 6 && rnd() < (near ? 0.7 : 0.35)) {
      const k = 2 + Math.floor(rnd() * (pts.length - 4));
      const p = pts[k];
      const ahead = pts[Math.min(pts.length - 1, k + 2)];
      const h0 = Math.atan2(ahead.x - p.x, ahead.z - p.z);
      const dir = rnd() < 0.5 ? 1 : -1;
      const bp = walk(p.x, p.z, h0 + dir * (0.5 + rnd() * 0.7), 0.8 + rnd() * 2.6, 0.55, z * 0.77 + 9);
      add(bp, half * (0.55 + rnd() * 0.35), tar && rnd() < 0.5);
    }
  }

  // --- longitudinal: the seams and wheel-path cracks ----------------------
  // THREE seams, not six. Six evenly spaced lines read as a striped pattern
  // (the vision check called them "long straight parallel bands"); a real road
  // has the one lane joint it was paved to, and maybe a second where it was
  // widened. Each wanders two octaves and changes width as it goes, so no two
  // metres of it look like the metre before.
  const laneSeams = [-1.62, 1.74, 3.42];
  for (const xs of laneSeams) {
    // a lane joint is one long tar bead, wandering slowly
    const tar = true;
    let x = xs;
    let zz = CRACK_Z0;
    const pts = [{ x, z: zz }];
    const widths: number[] = [];
    let wSeed = rnd() * 40;
    let hw = (Math.abs(xs) > 3.0 ? 0.030 : 0.040) + rnd() * 0.020;
    while (zz < CRACK_Z1) {
      const step = 0.9;
      x =
        xs +
        0.26 * (vnoise(zz * 0.06, xs * 3.7) - 0.5) +
        0.05 * (vnoise(zz * 0.61, xs * 1.3) - 0.5);
      // width breathes along the seam: a bead is thick where it was poured,
      // thin where it settled, and the shoulders of the seam are uneven
      hw = Math.max(0.012, hw * 0.985 + 0.004 * (vnoise(zz * 0.13 + wSeed, xs) - 0.5));
      zz += step;
      pts.push({ x, z: zz });
      widths.push(hw);
    }
    // the list starts at the first point, which has no width entry of its own
    widths.unshift(widths[0] ?? hw);
    add(pts, hw, tar, widths);
  }

  // --- alligator cracking -------------------------------------------------
  // Old asphalt does not fail in single lines: it fails in blocks. A cluster is
  // a handful of nodes joined to their nearest neighbours, which is what a
  // fatigue network looks like, and it is the only thing in this file that
  // produces crack TOPOLOGY rather than marks. Without it a crack reads as a
  // stripe, and a stripe reads as a decal.
  const alligator = (cx: number, cz: number, r: number, tar: boolean) => {
    const n = 6 + Math.floor(rnd() * 6);
    const nodes: Array<{ x: number; z: number }> = [];
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = Math.sqrt(rnd()) * r;
      const x = cx + Math.cos(a) * rr;
      const z = cz + Math.sin(a) * rr * 0.75;
      if (Math.abs(x) > ASPHALT + edgeJitter(z) - 0.15) continue;
      nodes.push({ x, z });
    }
    for (let i = 1; i < nodes.length; i++) {
      // join to the nearest node ALREADY in the network. Two nearest
      // neighbours each turns the cluster into closed polygons, which read as
      // scribble; one earlier neighbour gives a branching tree, which is what
      // fatigue cracking actually looks like.
      const near = nodes
        .map((p, k) => ({ k, d: Math.hypot(p.x - nodes[i].x, p.z - nodes[i].z) }))
        .filter((o) => o.k < i)
        .sort((a, b) => a.d - b.d)
        .slice(0, 1);
      for (const o of near) {
        if (o.d > r * 1.3) continue;
        const a = nodes[i];
        const b = nodes[o.k];
        const steps = 5 + Math.floor(o.d / 0.07);
        const pts: Array<{ x: number; z: number }> = [];
        for (let st = 0; st <= steps; st++) {
          const tt = st / steps;
          const j = 0.034 * r;
          pts.push({
            x: a.x + (b.x - a.x) * tt + (vnoise(tt * 11 + i, o.k * 3.3) - 0.5) * j,
            z: a.z + (b.z - a.z) * tt + (vnoise(tt * 11 + 7, i * 2.1) - 0.5) * j,
          });
        }
        // a sealed alligator crack is 5-9 cm of bead, not a hairline: at this
        // lens 3 cm is four pixels and its dark core is one, which antialiases
        // away to grey. Width here is legibility, not decoration.
        add(pts, tar ? 0.026 + rnd() * 0.020 : 0.007 + rnd() * 0.008, tar);
      }
    }
  };

  // clusters sit where the lens can read them, and the far ones are wider (a
  // block crack under a pixel is only aliasing)
  let cz2 = CRACK_Z0 + 4;
  while (cz2 < 70) {
    const near = cz2 < 30;
    const r = (near ? 0.55 + rnd() * 0.75 : 1.0 + rnd() * 1.4);
    const cx = (rnd() * 2 - 1) * (ASPHALT - r - 0.2);
    alligator(cx, cz2, r, rnd() < (near ? 0.65 : 0.4));
    cz2 += (near ? 2.5 : 6) + rnd() * (near ? 7 : 18);
  }

  // One cluster inside the near window on purpose. The lens resolves about
  // 1.6 x 1.6 m of pavement at the bottom of frame, and a fatigue cluster is
  // 1-2 m across, so whether the shot HAS crack topology at all is decided by
  // whether one of them happens to land there. Two per 64 m of road is what a
  // road in this condition carries, so this is a placement, not an invention.
  alligator(1.5 + rnd() * 1.4, -3.4 + rnd() * 1.4, 0.85 + rnd() * 0.5, true);
  alligator(-0.6 + rnd() * 1.6, -0.4 + rnd() * 1.6, 0.6 + rnd() * 0.4, false);

  // wheel-path cracks: long, thin, and they always run with the traffic
  for (const lane of [-2.55, -1.05, 1.05, 2.55]) {
    let zz = CRACK_Z0 + rnd() * 6;
    while (zz < CRACK_Z1) {
      const len = 5 + rnd() * 22;
      const x0 = lane + (rnd() - 0.5) * 0.7;
      const pts = walk(x0, zz, (rnd() - 0.5) * 0.09, len, 0.11, zz * 0.13 + lane);
      add(pts, 0.006 + rnd() * 0.009, false);
      zz += len + 4 + rnd() * 16;
    }
  }

  return out;
}

function crackMesh(scene: Scene, name: string, strokes: Stroke[], mat: PBRMaterial, tint: number[], lift: number, shade: number[]) {
  const nCol = CRACK_COLS.length;
  let nVert = 0;
  for (const s of strokes) nVert += s.pts.length >= 3 ? s.pts.length : 0;
  if (nVert === 0) return;

  const positions = new Float32Array(nVert * nCol * 3);
  const normals = new Float32Array(nVert * nCol * 3);
  const uvs = new Float32Array(nVert * nCol * 2);
  const colors = new Float32Array(nVert * nCol * 4);
  const indices: number[] = [];

  const lean = Math.sin((CRACK_WALL_DEG * Math.PI) / 180);
  const up = Math.cos((CRACK_WALL_DEG * Math.PI) / 180);

  let v = 0;
  let row0 = 0;
  for (const s of strokes) {
    // endpoints are collapsed to zero width, which caps the stroke; a crack
    // that ends in a blunt square is a decal giveaway
    const n = s.pts.length;
    if (n < 3) continue;
    for (let i = 0; i < n; i++) {
      const p = s.pts[i];
      const prev = s.pts[Math.max(0, i - 1)];
      const next = s.pts[Math.min(n - 1, i + 1)];
      let tx = next.x - prev.x;
      let tz = next.z - prev.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      const lx = -tz; // lateral, unit length in XZ
      const lz = tx;
      // width taper: zero at both ends, full in the middle third
      const e = i / (n - 1);
      const taper = Math.min(1, Math.min(e, 1 - e) / 0.18);
      const w = (s.widths ? s.widths[i] : s.half) * taper;
      // distance taper: a crack under a pixel only aliases, so it fades out
      const zd = Math.max(0, Math.min(1, (110 - p.z) / 26));
      const ww = w * zd;
      const y = asphaltMeshY(p.x, p.z) + lift;
      for (let c = 0; c < nCol; c++) {
        const off = CRACK_COLS[c] * ww;
        const vx = p.x + lx * off;
        const vz = p.z + lz * off;
        positions[v * 3] = vx;
        positions[v * 3 + 1] = y;
        positions[v * 3 + 2] = vz;
        // authored normal: up, leaned into the groove by CRACK_WALL_DEG
        const ln = CRACK_LEAN[c] * lean;
        const nx = lx * ln;
        const nz = lz * ln;
        const ny = CRACK_LEAN[c] === 0 ? 1 : up;
        const nl = Math.hypot(nx, ny, nz) || 1;
        normals[v * 3] = nx / nl;
        normals[v * 3 + 1] = ny / nl;
        normals[v * 3 + 2] = nz / nl;
        // the lip samples the pavement's own texel under it, so the strip has
        // no visible edge against the road around it
        const uv = nearUV(vx, vz, T_NEAR_A, nearWarp(vx, vz));
        uvs[v * 2] = uv[0];
        uvs[v * 2 + 1] = uv[1];
        const sh = shade[c];
        colors[v * 4] = sh * tint[0];
        colors[v * 4 + 1] = sh * tint[1];
        colors[v * 4 + 2] = sh * tint[2];
        colors[v * 4 + 3] = 1;
        v++;
      }
    }
    // faces, wound so the +Y side is front
    for (let r = 0; r < n - 1; r++) {
      for (let c = 0; c < nCol - 1; c++) {
        const a = row0 + r * nCol + c;
        const d = row0 + r * nCol + c + 1;
        const cc = row0 + (r + 1) * nCol + c + 1;
        const b = row0 + (r + 1) * nCol + c;
        indices.push(a, d, cc, a, cc, b);
      }
    }
    row0 += n * nCol;
  }

  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = new Uint32Array(indices);
  vd.normals = normals;
  vd.uvs = uvs;
  vd.colors = colors;
  vd.applyToMesh(mesh, false);
  mesh.material = mat;
  mesh.receiveShadows = true;
  mesh.isPickable = false;
  mesh.alphaIndex = 1;
  mesh.freezeWorldMatrix();
  return mesh;
}

// ---------------------------------------------------------------------------
// Wear: a canvas multiplier with soft ramps, never a hard edge, never bright
// ---------------------------------------------------------------------------

function wearTexture(scene: Scene, name: string, kind: "asphalt" | "dirt") {
  // returns the canvas texture plus the mean of the multiplier it stores
  const W = 1024;
  const H = 2048; // 7.2 m across x 64 m along: 143 and 32 px/m, i.e. 3 cm
  const dt = new DynamicTexture(name, { width: W, height: H }, scene, true);
  const g = dt.getContext() as unknown as CanvasRenderingContext2D;
  let seed = kind === "asphalt" ? 7717 : 4231;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  // the noise field is indexed in WORLD metres, not texels, so the canvas and
  // the geometry are describing the same ground
  const WORLD_W = ASPHALT * 2; // width of the asphalt this canvas covers
  const WORLD_L = 64; // metres along the road, matching the overlay's z/64

  // --- repair patches: straight edges are a scale cue ---------------------
  // A patch is a rectangle of newer, darker, finer asphalt with a tar outline.
  // Four per 64 m, never at the same place twice, and never straddling the
  // centreline, because that is not how a repair crew works.
  interface Patch { x0: number; x1: number; z0: number; z1: number; tone: number }
  const patches: Patch[] = [];
  if (kind === "asphalt") {
    for (let i = 0; i < 4; i++) {
      const wm = 0.8 + rnd() * 2.2;
      const lm = 1.0 + rnd() * 7.0;
      const side = rnd() < 0.5 ? -1 : 1;
      const cx = side * (0.7 + rnd() * 2.6);
      const cz = rnd() * WORLD_L;
      patches.push({
        x0: cx - wm / 2,
        x1: cx + wm / 2,
        z0: cz - lm / 2,
        z1: cz + lm / 2,
        tone: 0.75 + rnd() * 0.12,
      });
    }
  }
  // A lane-wide seal coat: a strip of the pavement was re-sealed, so it is a
  // shade darker along its whole length, with a hard edge at one side. That
  // edge is one of the strongest scale cues on a real road - it runs to the
  // horizon and it is 1-3 cm wide.
  const sealEdge = kind === "asphalt" ? 0.4 + rnd() * 2.4 : 99;
  const sealTone = 0.90 + rnd() * 0.05;
  const sealSign = rnd() < 0.5 ? -1 : 1;

  const nLen = Math.floor(H / 8) + 2;
  const lenNoise = new Float32Array(nLen);
  for (let i = 0; i < nLen; i++) lenNoise[i] = rnd();
  const len = (tt: number) => {
    // Wrap into [0,1) first. This field repeats along the road, and without the
    // wrap a caller passing t*3.1+0.2 (as the grit term does) drives the
    // smoothstep past the end of the table, where f0^2*(3-2*f0) extrapolates to
    // ~1e8 and the multiplier collapses onto its clamp. That bug was in the
    // first pass: it left 73% of the wear map at one flat value, which is a
    // large part of why the pavement had no structure in it.
    const w = tt - Math.floor(tt);
    const p = w * (nLen - 1);
    const i0 = Math.min(nLen - 2, Math.floor(p));
    const f0 = p - i0;
    const f = f0 * f0 * (3 - 2 * f0);
    return lenNoise[i0] * (1 - f) + lenNoise[i0 + 1] * f;
  };

  const img = g.createImageData(W, H);
  const d = img.data;
  let sum = 0;
  const rawBins = new Array(12).fill(0);
  let rawMin = 9, rawMax = -9;
  for (let y = 0; y < H; y++) {
    const t = y / H;
    const drift = 0.1 * (len(t) - 0.5) * 2; // polish runs along the road
    const wz = (y / H) * WORLD_L;
    for (let x = 0; x < W; x++) {
      const u = x / W; // 0..1 across the surface's own width
      const wx = (u - 0.5) * WORLD_W;
      let m = 1.0;
      if (kind === "asphalt") {
        // dust and grit banked against both edges: no darkening there at all
        const dusty = Math.max(0, 1 - Math.min(u, 1 - u) / 0.2);
        // polished wheel paths: lanes at +-1.8 m, so tracks at +-1.05 and +-2.55
        const wob = 0.022 * (len(t * 0.7 + 0.11) - 0.5) * 2;
        let polish = 0;
        for (const c of [0.185, 0.37, 0.63, 0.815]) polish += Math.exp(-(((u - c - wob) / 0.075) ** 2));
        polish = Math.min(1, polish);
        // tar seam wandering down the lane joint, soft
        const seam = Math.exp(-(((u - 0.5 - 0.05 * Math.sin(t * 37)) / 0.013) ** 2));
        m = 1 - 0.055 * polish * (1 - 0.7 * dusty) + 0.6 * drift * (1 - dusty);
        m -= 0.09 * seam * (0.35 + 0.65 * len(t + 0.37));
        m -= 0.03 * (1 - dusty) * len(t * 3.1 + 0.2);

        // pooled seal: darker where the pavement geometry sits in a dip, from
        // the same noise the mesh is displaced by. This is the term that gives
        // the surface its scale - a uniform mid-tone has none.
        m *= 1 - 0.50 * lowSpot(wx, wz);

        // the lane-wide seal coat, and its hard edge
        if (sealSign * wx > sealEdge) m *= sealTone;
        const edgeD = Math.abs(Math.abs(wx) - sealEdge);
        if (sealSign * wx > sealEdge - 0.02 && edgeD < 0.02) m *= 0.80;

        // repair patches, with their tar outline
        for (const p of patches) {
          const inside = wx > p.x0 && wx < p.x1 && wz > p.z0 && wz < p.z1;
          if (inside) {
            m *= p.tone;
          } else {
            const dx = Math.max(p.x0 - wx, 0, wx - p.x1);
            const dz = Math.max(p.z0 - wz, 0, wz - p.z1);
            const d = Math.hypot(dx, dz);
            if (d < 0.05) m *= 1 - 0.55 * (1 - d / 0.05); // tar outline, 5 cm
          }
        }
      } else {
        m = 0.95 + 0.11 * (len(t * 2.3) - 0.5) - 0.07 * len(t + 0.5);
        m -= 0.09 * Math.max(0, 1 - Math.min(u, 1 - u) / 0.08); // grime at the gravel seam
        m += 0.045 * Math.max(0, 1 - Math.abs(u - 0.4) / 0.18); // wind-blown sand
      }
      // a little grain so the wash is never flat, but a third of what it was:
      // 4% per texel at 3 cm was part of the pixel sparkle
      m += (rnd() - 0.5) * 0.014;
      if (m < rawMin) rawMin = m;
      if (m > rawMax) rawMax = m;
      rawBins[Math.max(0, Math.min(11, Math.floor(m * 10) + 1))]++;
      const q = Math.max(0.45, Math.min(1, m));
      sum += q;
      const b = Math.round(q * 255);
      const o = (y * W + x) * 4;
      d[o] = b;
      d[o + 1] = b;
      d[o + 2] = b;
      d[o + 3] = 255;
    }
  }
  const out = g.createImageData(W, H);
  out.data.set(d);
  g.putImageData(out, 0, 0);
  dt.update(false);
  dt.wrapU = Texture.WRAP_ADDRESSMODE;
  dt.wrapV = Texture.WRAP_ADDRESSMODE;
  dt.anisotropicFilteringLevel = 16;
  // the mean is measured, not guessed: the base tint divides by it
  return { texture: dt, mean: sum / (W * H), rawBins: rawBins.map((b) => b / (W * H)), rawMin, rawMax };
}

// ---------------------------------------------------------------------------
// Paint
// ---------------------------------------------------------------------------

function paintMaterial(scene: Scene, name: string, tex: Texture, colour: Color3) {
  const m = new PBRMaterial(name, scene);
  m.albedoTexture = tex;
  m.useAlphaFromAlbedoTexture = true;
  m.albedoColor = new Color3(colour.r, colour.g, colour.b);
  m.metallic = 0;
  m.roughness = 0.78; // road paint is glass beads in a binder: rough, not gloss
  m.environmentIntensity = GROUND_ENV;
  m.directIntensity = GROUND_DIRECT;
  m.transparencyMode = Material.MATERIAL_ALPHABLEND;
  m.zOffset = -4;
  m.zOffsetUnits = -8;
  m.disableDepthWrite = true;
  tex.hasAlpha = true;
  return m;
}

function paintRibbon(scene: Scene, name: string, x0: number, x1: number, u0: number, u1: number, vOffset: number, mat: Material) {
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
  const mat = new PBRMaterial("roadPebbleMat", scene);
  mat.albedoColor = new Color3(0.11, 0.098, 0.085);
  mat.metallic = 0;
  mat.roughness = 0.92;
  mat.environmentIntensity = GROUND_ENV;
  mat.directIntensity = GROUND_DIRECT;

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

  const mat = new PBRMaterial("roadScrubMat", scene);
  mat.albedoTexture = dt;
  mat.useAlphaFromAlbedoTexture = true;
  mat.albedoColor = new Color3(0.28, 0.245, 0.19);
  mat.metallic = 0;
  mat.roughness = 0.95;
  mat.transparencyMode = Material.MATERIAL_ALPHATEST;
  mat.alphaCutOff = 0.42;
  mat.environmentIntensity = GROUND_ENV;
  mat.directIntensity = GROUND_DIRECT;
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
