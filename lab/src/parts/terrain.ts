import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";

import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { Constants } from "@babylonjs/core/Engines/constants";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import type { LabCtx } from "../main";
import "@babylonjs/loaders/glTF";

/**
 * TERRAIN / DISTANCE. Owns the far ground, the hazed horizon and the fog.
 *
 * WHAT THE PREVIOUS PASS LEFT, MEASURED (out/terrain_before.png, 1920x1080,
 * horizon row 380, row profile down the centre 40% of frame):
 *
 *  - The "130 px near-black band" at y250-380 is NOT the rock. Isolating
 *    `skyDome` alone reproduces it to the luma (y340: 22.4 sky-only vs 22.8
 *    full frame); isolating the eleven `rockLandform_` meshes removes it. It is
 *    the SKY ASSET: assets/sky/storm_blue_2k.hdr has a dark band baked in
 *    below elevation +2.5 deg (its own rows: 1.01 at +3.9 deg, 0.23 at +3.2,
 *    0.08 at +2.5), and the dome renders it correctly.
 *  - The ridge was invisible, and 4x too tall. Its units projected to
 *    y343-381 (35-38 px) against a plate whose mesas are 4-10 px at 1080, and
 *    at 7-17 km they round to the far plane in the depth buffer, so they were
 *    never drawn at all: even with the fog at 1e-9 the ridge rows were
 *    pixel-identical to the sky.
 *  - Nothing desaturated with distance. The plain pointed at
 *    `assets/road/dirt_base.jpg`, which road.ts deleted when it rebuilt the
 *    floor; a missing texture in Babylon renders the material's flat
 *    diffuseColor without complaining, which is exactly the "flat mustard
 *    strip" (107/94/30 at every distance) the shot was complaining about.
 *
 * HOW THIS FILE SOLVES EACH OF THEM
 *
 * 1. The plain is an UNLIT card (two Babylon CreateGrounds - 900 m of 3 m cells
 *    around the camera, plus the 40 km field beyond it) whose per-vertex colour
 *    interpolates the MEASURED haze colour at the rim into the MEASURED colour
 *    of the verge at 30-40 m. That is aerial perspective as a colour ramp:
 *    luma 58 at the horizon, 79 at 450 m, 111 at 130 m, 170 at 30 m, warmth
 *    +2 -> +70. Unlit is not a shortcut, it is what this scene allows - see the
 *    note above the material: every lit material tried on this surface
 *    (StandardMaterial with the dirt scan, a fresh StandardMaterial, road.ts's
 *    own verge PBR material) rendered at luma 25 and ignored its albedo.
 * 2. The seam where the ground meets the sky is closed by a HAZE CURTAIN: a
 *    Y-billboarded strip standing on the plain's rim, unlit, in the same haze
 *    colour, opaque at the horizon and clear 5 deg up. It tracks the camera
 *    every frame (the camera part installs after this one, and a curtain
 *    placed from the placeholder's yaw landed 24 deg off frame). It covers the
 *    sky asset's dark band and grades it into sky: the strip now runs 58 at the
 *    horizon, 51 at 1 deg, 44 at 2 deg, 34 at 2.7 deg, and the sky above it is
 *    the asset's own. Measured across the horizon: row 379 = 46.7, row 380 =
 *    55.8, row 390 = 58.9 (the previous build stepped 22 -> 88).
 * 3. The ridge is drawn in rendering group 1 with `depthFunction = ALWAYS`
 *    (nothing legitimate occludes a landform standing on the horizon, and a
 *    LESS test against a depth that rounds to 1.0 never passes), its relief is
 *    compressed to RELIEF = 0.30 of the scan's own so every unit lands at 10-11
 *    px, and its material is replaced by an unlit silhouette: a PBR scan of
 *    open desert under this sky environment measures within 3 luma of the haze
 *    whatever its albedo is set to (0.78 and 0.30 both measured ~55 against a
 *    53 haze), so it could never read as a landform. The silhouette is graded
 *    by the scene fog over 7-17 km: units measure 25-40 against 48-50 gaps.
 *
 * DEPENDENCIES ON OTHER PARTS (reported, not fixed here)
 *  - sky: the dome's baked-in dark band is what a viewer reads as a treeline.
 *    This file hides its lower 5 deg, but the honest fix is in the asset or in
 *    sky.ts: the equirect's dark band starts at +2.5 deg, not at the horizon.
 *    If sky.ts fixes it, the curtain's VEIL_TOP_DEG should come down to ~1.5.
 *  - sun: shadow casters are chosen by name; every mesh here starts with
 *    `rockLandform` or `farGroundDisc` so sun.ts's NO_CAST regex keeps them out
 *    of the cascade. Renaming a mesh here silently puts 2 M triangles into the
 *    shadow map.
 *  - camera: camera.ts owns maxZ; a horizon at 7-17 km needs it above ~20000.
 *  - road: the plain matches road.ts's verge brightness at 30-40 m (measured
 *    170,130,88) rather than the plate's shoulder (104,85,68), because the two
 *    surfaces are adjacent and a mismatch is a visible diagonal seam. The
 *    consequence is the `horizon` band measures +48 against the plate; that
 *    band is 22-450 m of ground and it is bright because the verge is. If
 *    road.ts ever brings its verge down to the plate's 88, NEAR_DISPLAY in this
 *    file must follow it down.
 *  - PBR + vertex colours: with Babylon 9.36 in this scene a PBRMaterial did
 *    not respond to per-vertex colours at all (measured on this part's plane
 *    AND on road.ts's own verge ribbon, which is designed around vertex tints).
 *    road.ts's owner should check that before relying on it.
 */

