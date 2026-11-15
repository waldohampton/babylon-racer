import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";

import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import type { LabCtx } from "../main";
import "@babylonjs/loaders/glTF";

/**
 * TERRAIN / DISTANCE. Owns the far ground, the rock formations and the fog.
 *
 * The rock is REAL SCANNED GEOMETRY: Poly Haven "namaqualand_cliff_02" (CC0),
 * surfaced photogrammetry with albedo, normal and arm maps. A procedural
 * silhouette reads as procedural no matter what texture is pasted on it; real
 * erosion has a wall line, a talus apron and a skyline that layered sines do not
 * make. A first pass here WAS procedural (theta-modulated prisms) and was
 * rejected on sight, correctly. Do not put it back.
 *
 * WHAT CHANGED FROM THE ONE-BIG-MASS VERSION
 *
 * 1. Scale and distance are HONEST. The scan keeps its own proportions and its
 *    own metre of relief - it is NOT squashed in Y. It is put where a range
 *    that size belongs, 7.3-17 km out, and the fog is extended past it (exp2,
 *    density 9.2e-5, opaque by ~20 km) so the ridge and the ground's rim
 *    dissolve instead of standing on the sky. A unit is 325-756 m wide and
 *    115-268 m tall; at 9.2 km, 409 m subtends 2.6 degrees wide and 0.9 deg
 *    high, which is 100 x 33 px at the reference's lens.
 * 2. It spans the horizon as a BROKEN line, not a single mass off to one side:
 *    eleven yawed copies of the same scan, spread across +/-95% of the camera's
 *    own horizontal field of view at eleven distances, so they interleave and
 *    leave gaps of open sky between them. Measured on the capture: forms from
 *    x = 3 to x = 1903 px, tops 31-39 px above the horizon line.
 * 3. Aerial perspective is carried by DISTANCE, not by a tint: 33% fogged at the
 *    nearest unit (7.6 km), 91% at the farthest (17 km). The fog colour is
 *    calibrated against the sky's own horizon row by sweeping it and reading
 *    the fogged ridge back out of the capture.
 * 4. The far ground is the road's OWN dirt albedo scan at the road's OWN tile
 *    size (3.16 m) and the road's OWN albedo tint, so the verge does not end in
 *    a razor line. Before this it was a separate PBR disc with a 304 m tile and
 *    a lighter albedo, which is exactly what made the hard edge at z = 560.
 *    Verified on the capture: with the plane on, the covered area sits +1.2
 *    luma from what the road's own surfaces read there.
 *
 * DEPENDENCY ON OTHER PARTS (reported, not fixed here):
 *  - camera: camera.ts pins maxZ = 4000, which clips a horizon at 7-17 km
 *    completely (measured: the ridge vanished and only the plain remained).
 *    This part re-asserts maxZ = 30000 once the ridge has loaded, which runs
 *    after camera.ts. If camera.ts ever asserts maxZ per frame, the ridge goes
 *    away again - the far plane has to stay above ~20000 for any of this.
 *  - sun: shadow casters are selected by name. Every mesh here is named
 *    `rockLandform*` or `farGroundDisc*` so the sun's NO_CAST filter keeps
 *    2.1 M distant triangles out of the cascaded shadow map.
 *  - dust: the band between 30 m and 400 m is still bare saturated dirt (the
 *    horizon band measures warmth +55 where the reference's is +0.7). No
 *    distance fog can haze 30 m; that is a low dust layer, and dust.ts owns it.
 *  - sky: the sky dome's below-horizon colour is what shows in the sub-pixel
 *    gap at the very horizon, so the dome's bottom band must stay close to the
 *    fog colour (0.27-0.30 linear) or a 1 px line appears.
 */

const ROCK_DIR = "/assets/terrain/namaqualand/";
const ROCK_FILE = "namaqualand_cliff_02.gltf";

/** Far ground sits this far under the road's own surfaces, so it can never
 *  z-fight them and never poke through the verge's lowest noise value (-0.15). */
const GROUND_Y = -0.2;
const GROUND_SIZE = 40000; // metres across; its rim is 20 km out, where fog is opaque

/** The road's dirt scans and the physical tile sizes the road part measures
 *  them at. Reusing those exact numbers is what makes the seam disappear. */
const A = "/assets/road/";
const T_BASE_D = 3.16;
const GAIN_DIRT = 2.66;
const ALBEDO_DIRT: [number, number, number] = [0.474, 0.284, 0.08];
const BASE_DIRT: [number, number, number] = [0.55, 0.482, 0.425];
const MACRO_MEAN_DIRT = 0.9505;

