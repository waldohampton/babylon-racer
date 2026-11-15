import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import type { LabCtx } from "../main";

/**
 * DUST AND ATMOSPHERE. Owns the low haze and the dust plume.
 *
 * Why this part exists, measured rather than guessed: with the horizon at
 * fy 0.352, the strip just below it is bare saturated dirt at 30-300 m, which
 * measured saturation 70 percent and warmth +62 against the reference's
 * 29 percent and +0.7. The plate gets that from aerial perspective: dust
 * hanging in the first few hundred metres desaturates distance while leaving
 * the near ground warm. Scene fog cannot do it — a density that hazes 200 m
 * also erases the car.
 *
 * So: a stack of large soft unlit planes at grazing heights. From a 2 m camera
 * they thicken toward the horizon the way real ground haze does, at one draw
 * call each.
 */

const HAZE_COLOUR = new Color3(0.30, 0.285, 0.262); // warm neutral, near the measured fog colour

/** [height m, radius m, alpha] — every layer must sit BELOW the 2.11 m camera,
 *  or it becomes a ceiling over the sky. They read as a band because perspective
 *  compresses them toward the horizon. */
const LAYERS: [number, number, number][] = [
  [0.35, 1200, 0.025],
  [0.75, 2400, 0.030],
  [1.25, 4200, 0.035],
  [1.70, 6500, 0.040],
];

function radialTexture(name: string, scene: LabCtx["scene"], centre: number, mid: number) {
  const size = 512;
  const dt = new DynamicTexture(name, { width: size, height: size }, scene, false);
  const ctx = dt.getContext() as unknown as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.04, size / 2, size / 2, size * 0.5);
  g.addColorStop(0.0, `rgba(255,255,255,${centre})`);
  g.addColorStop(0.55, `rgba(255,255,255,${mid})`);
  g.addColorStop(1.0, "rgba(255,255,255,0.0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  dt.update(true);
  dt.hasAlpha = true;
  return dt;
}

/**
 * Haze planes are OFF by default. Measured: alpha-blended emissive sheets lift
 * the band they are meant to neutralise (horizon luma 65.6 -> 86.3 while warmth
 * barely moved, +62 -> +52). Aerial perspective needs a depth-based pass that
 * desaturates toward the fog colour without adding light; that is a
 * screen-space post process, not geometry. Kept here behind a flag so the idea
 * and its measurements are not lost.
 */
const HAZE_PLANES = false;

export function installDust(ctx: LabCtx) {
  const { scene } = ctx;

  const tex = radialTexture("hazeFalloff", scene, 0.95, 0.55);

  for (const [y, radius, alpha] of HAZE_PLANES ? LAYERS : []) {
    const plane = MeshBuilder.CreateGround(`haze_${y}`, { width: radius * 2, height: radius * 2 }, scene);
    plane.position.y = y;
    const m = new StandardMaterial(`hazeMat_${y}`, scene);
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.emissiveColor = HAZE_COLOUR;
    m.opacityTexture = tex;
    m.alpha = alpha;
    m.disableLighting = true;
    m.backFaceCulling = false;
    m.fogEnabled = false;
    m.disableDepthWrite = true; // haze must never occlude the terrain behind it
    m.alphaMode = 1; // ALPHA_COMBINE; additive over a bright sky blows out
    plane.material = m;
    plane.isPickable = false;
    plane.applyFog = false;
    plane.alphaIndex = 200; // after opaque geometry
  }

  // Dust plume off the rear tyres. The plate's is subtle: a veil, not a rooster
  // tail, so the emitter is wide and the particles are large and faint.
  const puff = radialTexture("dustPuff", scene, 0.85, 0.35);

  const ps = new ParticleSystem("dustPlume", 260, scene);
  ps.particleTexture = puff as never;
  ps.emitter = new Vector3(-1.6, 0.35, -2.6); // behind the rear axle, low
  ps.minEmitBox = new Vector3(-0.5, 0, -0.4);
  ps.maxEmitBox = new Vector3(0.5, 0.25, 0.4);
  ps.color1 = new Color4(0.72, 0.66, 0.57, 0.14);
  ps.color2 = new Color4(0.66, 0.60, 0.52, 0.09);
  ps.colorDead = new Color4(0.66, 0.62, 0.55, 0.0);
  ps.minSize = 0.5;
  ps.maxSize = 1.7;
  ps.minLifeTime = 1.6;
  ps.maxLifeTime = 3.6;
  ps.emitRate = 14;
  ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  ps.gravity = new Vector3(0.35, 0.12, 0.15);
  ps.direction1 = new Vector3(-0.6, 0.15, -0.5);
  ps.direction2 = new Vector3(0.6, 0.55, 0.4);
  ps.minEmitPower = 0.4;
  ps.maxEmitPower = 1.5;
  ps.updateSpeed = 0.012;
  ps.start();
}
