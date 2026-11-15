import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import type { Scene } from "@babylonjs/core/scene";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { TUNE } from "../core/config";
import type { VehicleState } from "../vehicle/types";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Chase camera. Spring arm behind the car, look-at a few metres ahead so the
 * road leads the frame. Ray pull-in against level meshes comes in M4; on a flat
 * plane there is nothing to pull in against, so this is position + lens only.
 */
export class ChaseCamera {
  yaw = 0;
  pitch = 0.14;
  private pos = new Vector3(0, 3, -8);
  private dist = TUNE.chase.dist;
  private fovWait = 0;
  /** test seam: stop the arm tracking so a fixed viewpoint can be inspected */
  frozen = false;

  constructor(private scene: Scene, public cam: UniversalCamera) {
    cam.minZ = 0.1;
    cam.maxZ = 2000;
    cam.fov = (TUNE.chase.fovBase * Math.PI) / 180;
  }

  /** aim the arm at a heading without waiting for the auto-swing */
  look(yaw: number) {
    this.yaw = yaw;
    this.fovWait = 0;
  }

  update(v: VehicleState, root: TransformNode, dt: number) {
    if (this.frozen) return;
    const C = TUNE.chase;

    // swing back behind the car after a moment at speed
    if (v.speed > 1.5) {
      const want = v.yaw;
      let d = want - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const rate = clamp(1.2 + v.speed * 0.05, 1.2, 2.6);
      this.yaw += clamp(d, -rate * dt, rate * dt);
    }

    const ahead = new Vector3(Math.sin(v.yaw), 0, Math.cos(v.yaw));
    // NOTE: +Z is the car's nose, so "behind" is minus the nose
    const armX = -Math.sin(this.yaw) * this.dist;
    const armZ = -Math.cos(this.yaw) * this.dist;
    const want = new Vector3(v.x + armX, C.height, v.z + armZ);

    const k = 1 - Math.exp(-C.posLerp * dt);
    this.pos = Vector3.Lerp(this.pos, want, k);
    this.cam.position.copyFrom(this.pos);

    const target = new Vector3(
      v.x + ahead.x * C.lookAhead,
      C.lookHeight,
      v.z + ahead.z * C.lookAhead,
    );
    this.cam.setTarget(target);

    // lens opens with speed: the free speed cue
    const t = clamp(v.speed / 30, 0, 1);
    const wantFov = ((C.fovBase + (C.fovSpeed - C.fovBase) * t) * Math.PI) / 180;
    const lk = 1 - Math.exp(-C.fovLerp * dt);
    this.cam.fov += (wantFov - this.cam.fov) * lk;
    this.cam.getProjectionMatrix(true);
  }
}