/**
 * Aerial perspective. Exponential-squared, because that is how air actually
 * extinguishes a view: 0.3% at the road's far end (z=560), 33% at the nearest
 * unit (7.6 km), 91% at the farthest (17 km), ~99.9% at the ground's rim. A
 * linear ramp either hazes the road or leaves the ridge bare; this does not.
 */
const FOG_DENSITY = 9.2e-5;
/**
 * The sky's own horizon band, measured off the frame one row above the horizon
 * ([74,75,65] display, luma ~74). This is NOT the linear value of that colour:
 * calibrated by sweeping the fog colour and reading the fogged ridge back out
 * of the capture (0.24 -> L 53/58, 0.34 -> L 58-67, 0.415 -> 70+, i.e. the
 * ridge vanishes into the sky). 0.30 puts the haze ~8-16 luma under the sky at
 * 74-79: a readable line, not a hole in the horizon and not a cutout.
 */
const FOG_COLOR = new Color3(0.268, 0.27, 0.238);

/** One unit per entry: azimuth as a FRACTION of the camera's half horizontal
 *  field of view (-1 = left edge, +1 = right edge), distance from the camera
 *  (m), width of the scan (m), extra yaw (degrees).
 *
 *  The azimuths are fractions of the lens, not absolute bearings, because the
 *  camera part is still moving and it owns the yaw: a ridge pinned to fixed
 *  bearings walked out of frame the moment the camera swung to 23 degrees off
 *  broadside (measured: the whole line sat at x = 960-3500 px, i.e. off the
 *  right edge). Reading camera.fov and camera.rotation.y once at load and
 *  spreading the units across that span keeps the line on the horizon whatever
 *  the framing settles on.
 *
 *  Size is set by the 40 mm lens the reference specifies (v-FOV 27.1 deg): every
 *  unit subtends ~2.6 deg wide and ~0.9 deg high, i.e. ~100 x 33 px on a 1920
 *  frame. That is a THIN broken line of hills, not the 1847 m wall this part
 *  used to be, and it matches the reference's mesas (tops 0.337-0.357 of frame,
 *  a hair above the horizon at 0.352).
 *
 *  The scan's own proportions are kept (2.8:1), so a unit cannot be made 10:1
 *  like the reference's flat-topped mesas without squashing Y - that would be a
 *  lie about the geometry. What the distances do instead is spread 7.3-17 km so
 *  the haze itself carries the aerial perspective: 33% fogged at the near end,
 *  91% at the far end, which is what makes the near edge dark and warm and the
 *  far edge dissolve into the sky. Azimuths are spaced so open sky shows
 *  between the units. */
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

  // The ridge is at 10-16 km and the ground disc's rim at 25 km: both are
  // outside the lab's default 4 km far plane, which would clip the horizon away
  // entirely. Depth precision at the car is still ~2e-5 m, so this costs
  // nothing where it is seen.
  if (camera.maxZ < 30000) camera.maxZ = 30000;

  const setFog = (color: Color3, density: number) => {
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogColor = color;
    scene.fogDensity = density;
    scene.fogEnabled = true;
  };
  setFog(FOG_COLOR, FOG_DENSITY);

  // ------------------------------------------------------------------ ground
  // A single flat plane with the road's dirt scans on it. Flat is right: this
  // is the plain the road runs across. It is not a second landscape.
  const tiled = (file: string) => {
    const t = new Texture(A + file, scene, false, false, Texture.TRILINEAR_SAMPLINGMODE);
    t.anisotropicFilteringLevel = 16; // grazing angles: without it the plain smears
    t.wrapU = Texture.WRAP_ADDRESSMODE;
    t.wrapV = Texture.WRAP_ADDRESSMODE;
    return t;
  };

  // The road's own dirt albedo scan, at the road's own measured physical tile
  // size (3.16 m), tinted to the road's own target albedo. Same texture, same
  // metres per tile, same colour maths as the verge it has to meet: that is
  // what stops the verge ending in a razor line at z = 560.
  //
  // Two traps here, both measured:
  //  - the road's *macro* map (dirt_macro.jpg) is a near-white multiply layer
  //    (mean 242/255), so it must never be the only diffuse texture - used
  //    alone it turns this plane into a white sheet.
  //  - StandardMaterial's detail map sampled across 2000 repeats came back
  //    BLACK on SwiftShader at grazing angles (measured: luma 7 where the base
  //    alone reads 187). One textured layer at the right physical scale beats
  //    two that disagree, so there is no detail map on the far ground.
  const base = tiled("dirt_base.jpg");
  base.uScale = GROUND_SIZE / T_BASE_D;
  base.vScale = GROUND_SIZE / T_BASE_D;

  const dirt = new StandardMaterial("farGround", scene);
  dirt.diffuseTexture = base;
  // The road tints its dirt with vertex colours; a flat plane has none, so the
  // same product (target albedo / the scan's measured mean) goes into
  // diffuseColor. Same arithmetic, same colour.
  const tint = ALBEDO_DIRT.map((a, i) => (GAIN_DIRT * (a / BASE_DIRT[i])) / MACRO_MEAN_DIRT);
  dirt.diffuseColor = new Color3(tint[0], tint[1], tint[2]);
  dirt.specularColor = new Color3(0.012, 0.0116, 0.0112);
  dirt.specularPower = 64;
  dirt.ambientColor = Color3.Black();
  dirt.fogEnabled = true;

  const disc = MeshBuilder.CreateGround(
    "farGroundDisc",
    { width: GROUND_SIZE, height: GROUND_SIZE, subdivisions: 2 },
    scene,
  );
  disc.position.y = GROUND_Y;
  disc.material = dirt;
  disc.receiveShadows = false;


  // -------------------------------------------------------------------- rock
  SceneLoader.ImportMeshAsync("", ROCK_DIR, ROCK_FILE, scene)
    .then((result) => {
      // the camera part installs after this one and pins maxZ back to 4000,
      // which would clip the whole horizon: reassert it now that the ridge exists
      if (camera.maxZ < 30000) camera.maxZ = 30000;

      const source = result.meshes.find(
        (m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0,
      );
      if (!source) throw new Error("no geometry in " + ROCK_FILE);

      // the scan's own bounds are measured after it is hung under its unit node,
      // because the loader's axis conversion lives in the parent chain

      // Babylon renders instances as a batch driven by the TEMPLATE mesh, and
      // the glTF arrives under a loader-created root that carries the axis
      // conversion. Two traps, both found the hard way:
      //  - hiding the template hides every instance of it;
      //  - a transform written onto the mesh itself is then combined with that
      //    loader root, which mirrored X (an azimuth of 4 degrees came out on
      //    the right edge instead of behind the frame) and inverted Y (the ridge
      //    was placed upside down, under the ground, and never seen).
      // So: keep the loader's conversion intact, hang each unit under a
      // TransformNode of its own, and measure the scan's box in the NODE's frame
      // rather than trusting any parent-relative numbers.
      const unit0 = new TransformNode("rockUnit_0", scene);
      source.parent = unit0;
      source.computeWorldMatrix(true);
      const wbb = source.getBoundingInfo().boundingBox;
      const lo = wbb.minimumWorld.clone();
      const hi = wbb.maximumWorld.clone();
      const srcW = hi.x - lo.x;
      const cX = (lo.x + hi.x) / 2;
      const cZ = (lo.z + hi.z) / 2;

      // The scan was photographed under open sun; as an albedo it is already
      // lit. Distant, backlit, and 60-90% veiled by air, it should be a
      // silhouette, so it is pulled down and desaturated rather than left to
      // compete with the sky the way a sunlit rock would.
      for (const m of result.meshes) {
        const mat: any = m.material;
        if (!mat) continue;
        if (mat.albedoColor) mat.albedoColor = new Color3(0.78, 0.78, 0.8);
        if (typeof mat.metallic === "number") mat.metallic = 0;
        if (typeof mat.roughness === "number") mat.roughness = 0.96;
        mat.fogEnabled = true;
        mat.backFaceCulling = true;
      }

      // The camera owns the yaw and the lens; read both once, at the moment the
      // ridge exists, and spread the line across that field instead of across
      // fixed bearings. (The camera part swung 23 degrees mid-task and took a
      // fixed-bearing ridge off the right edge of the frame with it.)
      const aspect = ctx.engine.getRenderWidth() / Math.max(1, ctx.engine.getRenderHeight());
      const halfH = (Math.atan(Math.tan(camera.fov / 2) * aspect) * 180) / Math.PI;
      const az0 = (-camera.rotation.y * 180) / Math.PI; // my azimuths grow to the left
      const azimuthOf = (frac: number) => az0 + frac * halfH;

      const place = (node: TransformNode, i: number) => {
        const [azFrac, dist, width, yawOff] = UNITS[i];
        const azDeg = azimuthOf(azFrac);
        const a = (azDeg * Math.PI) / 180;
        const theta = -a + (yawOff * Math.PI) / 180; // face the camera, then skew
        const s = width / srcW;
        const cos = Math.cos(theta);
        const sin = Math.sin(theta);
        node.scaling.set(s, s, s);
        node.rotation.y = theta;
        // The scan's base sits on the plain and its footprint centre sits on
        // the ring point; the centre offset has to be rotated by the same yaw.
        node.position.set(
          camera.position.x - Math.sin(a) * dist - (s * cX * cos + s * cZ * sin),
          GROUND_Y - s * lo.y,
          camera.position.z + Math.cos(a) * dist - (-s * cX * sin + s * cZ * cos),
        );
        node.computeWorldMatrix(true);
        node.name = "rockUnit_" + i;
      };

      place(unit0, 0);
      source.name = "rockLandform_0";
      source.receiveShadows = false;
      source.alwaysSelectAsActiveMesh = true;
      source.computeWorldMatrix(true);

      // Instances rather than clones: all eleven units share one 34 MB vertex
      // buffer instead of eleven of them, and `createInstance` copies the
      // template's own local transform, so the loader's axis conversion comes
      // along. The template is unit 0 (the batch renderer needs it visible).
      const units: AbstractMesh[] = [source];
      for (let i = 1; i < UNITS.length; i++) {
        const node = new TransformNode("rockUnit_" + i, scene);
        const inst = source.createInstance("rockLandform_" + i);
        inst.parent = node;
        place(node, i);
        inst.receiveShadows = false;
        inst.alwaysSelectAsActiveMesh = true;
        inst.computeWorldMatrix(true);
        units.push(inst);
      }

      // Range extents straight from the placement table: an instanced mesh's
      // bounding info belongs to its template, so measuring the units would
      // report one rock's bounds nine times.
      const aspectWH = (hi.y - lo.y) / srcW;
      const aspectWD = (hi.z - lo.z) / srcW;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, tallest = 0;
      for (const [azFrac, dist, width] of UNITS) {
        const a = (azimuthOf(azFrac) * Math.PI) / 180;
        const cx = camera.position.x - Math.sin(a) * dist;
        const cz = camera.position.z + Math.cos(a) * dist;
        const half = (width + width * aspectWD) / 2;
        minX = Math.min(minX, cx - half);
        maxX = Math.max(maxX, cx + half);
        minZ = Math.min(minZ, cz - half);
        maxZ = Math.max(maxZ, cz + half);
        tallest = Math.max(tallest, width * aspectWH);
      }
      const min = { x: minX, y: GROUND_Y, z: minZ };
      const max = { x: maxX, y: GROUND_Y + tallest, z: maxZ };

      const tris = Math.round(source.getTotalIndices() / 3) * units.length;
      // Independent check that the transforms landed where the table says: push
      // the scan's node-frame box through each unit node's world matrix.
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
      (window as any).HERO_TERRAIN = {
        source: "polyhaven namaqualand_cliff_02 (CC0)",
        units: units.length,
        trianglesPerUnit: Math.round(source.getTotalIndices() / 3),
        trianglesTotal: tris,
        scanWidthM: Math.round(srcW),
        scanHeightM: Math.round(hi.y - lo.y),
        rangeWidthM: Math.round(max.x - min.x),
        rangeDepthM: Math.round(max.z - min.z),
        tallestM: Math.round(max.y - min.y),
        halfHfovDeg: +halfH.toFixed(1),
        cameraAzimuthDeg: +az0.toFixed(1),
        nearestKm: +(UNITS.reduce((n, u) => Math.min(n, u[1]), 1e9) / 1000).toFixed(1),
        farthestKm: +(UNITS.reduce((n, u) => Math.max(n, u[1]), 0) / 1000).toFixed(1),
        fog: { mode: "exp2", density: FOG_DENSITY, color: [FOG_COLOR.r, FOG_COLOR.g, FOG_COLOR.b] },
        cameraMaxZ: camera.maxZ,
        worldBoxes: units.map(worldBox),
      };
      console.log("terrain rock " + JSON.stringify((window as any).HERO_TERRAIN));

      // dev seam: retune the haze and re-render without reloading 195 k
      // triangles. Used by out/terrain_probe.mjs; not read at install.
      (window as any).HERO_TERRAIN_TUNE = (cfg: any) => {
        if (cfg.density !== undefined) scene.fogDensity = cfg.density;
        if (cfg.color) scene.fogColor = new Color3(cfg.color[0], cfg.color[1], cfg.color[2]);
        if (cfg.mode === "linear") {
          scene.fogMode = Scene.FOGMODE_LINEAR;
          if (cfg.start !== undefined) scene.fogStart = cfg.start;
          if (cfg.end !== undefined) scene.fogEnd = cfg.end;
        } else if (cfg.mode === "exp2") {
          scene.fogMode = Scene.FOGMODE_EXP2;
        }
        return {
          mode: scene.fogMode,
          density: scene.fogDensity,
          color: [scene.fogColor.r, scene.fogColor.g, scene.fogColor.b],
        };
      };
    })
    .catch((e) => {
      console.error("terrain rock failed to load: " + e);
      // never leave the horizon empty
      const fallback = MeshBuilder.CreateBox(
        "rockFallback",
        { width: 1800, height: 240, depth: 400 },
        scene,
      );
      fallback.position.set(-200, 100, 3200);
      fallback.material = dirt;
    });
}
