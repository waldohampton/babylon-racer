import { TUNE } from "../core/config";
import type { InputState } from "../core/input";
import type { VehicleDriver, VehicleState } from "./types";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Kinematic bicycle model. Heading is turned by vF/wheelbase * tan(steer);
 * grip bleeds lateral velocity. No physics engine involved, so it is
 * deterministic and testable headlessly.
 *
 * Nose points along +Z at yaw 0: forward = (sin yaw, 0, cos yaw).
 */
export class BicycleVehicle implements VehicleDriver {
  private x = 0;
  private z = 0;
  private yaw = 0;
  private vx = 0;
  private vz = 0;
  private steer = 0;
  private spin = 0;
  /** true while the rear tyres are broken away and the car is sliding */
  private sliding = false;

  constructor(x = 0, z = 0, yaw = 0) {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
  }

  reset(x = 0, z = 0, yaw = 0) {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.vx = 0;
    this.vz = 0;
    this.steer = 0;
    this.spin = 0;
  }

  place(x: number, z: number, yaw = this.yaw) {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.vx = 0;
    this.vz = 0;
  }

  step(dt: number, input: InputState) {
    const T = TUNE;

    // --- steering: eased toward the request, self-centres when released ---
    const want = clamp(input.steer, -1, 1) * T.maxSteer;
    const rate = Math.abs(input.steer) > 0.01 ? T.steerRate : T.steerReturn;
    const dSteer = clamp(want - this.steer, -rate * dt, rate * dt);
    this.steer += dSteer;

    // --- split world velocity into the car's own frame ---
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let vF = this.vx * sin + this.vz * cos; // signed forward
    let vL = this.vx * cos - this.vz * sin; // lateral

    // engine, tapered so it stops accelerating at top speed
    if (input.throttle > 0) {
      const r = clamp(vF / T.topSpeed, 0, 1);
      const headroom = 1 - Math.pow(r, T.accelPower);
      vF += T.engineAccel * input.throttle * headroom * dt;
    }

    // brake, then reverse once stopped
    if (input.brake > 0) {
      if (vF > 0.2) {
        vF = Math.max(0, vF - T.brakeAccel * input.brake * dt);
      } else {
        vF = Math.max(-T.reverseMax, vF - T.reverseAccel * input.brake * dt);
      }
    }

    // drag and rolling resistance, guarded so a tiny vF cannot flip sign
    const drag = vF * Math.abs(vF) * T.dragQuad * dt;
    const roll = Math.sign(vF) * Math.min(Math.abs(vF), T.rollResist * dt);
    vF -= drag + roll;

    // --- lateral grip: two regimes ---
    // GRIP. The nose wins: sideways speed is simply deleted and the velocity is
    // rebuilt on the new heading, so a corner costs nothing. That is not
    // physical, it is the arcade lie the car has been tuned around, and the
    // measured corner radii depend on it.
    //
    // SLIDE. Once the rear is broken away the velocity keeps pointing where it
    // pointed and the body rotates around its own momentum. Grip then becomes a
    // budget: the tyres claw back at most latAccel metres per second of sideways
    // speed per second, and the rest is the drift.
    const slipNow = Math.abs(Math.atan2(vL, Math.max(Math.abs(vF), 0.5))) * (180 / Math.PI);
    if (input.handbrake) this.sliding = true;
    else if (this.sliding && slipNow < T.reGripSlip) this.sliding = false;

    if (this.sliding) {
      // power oversteer: throttle keeps the rear spinning, so releasing the
      // handbrake does not instantly hook the car back up
      const budget = input.handbrake
        ? T.handbrakeLatAccel
        : input.throttle > 0.1
          ? T.powerSlideGrip
          : T.latAccelMax;
      const maxKill = budget * dt;
      vL -= clamp(vL, -maxKill, maxKill);

      const dir = Math.sign(vF);
      if (input.handbrake) vF -= dir * Math.min(Math.abs(vF), T.handbrakeDrag * dt);
      vF -= dir * Math.min(Math.abs(vF), Math.abs(vL) * T.slideScrub * dt);

      // rebuilt on the OLD heading: whatever slide the tyres could not kill
      // keeps its direction in the world
      this.vx = vF * sin + vL * cos;
      this.vz = vF * cos - vL * sin;

      if (Math.abs(vF) > 0.05) {
        // Steering asks for a drift angle, not a yaw rate: full lock one way
        // asks for the deepest slide, countersteer asks for none, and the body
        // is driven toward the angle. Positive steer is right, which puts the
        // tail out to the left, so the target angle is negative.
        const target = -(this.steer / T.maxSteer) * T.maxDriftAngle;
        const slipSigned = Math.atan2(vL, Math.max(Math.abs(vF), 0.5)) * (vF >= 0 ? 1 : -1);
        // slip is (direction of travel - heading), so turning the body right
        // DECREASES it: the rate chases the target with the opposite sign
        const yawCap = input.handbrake ? T.handbrakeYawMax : T.driftYawMax;
        const rate = clamp((slipSigned - target) * T.driftYawGain, -yawCap, yawCap);
        this.yaw += rate * dt;
      }
    } else {
      vL = 0;
      if (Math.abs(vF) > 0.05) {
        const geometric = (vF / T.wheelbase) * Math.tan(this.steer);
        const yawCap = T.latAccelMax / Math.max(Math.abs(vF), 3);
        this.yaw += clamp(geometric, -yawCap, yawCap) * dt;
      }
      // the nose wins: carry the speed round to the new heading
      const s2 = Math.sin(this.yaw);
      const c2 = Math.cos(this.yaw);
      this.vx = vF * s2 + vL * c2;
      this.vz = vF * c2 - vL * s2;
    }

    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // wheel spin follows SIGNED forward travel, never speed: positive driving
    // spins them one way, reversing spins them the other
    this.spin -= (vF * dt) / T.tyreRadius;
  }

  state(): VehicleState {
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const vF = this.vx * sin + this.vz * cos;
    const vL = this.vx * cos - this.vz * sin;
    return {
      x: this.x,
      y: 0,
      z: this.z,
      yaw: this.yaw,
      vx: this.vx,
      vz: this.vz,
      speed: Math.hypot(this.vx, this.vz),
      forwardSpeed: vF,
      steer: this.steer,
      wheelSpin: this.spin,
      // positive when the car's tail is sliding to its right: the body points
      // further round the corner than the car is actually travelling
      slip: Math.atan2(vL, Math.max(Math.abs(vF), 0.5)) * Math.sign(vF || 1),
    };
  }
}
