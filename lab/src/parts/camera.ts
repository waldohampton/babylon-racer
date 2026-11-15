import type { LabCtx } from "../main";

/**
 * CAMERA. Owns framing: position, target, focal length and horizon height.
 *
 * PLACEHOLDER: the framing set in main.ts (42 degrees, low, three-quarter).
 * Replace with a shot that matches the reference composition: 40-45mm
 * equivalent, camera near car-body height, car filling the lower-centre third,
 * horizon around 45 percent of frame height.
 *
 * Framing changes invalidate band comparisons: measure AFTER the frame is
 * aligned, and keep the horizon where it is once agreed.
 */
export function installCamera(_ctx: LabCtx) {
  // intentionally empty placeholder; framing lives in main.ts for now
}