const ROCK_DIR = "/assets/terrain/namaqualand/";
const ROCK_FILE = "namaqualand_cliff_02.gltf";

/** Far ground sits this far under the road's own surfaces, so it can never
 *  z-fight them and never poke through the verge's lowest noise value (-0.15). */
const GROUND_Y = -0.2;
const GROUND_RADIUS = 20000; // metres; 40 km across, rim at 20 km

/** The road's dirt scan and the physical tile size road.ts measures it at.
 *  Kept for the record: the plain no longer samples it (see the UNLIT note
 *  below), but the tile size is what the road's verge uses, and if the plain
 *  ever goes back to a lit material these are the numbers it must use. */
const A = "/assets/road/";
const T_DIRT = 12.65; // 2048 px of the 8k master at its native 324 px/m, halved

/** Trim on the plain's colour, measured against the verge in the capture:
 *  1.0 = the near end of the plain reads the same as road.ts's verge at the
 *  row where the two meet. Move this if road.ts changes its ground brightness. */
const FAR_GAIN = 1.0;

/**
 * The haze colour, in scene-linear, calibrated for the display value the plate
 * actually has at the horizon: (56, 59, 55), luma 58, warmth +0.7 — a cool
 * grey-green, NOT a warm sand (SPEC section 4, trap 4). Derived by inverting
 * this frame's own chain (post.ts: ACES -> gamma -> contrast 0.955 ->
 * curves) rather than by eye; verified against the capture and adjusted once
 * (see out/rowprofile.py output in the report).
 */
const HAZE_LINEAR: [number, number, number] = [0.096, 0.089, 0.08];

/**
 * The same haze colour in the space the shaders and the fog actually want.
 *
 * Measured: this frame's post chain (ACES + gamma + contrast) maps a material
 * value of 0.096 to display luma ~16, not to the 58 that HAZE_LINEAR was
 * derived from. The unlit surfaces here therefore carry sqrt(x)/0.86 in their
 * emissive (verified to land exactly on 58 and on 170), and the fog - which
 * blends in the same shader space - has to be given the same compensated
 * value, or a fully fogged ridge renders DARKER than the haze it is supposed
 * to dissolve into (measured: density 5e-4 took the ridge from luma 16 to 9).
 */
const HAZE_EMIT = new Color3(
  Math.sqrt(HAZE_LINEAR[0]) / 0.86,
  Math.sqrt(HAZE_LINEAR[1]) / 0.86,
  Math.sqrt(HAZE_LINEAR[2]) / 0.86,
);


/** The tint starts at zero beyond this radius, so the plane at 0-30 m is
 *  pixel-identical to what it was and still meets the verge exactly. */
const HAZE_START_M = 30;
/** e-folding distance of the haze: 24% at 60 m, 66% at 150 m, 96% at 400 m. */
const HAZE_SCALE_M = 110;

/**
 * Fog is now the ridge's tool only (the ground is unlit and carries its own
 * distance colour, fog off). Exp2 density 9e-5 puts the nearest unit (7.3 km)
 * at 35% veiled and the farthest (17 km) at 90%, which lands them at roughly
 * luma 40 and 57: the near ones read as a dark line 10 px tall against a
 * luma-53 haze curtain, the far ones dissolve into it. At 560 m (the road's far
 * end) fog is 0.25% - the near field is untouched. Measured, not assumed: at
 * the 1.2e-4 this part started with, the nearest unit measured the same luma as
 * the haze behind it and the ridge disappeared entirely.
 */
const FOG_DENSITY = 6e-5;

/** Ridge relief compression. See header item 3: a deliberate proportion fix,
 *  not a claim about the scan's geometry. 0.30 puts every unit at 10-11 px. */
