// The car body. A placeholder box hull is built first so the game never boots
// without a car; when this model lands the boxes are hidden and the real body
// takes over. Wheels are the model's own nodes, spun about the car's X axis.
import { ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader";
import "@babylonjs/loaders/glTF/2.0";
import { Quaternion } from "@babylonjs/core/Maths/math.vector";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { asset } from "../core/assets";

export interface CarModel {
  root: TransformNode;
  wheels: { node: AbstractMesh; base: Quaternion }[];
  spin: (radians: number) => void;
}

/** nose orientation of the asset in our world: +Z is the car's forward */
const MODEL_YAW = Math.PI;

export async function loadCarModel(
  scene: Scene,
  parent: TransformNode,
  shadows: ShadowGenerator,
  url: string,
  clearCoat: boolean,
  onReady: () => void,
): Promise<CarModel | null> {
  let result;
  try {
    result = await ImportMeshAsync(url, scene);
  } catch (e) {
    console.warn("car model failed, placeholder stays", e);
    return null;
  }

  const root = result.meshes[0];
  root.parent = parent;
  root.rotation.y = MODEL_YAW;

  // seat it on the ground: the asset's own bbox, not a guessed offset
  root.computeWorldMatrix(true);
  const bounds = root.getHierarchyBoundingVectors(true);
  root.position.y -= bounds.min.y;

  const wheels: CarModel["wheels"] = [];
  const blackPaint = new Texture(asset("assets/car/body_basecolor_black.jpg"), scene);
  blackPaint.gammaSpace = true;
  blackPaint.anisotropicFilteringLevel = 4;

  for (const m of result.meshes) {
    if (!m.getTotalVertices()) continue;
    m.receiveShadows = true;
    shadows.addShadowCaster(m as Mesh);

    // the stock atlas is butter yellow with stripes; this derivative keeps its
    // baked shading but remaps the paint islands to near-black, so the car is
    // black without losing the panel detail
    const mat = m.material as any;
    if (mat && /body_pbr/i.test(mat.name)) {
      // black paint with a clear coat: without the coat a black body is the one
      // surface with no readable shape, because it only shows what it reflects
      if (mat.albedoTexture) mat.albedoTexture = blackPaint;
      if (clearCoat && mat.clearCoat) {
        mat.clearCoat.isEnabled = true;
        mat.clearCoat.intensity = 0.9;
        mat.clearCoat.roughness = 0.1;
      }
    }

    if (/wheel_(fl|fr|rl|rr)/i.test(m.name)) {
      if (!m.rotationQuaternion) m.rotationQuaternion = Quaternion.FromEulerVector(m.rotation);
      wheels.push({ node: m, base: m.rotationQuaternion.clone() });
    }
  }

  const spinAxis = new Vector3(1, 0, 0);
  const spin = (radians: number) => {
    const q = Quaternion.RotationAxis(spinAxis, radians);
    for (const w of wheels) w.node.rotationQuaternion = w.base.multiply(q);
  };

  onReady();
  return { root, wheels, spin };
}
