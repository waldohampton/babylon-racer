import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Engine } from "@babylonjs/core/Engines/engine";
import type { Scene } from "@babylonjs/core/scene";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { BicycleVehicle } from "../vehicle/bicycle";
import type { ChaseCamera } from "../camera/chase";
import type { Input } from "../core/input";

interface Deps {
  engine: Engine;
  scene: Scene;
  car: BicycleVehicle;
  root: TransformNode;
  cam: ChaseCamera;
  input: Input;
  fixedStep: (dt: number) => void;
  setPaused: (p: boolean) => void;
}

/**
 * Headless test seam. Kept in the shipped file: it costs nothing and every
 * later session needs it. sim() steps physics at an exact dt with no reliance
 * on requestAnimationFrame, which does not fire in a headless harness.
 */
export function installHook(d: Deps) {
  (window as any).RACER = {
    state: () => d.car.state(),
    sim: (n = 1, dt = 1 / 60) => {
      for (let i = 0; i < n; i++) d.fixedStep(dt);
      return d.car.state();
    },
    pause: (p: boolean) => d.setPaused(p),
    press: (code: string, down: boolean) => d.input.press(code, down),
    inputNow: () => ({ ...d.input.state }),
    place: (x: number, z: number, yaw = 0) => {
      d.car.place(x, z, yaw);
      d.cam.look(yaw);
      const s = d.car.state();
      d.root.position.set(s.x, s.y, s.z);
      d.root.rotation.y = s.yaw;
      return s;
    },
    /** world-space direction the car mesh actually points, derived by the engine */
    nose: () => d.root.getDirection(new Vector3(0, 0, 1)).asArray(),
    camState: () => ({ pos: d.cam.cam.position.asArray(), fov: (d.cam.cam.fov * 180) / Math.PI }),
    /** park the camera at a fixed viewpoint; call releaseCam() to resume the arm */
    freezeCam: (x: number, y: number, z: number, tx = 0, ty = 1, tz = 0) => {
      d.cam.frozen = true;
      d.cam.cam.position.set(x, y, z);
      d.cam.cam.setTarget(new Vector3(tx, ty, tz));
    },
    releaseCam: () => {
      d.cam.frozen = false;
    },
    dbg: () => ({
      fps: Math.round(d.engine.getFps()),
      meshes: d.scene.meshes.length,
      calls: (window as any).__calls,
      tris: (window as any).__tris,
    }),
    /** live handles, so a session can inspect what actually loaded */
    scene: () => d.scene,
    engine: () => d.engine,
  };
}
