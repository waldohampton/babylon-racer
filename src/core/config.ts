// Every tunable in one place. Numbers carried over from the earlier vehicle
// builds, which are already proven; change them here, not in the physics.
export const TUNE = {
  step: 1 / 60,

  // vehicle geometry
  wheelbase: 2.6,
  hullRadius: 0.95,
  hullHalfLen: 1.15, // circle offset, NOT half the length: 2*1.15 + 2*0.95 = 4.2 m
  tyreRadius: 0.366,

  // steering. Lock was 0.55 / 2.6 / 3.2 and the car asked for tighter turns
  // twice: 41 deg of lock is a 2.8 m turning circle on the geometry, and the
  // rate is up so full lock arrives in 0.15 s.
  maxSteer: 0.72, // rad, ~41 deg
  steerRate: 4.8, // rad/s toward target
  steerReturn: 5.0, // rad/s self-centre

  // drive
  engineAccel: 8.0, // m/s^2 at rest, tapers with a power curve
  topSpeed: 46.0, // m/s ceiling for the taper; real top emerges from drag
  accelPower: 2.5, // taper exponent: feels progressive, not binary
  brakeAccel: 11.0,
  reverseAccel: 4.0,
  reverseMax: 8.0,
  dragQuad: 0.0011,
  rollResist: 0.4,

  // grip: yaw rate is capped by lateral acceleration, so full lock at speed
  // means understeer instead of a spin. 12 m/s^2 ~ 1.2 g bound at every speed
  // and is what made the car feel like it would not turn; 19 was still not
  // enough; 26 ~ 2.6 g is arcade race car, roughly a third of the original
  // radius again.
  latAccelMax: 26.0,
  gripBleed: 13.0, // lateral velocity bleed per second
  handbrakeGrip: 1.6,

  chase: {
    dist: 6.2,
    height: 1.9,
    lookAhead: 3.0,
    lookHeight: 1.0,
    fovBase: 46,
    fovSpeed: 53,
    fovLerp: 3,
    posLerp: 9,
    armIn: 18,
    armOut: 6,
    swingIdle: 0.7,
  },
} as const;
