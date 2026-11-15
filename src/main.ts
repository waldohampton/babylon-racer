import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";

import { TUNE } from "./core/config";
import { Input } from "./core/input";
import { BicycleVehicle } from "./vehicle/bicycle";
import { buildWheels, spinWheels } from "./vehicle/wheels";
import { ChaseCamera } from "./camera/chase";
import { installHook } from "./test/hook";

const canvas = document.getElementById("c") as HTMLCanvasElement;
const engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(0.35, 0.45, 0.58, 1);

// --- world (M0 placeholder: flat plane, no track yet) ---
const ground = MeshBuilder.CreateGround("ground", { width: 600, height: 600 }, scene);
const gm = new StandardMaterial("gm", scene);
gm.diffuseColor = new Color3(0.24, 0.25, 0.24);
gm.specularColor = new Color3(0.02, 0.02, 0.02);
ground.material = gm;

// reference blocks so motion is readable before the track exists
const bm = new StandardMaterial("bm", scene);
bm.diffuseColor = new Color3(0.55, 0.42, 0.3);
for (let i = 0; i < 12; i++) {
  const b = MeshBuilder.CreateBox("ref" + i, { width: 6, height: 6 + (i % 3) * 4, depth: 6 }, scene);
  const ang = (i / 12) * Math.PI * 2;
  b.position.set(Math.cos(ang) * 60, b.getBoundingInfo().boundingBox.extendSize.y, Math.sin(ang) * 60);
  b.material = bm;
}

const sky = new HemisphericLight("sky", new Vector3(0, 1, 0), scene);
sky.intensity = 0.55;
sky.diffuse = new Color3(0.7, 0.78, 0.95);
sky.groundColor = new Color3(0.2, 0.19, 0.17);
const sun = new DirectionalLight("sun", new Vector3(-0.45, -1, -0.35), scene);
sun.intensity = 1.1;

// --- car ---
const car = new BicycleVehicle();
const root = new TransformNode("carRoot", scene);
const bodyMat = new StandardMaterial("body", scene);
bodyMat.diffuseColor = new Color3(0.72, 0.18, 0.16);
bodyMat.specularColor = new Color3(0.35, 0.35, 0.35);
const hull = MeshBuilder.CreateBox("hull", { width: 1.7, height: 0.62, depth: 4.2 }, scene);
hull.position.y = 0.66;
hull.material = bodyMat;
hull.parent = root;
const cabin = MeshBuilder.CreateBox("cabin", { width: 1.45, height: 0.52, depth: 1.9 }, scene);
cabin.position.set(0, 1.2, -0.25);
const cabinMat = new StandardMaterial("cabin", scene);
cabinMat.diffuseColor = new Color3(0.22, 0.24, 0.28);
cabin.material = cabinMat;
cabin.parent = root;
const wheels = buildWheels(scene, root, TUNE.tyreRadius);

const cam = new ChaseCamera(scene, new UniversalCamera("cam", new Vector3(0, 3, -8), scene));
const input = new Input();

let simTime = 0;
let paused = false;
let acc = 0;

function fixedStep(dt: number) {
  input.tick(dt);
  car.step(dt, input.state);
  const s = car.state();
  root.position.set(s.x, s.y, s.z);
  root.rotation.y = s.yaw;
  spinWheels(wheels, s.wheelSpin, s.steer);
  simTime += dt;
}

function advance(realDt: number) {
  if (paused) return;
  acc += Math.min(realDt, 0.25);
  let n = 0;
  while (acc >= TUNE.step && n++ < 5) {
    fixedStep(TUNE.step);
    acc -= TUNE.step;
  }
}

const hudSpeed = document.getElementById("spd") as HTMLElement;
const hudGear = document.getElementById("gear") as HTMLElement;

scene.onBeforeRenderObservable.add(() => {
  advance(engine.getDeltaTime() / 1000);
  const s = car.state();
  const kmh = Math.round(Math.abs(s.forwardSpeed) * 3.6);
  hudSpeed.textContent = String(kmh);
  hudGear.textContent = s.forwardSpeed < -0.3 ? "R" : kmh < 1 ? "N" : "D";
  cam.update(s, root, engine.getDeltaTime() / 1000);
});

engine.runRenderLoop(() => {
  scene.render();
  // read straight after the scene pass, before any other render() resets them
  (window as any).__calls = (engine as any)._drawCalls?.current ?? -1;
  (window as any).__tris = Math.round(scene.getActiveIndices() / 3);
});
window.addEventListener("resize", () => engine.resize());

installHook({ engine, scene, car, root, cam, input, fixedStep, setPaused: (p: boolean) => { paused = p; } });
