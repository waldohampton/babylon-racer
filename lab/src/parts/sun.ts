import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import type { LabCtx } from "../main";

/**
 * SUN AND LIGHT RIG. Owns every light in the scene, photometric units, and the
 * exposure value that goes with them.
 *
 * PLACEHOLDER: one hemispheric fill and one directional sun, old-style
 * intensities. Replace with a photometric rig: sun at 5-10 degrees elevation,
 * warm (~3000K) from behind and right of the car, cool sky fill, exposure
 * calibrated so the ground band lands at luma 114 / warmth +53.
 */
export function installSun(ctx: LabCtx) {
  const { scene } = ctx;
  const fill = new HemisphericLight("fill", new Vector3(0, 1, 0), scene);
  fill.intensity = 0.5;
  fill.diffuse = new Color3(0.62, 0.7, 0.82);
  fill.groundColor = new Color3(0.28, 0.24, 0.19);

  const sun = new DirectionalLight("sun", new Vector3(-0.35, -0.22, 0.9), scene);
  sun.intensity = 1.0;
  sun.diffuse = new Color3(1.0, 0.78, 0.55);
}
