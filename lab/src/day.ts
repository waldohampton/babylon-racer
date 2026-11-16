/**
 * DAY LAB — the retargeted scene.
 *
 * The user's reference is a Babylon.js WebGPU desert flythrough: daylight, hard
 * sun shadows, aerial perspective, dense instanced ground cover, HDR post with
 * bloom and tonemapping. This file builds that baseline rather than the moody
 * hero still (see lab/src/main.ts, kept for reference).
 *
 * Deliberate choices, and why:
 *  - Plain WebGL2 engine. WebGPU is available (verified: Windows Chrome on this
 *    machine reports vendor amd / arch gcn-5 / device true) but Babylon's
 *    WebGPU path changes shader compilation and would add a second source of
 *    breakage while the look is still being found. Switch engines after the
 *    frame is good, not before.
 *  - Distance fog from Babylon's own EXP2 fog, not a custom height-fog post
 *    pass. At a 2 m camera on flat ground, height fog and distance fog differ by
 *    almost nothing, and the built-in one is applied per material with no depth
 *    plumbing to get wrong. The earlier storm lab proved how much damage a
 *    hand-rolled atmosphere term does when its units are wrong.
 *  - Exposure is the ONE dial. Lights are set so that midday sunlit dirt lands
 *    near the reference's brightness with exposure at 1.0.
 */
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3, Matrix } from "@babylonjs/core/Maths/math.vector";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator";
import { HDRCubeTexture } from "@babylonjs/core/Materials/Textures/hdrCubeTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";

import type { LabCtx } from "./main";
import { installRoad } from "./parts/road";
import { installCar } from "./parts/car";

const canvas = document.getElementById("c") as HTMLCanvasElement;
const engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: true });
engine.setHardwareScalingLevel(1);

const scene = new Scene(engine);
scene.clearColor = new Color4(0.55, 0.68, 0.85, 1);

// ---------------------------------------------------------------- atmosphere
// Sunny desert haze. Colour sampled from the daylight HDRI's own horizon band so
// the distance resolves to the sky instead of to a painted gradient.
const FOG_COLOUR = new Color3(0.74, 0.78, 0.82);
const FOG_DENSITY = 3.4e-4;
scene.fogMode = Scene.FOGMODE_EXP2;
scene.fogColor = FOG_COLOUR;
scene.fogDensity = FOG_DENSITY;

// ------------------------------------------------------------------- camera
// Low, road-level, three-quarter behind the car: the reference flythrough's
// viewpoint, and the angle that shows the ground off best.
const camera = new UniversalCamera("day", new Vector3(5.2, 2.05, -7.2), scene);
camera.minZ = 0.1;
camera.maxZ = 30000;
camera.fov = (42 * Math.PI) / 180;
camera.setTarget(new Vector3(0, 0.75, 0.6));

// ---------------------------------------------------------------------- sky
const SKY_LEVEL = 1.0;
const ENV_LEVEL = 1.0;
const dome = new HDRCubeTexture("/assets/sky/day_desert_2k.hdr", scene, 512, false, false, true);
const skyMat = new StandardMaterial("daySky", scene);
skyMat.backFaceCulling = false;
skyMat.disableLighting = true;
skyMat.reflectionTexture = dome;
skyMat.reflectionTexture.coordinatesMode = Texture.SKYBOX_MODE;
skyMat.diffuseColor = new Color3(0, 0, 0);
skyMat.specularColor = new Color3(0, 0, 0);
skyMat.disableDepthWrite = true;
skyMat.fogEnabled = false;
skyMat.diffuseTexture = null;
const skybox = MeshBuilder.CreateBox("skyBox", { size: 12000 }, scene);
skybox.material = skyMat;
skybox.infiniteDistance = true;
skybox.isPickable = false;
skybox.applyFog = false;
dome.level = SKY_LEVEL;

const envTex = new HDRCubeTexture("/assets/sky/day_desert_2k.hdr?ibl=1", scene, 256, false, true, false, true, true);
envTex.level = ENV_LEVEL;
scene.environmentTexture = envTex;
scene.environmentIntensity = 1.15;

