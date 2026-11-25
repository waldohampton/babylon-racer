import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Material } from "@babylonjs/core/Materials/material";
import type { Scene } from "@babylonjs/core/scene";
import { TUNE } from "../core/config";

export interface WheelRig {
  pivot: TransformNode; // holds steer (rotation.y)
  spin: TransformNode; // holds roll (rotation.x)
  mesh: Mesh; // the tyre itself, so it can cast a shadow
  front: boolean;
}

/**
 * pivot (steer about Y) -> spin (roll about X) -> cylinder laid on its side.
 * The cylinder's own axis is Y, so it is rotated 90 deg on Z once, inside the
 * spin node; that keeps roll on a clean single axis.
 */
export function buildWheels(scene: Scene, root: TransformNode, r: number, mat: Material): WheelRig[] {
  const halfTrack = 0.88;
  const halfBase = TUNE.wheelbase / 2;
  const out: WheelRig[] = [];

  for (const z of [halfBase, -halfBase]) {
    for (const x of [-halfTrack, halfTrack]) {
      const front = z > 0;
      const pivot = new TransformNode(`wPivot${x}${z}`, scene);
      pivot.parent = root;
      pivot.position.set(x, r, z);

      const spin = new TransformNode(`wSpin${x}${z}`, scene);
      spin.parent = pivot;

      const mesh = MeshBuilder.CreateCylinder(
        `wheel${x}${z}`,
        { height: 0.27, diameter: r * 2, tessellation: 20 },
        scene,
      );
      mesh.rotation.z = Math.PI / 2;
      mesh.material = mat;
      mesh.parent = spin;

      out.push({ pivot, spin, mesh, front });
    }
  }
  return out;
}

export function spinWheels(wheels: WheelRig[], spin: number, steer: number) {
  for (const w of wheels) {
    w.spin.rotation.x = spin;
    if (w.front) w.pivot.rotation.y = steer;
  }
}
