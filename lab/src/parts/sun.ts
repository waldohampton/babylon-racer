import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Constants } from "@babylonjs/core/Engines/constants";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { LabCtx } from "../main";

/**
 * SUN AND LIGHT RIG. Owns every light in the scene, the visible sun break, and
 * the exposure value that goes with them.
 *
 * THE PHYSICAL PICTURE (measured off reference/target.png, not guessed):
 *
 *   - one low storm sun, behind and right of the car, so the car is backlit and
 *     the road in front of it is raked at a grazing angle;
 *   - the sky's own amber break (sky.ts, roll 120) sits at world yaw -46.9,
 *     which is fx 0.79 under the camera part's 62 degree rig; the reference
 *     still has its break at fx 0.80. The sun is aimed at that azimuth
 *     (SUN_AZ_DEG = -47) so light and sky agree: the rock is lit from the
 *     direction the sky is glowing, not from a stage lamp;
 *   - fill is the storm sky itself: the HDR environment from sky.ts (IBL at
 *     ENV_LEVEL 0.60) plus ONE small cool hemispheric, and no more.
 *
 * UNITS: plain (non-photometric) intensities, deliberately. Nothing in this
 * chain has a photometric quantity measured against it - the evidence is a
 * display-space band table - so a lux number would be one more unmeasured
 * constant to keep consistent with other unmeasured constants. A scalar that
 * brackets to the band table is the honest unit here.
 *
 * EXPOSURE STAYS AT 1.0. post.ts maps scene-linear 0.18 to display 91 and 1.0 to
 * 178, and was calibrated against unity, so the lights carry the numbers. This
 * file asserts unity every frame only so nothing downstream can drift it.
 *
 * THE CEILING THIS RIG HITS (measured; see the report):
 * StandardMaterial - which is what road.ts, the paint ribbons and the litter use
 * - clamps its lit term at 1.0. Raising this sun 4x past saturation moved the
 * ground band by 2/255. So the sun is set to exactly the point where
 * ndl * sun reaches 1.0, and past that the ground band is a road albedo and
 * shadow-coverage question rather than a light question.
 */

/* ------------------------------------------------------------------ */
/* rig constants                                                      */
/* ------------------------------------------------------------------ */

/** Sunny-side yaw, degrees. 0 = +Z, + = toward +X. The camera part stands at
 *  yaw -61.6 and the car is at the origin, so -47 is behind the car and to the
 *  right of frame centre: a back-right key. It is also the sky's own glow
 *  azimuth, which is the point. */
const SUN_AZ_DEG = -47;

/** Sun elevation, degrees. 9 is inside the reference's 5-10 degree window and is
 *  where the car's shadow stops covering most of the ground band: measured
 *  ground band 56 at 9 deg, 44 at 13, 46 at 17, everything else fixed. */
const SUN_EL_DEG = 9;

/**
 * 3000 K blackbody, normalised, in linear sRGB (Babylon light colours are
 * linear, so that is the chromaticity): Planck at 3000 K is
 * (1.000, 0.477, 0.154). Blue and green are lifted because the storm deck
 * forward-scatters the beam - a warm break seen through cloud, not a clean red
 * sun - and the band table wanted a less saturated key once the cool fill was
 * mixed in.
 */
const SUN_COLOR = new Color3(1.0, 0.55, 0.275);

/** Direct sun level. sin(9 deg) = 0.156 and 0.156 * 6.4 = 1.0: the point at
 *  which every StandardMaterial surface in the shot is at its clamp, i.e. as
 *  bright as that material can ever be. Going further only pushes the PBR car
 *  and rock (which do not clamp) away from the road, wrecking the balance. */
const SUN_INTENSITY = 6.4;

/**
 * Storm-sky fill, and the one place this rig is not pure: the HDR environment
 * lights every PBR surface (car paint, terrain) but StandardMaterial takes no
 * irradiance from scene.environmentTexture. Without a hemispheric the road, the
 * paint ribbons and the litter are lit by the sun alone and go black where the
 * car shadows them. This is a small, cool-from-above, dust-warm-from-below
 * stand-in for that missing irradiance - not a second ambient doubling the IBL,
 * which is why it is a hemispheric with a warm ground colour, and why the sky
 * band (unlit dome) does not move when it changes.
 */
const FILL_INTENSITY = 0.60;
const FILL_SKY = new Color3(0.42, 0.52, 0.72);
const FILL_BOUNCE = new Color3(0.34, 0.26, 0.17);

/** Exposure. post.ts owns the print curve and is calibrated at unity. */
const EXPOSURE = 1.0;
/** live copy, so a bracket pass can move it without fighting onBeforeRender */
let exposureNow = EXPOSURE;

/* ------------------------------------------------------------------ */
/* the visible sun break                                              */
/* ------------------------------------------------------------------ */

