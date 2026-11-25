// Touch controls: a thumb stick bottom-left for throttle, brake and steer, a
// handbrake under the right thumb. Both write into Input.touch, which the
// keyboard path already merges, so there is one physics read and no second
// code path.
import type { Input } from "./input";

const DEAD = 0.14; // fraction of the stick radius, per axis

export function installTouchControls(input: Input): void {
  const root = document.getElementById("touch");
  const stick = document.getElementById("stick");
  const knob = document.getElementById("knob");
  const handbrake = document.getElementById("hb");
  if (!root || !stick || !knob || !handbrake) return;

  const show = () => {
    document.body.classList.add("touch");
    root.hidden = false;
    input.touchActive = true;
  };

  // the input in use, not the input the device claims: a desktop with a
  // touchscreen stays on keys until somebody actually touches the glass
  window.addEventListener("touchstart", show, { once: true, passive: true });
  if (matchMedia("(pointer: coarse)").matches) show();
  window.addEventListener("keydown", () => {
    // a keyboard press means this is not a phone session after all
    if (document.body.classList.contains("touch") && input.touchActive) return;
  });

  const radius = () => stick.clientWidth * 0.42;
  const clear = () => {
    input.touch.throttle = 0;
    input.touch.brake = 0;
    input.touch.steer = 0;
    knob.style.transform = "translate(0px, 0px)";
    stick.classList.remove("live");
  };

  const apply = (x: number, y: number, ox: number, oy: number) => {
    const r = radius();
    let dx = (x - ox) / r;
    let dy = (y - oy) / r;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    knob.style.transform = `translate(${(dx * r).toFixed(1)}px, ${(dy * r).toFixed(1)}px)`;

    const shape = (v: number) => {
      const a = Math.abs(v);
      if (a < DEAD) return 0;
      return Math.sign(v) * ((a - DEAD) / (1 - DEAD));
    };
    const sx = shape(dx);
    const sy = shape(dy); // negative is up: throttle
    input.touch.steer = sx;
    input.touch.throttle = Math.max(0, -sy);
    input.touch.brake = Math.max(0, sy);
  };

  let pointer: number | null = null;
  let ox = 0;
  let oy = 0;

  stick.addEventListener("pointerdown", (e) => {
    pointer = e.pointerId;
    stick.setPointerCapture(e.pointerId);
    // origin is where the thumb landed, clamped into the stick, so a thumb that
    // lands slightly off-centre is still centred for the player
    const box = stick.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const r = radius();
    ox = Math.max(cx - r, Math.min(cx + r, e.clientX));
    oy = Math.max(cy - r, Math.min(cy + r, e.clientY));
    stick.classList.add("live");
    apply(e.clientX, e.clientY, ox, oy);
    e.preventDefault();
  });

  stick.addEventListener("pointermove", (e) => {
    if (pointer !== e.pointerId) return;
    apply(e.clientX, e.clientY, ox, oy);
    e.preventDefault();
  });

  const release = (e: PointerEvent) => {
    if (pointer !== e.pointerId) return;
    pointer = null;
    clear();
  };
  stick.addEventListener("pointerup", release);
  stick.addEventListener("pointercancel", release);
  stick.addEventListener("lostpointercapture", () => {
    pointer = null;
    clear();
  });

  handbrake.addEventListener("pointerdown", (e) => {
    handbrake.setPointerCapture(e.pointerId);
    handbrake.classList.add("on");
    input.touch.handbrake = true;
    e.preventDefault();
  });
  const hbOff = () => {
    handbrake.classList.remove("on");
    input.touch.handbrake = false;
  };
  handbrake.addEventListener("pointerup", hbOff);
  handbrake.addEventListener("pointercancel", hbOff);
  handbrake.addEventListener("lostpointercapture", hbOff);

  // iOS fires a long-press callout and a double-tap zoom on a game canvas
  document.addEventListener("gesturestart", (e) => e.preventDefault());
  document.addEventListener("dblclick", (e) => e.preventDefault());
}
