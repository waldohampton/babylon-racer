import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { LabCtx } from "../main";

/**
 * ROAD AND SHOULDER. Owns the asphalt ribbon, the painted centreline, the
 * shoulder and verge, and every material on them.
 *
 * PLACEHOLDER: one grey plane. Replace with a photographed asphalt surface:
 * cracked aggregate at two tile scales with a normal map, faded double yellow
 * with a dirt alpha overlay, and the shoulder treated as ground.
 */
export function installRoad(ctx: LabCtx) {
  const { scene } = ctx;
  const g = MeshBuilder.CreateGround("groundPH", { width: 900, height: 900 }, scene);
  const m = new StandardMaterial("roadPH", scene);
  m.diffuseColor = new Color3(0.26, 0.25, 0.23);
  m.specularColor = new Color3(0.03, 0.03, 0.03);
  g.material = m;
}
