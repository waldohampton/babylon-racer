// One input struct. Physics never reads a key code; every source writes here.
export interface InputState {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1..1 (right positive)
  handbrake: boolean;
}

const empty = (): InputState => ({ throttle: 0, brake: 0, steer: 0, handbrake: false });

export class Input {
  state: InputState = empty();
  private keys = new Set<string>();
  private resetRequested = false;

  // written by the touch stick and the handbrake button, merged in tick()
  touch: InputState = empty();
  touchActive = false;

  constructor() {
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
      if (e.code === "KeyR") this.resetRequested = true;
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
  }

  /** Test/autopilot seam: write an input directly, bypassing the keyboard. */
  set(s: Partial<InputState>) {
    Object.assign(this.state, s);
  }

  press(code: string, down: boolean) {
    if (down) this.keys.add(code);
    else this.keys.delete(code);
  }

  takeReset(): boolean {
    const r = this.resetRequested;
    this.resetRequested = false;
    return r;
  }

  tick(_dt: number) {
    const k = this.keys;
    const fwd = k.has("KeyW") || k.has("ArrowUp");
    const back = k.has("KeyS") || k.has("ArrowDown");
    const left = k.has("KeyA") || k.has("ArrowLeft");
    const right = k.has("KeyD") || k.has("ArrowRight");
    // digital keys ramp to full over a couple of frames so the car is not
    // binary on/off; an analog source (touch stick) writes over this directly.
    const ramp = (cur: number, target: number) => {
      const step = 6 / 60;
      return cur + Math.max(-step, Math.min(step, target - cur));
    };
    this.state.throttle = ramp(this.state.throttle, fwd ? 1 : 0);
    this.state.brake = ramp(this.state.brake, back ? 1 : 0);
    this.state.steer = ramp(this.state.steer, (right ? 1 : 0) - (left ? 1 : 0));
    this.state.handbrake = k.has("Space");

    // a stick is analog: it writes over the ramp instead of being ramped
    if (this.touchActive) {
      this.state.throttle = Math.max(0, Math.min(1, this.touch.throttle));
      this.state.brake = Math.max(0, Math.min(1, this.touch.brake));
      this.state.steer = Math.max(-1, Math.min(1, this.touch.steer));
      this.state.handbrake = this.state.handbrake || this.touch.handbrake;
    }
  }
}