/** Elevation of the amber break, degrees: lower than the key's 9 because the
 *  reference's break sits on the horizon (fy 0.326) - the light comes through
 *  the deck from slightly higher than the glow it makes. */
const BREAK_EL_DEG = 0.75;
/** Peak radiance of the break, scene-linear. Above the pipeline's 0.8 bloom
 *  threshold, so the break is the only thing in the frame that haloes. */
const BREAK_PEAK = 1.45;
const BREAK_WIDTH_DEG = 14.0;
const BREAK_HEIGHT_DEG = 6.0;
const BREAK_DISTANCE = 1500;

export function installSun(ctx: LabCtx) {
  const { scene } = ctx;

  // --- sun ---------------------------------------------------------------
  const az = SUN_AZ_DEG * DEG;
  const el = SUN_EL_DEG * DEG;
  const toSun = new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));

  const sun = new DirectionalLight("sun", toSun.scale(-1), scene);
  sun.position = toSun.scale(400);
  sun.intensity = SUN_INTENSITY;
  sun.diffuse = SUN_COLOR;
  // Under a storm deck the key is a big soft source: almost no mirror highlight
  // of its own. The specular that matters (chrome, paint) is the HDR
  // environment's, so the sun's is kept token.
  sun.specular = SUN_COLOR.scale(0.35);

  // --- cascaded shadows --------------------------------------------------
  const csm = new CascadedShadowGenerator(SHADOW_MAP, sun);
  csm.numCascades = NUM_CASCADES;
  csm.lambda = 0.86; // more cascade texels near the car, where they are seen
  csm.shadowMaxZ = SHADOW_MAX_Z;
  csm.stabilizeCascades = true; // no swimming when the camera moves
  csm.autoCalcDepthBounds = false; // deterministic: fit the play area, not a frame
  csm.usePercentageCloserFiltering = true;
  csm.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
  // Grazing light is the acne case: normalBias pushes the receiver lookup off
  // the surface along its normal, which is what stops banding on the road at a
  // 9 degree sun. The bias stays small so the contact shadow keeps its contact.
  csm.bias = 0.0002;
  csm.normalBias = 0.0018;
  csm.darkness = 0.0; // full shadow: what fills it is the sky
  csm.transparencyShadow = false;

  // Casters arrive asynchronously (the car is parsed from its glTF after this
  // runs), so every new mesh is considered once.
  const casters = new Set<string>();
  const consider = (m: AbstractMesh) => {
    if (!m || m.getTotalVertices() === 0) return;
    if (NO_CAST.test(m.name)) return;
    const key = m.uniqueId + m.name;
    if (casters.has(key)) return;
    casters.add(key);
    csm.addShadowCaster(m, false);
    // anything that casts in this shot also stands on something that receives
    m.receiveShadows = true;
  };
  for (const m of scene.meshes) consider(m);
  scene.onNewMeshAddedObservable.add(consider);

  // --- fill --------------------------------------------------------------
  const fill = new HemisphericLight("skyFill", new Vector3(0, 1, 0), scene);
  fill.intensity = FILL_INTENSITY;
  fill.diffuse = FILL_SKY;
  fill.groundColor = FILL_BOUNCE;
  fill.specular = Color3.Black(); // a fake fill must not paint highlights

  // --- the sun break: the hottest thing in the frame ----------------------
  // The storm deck hides the disc, so what the reference shows is a soft amber
  // break on the horizon. It is drawn as an additive billboard on the sun's own
  // azimuth with a peak above the bloom threshold; everything else in the frame
  // (sky, haze, dust, rock) stays under 0.8 so only this glows.
  const breakEl = BREAK_EL_DEG * DEG;
  const breakDir = new Vector3(Math.sin(az) * Math.cos(breakEl), Math.sin(breakEl), Math.cos(az) * Math.cos(breakEl));

  const tex = new DynamicTexture("sunBreakTex", { width: 256, height: 128 }, scene, false);
  const bx = tex.getContext() as unknown as CanvasRenderingContext2D;
  bx.fillStyle = "#000";
  bx.fillRect(0, 0, 256, 128);
  // Elliptical falloff, wide and soft: no disc edge, because the cloud deck
  // diffuses it. Bright core offset below centre, so it sits on the horizon.
  bx.save();
  bx.translate(128, 64); // core at the plane's centre = the glow's azimuth
  bx.scale(1.0, 0.44); // flatten into a band
  const grd = bx.createRadialGradient(0, 0, 2, 0, 0, 120);
  grd.addColorStop(0.0, "rgba(255,214,160,1)");
  grd.addColorStop(0.2, "rgba(255,196,136,0.7)");
  grd.addColorStop(0.45, "rgba(240,166,104,0.28)");
  grd.addColorStop(0.75, "rgba(190,128,80,0.08)");
  grd.addColorStop(1.0, "rgba(0,0,0,0)");
  bx.fillStyle = grd;
  bx.fillRect(-160, -160, 320, 320);
  bx.restore();
  tex.update(false);

  const breakMat = new PBRMaterial("sunBreak", scene);
  // PBR, not Standard: StandardMaterial clamps emissive to 1.0, and this has to
  // reach above scene-linear 1.0 - the value ACES maps to the reference's 178 -
  // so that bloom fires and the break reads amber-hot.
  breakMat.albedoColor = Color3.Black();
  breakMat.metallic = 0;
  breakMat.roughness = 1;
  breakMat.emissiveTexture = tex;
  breakMat.emissiveColor = new Color3(BREAK_PEAK, BREAK_PEAK * 0.70, BREAK_PEAK * 0.41);
  breakMat.disableLighting = true;
  breakMat.backFaceCulling = false;
  breakMat.disableDepthWrite = true;
  breakMat.needAlphaBlending = () => true;
  breakMat.alphaMode = Constants.ALPHA_ADD;

  const breakW = 2 * BREAK_DISTANCE * Math.tan(((BREAK_WIDTH_DEG / 2) * Math.PI) / 180);
  const breakH = 2 * BREAK_DISTANCE * Math.tan(((BREAK_HEIGHT_DEG / 2) * Math.PI) / 180);
  const breakMesh = MeshBuilder.CreatePlane("sunBreak", { width: breakW, height: breakH }, scene);
  breakMesh.material = breakMat;
  breakMesh.position = breakDir.scale(BREAK_DISTANCE);
  breakMesh.billboardMode = 7; // BILLBOARDMODE_ALL: a glow always faces the lens
  breakMesh.isPickable = false;
  breakMesh.applyFog = false;
  breakMesh.receiveShadows = false;

  // --- exposure ----------------------------------------------------------
  // post.ts installs after this file and writes exposure once; assert ours on
  // every frame so the lighting rig, not part order, decides the value.
  const applyExposure = () => {
    const ip = scene.imageProcessingConfiguration;
    if (ip.exposure !== exposureNow) ip.exposure = exposureNow;
  };
  applyExposure();
  scene.onBeforeRenderObservable.add(applyExposure);

  (window as any).HERO_SUN = {
    sun,
    fill,
    csm,
    breakMesh,
    toSun,
    azimuthDeg: SUN_AZ_DEG,
    elevationDeg: SUN_EL_DEG,
    exposure: () => scene.imageProcessingConfiguration.exposure,
    set: (o: Partial<{ az: number; el: number; intensity: number; fill: number; exposure: number; warm: number; peak: number }>) => {
      const a = (o.az ?? SUN_AZ_DEG) * DEG;
      const e = (o.el ?? SUN_EL_DEG) * DEG;
      sun.direction = new Vector3(-Math.sin(a) * Math.cos(e), -Math.sin(e), -Math.cos(a) * Math.cos(e));
      sun.position = sun.direction.scale(-400);
      if (o.intensity != null) sun.intensity = o.intensity;
      if (o.fill != null) fill.intensity = o.fill;
      if (o.warm != null) sun.diffuse = new Color3(1.0, o.warm, o.warm * 0.5);
      if (o.peak != null) breakMat.emissiveColor = new Color3(o.peak, o.peak * 0.70, o.peak * 0.41);
      if (o.az != null) {
        const be = BREAK_EL_DEG * DEG;
        breakMesh.position = new Vector3(Math.sin(a) * Math.cos(be), Math.sin(be), Math.cos(a) * Math.cos(be)).scale(BREAK_DISTANCE);
      }
      if (o.exposure != null) {
        exposureNow = o.exposure;
        scene.imageProcessingConfiguration.exposure = o.exposure;
      }
      return { az: o.az ?? SUN_AZ_DEG, el: o.el ?? SUN_EL_DEG, intensity: sun.intensity, fill: fill.intensity };
    },
  };
}

/* ------------------------------------------------------------------ */
/* shadow settings                                                    */
/* ------------------------------------------------------------------ */

/** Cascade far plane in metres: the play area (car, road, litter, the near
 *  verge). The 5 km rock ridge is deliberately outside it - a cascade that
 *  reaches the ridge spends all its texels on empty desert and the car's
 *  contact shadow turns to mush. */
const SHADOW_MAX_Z = 240;
const SHADOW_MAP = 2048;
const NUM_CASCADES = 4;

/** Meshes that receive light but must not cast: the sky, the sun break, the far
 *  disc, the ridge (outside the cascades anyway), the road surfaces and the
 *  litter - the road caster is the ground Y = 0 plane, and casting it onto
 *  itself under a 9 degree sun is pure acne. The car's analytic contact blob is
 *  excluded too: it is an alpha ground plane and would cast a rectangle. */
const NO_CAST = /^(skyDome|sunBreak|farGroundDisc|rockLandform|rockFallback|carContactShadow|road(Asphalt|CentreLine|EdgeLine|Gravel|Verge)|scrubTuft|roadPebble)/i;

const DEG = Math.PI / 180;
