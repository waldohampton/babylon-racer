import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";

import { installSky } from "./parts/sky";
import { installSun } from "./parts/sun";
import { installTerrain } from "./parts/terrain";
import { installRoad } from "./parts/road";
import { installCar } from "./parts/car";
import { installDust } from "./parts/dust";
import { installPost } from "./parts/post";
import { installCamera } from "./parts/camera";

export interface LabCtx {
  scene: Scene;
  engine: Engine;
  camera: UniversalCamera;
}

const canvas = document.getElementById("c") as HTMLCanvasElement;
const engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: true });
engine.setHardwareScalingLevel(1);

const scene = new Scene(engine);
scene.clearColor = new Color4(0.1, 0.12, 0.15, 1);

// Hero camera. Fixed framing so every part is judged in the same shot.
// Position is the three-quarter front-left viewpoint; setTarget is REQUIRED or
// a UniversalCamera just looks down +Z and frames empty ground.
const camera = new UniversalCamera("hero", new Vector3(4.6, 1.1, -5.9), scene);
camera.minZ = 0.1;
camera.maxZ = 4000;
camera.fov = (42 * Math.PI) / 180;
camera.setTarget(new Vector3(0, 0.85, 0));

const ctx: LabCtx = { scene, engine, camera };

installSky(ctx);
installSun(ctx);
installTerrain(ctx);
installRoad(ctx);
installCar(ctx);
installDust(ctx);
installPost(ctx);
installCamera(ctx);

scene.activeCamera = camera;

engine.runRenderLoop(() => scene.render());
window.addEventListener("resize", () => engine.resize());

(window as any).HERO = {
  scene,
  engine,
  camera,
  ready: false,
  stats: () => ({
    meshes: scene.meshes.length,
    materials: scene.materials.length,
    activeMeshes: scene.getActiveMeshes().length,
    tris: Math.round(scene.getActiveIndices() / 3),
    fps: Math.round(engine.getFps()),
    lights: scene.lights.map((l) => ({ name: l.name, type: l.getClassName(), intensity: (l as any).intensity })),
    cameras: scene.cameras.length,
  }),
  setFov: (deg: number) => {
    camera.fov = (deg * Math.PI) / 180;
  },
  /** harness seam: show only meshes whose name matches, so one surface can be
   * judged while other agents are rewriting theirs. HERO.isolate("") restores. */
  isolate: (keep: string) => {
    const re = new RegExp(keep);
    const hidden: string[] = [];
    for (const m of scene.meshes) {
      const want = keep === "" ? true : re.test(m.name);
      m.isVisible = want;
      if (!want) hidden.push(m.name);
    }
    return hidden.length;
  },
};
(window as any).HERO_READY = true;
document.getElementById("tag")!.textContent = "hero lab";
