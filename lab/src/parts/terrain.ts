import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { LabCtx } from "../main";

/**
 * TERRAIN / DISTANCE. Owns the mesas, the ground out to the horizon, and the
 * fog settings that make distance read.
 *
 * PLACEHOLDER: two boxes standing in for mesas.
 */
export function installTerrain(ctx: LabCtx) {
  const { scene } = ctx;
  const m = new StandardMaterial("terrainPH", scene);
  m.diffuseColor = new Color3(0.34, 0.27, 0.22);
  for (const [x, z, w, h] of [
    [-140, 320, 220, 46],
    [180, 430, 260, 62],
  ]) {
    const b = MeshBuilder.CreateBox("mesaPH", { width: w, height: h, depth: 120 }, scene);
    b.position.set(x, h / 2 - 4, z);
    b.material = m;
  }
}
