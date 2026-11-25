// The look layer: scanned PBR surfaces, a photographed sky as the light probe,
// one sun with shadows, and a single filmic grade. Everything here is a real
// asset measured in metres, not a colour picked by eye.
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { HDRCubeTexture } from "@babylonjs/core/Materials/Textures/hdrCubeTexture";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import type { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";

export interface ScanSet {
  albedo: string;
  normal: string;
  arm: string; // R = ambient occlusion, G = roughness, B = metallic
}

/**
 * Asset URL under the build's base path. Vite dev serves from `/`, GitHub
 * Pages serves from `/babylon-racer/`, and a hardcoded leading slash breaks the
 * second one.
 */
export const asset = (p: string) => import.meta.env.BASE_URL + p.replace(/^\//, "");

/** Where the assets live and how big the real scan is, in metres. */
export const SCANS = {
  sand: {
    set: { albedo: asset("tex/ground_sand_diff.jpg"), normal: asset("tex/ground_sand_nor.jpg"), arm: asset("tex/ground_sand_arm.jpg") },
    tileMetres: 150, // Poly Haven publishes 15000 cm for aerial_sand
  },
  concrete: {
    set: { albedo: asset("tex/block_concrete_diff.jpg"), normal: asset("tex/block_concrete_nor.jpg"), arm: asset("tex/block_concrete_arm.jpg") },
    tileMetres: 2.5, // brushed_concrete is 250 cm
  },
};

/**
 * PBR material from a photogrammetry scan. `tileMetres` is the scan's real
 * world size, so `sizeMetres` is how much surface you are wrapping: the tiling
 * is a measurement, not a taste call.
 */
export function scannedMaterial(scene: Scene, name: string, set: ScanSet, tileMetres: number, sizeMetres: number): PBRMaterial {
  const m = new PBRMaterial(name, scene);
  const repeats = Math.max(0.25, sizeMetres / tileMetres);

  const albedo = new Texture(set.albedo, scene);
  albedo.gammaSpace = true; // colour maps are sRGB
  const normal = new Texture(set.normal, scene);
  normal.gammaSpace = false; // data maps are linear
  const arm = new Texture(set.arm, scene);
  arm.gammaSpace = false;

  for (const t of [albedo, normal, arm]) {
    t.uScale = repeats;
    t.vScale = repeats;
    t.anisotropicFilteringLevel = 8; // road surface is seen at a grazing angle
  }

  m.albedoTexture = albedo;
  m.bumpTexture = normal;
  m.metallicTexture = arm;
  m.useAmbientOcclusionFromMetallicTextureRed = true;
  m.useRoughnessFromMetallicTextureGreen = true;
  m.useMetallnessFromMetallicTextureBlue = true;
  m.roughness = 1;
  m.metallic = 1;
  return m;
}

/** Car paint: metallic flake base under a clear coat, so the sky reads on it. */
export function paintMaterial(scene: Scene, name: string, colour: Color3): PBRMaterial {
  const m = new PBRMaterial(name, scene);
  m.albedoColor = colour;
  m.metallic = 0.55;
  m.roughness = 0.34;
  m.clearCoat.isEnabled = true;
  m.clearCoat.intensity = 1.0;
  m.clearCoat.roughness = 0.045;
  m.clearCoat.indexOfRefraction = 1.5;
  return m;
}

/** Tyre rubber: no specular highlight to speak of, catches the sun on the shoulder. */
export function rubberMaterial(scene: Scene): PBRMaterial {
  const m = new PBRMaterial("rubber", scene);
  m.albedoColor = new Color3(0.045, 0.045, 0.05);
  m.metallic = 0;
  m.roughness = 0.85;
  return m;
}

/** Dark glass: reflections only, no light passing through in this pass. */
export function glassMaterial(scene: Scene): PBRMaterial {
  const m = new PBRMaterial("glass", scene);
  m.albedoColor = new Color3(0.02, 0.025, 0.03);
  m.metallic = 0.9;
  m.roughness = 0.06;
  return m;
}

/**
 * The photographed sky. Same HDRI is both the visible background and the
 * image-based light probe, which is the whole reason the paint and the road
 * stop looking like flat plastic.
 */
export function installSky(scene: Scene, url: string): HDRCubeTexture {
  const env = new HDRCubeTexture(
    url,
    scene,
    256, // prefiltered cube resolution
    false, // mipmaps
    true, // generate harmonics for irradiance
    true, // gamma space
    true, // prefilter so it can be a PBR reflection texture
    undefined,
    undefined,
    false,
    true, // prefilter irradiance too: this is the only ambient source
    true,
  );
  scene.environmentTexture = env;
  scene.environmentIntensity = 1.0;

  const skyMat = new PBRMaterial("skyBox", scene);
  skyMat.backFaceCulling = false;
  skyMat.fogEnabled = false; // fog on the skybox turns the whole sky into fog colour
  const refl = env.clone();
  if (refl) refl.coordinatesMode = Texture.SKYBOX_MODE;
  skyMat.reflectionTexture = refl;
  skyMat.microSurface = 1;
  skyMat.disableLighting = true;
  skyMat.twoSidedLighting = true;

  const box = MeshBuilder.CreateBox("sky", { size: 5000, sideOrientation: Mesh.BACKSIDE }, scene);
  box.material = skyMat;
  box.infiniteDistance = true;
  box.ignoreCameraMaxZ = true;
  box.isPickable = false;

  return env;
}

/** Sun with a real contact shadow. The blob under the car is gone; this replaces it. */
export function installSunShadows(scene: Scene, sun: DirectionalLight, casters: Mesh[], receivers: Mesh[]): ShadowGenerator {
  // The frustum is pinned to a 70 m box that follows the car (main.ts moves
  // the light). Left on auto it fits every caster in the scene, the blocks sit
  // 60 m out, and the car's shadow lands on about four texels.
  sun.autoUpdateExtends = false;
  sun.autoCalcShadowZBounds = false;
  sun.orthoLeft = -35;
  sun.orthoRight = 35;
  sun.orthoTop = 35;
  sun.orthoBottom = -35;
  sun.shadowMinZ = 1;
  sun.shadowMaxZ = 120;

  const sg = new ShadowGenerator(2048, sun);
  sg.useBlurExponentialShadowMap = true;
  sg.blurKernel = 24;
  sg.depthScale = 60;
  sg.bias = 0.0006;
  sg.setDarkness(0.25); // 0 = pitch black shadow, 1 = no shadow

  for (const c of casters) sg.addShadowCaster(c);
  for (const r of receivers) r.receiveShadows = true;
  return sg;
}

/** ACES, one exposure dial, and a little desaturation in the shadows. */
export function applyGrade(scene: Scene, exposure = 1.0) {
  const ip = scene.imageProcessingConfiguration;
  ip.toneMappingEnabled = true;
  ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  ip.exposure = exposure;
  ip.contrast = 1.06;
  ip.vignetteEnabled = true;
  ip.vignetteWeight = 1.4;
  ip.vignetteStretch = 0.35;
}
