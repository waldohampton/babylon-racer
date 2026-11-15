import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import { ColorCurves } from "@babylonjs/core/Materials/colorCurves";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import type { LabCtx } from "../main";

/**
 * POST AND GRADE. Owns the rendering pipeline, tone mapping, bloom, grain,
 * vignette and the colour grade.
 *
 * The shot is graded once, in one place, with a photographic print curve
 * rather than a pile of sliders:
 *
 *   scene linear --exposure--> ACES (shoulder) --> gamma --> contrast (toe lift)
 *   --> colour curves (cool shadows / warm, restrained highlights) --> grain
 *   --> vignette is applied in linear before tone mapping, as a lens does.
 *
 * Calibrated against reference/target.png, which has a brightest pixel of
 * 177/255 and no band above 200. Scene-linear light maps to display like this
 * (checked against a real capture, luma weights as in scripts/bands.py):
 *
 *   scene linear 0.000 ->   6/255   lifted black floor (reference p1 is 4)
 *   scene linear 0.020 ->  14/255
 *   scene linear 0.050 ->  33/255
 *   scene linear 0.180 ->  91/255   18% grey
 *   scene linear 0.500 -> 154/255
 *   scene linear 1.000 -> 178/255   scene white lands on the reference maximum
 *   scene linear 2.000 -> 196/255
 *   scene linear 3.000 -> 203/255
 *
 * Scene white lands on the reference's brightest pixel, and the shoulder holds
 * anything up to scene-linear ~2.3 under 200, so the grade cannot blow out on
 * in-range content: exposure sets the ceiling, the ACES shoulder does the
 * roll-off, and the colour curves are multiplicative.
 */
export function installPost(ctx: LabCtx) {
  const { scene, camera } = ctx;

  // HDR: the scene renders to a half-float target so highlights survive the
  // tone mapping shoulder instead of being clamped to white in the buffer.
  const caps = scene.getEngine().getCaps();
  const hdr = !!(caps.textureHalfFloatRender || caps.textureFloatRender);
  const pipeline = new DefaultRenderingPipeline("hero", hdr, scene, [camera]);

  // --- image processing (tone mapping + grade) -----------------------------
  const ip = scene.imageProcessingConfiguration;
  ip.isEnabled = true;
  ip.applyByPostProcess = true; // the pipeline applies it once, on the HDR buffer

  ip.toneMappingEnabled = true;
  ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;

  // One exposure dial, in linear light, and it stays at unity: the lighting
  // rig owns exposure (the sun part calibrates to the band numbers), and this
  // curve places scene white on the reference's 177 with a shoulder above it.
  // Turn this down if a future part ever pushes the frame over 200.
  ip.exposure = 1.0;
  // Contrast < 1 mixes toward mid grey, which is the print toe: a black pixel
  // becomes 6/255 instead of 0, and 4/255 once the vignette has done its work
  // in the corners. The shoulder is done by ACES, not by contrast.
  ip.contrast = 0.955;

  // Colour grade: teal shadows, restrained amber highlights, slightly
  // desaturated overall. Multiplicative and capped at 1.0 per channel, so the
  // grade can never push a pixel above the curve's ceiling.
  const curves = new ColorCurves();
  curves.globalHue = 0;
  curves.globalDensity = 0;
  curves.globalSaturation = -5; // -5% saturation: restrained, not a "look"
  curves.shadowsHue = 205; // cool slate-teal
  curves.shadowsDensity = 45;
  curves.shadowsSaturation = 0;
  curves.midtonesHue = 0;
  curves.midtonesDensity = 0;
  curves.midtonesSaturation = 0;
  // Highlights: amber tint *and* the print shoulder. highlightsExposure -49
  // scales the highlight region to 0.88 of its value, so the top of the range
  // rolls into the reference's 177 instead of ACES' 205. The multiplier is
  // (0.880, 0.847, 0.791) and the curve stays monotonic (checked on a 4001
  // point sweep of the whole 0..1 range), so it shoulders rather than flattens.
  curves.highlightsHue = 38;
  curves.highlightsDensity = 45;
  curves.highlightsSaturation = 0;
  curves.highlightsExposure = -49;
  ip.colorCurvesEnabled = true;
  ip.colorCurves = curves;

  // Soft optical vignette, applied in linear light before ACES. vignetteCameraFov
  // is matched to the 42 degree lens so falloff starts at the frame edge.
  ip.vignetteEnabled = true;
  ip.vignetteWeight = 1.9;
  ip.vignetteStretch = 0.15;
  ip.vignetteCameraFov = (42 * Math.PI) / 180;
  ip.vignetteColor = new Color4(0.62, 0.62, 0.66, 1); // corners fall, never to black
  ip.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;

  // Fine dither under the grain: kills banding in the sky gradient.
  ip.ditheringEnabled = true;
  ip.ditheringIntensity = 0.02;

  // --- bloom: halation only on genuinely hot things ------------------------
  // The extract pass threshold is compared against colour * exposure (the
  // pipeline feeds the image-processing exposure into the bloom), so with
  // exposure at unity this is scene-linear. 0.8 is just under the 1.0 that
  // lands on the reference's 177: only genuinely hot pixels glow, paint and
  // midtones never do.
  pipeline.bloomEnabled = true;
  pipeline.bloomThreshold = 0.8;
  pipeline.bloomWeight = 0.22;
  pipeline.bloomKernel = 64;
  pipeline.bloomScale = 0.5;

  // --- grain: film stock, not noise ---------------------------------------
  pipeline.grainEnabled = true;
  pipeline.grain.intensity = 8; // +/-8/255 at mid grey, tapering to 0 at black/white
  pipeline.grain.animated = false; // deterministic frame for capture

  // --- optics -------------------------------------------------------------
  pipeline.fxaaEnabled = true; // thin poles and wires, without fringing
  // Chromatic aberration deliberately OFF. Even at 0.0003 UV the car's roofline
  // against the bright horizon fringed magenta/cyan on capture, and the
  // reference has none: a lens artefact that reads as a bug is not worth it.
  pipeline.chromaticAberrationEnabled = false;

  (window as any).HERO_POST = { pipeline, ip, hdr };
}
