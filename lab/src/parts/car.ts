import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { LabCtx } from "../main";

/**
 * CAR. Owns the vehicle mesh, its materials and its placement in the shot.
 *
 * PLACEHOLDER: boxes. Replace with a real GLB muscle car, positioned on the
 * centreline at the hero angle (nose toward camera-left, three-quarter front),
 * with glossy black clearcoat paint, chrome that catches the horizon, and dust
 * breaking up the lower panels.
 *
 * Expose the root as scene.getTransformNodeByName("carRoot") so the camera part
 * can frame it.
 */
export function installCar(ctx: LabCtx) {
  const { scene } = ctx;
  const root = new TransformNode("carRoot", scene);
  root.position.set(0, 0, 0);

  const paint = new StandardMaterial("carPaintPH", scene);
  paint.diffuseColor = new Color3(0.05, 0.05, 0.055);
  paint.specularColor = new Color3(0.6, 0.6, 0.6);

  const body = MeshBuilder.CreateBox("carBodyPH", { width: 1.9, height: 0.62, depth: 4.6 }, scene);
  body.position.y = 0.72;
  body.material = paint;
  body.parent = root;

  const cabin = MeshBuilder.CreateBox("carCabinPH", { width: 1.62, height: 0.5, depth: 1.9 }, scene);
  cabin.position.set(0, 1.26, -0.3);
  const glass = new StandardMaterial("carGlassPH", scene);
  glass.diffuseColor = new Color3(0.1, 0.12, 0.14);
  glass.specularColor = new Color3(0.9, 0.9, 0.9);
  cabin.material = glass;
  cabin.parent = root;

  const tyre = new StandardMaterial("carTyrePH", scene);
  tyre.diffuseColor = new Color3(0.045, 0.045, 0.05);
  for (const z of [1.45, -1.45]) {
    for (const x of [-0.95, 0.95]) {
      const w = MeshBuilder.CreateCylinder("carWheelPH", { height: 0.3, diameter: 0.74, tessellation: 20 }, scene);
      w.rotation.z = Math.PI / 2;
      w.position.set(x, 0.37, z);
      w.material = tyre;
      w.parent = root;
    }
  }
}