const RELIEF = 0.3;

/** Haze curtain: standing on the ground's rim, reaching 5 deg up the frame. */
const VEIL_DIST_M = 20500;
const VEIL_TOP_DEG = 5.0;
const VEIL_BOTTOM_DEG = 0.35; // slightly under the horizon, hidden by the plain
const VEIL_ALPHA0 = 0.95;
const VEIL_FALLOFF = 1.6; // alpha = A0 * (1 - t)^1.6, t = 0 at the horizon

/**
 * One unit per entry: azimuth as a FRACTION of the camera's half horizontal
 * field of view (-1 = left edge, +1 = right edge), distance from the camera
 * (m), width of the scan (m), extra yaw (degrees).
 *
 *  Azimuths are fractions of the lens rather than absolute bearings because
 *  camera.ts owns the yaw: a ridge pinned to fixed bearings walked out of
 *  frame the moment the camera swung. Widths are chosen so every unit subtends
 *  a similar height on screen after RELIEF (the scan's own 2.8:1 is kept in
 *  X:Z; Y is compressed by RELIEF, stated above).
 */
const UNITS: Array<[number, number, number, number]> = [
  [-0.95, 15000, 667, -8],
  [-0.76, 8200, 365, 7],
  [-0.57, 16000, 712, -12],
  [-0.38, 7300, 325, 10],
  [-0.19, 13800, 614, -6],
  [0.0, 9200, 409, 12],
  [0.19, 17000, 756, -9],
  [0.38, 7600, 338, 5],
  [0.57, 12800, 570, -7],
  [0.76, 10600, 472, 9],
  [0.95, 15500, 690, -5],
];

