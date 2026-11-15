import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { LabCtx } from "../main";

/**
 * CAMERA. Owns framing: position, aiming, focal length and horizon height.
 *
 * The placeholder in main.ts (pos 4.6,1.1,-5.9 / target 0,0.85,0 / fov 42 deg)
 * is a ~26 mm equivalent wide angle with the horizon near mid-frame. This file
 * replaces it with the reference still's rig, measured in reference/SPEC.md and
 * reference/measurements.json, then solved against this scene's own car
 * geometry (every car vertex projected through the candidate camera) rather
 * than dialled in by eye.
 *
 * TARGET (SPEC section 0, accepts +-0.02 on the car box, +-0.008 on the horizon):
 *   horizon row        fy 0.352
 *   car bbox           fx 0.244 - 0.728   (0.484 of frame width)
 *                      fy 0.516 - 0.771   (0.255 of frame height)
 *   tyre contact line  fy 0.771
 *   lens               40 mm equivalent  -> vertical fov 28.4 deg
 *   rig                 2.2 m above the asphalt, ~10.5 m from the car, pitched
 *                       4.3 deg down
 *
 * SOLVED FOR THIS SCENE (car at the origin, nose toward -Z, 4.68 x 1.92 x 1.39 m):
 *   azimuth 62 deg off head-on, distance 11.25 m, height 2.11 m, pitch 4.28 deg
 *   -> horizon 0.352, car bbox fx 0.2455-0.7265, fy 0.470-0.771
 * The rig the solve lands on (2.11 m / 11.25 m / 4.28 deg) is within 5 percent of
 * the SPEC's independently derived 2.22 m / 10.5 m / 4.3 deg, which is the
 * strongest evidence that the framing is right.
 *
 * THE AZIMUTH IS 62 DEG, NOT THE ~35 DEG THE ROAD'S VANISHING POINT IMPLIES.
 * The plate is not self-consistent about this (SPEC trap 8): its car bbox implies
 * an almost broadside car (bbox height 0.255 = the car's own height at 10.5 m, so
 * no far-end tilt), while its road exits the right edge as if the camera axis
 * were only ~35 deg off the road direction. Both cannot hold for a car parallel
 * to the road. The car-side evidence wins here for two reasons: (a) the front
 * face occupies fx 0.24-0.33 of the plate, i.e. 18.6 percent of the car's frame
 * width, which pins the azimuth at 1.92cos/(4.68sin+1.92cos) = 0.186 -> 61 deg;
 * (b) the car is ours to frame and the car's silhouette is what the mid band is
 * measured on. At 62 deg the front face projects to fx 0.240-0.301, i.e. 12.7
 * percent of the car's width - compressed harder than the plate's 18.6 percent,
 * the honest cost of a car that cannot be yawed relative to its road.
 *
 * THE ROAD STILL CROSSES THE FRAME, measured on this camera: the yellow
 * centreline exits the right edge at fy 0.629 (plate: 0.533 for the yellow,
 * ~0.62 for the asphalt edge), the asphalt's near edge exits at fy 0.816, and
 * the white edge line crosses the bottom of frame at fx 0.380 (plate ~0.32).
 * The road's true vanishing point for the +Z direction lands off-frame right at
 * fx 2.56, higher than the plate's extrapolated 1.29, which is the same
 * inconsistency seen from the other side.
 *
 * THE CAR BOX IS 0.046 TALL IN FRAME (roof at fy 0.470, plate 0.516). The
 * placeholder GLB is 4.68 m long and 1.39 m tall - 10 percent taller for its
 * length than the plate's car - and the camera stands 2.1 m up, so the far end
 * of the car sits higher in frame than the near end and inflates the bbox. The
 * contact line (fy 0.772 vs plate 0.771) and the width (0.481 vs plate 0.484)
 * are hit because those carry the depth and the composition; matching the roof
 * instead would move the tyres off the road-depth that the ground band is
 * measured against. Even a pure broadside view only closes half of the gap.
 *
 * NO DEPTH OF FIELD. The plate is deep focus: the near tyre and the mesas are
 * both sharp, and only atmospheric haze softens distance. Nothing here adds a
 * lens blur and nothing downstream should.
 */
export function installCamera(ctx: LabCtx) {
  const { camera } = ctx;

  // 40 mm on a full-frame 36 x 24 mm sensor, cropped to 16:9 (36 x 20.25 mm).
  const focalMm = 40;
  const sensorH = 20.25;
  const fovDeg = (2 * Math.atan(sensorH / (2 * focalMm)) * 180) / Math.PI; // 28.41

  // The horizon is the vanishing row of the ground plane (elevation 0, any
  // distance). With a vertical-fixed fov its row is set by pitch alone:
  //   row = 0.5 - 0.5 * tan(pitch) / tan(fov / 2)
  // Inverting that keeps the horizon on 0.352 even if the focal length or the
  // window aspect changes, which is the one number every band depends on.
  const horizonFrac = 0.352;
  const pitchDeg =
    (Math.atan((0.5 - horizonFrac) * 2 * Math.tan((fovDeg * Math.PI) / 360)) * 180) / Math.PI; // 4.28

  const azimuthDeg = 62; // off head-on: flank dominant, front face 12.7 % of the car
  const height = 2.11; // metres above the asphalt
  const distance = 11.25; // horizontal, car centre to camera

  // The optical axis is aimed a hair right of the car's centre so the car lands
  // on fx 0.244-0.728 (the plate's box) rather than dead centre.
  const yawDeg = -61.62;
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;

  // camera stands in front of the nose (-Z) and out along the car's +X flank
  const az = (azimuthDeg * Math.PI) / 180;
  const px = distance * Math.sin(az);
  const pz = -distance * Math.cos(az);
  camera.position.set(px, height, pz);

  // Aim at the ground point the axis actually lands on: pitched down by `pitch`,
  // that point is height / tan(pitch) metres downrange along the view azimuth.
  const aimDist = height / Math.tan(pitch);
  camera.setTarget(
    new Vector3(px + Math.sin(yaw) * aimDist, 0, pz + Math.cos(yaw) * aimDist)
  );

  camera.fov = (fovDeg * Math.PI) / 180;
  // vertical-fixed (Babylon default): the horizon fraction then holds at any
  // window aspect instead of drifting with the canvas size
  camera.fovMode = 0;

  camera.minZ = 0.1;
  camera.maxZ = 30000; // the scanned ridge sits 7-17 km out

  (window as any).CAM = {
    pos: camera.position.asArray().map((v) => +v.toFixed(3)),
    fovDeg: +fovDeg.toFixed(2),
    focalMm,
    pitchDeg: +pitchDeg.toFixed(2),
    yawDeg,
    azimuthDeg,
    horizonFrac,
    target: camera.getTarget().asArray().map((v) => +v.toFixed(2)),
  };
}
