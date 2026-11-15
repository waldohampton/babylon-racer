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
    let sin = Math.sin(this.yaw);
    let cos = Math.cos(this.yaw);
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

    // --- lateral grip: exponential bleed, stable at any dt ---
    const grip = input.handbrake ? T.handbrakeGrip : T.gripBleed;
    vL *= Math.exp(-grip * dt);

    // --- heading (bicycle model, then grip-limited) ---
    // Geometry alone lets full lock at 55 km/h spin the car like a top; real
    // tyres cap lateral acceleration, so clamp the yaw rate to latAccelMax.
    if (Math.abs(vF) > 0.05) {
      const geometric = (vF / T.wheelbase) * Math.tan(this.steer);
      const yawCap = T.latAccelMax / Math.max(Math.abs(vF), 3);
      const yawRate = clamp(geometric, -yawCap, yawCap);
      this.yaw += yawRate * dt;
    }

    // rebuild world velocity from the NEW heading so the car carries its
    // momentum round the corner instead of snapping to a new direction
    sin = Math.sin(this.yaw);
    cos = Math.cos(this.yaw);
    this.vx = vF * sin + vL * cos;
    this.vz = vF * cos - vL * sin;

    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // wheel spin follows SIGNED forward travel, never speed: positive driving
    // spins them one way, reversing spins them the other
    this.spin -= (vF * dt) / T.tyreRadius;
  }

  state(): VehicleState {
    return {
      x: this.x,
      y: 0,
      z: this.z,
      yaw: this.yaw,
      vx: this.vx,
      vz: this.vz,
      speed: Math.hypot(this.vx, this.vz),
      forwardSpeed: this.vx * Math.sin(this.yaw) + this.vz * Math.cos(this.yaw),
      steer: this.steer,
      wheelSpin: this.spin,
    };
  }
}
