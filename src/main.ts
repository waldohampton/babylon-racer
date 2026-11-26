import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";

import { TUNE } from "./core/config";
import { Input } from "./core/input";
import { BicycleVehicle } from "./vehicle/bicycle";
import { buildWheels, spinWheels } from "./vehicle/wheels";
import { ChaseCamera } from "./camera/chase";
import { installHook } from "./test/hook";
import { loadCarModel, type CarModel } from "./vehicle/model";
import { asset } from "./core/assets";
import { pickTier } from "./core/quality";
import { installTouchControls } from "./core/touch";
import {
  TILE,
  scannedMaterial,
  paintMaterial,
  rubberMaterial,
  glassMaterial,
  installSky,
  installSunShadows,
  applyGrade,
  type ScanSet,
} from "./render/look";

const canvas = document.getElementById("c") as HTMLCanvasElement;
const tier = pickTier();

const engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: true }, true);
// adaptToDeviceRatio handles a retina screen; the cap stops a 3x phone paying
// 2.25x the fragments of 2x for something nobody can see on a 6 inch screen
engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, tier.dprCap));
const scene = new Scene(engine);
scene.clearColor = new Color4(0.35, 0.45, 0.58, 1);

// --- light first, so everything below has something real to catch --------
// A photographed sky is both the background and the PBR light probe. No
// hemispheric cheat light: the HDRI is the ambient, which is why paint and
// sand stop looking like flat plastic.
installSky(scene, asset("hdri/clear_1k.hdr"));

// Sun over the driver's left shoulder: the faces the chase cam sees are lit
// and the shadow falls away to screen right instead of hiding under the car.
const SUN_DIR = new Vector3(0.5, -0.9, 0.3);
const sun = new DirectionalLight("sun", SUN_DIR, scene);
sun.intensity = 3.4;
sun.diffuse = new Color3(1.0, 0.96, 0.9);
// the shadow frustum is centred on the light's position, so the offset is
// moved with the car every frame (see the render observer below)
const SUN_FRAME_OFFSET = SUN_DIR.scale(-50);

// distance haze, so the plane has no visible edge (400 m on the phone tier)
scene.fogMode = Scene.FOGMODE_EXP2;
scene.fogDensity = tier.fogDensity;
scene.fogColor = new Color3(0.63, 0.66, 0.7);

// --- world (M0 placeholder: flat scanned ground, no track yet) -----------
const ground = MeshBuilder.CreateGround("ground", { width: tier.planeSize, height: tier.planeSize }, scene);
const sandSet: ScanSet = { albedo: tier.groundAlbedo, normal: tier.groundNormal, arm: asset("tex/ground_sand_arm.jpg") };
ground.material = scannedMaterial(scene, "sand", sandSet, TILE.sand, tier.planeSize);

// reference blocks so motion is readable before the track exists
const concreteSet: ScanSet = {
  albedo: asset("tex/block_concrete_diff.jpg"),
  normal: asset("tex/block_concrete_nor.jpg"),
  arm: asset("tex/block_concrete_arm.jpg"),
};
const blockMat = scannedMaterial(scene, "concrete", concreteSet, TILE.concrete, 6);
const blocks = [];
for (let i = 0; i < 12; i++) {
  const b = MeshBuilder.CreateBox("ref" + i, { width: 6, height: 6 + (i % 3) * 4, depth: 6 }, scene);
  const ang = (i / 12) * Math.PI * 2;
  b.position.set(Math.cos(ang) * 60, b.getBoundingInfo().boundingBox.extendSize.y, Math.sin(ang) * 60);
  b.material = blockMat;
  blocks.push(b);
}

// --- car -----------------------------------------------------------------
const car = new BicycleVehicle();
const root = new TransformNode("carRoot", scene);

const hull = MeshBuilder.CreateBox("hull", { width: 1.7, height: 0.62, depth: 4.2 }, scene);
hull.position.y = 0.66;
hull.material = paintMaterial(scene, "paint", new Color3(0.36, 0.04, 0.03), tier.clearCoat);
hull.parent = root;

const cabin = MeshBuilder.CreateBox("cabin", { width: 1.45, height: 0.52, depth: 1.9 }, scene);
cabin.position.set(0, 1.2, -0.25);
cabin.material = glassMaterial(scene);
cabin.parent = root;

const wheels = buildWheels(scene, root, TUNE.tyreRadius, rubberMaterial(scene));

const shadows = installSunShadows(
  scene,
  sun,
  [hull, cabin, ...wheels.map((w) => w.mesh), ...blocks],
  [ground, ...blocks],
  tier.shadowSize,
  tier.shadowBlur,
);

// the real body replaces the boxes once it has loaded; the boxes stay as the
// fallback if the asset 404s, and physics does not care either way
let model: CarModel | null = null;
loadCarModel(scene, root, shadows, tier.carModel, tier.clearCoat, () => {
  hull.setEnabled(false);
  cabin.setEnabled(false);
  for (const w of wheels) w.pivot.setEnabled(false);
}).then((m) => {
  model = m;
});

applyGrade(scene, 1.0);

