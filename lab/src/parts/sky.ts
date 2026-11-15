import { HDRCubeTexture } from "@babylonjs/core/Materials/Textures/hdrCubeTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { LabCtx } from "../main";

/**
 * SKY. Owns the scene background, the environment map (IBL) and the sky dome.
 *
 * A photographed equirectangular storm sky (Poly Haven, CC0) is used twice:
 *
 *  1. as the visible background, on a skybox mesh (SKYBOX_MODE, gamma space);
 *  2. as the scene environment map, prefiltered at load (prefilterOnLoad +
 *     irradiance prefilter) so the car paint and chrome get real PMREM
 *     reflections and real spherical-harmonic ambient light.
 *
 * The .hdr in assets/sky/ is a re-bake of the Poly Haven original: horizontally
 * rolled so the amber glow sits behind the car, white-balanced and highlight
 * compressed (see assets/sky/bake_sky.py) so the measured sky band lands on the
 * reference's luma 75 / warmth -6 with nothing clipped.
 */

const SKY_URL = "/assets/sky/storm_blue_2k.hdr";

/** Cube face size for the visible dome. The source panorama is 2048x1024. */
const CUBE_SIZE = 1024;

/** Face size of the environment cube. PMREM is cheap at 256 and plenty for IBL. */
const ENV_CUBE_SIZE = 256;

/** Dome brightness. Calibrated against scripts/bands.py, not by eye. */
const SKY_LEVEL = 0.72;

/** IBL brightness for PBR/standard materials that reflect the sky. */
const ENV_LEVEL = 0.60;

/** Azimuth of the sunset glow, degrees clockwise from -Z. */
const ROTATION_DEG = 30; // measured: glow centroid lands at fx 0.80 on the 40 mm camera axis

const DEG = Math.PI / 180;

export function installSky(ctx: LabCtx) {
  const { scene } = ctx;

  // Fallback so the frame is never black while the 3.4 MB .hdr streams in.
  scene.clearColor.set(0.19, 0.19, 0.2, 1);

  // --- visible background -------------------------------------------------
  // gammaSpace = true: StandardMaterial uses the radiance values as display
  // values, which is what the skybox needs. Separate texture instance from the
  // environment one, because PBR needs the linear-space, prefiltered copy.
  const domeTex = new HDRCubeTexture(SKY_URL, scene, CUBE_SIZE, false, false, true);
  domeTex.level = SKY_LEVEL;
  domeTex.coordinatesMode = Texture.SKYBOX_MODE;

  const domeMat = new StandardMaterial("skyDome", scene);
  domeMat.backFaceCulling = false;
  domeMat.disableLighting = true;
  domeMat.reflectionTexture = domeTex;
  domeMat.diffuseColor = Color3.Black();
  domeMat.specularColor = Color3.Black();
  domeMat.emissiveColor = Color3.Black();
  domeMat.ambientColor = Color3.Black();
  domeMat.fogEnabled = false; // fog owns distance, not the sky
  domeMat.disableDepthWrite = true;

  const dome = MeshBuilder.CreateBox("skyDome", { size: 3000 }, scene);
  dome.material = domeMat;
  dome.infiniteDistance = true;
  dome.isPickable = false;
  dome.applyFog = false;
  dome.renderingGroupId = 0;
  // draw the dome before everything else so it never z-tests against terrain
  domeMat.zOffset = 1;

  // --- IBL ----------------------------------------------------------------
  // prefilterOnLoad -> PMREM radiance chain (roughness mips); irradiance
  // prefilter + spherical harmonics -> diffuse ambient.
  //
  // The "?ibl=1" suffix matters: HDRCubeTexture caches its internal cubemap by
  // URL, and if the environment instance shares the dome's cache entry the
  // prefilter pass silently never runs (verified: _prefiltered stayed false and
  // the spherical polynomial stayed empty). A distinct URL gives it its own
  // internal texture, and then _prefiltered === true on the GPU path.
  const ENV_URL = SKY_URL + "?ibl=1";
  const env = new HDRCubeTexture(ENV_URL, scene, ENV_CUBE_SIZE, false, true, false, true, null, null, false, true);
  env.level = ENV_LEVEL;
  env.name = "skyEnv";
  scene.environmentTexture = env;
  scene.environmentIntensity = 1.0;

  // Rotation is applied once both textures exist (rotationY is honoured by the
  // cube sampler in both the skybox and the PBR reflection path).
  const setRotation = (deg: number) => {
    domeTex.rotationY = deg * DEG;
    env.rotationY = deg * DEG;
  };
  setRotation(ROTATION_DEG);

  domeTex.onLoadObservable.addOnce(() => setRotation(ROTATION_DEG));

  // Small hook so the camera/sun parts can re-aim the glow without editing this
  // file (the sunset azimuth and the camera azimuth have to agree).
  (window as any).SKY = {
    dome: domeTex,
    env,
    material: domeMat,
    mesh: dome,
    rotate: setRotation,
    setLevel: (l: number) => {
      domeTex.level = l;
      env.level = l;
    },
    isEnvironmentPrefiltered: () => !!env._prefiltered,
    hasSphericalHarmonics: () => !!env.sphericalPolynomial,
    source: "Poly Haven wasteland_clouds_puresky (CC0), re-baked",
  };
}
