import type { LabCtx } from "../main";

/**
 * POST AND GRADE. Owns the rendering pipeline, tone mapping, bloom, grain,
 * vignette and the colour grade.
 *
 * PLACEHOLDER: nothing. Replace with DefaultRenderingPipeline plus image
 * processing: ACES tone mapping, bloom with a HIGH threshold (the reference has
 * nothing above 177/255, so bloom stays subtle), film grain, vignette, and a
 * teal-shadow / amber-highlight grade that lifts blacks to about 4, not 0.
 */
export function installPost(_ctx: LabCtx) {
  // intentionally empty placeholder
}