// ---------------------------------------------------------------------- sun
// ~32 degrees up, coming from the right and slightly behind the camera so the
// car is lit three-quarter and the ruts cast across the road.
const sun = new DirectionalLight("daySun", new Vector3(-0.52, -0.62, -0.58).normalize(), scene);
sun.position = new Vector3(120, 140, 130);
sun.diffuse = new Color3(1.0, 0.955, 0.88);
sun.intensity = 4.2;
sun.shadowMinZ = 1;
sun.shadowMaxZ = 400;

const csm = new CascadedShadowGenerator(2048, sun);
csm.numCascades = 3;
csm.lambda = 0.9;
csm.shadowMaxZ = 220;
csm.usePercentageCloserFiltering = true;
csm.filteringQuality = CascadedShadowGenerator.QUALITY_MEDIUM;
csm.bias = 0.0012;
csm.normalBias = 0.012;
csm.darkness = 0.0;

// Sky bounce. Kept low: the environment map already supplies most of it, and
// doubling it is what washed the storm scene out.
const sky = new HemisphericLight("dayFill", new Vector3(0, 1, 0), scene);
sky.intensity = 0.85;
sky.diffuse = new Color3(0.58, 0.68, 0.86);
sky.groundColor = new Color3(0.42, 0.34, 0.26);
sky.specular = new Color3(0, 0, 0);

const ctx: LabCtx = { scene, engine, camera };

// ------------------------------------------------------------------ surfaces
// The road/verge/clutter suite built for the storm lab is reused as-is: it is
// already PBR with 4k near-field scans and a world-space crack network. It will
// need its palette re-tuned for daylight, but the geometry is sound.
installRoad(ctx);

// Far ground: one big plane so the horizon never shows an edge.
{
  const g = MeshBuilder.CreateGround("farGround", { width: 9000, height: 9000, subdivisions: 2 }, scene);
  g.position.y = -0.02;
  const m = new PBRMaterial("farGroundMat", scene);
  const dirt = new Texture("/assets/road/dirt_albedo.jpg", scene);
  dirt.uScale = 900;
  dirt.vScale = 900;
  dirt.anisotropicFilteringLevel = 8;
  m.albedoTexture = dirt;
  m.albedoColor = new Color3(0.62, 0.52, 0.40);
  m.metallic = 0;
  m.roughness = 0.95;
  g.material = m;
  g.isPickable = false;
}

installCar(ctx);

// --------------------------------------------------------------- ground cover
// Instanced scatter is most of what makes the reference read as a place rather
// than a plane: every square metre of verge carries dry grass, and rocks break
// the ground plane along the skyline. Thin instances, one draw call each.

function grassTexture(): DynamicTexture {
  const s = 128;
  const dt = new DynamicTexture("grassCard", { width: s, height: s }, scene, true);
  const c = dt.getContext() as unknown as CanvasRenderingContext2D;
  c.clearRect(0, 0, s, s);
  for (let i = 0; i < 26; i++) {
    const x = 8 + Math.random() * (s - 16);
    const w = 1 + Math.random() * 2;
    const h = s * (0.45 + Math.random() * 0.5);
    const lean = (Math.random() - 0.5) * 18;
    // dry straw: no green anywhere, the reference verge is dead grass
    const v = 120 + Math.floor(Math.random() * 70);
    c.strokeStyle = `rgba(${v},${v - 18},${v - 46},${0.65 + Math.random() * 0.35})`;
    c.lineWidth = w;
    c.beginPath();
    c.moveTo(x, s);
    c.quadraticCurveTo(x + lean * 0.4, s - h * 0.55, x + lean, s - h);
    c.stroke();
  }
  dt.update(true);
  dt.hasAlpha = true;
  return dt;
}

function crossCard(name: string, tex: DynamicTexture): Mesh {
  const a = MeshBuilder.CreatePlane(name + "_a", { size: 1 }, scene);
  const b = MeshBuilder.CreatePlane(name + "_b", { size: 1 }, scene);
  b.rotation.y = Math.PI / 2;
  const merged = Mesh.MergeMeshes([a, b], true, true, undefined, false, false) as Mesh;
  merged.name = name;
  const m = new StandardMaterial(name + "Mat", scene);
  // Foliage cards MUST be self-lit. A crossed quad has its normal facing one way,
  // so half of every card faces away from the sun and lights to black. Driving
  // the colour from the texture as emissive keeps the straw colour on both, and
  // the fog plus shadows still place it in the world.
  m.emissiveTexture = tex;
  m.emissiveColor = new Color3(0.55, 0.5, 0.4);
  m.diffuseTexture = tex;
  m.diffuseTexture.hasAlpha = true;
  m.useAlphaFromDiffuseTexture = true;
  m.transparencyMode = 1; // alpha test
  m.alphaCutOff = 0.28;
  m.backFaceCulling = false;
  m.diffuseColor = new Color3(0.35, 0.33, 0.28);
  m.specularColor = new Color3(0.02, 0.02, 0.02);
  merged.material = m;
  merged.isPickable = false;
  return merged;
}