const cam = new ChaseCamera(scene, new UniversalCamera("cam", new Vector3(0, 3, -8), scene));
const input = new Input();
installTouchControls(input);

let simTime = 0;
let paused = false;
let acc = 0;
// above this many physics steps in one frame, the frame is late: better to run
// slightly slow than to bank a backlog that never drains
const MAX_STEPS = 8;
let prevX = 0, prevZ = 0, prevYaw = 0, prevSpin = 0;
let curX = 0, curZ = 0, curYaw = 0, curSpin = 0;

function fixedStep(dt: number) {
  input.tick(dt);
  // snapshot before stepping, so the renderer can interpolate between the last
  // two physics states instead of jumping to the newest one
  prevX = curX;
  prevZ = curZ;
  prevYaw = curYaw;
  prevSpin = curSpin;

  car.step(dt, input.state);
  const s = car.state();
  curX = s.x;
  curZ = s.z;
  curYaw = s.yaw;
  curSpin = s.wheelSpin;

  // headless tests read the root straight after sim(); the render observer
  // overwrites this with the interpolated pose every frame
  root.position.set(s.x, s.y, s.z);
  root.rotation.y = s.yaw;
  spinWheels(wheels, s.wheelSpin, s.steer);
  // the model's wheels roll the other way round from our accumulator sign
  if (model) {
    model.spin(-s.wheelSpin);
    model.steer(s.steer);
  }
  simTime += dt;
}

/** pose to draw this frame: between the last two physics states */
function renderPose() {
  const a = paused ? 1 : Math.min(1, Math.max(0, acc / TUNE.step));
  let dy = curYaw - prevYaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  const yaw = prevYaw + dy * a;
  const x = prevX + (curX - prevX) * a;
  const z = prevZ + (curZ - prevZ) * a;
  const spin = prevSpin + (curSpin - prevSpin) * a;
  root.position.set(x, 0, z);
  root.rotation.y = yaw;
  spinWheels(wheels, spin, car.state().steer);
  if (model) {
    model.spin(-spin);
    model.steer(car.state().steer); // input, not physics: no need to interpolate
  }
  return { x, z, yaw };
}

/** drop the snapshots onto the live car state, for teleports (place/reset) */
function resyncPose() {
  const s = car.state();
  prevX = curX = s.x;
  prevZ = curZ = s.z;
  prevYaw = curYaw = s.yaw;
  prevSpin = curSpin = s.wheelSpin;
}

function advance(realDt: number) {
  if (paused) return;
  acc += Math.min(realDt, 0.25);
  let n = 0;
  while (acc >= TUNE.step && n < MAX_STEPS) {
    fixedStep(TUNE.step);
    acc -= TUNE.step;
    n++;
  }
  // A device that cannot keep up would otherwise bank the backlog forever: the
  // accumulator grows, alpha pins at 1, interpolation does nothing, and the car
  // runs in permanent slow motion. Drop the excess and let it be slow instead.
  if (acc >= TUNE.step) acc = 0;
}

const hudSpeed = document.getElementById("spd") as HTMLElement;
const hudGear = document.getElementById("gear") as HTMLElement;

scene.onBeforeRenderObservable.add(() => {
  const dt = engine.getDeltaTime() / 1000;
  advance(dt);
  const s = car.state();
  // draw between the last two physics states; without this the body jumps a
  // whole step per frame at whatever rate the display runs, which is the judder
  const pose = renderPose();
  const kmh = Math.round(Math.abs(s.forwardSpeed) * 3.6);
  hudSpeed.textContent = String(kmh);
  hudGear.textContent = s.forwardSpeed < -0.3 ? "R" : kmh < 1 ? "N" : "D";
  cam.update({ ...s, x: pose.x, z: pose.z, yaw: pose.yaw }, root, dt);
  // keep the 70 m shadow box on the car
  sun.position.copyFromFloats(pose.x + SUN_FRAME_OFFSET.x, SUN_FRAME_OFFSET.y, pose.z + SUN_FRAME_OFFSET.z);
});

// Warm-up frames: the first render after the sky prefilter and the PBR shader
// compile can clear the canvas and draw nothing, which frames the game as a
// flat colour. A few passes at boot costs a couple of hundred ms and means the
// first composite has content in it.
for (let i = 0; i < 4; i++) scene.render();

engine.runRenderLoop(() => {
  try {
    scene.render();
  } catch (e) {
    // a throw inside the render function kills Babylon's frame chain: the loop
    // re-registers only after the callback returns, so one exception means a
    // frozen canvas with no visible error. Surface it and stop cleanly.
    engine.stopRenderLoop();
    const el = document.getElementById("err");
    if (el) {
      el.style.display = "block";
      el.textContent = "RENDER ERROR\n" + ((e as Error)?.stack || String(e));
    }
    console.error("render error", e);
    return;
  }
  // read straight after the scene pass, before any other render() resets them
  (window as any).__calls = (engine as any)._drawCalls?.current ?? -1;
  (window as any).__tris = Math.round(scene.getActiveIndices() / 3);
});
window.addEventListener("resize", () => engine.resize());

installHook({ engine, scene, car, root, cam, input, fixedStep, setPaused: (p: boolean) => { paused = p; }, resync: resyncPose });