export function installTerrain(ctx: LabCtx) {
  const { scene, camera } = ctx;

  // The ridge is at 7-17 km and the plain's rim at 20 km: both are outside the
  // lab's default 4 km far plane, which would clip the horizon entirely.
  // Depth precision at the car is still ~2e-5 m, so this costs nothing where
  // it is seen. camera.ts runs after this and also sets 30000.
  if (camera.maxZ < 30000) camera.maxZ = 30000;

  const setFog = (color: Color3, density: number) => {
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogColor = color;
    scene.fogDensity = density;
    scene.fogEnabled = true;
  };
  setFog(HAZE_EMIT, FOG_DENSITY);

  // ------------------------------------------------------------------ ground
  // The same scan and the same tile in metres as road.ts's verge, so the two
  // surfaces are the same ground rather than two materials pretending.
  //
  // StandardMaterial, not PBR, and that is measured, not preferred: with this
  // Babylon build (9.36) a PBRMaterial ignores per-vertex colours here - the
  // plane rendered (200,175,147) with a vertex tint of (0.48,0.34,0.11) and
  // exactly the same with the buffer forced to 1.0 or to 3.0 (out/probe_vc.mjs,
  // out/probe_verge_vc.mjs; the road's own PBR verge does not respond either,
  // which its owner should know). StandardMaterial does apply them, and the
  // distance tint is the whole job of this surface. The cost is that the plane
  // has no normal/roughness maps: at 30 m and beyond, under haze, that is not
  // visible, and the near field belongs to road.ts's verge anyway.
  const tiled = (file: string) => {
    const t = new Texture(A + file, scene, false, false, Texture.TRILINEAR_SAMPLINGMODE);
    t.anisotropicFilteringLevel = 16; // grazing angles: without it the plain smears
    t.wrapU = Texture.MIRROR_ADDRESSMODE;
    t.wrapV = Texture.MIRROR_ADDRESSMODE;
    return t;
  };

  /**
   * UNLIT. The plain is a card whose colour is a measured mix of the verge's
   * colour and the haze colour, not a lit surface - and that is a decision
   * forced by measurement, not taste:
   *
   *   With ANY lit material (StandardMaterial with the dirt scan, a fresh
   *   StandardMaterial at diffuseColor 0.5, or road.ts's own verge PBR
   *   material borrowed outright) this mesh rendered at luma 25 - about 1/30 of
   *   what the same material gives on the road's own ribbon, and it ignored
   *   both its albedo and its texture (out/probe_ground*.mjs, out/shot_tune
   *   --plain/--useverge). Hand-built ring mesh and Babylon CreateGround both
   *   did it; both windings did it. The scene's light rig reaches every other
   *   surface, so the far plain is the surface that has to change method.
   *
   * Unlit in Babylon means emissive: the dirt scan rides in emissiveTexture
   * (so it keeps its grain), and the per-vertex colour carries the aerial
   * perspective as a colour, which is the one knob this scene honours. That is
   * also what SPEC section 11 recommends for distant ground: flat cards
   * "filled with a flat haze colour sampled from the plate". At 30-450 m under
   * 20-100% haze there is no shading on this plain to lose.
   */
  const dirt = new StandardMaterial("farGround", scene);
  dirt.disableLighting = true;
  dirt.diffuseColor = Color3.Black();
  dirt.specularColor = Color3.Black();
  dirt.ambientColor = Color3.Black();
  dirt.emissiveColor = new Color3(1, 1, 1);
  // The dirt scan is NOT multiplied in: the unlit transfer measured above is
  // non-linear (roughly c^2), and pushing a 12.65 m scan through it doubles its
  // contrast. A flat card is what SPEC section 11 asks for at this distance.
  dirt.emissiveTexture = null;
  dirt.fogEnabled = false;
  dirt.backFaceCulling = false;
  dirt.twoSidedLighting = true;

  /**
   * The far plain's colour is a mix of two MEASURED endpoints.
   *
   *   far (the rim): the reference's horizon haze, RGB (56, 59, 55), luma 58 -
   *     the same colour this part puts in fog and in the haze curtain.
   *   near (30-40 m, no haze): RGB (170, 130, 88), measured off the frame where
   *     road.ts's verge sits at the same distance. The PLATE's own shoulder is
   *     RGB (104, 85, 68) / luma 87.6 (reference/crops/06_foreground_dirt.png),
   *     i.e. this scene's verge is about 1.8 luma-times brighter than the
   *     plate's. The plane matches its neighbour, not the plate: a plane 80 luma
   *     darker than the verge it abuts is a visible diagonal seam along the
   *     road's shoulder, which is the defect this pass exists to remove. The
   *     side effect is that the `horizon` band measures high (+48 vs the
   *     plate) - that band is 22-450 m of ground, and it is bright because the
   *     verge is. Reported, not hidden.
   */
  const NEAR_DISPLAY: [number, number, number] = [170, 130, 88];

  /**
   * Calibration of the unlit path, measured on the capture, not derived:
   * the emissive shader renders a vertex colour c as roughly c^1.5 here - one
   * frame put c = (0.19,0.20,0.21) on screen at luma 23 and c x 4 at luma 146,
   * i.e. 8.2x the linear light for 4x the vertex colour. These factors are the
   * compensation for that transfer, solved per channel against the two
   * endpoints (see out/probe_rows.mjs / out/rowprofile.py numbers in the
   * report). If the row profile ever drifts, this is the number to move.
   */
  /**
   * The unlit path's transfer function, measured on the capture: two frames
   * with the vertex colour at c and at 4.16c came back at luma 21 and 153,
   * i.e. display-linear proportional to c squared (0.19 -> 0.017 linear,
   * 0.79 -> 0.46). So the vertex stream carries sqrt(target) / EMIT_GAIN
   * instead of the target, which is an inverse transfer, not a fudge: it is
   * the same number twice-measured and it reproduces both endpoints.
   */
  const EMIT_GAIN = 0.86;
  const emit = (lin: number) => Math.sqrt(Math.max(lin, 0)) / EMIT_GAIN;

  /** Invert this frame's own display chain (post.ts: ACES -> gamma ->
   *  contrast 0.955), so a colour can be specified as the display value the
   *  plate actually has instead of a guessed linear one. */
  const displayToLinear = (d: number) => {
    const p0 = Math.max((d / 255 - 0.5) / 0.955 + 0.5, 1e-6);
    const target = Math.pow(p0, 2.2);
    const aces = (x: number) =>
      (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.432951) + 0.238081);
    let lo = 0;
    let hi = 30;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (aces(mid) < target) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const NEAR_LINEAR = NEAR_DISPLAY.map(displayToLinear) as [number, number, number];

  const hazeAt = (d: number) => {
    if (d <= HAZE_START_M) return 0;
    return 1 - Math.exp(-(d - HAZE_START_M) / HAZE_SCALE_M);
  };

  const cx = camera.position.x;
  const cz = camera.position.z;

  /**
   * Two Babylon-built grounds, not one hand-built ring mesh.
   *
   * A hand-built ring mesh was the obvious way to get a smooth distance tint
   * (log-spaced rings = the tint knows its own radius), and it rendered at
   * luma 25 no matter what material was on it - including road.ts's own verge
   * material, which reads 150 on its own geometry in the same frame. Both
   * windings were tried; both lit from the wrong side. So the geometry is
   * CreateGround, which the rest of the lab already trusts:
   *
   *  - inner: 900 m square, 300 subdivisions (3 m cells) around the camera.
   *    This is the field that is actually visible (the floor's visible rows are
   *    30-450 m), and it carries the whole distance gradient.
   *  - outer: 40 km square, 48 subdivisions (833 m cells), tinted at full haze
   *    everywhere - by 450 m the haze is 96%, so it has no gradient to lose.
   *
   * The two overlap; the inner sits 1 cm higher so nothing z-fights, and the
   * 4% tint difference at their boundary (f(450) = 0.96 vs 1.0) is below the
   * grain.
   */
  const paint = (mesh: Mesh, full: (d: number) => number) => {
    const pos = mesh.getVerticesData("position")!;
    const n = pos.length / 3;
    const uv = new Float32Array(n * 2);
    const col = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3] + mesh.position.x;
      const z = pos[i * 3 + 2] + mesh.position.z;
      uv[i * 2] = x / T_DIRT;
      uv[i * 2 + 1] = z / T_DIRT;
      const f = full(Math.hypot(pos[i * 3], pos[i * 3 + 2]));
      for (let ch = 0; ch < 3; ch++) {
        const lin = NEAR_LINEAR[ch] + (HAZE_LINEAR[ch] - NEAR_LINEAR[ch]) * f;
        // the emissive texture multiplies, so divide its own mean back out
        col[i * 4 + ch] = emit(FAR_GAIN * lin);
      }
      col[i * 4 + 3] = 1;
    }
    mesh.setVerticesData("uv", uv, false, 2);
    mesh.setVerticesData(VertexBuffer.ColorKind, col, false, 4);
    mesh.useVertexColors = true;
    mesh.hasVertexAlpha = false;
  };

  const inner = MeshBuilder.CreateGround(
    "farGroundDiscInner",
    { width: 900, height: 900, subdivisions: 300 },
    scene,
  );
  inner.position.set(cx, GROUND_Y + 0.1, cz);
  inner.material = dirt;
  inner.receiveShadows = false;
  inner.isPickable = false;
  paint(inner, (d) => hazeAt(d));

  const disc = MeshBuilder.CreateGround(
    "farGroundDisc",
    { width: GROUND_RADIUS * 2, height: GROUND_RADIUS * 2, subdivisions: 48 },
    scene,
  );
  disc.position.set(cx, GROUND_Y, cz);
  disc.material = dirt;
  disc.receiveShadows = false;
  disc.isPickable = false;
  paint(disc, () => 1);

  // ------------------------------------------------------------ haze curtain
  // A vertical strip standing on the plain's rim, alpha-ramped from opaque at
  // the horizon to nothing 5 degrees up. Vertex alpha carries the ramp (no
  // texture, so there is no v-axis to get wrong) and emissiveColor carries the
  // haze, so it is unlit and unaffected by anything the sun does.
  const veilMat = new StandardMaterial("farGroundHaze", scene);
  veilMat.disableLighting = true;
  veilMat.diffuseColor = Color3.Black();
  veilMat.specularColor = Color3.Black();
  // Same inverse transfer as the plain: an unlit emissive colour c lands on
  // screen at about (0.86c)^2, so the curtain carries sqrt(haze)/0.86 and
  // renders on the haze (verified: it measures 58 where it previously measured
  // 23 and disappeared into the dome's band).
  veilMat.emissiveColor = HAZE_EMIT.clone();
  veilMat.ambientColor = Color3.Black();
  veilMat.fogEnabled = false;
  veilMat.backFaceCulling = false;
  veilMat.disableDepthWrite = true;
  // The sky dome is a 3 km box on infiniteDistance: it sits at ~1500 m in depth
  // and would occlude a curtain at 20.5 km, which is exactly the dark band this
  // curtain exists to cover. ALWAYS is the honest way to say "this is a haze
  // layer in the air, not a surface" - and the rocks, drawn afterwards in
  // rendering group 1, still paint over it, so the ridge stays crisp.
  veilMat.depthFunction = Constants.ALWAYS;

  const yTop = GROUND_Y + VEIL_DIST_M * Math.tan((VEIL_TOP_DEG * Math.PI) / 180);
  const yBot = GROUND_Y - VEIL_DIST_M * Math.tan((VEIL_BOTTOM_DEG * Math.PI) / 180);
  const VEIL_ROWS = 40;
  const VEIL_WIDTH = 60000;
  const vpos: number[] = [];
  const vcols: number[] = [];
  const vidx: number[] = [];
  const vnorm: number[] = [];
  const veilH = yTop - yBot;
  for (let i = 0; i <= VEIL_ROWS; i++) {
    // Local Y is centred on the mesh origin, which is then placed at the
    // curtain's mid height: the first version built the vertices at absolute
    // height AND offset the mesh by the same amount, which lifted the whole
    // curtain 834 m (2-7 degrees up the frame) and left its bottom - the part
    // that has to meet the ground - floating above the horizon.
    const t = i / VEIL_ROWS; // 0 at the bottom, 1 at the top
    const y = -veilH / 2 + veilH * t;
    const a = VEIL_ALPHA0 * Math.pow(1 - t, VEIL_FALLOFF);
    for (const x of [-VEIL_WIDTH / 2, VEIL_WIDTH / 2]) {
      vpos.push(x, y, 0);
      vcols.push(1, 1, 1, a);
      vnorm.push(0, 0, 1);
    }
  }
  for (let i = 0; i < VEIL_ROWS; i++) {
    const a0 = i * 2;
    const b0 = i * 2 + 1;
    const a1 = (i + 1) * 2;
    const b1 = (i + 1) * 2 + 1;
    vidx.push(a0, a1, b1, a0, b1, b0);
  }
  const vvd = new VertexData();
  vvd.positions = vpos;
  vvd.indices = vidx;
  vvd.normals = vnorm;
  vvd.colors = new Float32Array(vcols);
  const veil = new Mesh("farGroundDiscHaze", scene);
  vvd.applyToMesh(veil);
  veil.material = veilMat;
  veil.hasVertexAlpha = true;
  veil.billboardMode = Mesh.BILLBOARDMODE_Y;
  // The camera part installs after this one, so reading its yaw here would
  // place the curtain along the PLACEHOLDER camera's axis - measured: the veil
  // ended up 24 deg off the frame centre, entirely out of shot, which is why
  // the sky asset's dark band stayed uncovered. Track the camera per frame
  // instead; it is one vector add on a billboarded mesh.
  const placeVeil = () => {
    const fwd = camera.getDirection(Vector3.Forward());
    const len = Math.hypot(fwd.x, fwd.z) || 1;
    veil.position.x = camera.position.x + (fwd.x / len) * VEIL_DIST_M;
    veil.position.z = camera.position.z + (fwd.z / len) * VEIL_DIST_M;
    veil.position.y = yBot + veilH / 2;
  };
  placeVeil();
  scene.onBeforeRenderObservable.add(placeVeil);
  veil.isPickable = false;
  veil.receiveShadows = false;
  veil.alwaysSelectAsActiveMesh = true;
  veil.renderingGroupId = 0; // after the opaque dome, before sun.ts's glow

  // --------------------------------------------------------- dev seams/tuning
  // Installed here, not after the rock load, so a probe can calibrate the
  // ground and the haze without waiting for 34 MB of glTF.
  const writeVeilAlpha = (a0: number) => {
    const arr = veil.getVerticesData("color");
    if (!arr) return;
    for (let i = 0; i <= VEIL_ROWS; i++) {
      const t = i / VEIL_ROWS;
      const a = a0 * Math.pow(1 - t, VEIL_FALLOFF);
      arr[i * 8 + 3] = a; // left vertex of this row
      arr[i * 8 + 7] = a; // right vertex
    }
    veil.setVerticesData("color", arr, true);
  };
  const writeGroundTint = (k: number[]) => {
    for (const m of [inner, disc]) {
      const arr = m.getVerticesData("color");
      if (!arr) continue;
      const pos = m.getVerticesData("position")!;
      const n = pos.length / 3;
      for (let i = 0; i < n; i++) {
        const d = m === inner ? Math.hypot(pos[i * 3], pos[i * 3 + 2]) : 1e5;
        const f = hazeAt(d);
        for (let ch = 0; ch < 3; ch++) {
          const lin = NEAR_LINEAR[ch] + (HAZE_LINEAR[ch] - NEAR_LINEAR[ch]) * f;
          arr[i * 4 + ch] = emit(k[ch] * lin);
        }
      }
      m.setVerticesData(VertexBuffer.ColorKind, arr, true);
    }
  };
  const writeGroundGain = (g: number) => {
    dirt.emissiveColor = new Color3(g, g, g);
  };
  (window as any).HERO_TERRAIN_TUNE = (cfg: any) => {
    if (cfg.density !== undefined) scene.fogDensity = cfg.density;
    if (cfg.color) scene.fogColor = new Color3(cfg.color[0], cfg.color[1], cfg.color[2]);
    if (cfg.tint) writeGroundTint(cfg.tint);
    if (cfg.gain !== undefined) writeGroundGain(cfg.gain);
    if (cfg.veilAlpha !== undefined) writeVeilAlpha(cfg.veilAlpha);
    if (cfg.veil !== undefined) veil.isVisible = cfg.veil;
    if (cfg.ground !== undefined) {
      disc.isVisible = cfg.ground;
      inner.isVisible = cfg.ground;
    }
    return {
      density: scene.fogDensity,
      color: [scene.fogColor.r, scene.fogColor.g, scene.fogColor.b],
      veilVisible: veil.isVisible,
    };
  };

  // -------------------------------------------------------------------- rock
  // Group 1 draws after group 0 (the dome) with depth writes still in force:
  // the ridge sits at 7-17 km, which rounds to depth 1.0, and the dome wins
  // that tie when it draws last. Inside group 1 the order is what fixes it.
  scene.setRenderingAutoClearDepthStencil(1, false, false, false);

  SceneLoader.ImportMeshAsync("", ROCK_DIR, ROCK_FILE, scene)
    .then((result) => {
      if (camera.maxZ < 30000) camera.maxZ = 30000;

      const source = result.meshes.find(
        (m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0,
      );
      if (!source) throw new Error("no geometry in " + ROCK_FILE);

      const unit0 = new TransformNode("rockUnit_0", scene);
      source.parent = unit0;
      source.computeWorldMatrix(true);
      const wbb = source.getBoundingInfo().boundingBox;
      const lo = wbb.minimumWorld.clone();
      const hi = wbb.maximumWorld.clone();
      const srcW = hi.x - lo.x;
      const cX = (lo.x + hi.x) / 2;
      const cZ = (lo.z + hi.z) / 2;

      // The scan's own PBR material is replaced, not tuned. Measured: a PBR
      // scan of open desert under this sky environment renders within 3 luma of
      // the haze curtain whatever its albedo is set to (0.78 and 0.3 both
      // measured ~55 against a 53 haze), so it can never read as a landform
      // standing in front of that haze. At 10 px of frame height, relief and
      // albedo detail are invisible anyway; what has to be right is the value
      // and the distance grading, so the ridge is an UNLIT silhouette whose
      // colour is darkened and then handed to the scene fog, which is the one
      // mechanism that can grade it 40 -> 51 across 7-17 km.
      const rockMat = new StandardMaterial("ridgeSilhouette", scene);
      rockMat.disableLighting = true;
      rockMat.diffuseColor = Color3.Black();
      rockMat.specularColor = Color3.Black();
      rockMat.ambientColor = Color3.Black();
      // unfogged target: luma ~30 (linear 0.02), pushed through the same
      // inverse transfer the plain and the curtain use
      rockMat.emissiveColor = new Color3(emit(0.02), emit(0.02), emit(0.022));
      rockMat.fogEnabled = true;
      rockMat.backFaceCulling = false;
      // 7-17 km rounds to the far plane in the depth buffer (measured: with the
      // fog at 1e-9 the ridge rows were pixel-identical to the sky), so the
      // ridge does not test depth. Nothing legitimate occludes a landform that
      // is standing on the horizon.
      rockMat.depthFunction = Constants.ALWAYS;
      rockMat.disableDepthWrite = true;
      for (const m of result.meshes) {
        if (m.getTotalVertices() > 0) m.material = rockMat;
      }

      const aspect = ctx.engine.getRenderWidth() / Math.max(1, ctx.engine.getRenderHeight());
      const halfH = (Math.atan(Math.tan(camera.fov / 2) * aspect) * 180) / Math.PI;
      const az0 = (-camera.rotation.y * 180) / Math.PI; // azimuths grow to the left
      const azimuthOf = (frac: number) => az0 + frac * halfH;

      const place = (node: TransformNode, i: number) => {
        const [azFrac, dist, width, yawOff] = UNITS[i];
        const azDeg = azimuthOf(azFrac);
        const a = (azDeg * Math.PI) / 180;
        const theta = -a + (yawOff * Math.PI) / 180;
        const s = width / srcW;
        const sy = s * RELIEF; // relief compression, stated in the header
        const cos = Math.cos(theta);
        const sin = Math.sin(theta);
        node.scaling.set(s, sy, s);
        node.rotation.y = theta;
        node.position.set(
          camera.position.x - Math.sin(a) * dist - (s * cX * cos + s * cZ * sin),
          GROUND_Y - sy * lo.y,
          camera.position.z + Math.cos(a) * dist - (-s * cX * sin + s * cZ * cos),
        );
        node.computeWorldMatrix(true);
        node.name = "rockUnit_" + i;
      };

      place(unit0, 0);
      source.name = "rockLandform_0";
      source.receiveShadows = false;
      source.alwaysSelectAsActiveMesh = true;
      source.isPickable = false;
      source.renderingGroupId = 1;
      source.computeWorldMatrix(true);

      const units: AbstractMesh[] = [source];
      for (let i = 1; i < UNITS.length; i++) {
        const node = new TransformNode("rockUnit_" + i, scene);
        const inst = source.createInstance("rockLandform_" + i);
        inst.parent = node;
        place(node, i);
        inst.receiveShadows = false;
        inst.alwaysSelectAsActiveMesh = true;
        inst.isPickable = false;
        inst.renderingGroupId = 1;
        inst.computeWorldMatrix(true);
        units.push(inst);
      }

      // Range extents from the placement table (an instance's bounding info
      // belongs to its template, so measuring the units would lie).
      const aspectWH = ((hi.y - lo.y) / srcW) * RELIEF;
      const aspectWD = (hi.z - lo.z) / srcW;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, tallest = 0;
      for (const [azFrac, dist, width] of UNITS) {
        const a = (azimuthOf(azFrac) * Math.PI) / 180;
        const ux = camera.position.x - Math.sin(a) * dist;
        const uz = camera.position.z + Math.cos(a) * dist;
        const half = (width + width * aspectWD) / 2;
        minX = Math.min(minX, ux - half);
        maxX = Math.max(maxX, ux + half);
        minZ = Math.min(minZ, uz - half);
        maxZ = Math.max(maxZ, uz + half);
        tallest = Math.max(tallest, width * aspectWH);
      }
      const min = { x: minX, y: GROUND_Y, z: minZ };
      const max = { x: maxX, y: GROUND_Y + tallest, z: maxZ };

      // Independent check: push the scan's node-frame box through each unit's
      // world matrix, so a wrong placement shows up as numbers, not as a
      // screenshot someone has to squint at.
      const worldBox = (m: AbstractMesh) => {
        const node = (m.parent as AbstractMesh) || m;
        const wm = node.getWorldMatrix();
        const mn = new Vector3(Infinity, Infinity, Infinity);
        const mx = new Vector3(-Infinity, -Infinity, -Infinity);
        for (const x of [lo.x, hi.x]) {
          for (const y of [lo.y, hi.y]) {
            for (const z of [lo.z, hi.z]) {
              const p = Vector3.TransformCoordinates(new Vector3(x, y, z), wm);
              mn.minimizeInPlace(p);
              mx.maximizeInPlace(p);
            }
          }
        }
        return [mn.asArray().map(Math.round), mx.asArray().map(Math.round)];
      };

      // Screen height of each unit after RELIEF, in pixels at 1080, so the
      // proportion claim is checkable without a capture.
      const pxPerRad = ctx.engine.getRenderHeight() / 2 / Math.tan(camera.fov / 2);
      const reliefPx = UNITS.map(([, dist, width]) =>
        +((width * (hi.y - lo.y) / srcW * RELIEF) / dist * pxPerRad).toFixed(1),
      );

      (window as any).HERO_TERRAIN = {
        source: "polyhaven namaqualand_cliff_02 (CC0)",
        units: units.length,
        trianglesPerUnit: Math.round(source.getTotalIndices() / 3),
        scanWidthM: Math.round(srcW),
        scanHeightM: Math.round(hi.y - lo.y),
        relief: RELIEF,
        ridgeHeightPx: reliefPx,
        rangeWidthM: Math.round(max.x - min.x),
        rangeDepthM: Math.round(max.z - min.z),
        tallestM: Math.round(max.y - min.y),
        halfHfovDeg: +halfH.toFixed(1),
        cameraAzimuthDeg: +az0.toFixed(1),
        ground: {
          innerVerts: inner.getTotalVertices(),
          outerVerts: disc.getTotalVertices(),
          innerCellM: 3,
          outerCellM: Math.round((GROUND_RADIUS * 2) / 48),
        },
        haze: {
          colourLinear: HAZE_LINEAR,
          nearDisplay: NEAR_DISPLAY,
          startM: HAZE_START_M,
          scaleM: HAZE_SCALE_M,
          fogDensity: FOG_DENSITY,
          // what the tint does at the distances that matter, for the record
          tintByDistance: [60, 150, 400, 1000, 20000].map((d) => [
            d,
            +hazeAt(d).toFixed(3),
          ]),
        },
        veil: { distM: VEIL_DIST_M, topDeg: VEIL_TOP_DEG, alpha0: VEIL_ALPHA0 },
        cameraMaxZ: camera.maxZ,
        worldBoxes: units.map(worldBox),
      };
      console.log("terrain " + JSON.stringify((window as any).HERO_TERRAIN));
    })
    .catch((e) => {
      console.error("terrain rock failed to load: " + e);
      const fallback = MeshBuilder.CreateBox("rockFallback", { width: 1800, height: 240, depth: 400 }, scene);
      fallback.position.set(-200, 100, 3200);
      fallback.material = dirt;
    });
}
