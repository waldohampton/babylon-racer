import type { LabCtx } from "../main";

/**
 * SKY. Owns: scene background, the environment map (IBL), and any sky dome.
 *
 * PLACEHOLDER. Replace with a photographed storm sky. Target measured from the
 * reference still: sky band luma 75, cool by 6 (R-B), nothing clipped.
 * See ../../CONTRACT.md for the measurement commands.
 */
export function installSky(ctx: LabCtx) {
  const { scene } = ctx;
  // flat placeholder so the frame is not black; a real sky replaces this
  scene.clearColor.set(0.27, 0.3, 0.29, 1);
}
