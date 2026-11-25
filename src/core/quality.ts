// One place that decides how hard the scene is allowed to work. The phone gets
// smaller textures, a smaller shadow map and a shorter draw distance; the
// desktop tier is what shipped before this existed.
import { asset } from "./assets";

export interface QualityTier {
  name: "high" | "low";
  dprCap: number; // device pixel ratio cap, the cheapest performance dial there is
  shadowSize: number;
  shadowBlur: number;
  clearCoat: boolean;
  groundAlbedo: string;
  groundNormal: string;
  planeSize: number; // metres
  fogDensity: number;
  carModel: string;
}

const HIGH: QualityTier = {
  name: "high",
  dprCap: 2,
  shadowSize: 2048,
  shadowBlur: 24,
  clearCoat: true,
  groundAlbedo: asset("tex/ground_sand_diff.jpg"),
  groundNormal: asset("tex/ground_sand_nor.jpg"),
  planeSize: 600,
  fogDensity: 0.0024,
  carModel: asset("assets/car/muscle-grab3d.glb"),
};

const LOW: QualityTier = {
  name: "low",
  dprCap: 2, // 3x on a phone buys nothing visible and costs 2.25x the fragments
  shadowSize: 1024,
  shadowBlur: 16,
  clearCoat: false,
  groundAlbedo: asset("tex/ground_sand_diff_1k.jpg"),
  groundNormal: asset("tex/ground_sand_nor_1k.jpg"),
  planeSize: 400,
  fogDensity: 0.006, // closes the edge of a 400 m plane
  carModel: asset("assets/car/muscle-grab3d-1k.glb"),
};

/**
 * Coarse pointer *and* a small screen, because a touchscreen laptop should keep
 * the high tier. `?q=low` / `?q=high` forces it for testing.
 */
export function pickTier(): QualityTier {
  const forced = new URLSearchParams(location.search).get("q");
  if (forced === "low") return LOW;
  if (forced === "high") return HIGH;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const small = Math.min(window.innerWidth, window.innerHeight) <= 820;
  return coarse && small ? LOW : HIGH;
}
