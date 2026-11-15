// Every tunable in one place. Numbers carried over from the earlier vehicle
// builds, which are already proven; change them here, not in the physics.
export const TUNE = {
  step: 1 / 60,

  // vehicle geometry
  wheelbase: 2.6,
  hullRadius: 0.95,
  hullHalfLen: 1.15, // circle offset, NOT half the length: 2*1.15 + 2*0.95 = 4.2 m
  tyreRadius: 0.366,

  // steering
  maxSteer: 0.55, // rad, ~31 deg
  steerRate: 2.6, // rad/s toward target
  steerReturn: 3.2, // rad/s self-centre

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
  // means understeer instead of a spin. 12 m/s^2 ~ 1.2 g.
  latAccelMax: 12.0,
  gripBleed: 9.0, // lateral velocity bleed per second
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