/** Scatter on both verges only: the road runs along Z, so anything with |x| < 7
 *  would stand in the middle of the asphalt. */
function scatterVerges(mesh: Mesh, count: number, inner: number, outer: number, zFrom: number, zTo: number, sMin: number, sMax: number) {
  const mats = new Float32Array(count * 16);
  const rot = new Matrix();
  const scl = new Matrix();
  const tra = new Matrix();
  for (let i = 0; i < count; i++) {
    const side = Math.random() < 0.5 ? -1 : 1;
    // quadratic falloff so the near field is dense and the far field thins out
    const t = Math.random();
    const x = side * (inner + (outer - inner) * t * t);
    const z = zFrom + (zTo - zFrom) * Math.random();
    const s = sMin + Math.random() * (sMax - sMin);
    Matrix.RotationYToRef(Math.random() * Math.PI * 2, rot);
    Matrix.ScalingToRef(s, s * (0.8 + Math.random() * 0.5), s, scl);
    Matrix.TranslationToRef(x, s * 0.34, z, tra);
    scl.multiply(rot).multiply(tra).copyToArray(mats, i * 16);
  }
  mesh.thinInstanceSetBuffer("matrix", mats, 16, false);
  mesh.thinInstanceRefreshBoundingInfo(false);
}

const grass = crossCard("vergeGrass", grassTexture());
scatterVerges(grass, 9000, 6.5, 140, -240, 60, 0.24, 0.8);

// ------------------------------------------------------------------ post
const pipe = new DefaultRenderingPipeline("dayPipe", true, scene, [camera]);
pipe.samples = 4; // MSAA, because a flythrough lives or dies on clean edges
pipe.fxaaEnabled = true;
pipe.imageProcessing.toneMappingEnabled = true;
pipe.imageProcessing.toneMappingType = 1; // ACES
pipe.imageProcessing.exposure = 1.0;
pipe.imageProcessing.contrast = 1.02;
pipe.imageProcessing.vignetteEnabled = true;
pipe.imageProcessing.vignetteWeight = 0.6;
pipe.bloomEnabled = true;
pipe.bloomThreshold = 0.92;
pipe.bloomWeight = 0.18;
pipe.bloomKernel = 32;

scene.activeCamera = camera;

// --------------------------------------------------------------- shadows
for (const m of scene.meshes) {
  if (/car|wheel|body|glass|stone|pebble/i.test(m.name) && !/sky/i.test(m.name)) {
    csm.addShadowCaster(m, false);
  }
}

engine.runRenderLoop(() => scene.render());
window.addEventListener("resize", () => engine.resize());

(window as any).HERO = {
  scene,
  engine,
  camera,
  stats: () => ({
    meshes: scene.meshes.length,
    activeMeshes: scene.getActiveMeshes().length,
    tris: Math.round(scene.getActiveIndices() / 3),
    fps: Math.round(engine.getFps()),
    lights: scene.lights.map((l) => ({ name: l.name, intensity: (l as any).intensity })),
  }),
  isolate: (keep: string) => {
    const re = new RegExp(keep);
    for (const m of scene.meshes) m.isVisible = keep === "" ? true : re.test(m.name);
  },
  setFov: (deg: number) => {
    camera.fov = (deg * Math.PI) / 180;
  },
  tune: (o: Record<string, number>) => {
    if (o.fogDensity !== undefined) scene.fogDensity = o.fogDensity;
    if (o.exposure !== undefined) pipe.imageProcessing.exposure = o.exposure;
    if (o.sun !== undefined) sun.intensity = o.sun;
    if (o.env !== undefined) scene.environmentIntensity = o.env;
  },
};

window.HERO_READY = true;
