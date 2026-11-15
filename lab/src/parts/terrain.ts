import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene as SceneType } from "@babylonjs/core/scene";
import { Scene } from "@babylonjs/core/scene";
import type { LabCtx } from "../main";

/**
 * TERRAIN / DISTANCE. Owns the mesas, the ground out to the horizon, and the
 * fog settings that make distance read.
 *
 * The mesas are lofted eroded prisms, not boxes: a box has a silhouette the eye
 * names instantly, and at 200 m wide it reads as a building. Radius is
 * modulated by layered sines in theta (so the wall line wanders the way rock
 * does) and again by height (so there are ledges), the top is uneven, and each
 * mesa carries a real 18.3 m cliff scan at a physical tile size.
 *
 * Scan: Poly Haven "cliff_side", CC0, dimensions 1830 cm. Every number below is
 * arithmetic from that, not taste.
 */

const TILE_M = 18.3;

/** layered sines: smooth, non-repeating silhouette noise over the angle */
function rim(theta: number, seed: number) {
  return (
    0.55 * Math.sin(theta * 3.0 + seed * 1.7) +
    0.28 * Math.sin(theta * 7.3 + seed * 3.1) +
    0.17 * Math.sin(theta * 13.7 + seed * 5.3)
  );
}

interface MesaSpec {
  x: number;
  z: number;
  radius: number;
  height: number;
  aspect: number; // x stretch, so a mesa is a ridge rather than a drum
  seed: number;
  tile?: number; // metres of rock per texture repeat; bigger for far mesas
}

function buildMesa(scene: SceneType, s: MesaSpec, material: PBRMaterial): Mesh {
  const N = 44; // radial segments
  const RINGS = 9;
  const pos: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];

  const circumference = 2 * Math.PI * s.radius * s.aspect;
  const tile = s.tile ?? TILE_M;

  for (let i = 0; i < RINGS; i++) {
    const t = i / (RINGS - 1);
    // near vertical, slightly narrower at the top, a touch wider at the debris
    // apron around the base
    const taper = 1 - 0.07 * t + 0.05 * Math.exp(-t * 9);
    for (let j = 0; j <= N; j++) {
      const theta = (j / N) * Math.PI * 2;
      const wobble = 1 + 0.135 * rim(theta, s.seed) + 0.035 * Math.sin(t * 8.5 + s.seed * 2.3);
      const r = s.radius * taper * wobble;
      const x = Math.cos(theta) * r * s.aspect;
      const z = Math.sin(theta) * r;
      // uneven top: the wall line does not sit at one height
      const y = s.height * t + (t > 0.75 ? (t - 0.75) * 9 * rim(theta * 1.7, s.seed + 4) : 0);
      pos.push(x, y, z);
      uvs.push((theta / (Math.PI * 2)) * (circumference / tile), y / tile);
    }
  }

  // side quads. Winding matters: Babylon culls back faces, and with the order
  // reversed the whole mesa renders inside-out and disappears. Verified by
  // toggling backFaceCulling and watching the silhouette appear and vanish.
  for (let i = 0; i < RINGS - 1; i++) {
    for (let j = 0; j < N; j++) {
      const a = i * (N + 1) + j;
      const b = a + 1;
      const c = a + (N + 1);
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }

  // flat cap, fanned from the centre of the top ring
  const topRow = (RINGS - 1) * (N + 1);
  let capY = 0;
  for (let j = 0; j <= N; j++) capY += pos[(topRow + j) * 3 + 1];
  capY /= N + 1;
  const capCentre = pos.length / 3;
  pos.push(0, capY, 0);
  uvs.push(0.5 * (circumference / tile), (capY / tile) * 0.4);
  for (let j = 0; j < N; j++) idx.push(capCentre, topRow + j + 1, topRow + j);

  const mesh = new Mesh(`mesa_${s.seed}`, scene);
  const vd = new VertexData();
  vd.positions = pos;
  vd.indices = idx;
  vd.uvs = uvs;
  const normals: number[] = [];
  VertexData.ComputeNormals(pos, idx, normals);
  vd.normals = normals;
  vd.applyToMesh(mesh);

  mesh.material = material;
  mesh.position.set(s.x, -3, s.z); // sunk a little so the base apron is buried
  return mesh;
}

export function installTerrain(ctx: LabCtx) {
  const { scene } = ctx;

  // Aerial perspective. Linear fog matched toward the sky's horizon colour, so
  // distance dissolves instead of ending on a straight line. The sky dome opts
  // out of fog in sky.ts, which is why this does not grey the sky out.
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogColor = new Color3(0.42, 0.375, 0.33);
  scene.fogStart = 140;
  scene.fogEnd = 780;

  const rock = new PBRMaterial("mesaRock", scene);
  rock.albedoTexture = new Texture("/assets/terrain/cliff_diff.jpg", scene);
  rock.bumpTexture = new Texture("/assets/terrain/cliff_nor.jpg", scene);
  rock.metallicTexture = new Texture("/assets/terrain/cliff_rough.jpg", scene);
  rock.useRoughnessFromMetallicTextureGreen = true;
  rock.useMetallnessFromMetallicTextureBlue = false;
  rock.useAmbientOcclusionFromMetallicTextureRed = false;
  rock.metallic = 0;
  rock.roughness = 0.95;
  rock.bumpTexture.level = 1.15;
  // the scan is a photograph of already-lit rock: pull the level and warmth back
  // or the haze and the sun double up on it
  rock.albedoColor = new Color3(0.72, 0.68, 0.64);
  rock.backFaceCulling = false;

  // buttes spread over several depths, so the horizon has structure instead of
  // one flat wall
  const mesas: MesaSpec[] = [
    { x: -170, z: 210, radius: 34, height: 74, aspect: 1.5, seed: 1.3, tile: 18.3 },
    { x: 205, z: 290, radius: 46, height: 96, aspect: 1.3, seed: 2.9, tile: 26 },
    { x: -40, z: 430, radius: 58, height: 62, aspect: 1.8, seed: 4.1, tile: 34 },
    { x: -360, z: 390, radius: 40, height: 44, aspect: 1.2, seed: 5.7, tile: 30 },
    { x: 420, z: 470, radius: 52, height: 70, aspect: 1.4, seed: 7.3, tile: 38 },
    { x: 60, z: 690, radius: 78, height: 88, aspect: 1.6, seed: 9.1, tile: 52 },
  ];
  for (const m of mesas) buildMesa(scene, m, rock);
}
