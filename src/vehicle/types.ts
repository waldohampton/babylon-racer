import type { InputState } from "../core/input";

export interface VehicleState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  vx: number;
  vz: number;
  speed: number; // magnitude
  forwardSpeed: number; // signed
  steer: number; // rad, current
  wheelSpin: number; // accumulated rad, signed
}

export interface VehicleDriver {
  step(dt: number, input: InputState): void;
  state(): VehicleState;
}
