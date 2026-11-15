# HERO FRAME — REFERENCE SPECIFICATION

Source: `reference/target.png`, 2752 × 1536 (aspect 1.7917), sRGB 8-bit.
Everything below is measured off that file unless the line is marked **[recommendation]** or
**[inference]**. Nothing here is a guess about "what looks good" — it is what the pixels do.

Conventions used throughout:

- **Fraction coordinates** are `(fx, fy)` = x / 2752, y / 1536, **origin top-left**, y down.
  They are directly reusable on a 1920 × 1080 render (fractions are resolution independent).
- **Luma** = Rec.709 = `0.2126 R + 0.7152 G + 0.0722 B`, identical to `scripts/bands.py`.
- **Warmth** = `R - B` in 0–255 units, identical to `bands.py`.
- **near-black** = share of pixels with luma < 30 (bands.py's `black`).
- **blown** = share of pixels with luma > 200 (bands.py's `blown`).
- **sharp** = `mean(|dL/dy + dL/dx|)`, bands.py's sharpness figure.

Measurement tooling created for this spec: `reference/measurements.json` (machine-readable
region statistics), crops in `reference/crops/`.

---

## 0. The ten numbers that matter

| what | target |
|---|---|
| horizon line | **fy = 0.352** (y = 540 px) |
| ground below horizon | **65 % of frame height** |
| car bounding box | **fx 0.244 → 0.728, fy 0.516 → 0.771** (1332 × 392 px) |
| car tyre contact line | **fy = 0.771** |
| sun glow centre | **fx ≈ 0.80, fy 0.326** (just above the horizon, right of centre); **no visible sun disc** |
| frame luma | 76.1 (p1 4.0 / p50 70.4 / p99 176.8) |
| blown | **0.0 %** — only 143 px (0.003 %) exceed luma 200; p99.9 is 192 and the body of the frame tops out near 197 |
| near-black share | 12.6 % frame-wide |
| sharpness | 8.28 at 2752 wide (= 8.12 at 1920 wide) |
| lens | ≈ 40 mm full-frame equivalent (h-FOV 48.5°, **v-FOV 28.4°**) |

Band table, reference vs its own downscale to 1920 × 1080. Luma, warmth and the black/blown
shares are identical to within 0.2, so compare your 1920 × 1080 canvas straight against
`bands.py`'s numbers. (Sharpness moves slightly between the two sizes — see trap 2.)

```
band       luma    ref      d |   warm    ref      d | blown% black%
sky        75.0   75.0   +0.0 |   -5.8   -5.9   +0.1 |    0.0    1.2
horizon    58.0   58.0   +0.0 |    0.6    0.7   -0.1 |    0.0   13.0
mid        57.0   56.9   +0.1 |   22.8   22.8   +0.0 |    0.0   33.9
ground    114.3  114.2   +0.1 |   53.0   53.0   +0.0 |    0.0    8.4
frame    luma 76.1 | p1 4.0 | p50 70.4 | p99 176.3 | sharp 8.12   (at 1920 wide)
```

Band edges are `bands.py`'s: sky 0.03–0.35, horizon 0.35–0.52, mid 0.52–0.70,
ground 0.70–0.97, sampled across the centre 70 % of width (fx 0.15–0.85).

---

## 1. Composition — what is actually in the frame

The shot is **not** a receding-road-down-the-middle composition. Read this before you
place anything:

```
 fy 0.00 ─────────────────────────────────────────────
    0.03   heavy storm cloud, sky band, coolest at fx 0.15-0.30
    0.20   darkest cloud mass (L 59, nearly featureless)
    0.30   cloud base breaks; warm glow builds
    0.326  SUN GLOW PEAK, fx 0.76-0.82, RGB (216,169,117)
    0.352  ─── HORIZON ─── mesas / distant plain, cool and hazed
    0.352-0.56   LEFT THIRD: a near, unlit landform, L ≈ 23, RGB (18,25,26)
    0.36-0.62    desert plain in haze, warming as it comes forward
    0.60-1.00    RIGHT HALF: the road, sweeping in from frame-right
    0.516-0.771  the car, x 0.244-0.728
    0.70-0.83    brightest large band of the frame: sunlit road, L 137-147 (only the sun glow at fy 0.326 is brighter, L 175)
    0.94-1.00    foreground darkens again (L 84 at fy 0.99)
 fy 1.00 ─────────────────────────────────────────────
```

- **The road crosses the frame, it does not vanish inside it.** The double yellow runs
  from about (fx 0.49, fy 0.94) at the bottom up to the **right edge at fy ≈ 0.62**, where
  the asphalt exits frame. The implied vanishing point is off-frame right at roughly
  (fx 1.29, fy 0.33) — i.e. the camera looks *along* the road at a shallow angle and the
  road's far end leaves the right edge. Do not build a composition with the road
  converging to a point in the middle of the frame.
- **The camera stands on/next to the left shoulder.** The car sits in the near (left) lane;
  its nose crosses the white edge line onto the shoulder. The double yellow's centre passes
  x ≈ 1943 px at fy 0.78. The white edge line is visible where the shoulder meets the
  asphalt, around **fx 0.30–0.33 at the bottom of frame** — this one is read from the crops,
  not machine-measured (it is too eroded to peak-detect), so treat it as ±0.02.
- **The car faces frame-left and slightly toward the camera** — front-left three-quarter.
  Front end (grille, four round headlamps, chrome bumper) is at fx ≈ 0.24-0.33; rear is at
  fx ≈ 0.65-0.73. The car is ~23° off broadside **[inference]**, so the flank is the star and
  the front face is compressed.

### Reverse-engineered camera **[inference, self-consistent to ±5 %]**

Three independent measurements agree on this rig:

- horizon at fy 0.352 → 228 px above frame centre → 4.27° of pitch at f = 3053 px
- car tyre contact at fy 0.771 → 644 px below the horizon
- car height in frame 392 px

Take the car as 1.35 m tall ⇒ **290 px per metre at the car's distance**.
Then `camera height = 644 / 290 = 2.22 m` above the asphalt, and (for a 40 mm equivalent
lens, v-FOV 28.4°, f = 3053 px at this width) the car sits **≈ 10.5 m** from the camera, with
the camera pitched **4.3° down**. That pitch is independently confirmed from the car itself:
a 2.22 m camera over a 1.35 m roof at 10.5 m is 4.6°, and the roof rim measures **252 px**
below the horizon — 4.7°. Two routes, 0.1° apart.

**Babylon values [recommendation]:**

```ts
camera.fov = 28.4 * Math.PI / 180;          // 0.4957 rad — VERTICAL. NOT 42°.
camera.minZ = 0.1;                           // keep
// position: 10.5 m from the car's centre, 2.22 m above the road plane,
// azimuth such that the car's long axis sits ~23° off broadside
camera.rotation.x = -4.3 * Math.PI / 180;   // pitched DOWN
```

The current placeholder `fov = 42°` (in `main.ts`) is a **68.6° horizontal** field — about a
28 mm equivalent, roughly 1.5× too wide. At 42° you would have to stand far closer to hold
48 % of frame width, and the car's near-field proportions and the ground convergence would
both break. Change the fov first, then dial the distance until the bbox lands.

**Acceptance test for the camera part:** with the real car in place, measure the frame and
require horizon 0.352 ± 0.008, car bbox 0.244–0.728 ± 0.02, car base 0.771 ± 0.015. Those
three numbers *are* the camera.

---

## 2. Sky

**Structure, top to bottom:**

| fy | what | measured |
|---|---|---|
| 0.00–0.07 | dense overcast, lightest of the cloud, top edge clipped by frame | L 72.9, warm −21.9, p95 115 |
| 0.07–0.18 | slategrey deck, some soft volumetric structure | L 77 → 68, warm −19 → −17 |
| 0.18–0.24 | **darkest cloud mass** — smooth, almost no detail | L 58.9, std 8.2, warm −15.3 |
| 0.24–0.29 | transition, cloud base lifting | L 69.7, warm −4.8 |
| 0.29–0.35 | **glow band**: cloud underside lit from below | L 98.0, warm +30.0, p95 139 |

- Sky band as a whole: **luma 75.0, warmth −5.9, near-black 1.1 %, blown 0.0 %, p5 44.7,
  p95 134.3, std 28.3, sharp 4.65.** It is the smoothest large region in the frame — the sky
  carries *shape*, not texture. If your sky has visible high-frequency grain or a starfield
  of noise, it is wrong.
- Colour anchor points (mean of a 12 px patch):
  - top of frame, fx 0.545: **RGB (53, 75, 80)**, L 70.8 — teal-slate, B > G > R
  - darkest cloud, fx 0.276 fy 0.130: **RGB (28, 48, 55)**, L 44.6, warmth −27.0
  - lit cloud underside, fx 0.545 fy 0.130: **RGB (99, 112, 112)**, L 109.1, warmth −12.6
- **Horizontal gradient** (sky band, left → right, same rows):
  fx 0.15–0.30 → RGB (47, 67, 71), L 62.9, warm −24.2;
  fx 0.45–0.60 → (66, 75, 75), L 72.8, warm −8.8;
  fx 0.75–0.85 → (76, 76, 71), L 75.6, warm +4.6.
  The sky is cool blue-teal at the left and goes neutral/warm toward the sun on the right.
  A single flat sky colour cannot do this; the equirect/texture must carry the gradient.
- **Light direction within the clouds:** from *below*, off the horizon — the underside of
  the deck near the horizon is the brightest part of the clouds, and the deck gets darker as
  you look up. That is the opposite of a normal daylight sky and it is why the frame reads
  as storm-at-sunset.
- **Rain curtain:** a soft, slightly lighter vertical veil descending from the mid-left
  cloud bank around **fx 0.18–0.30, fy 0.15–0.35**. Very low contrast (a few luma steps).
  It is not a god ray and it is not a hard sheet of rain.

## 3. Sun and exposure

- **The sun disc is not visible.** No disc, no flare, no visible limb. Only a glow.
- Glow peak: **fx 0.76–0.82, fy 0.326**, RGB **(216, 169, 117)**, L 175, warmth **+99**.
  The glow band spans fx ≈ 0.65 → 0.90 and about 0.30 → 0.345 in y.
- Sun elevation ≈ **0.5–1.0° above the horizon line itself**; azimuth ≈ **15° right of the
  camera axis** (from `atan(0.30 × 2 × tan 24.25°)`). For the light rig: **elevation 4–6°**
  with the visible glow sitting on the horizon is the practical compromise
  **[recommendation]** — a 1° light gives no modelling on the car at all.
- **Exposure is set by the ground, not the sky.** The ground band is the bright one
  (luma 114) and the sky is far darker in linear terms — 2.5× in linear light, about 1.3
  stops. If you expose for the sky you get a correct sky and a dead ground; the plate is the
  reverse. Calibrate exposure so that the sunlit road at fy 0.75 lands on **L ≈ 137–147,
  RGB ≈ (178, 142, 106)**.
- **Ceiling:** p99 is 176.8, p99.9 is 192, and only **143 pixels of 4.2 M (0.003 %)** exceed
  luma 200 — a handful of warm specular glints reading ≈ (234, 197, 146), mostly on the car's
  chrome/roof at (fx 0.44–0.51, fy 0.52–0.65) and the glow at the right edge. Everything else
  tops out near 197. Tone-map so that the bulk of the highlights sit at **180–195** and only
  a few pixels crest 200; bloom must never push a region over ~200.

## 4. Terrain

- **Horizon at fy 0.352**, and it is a *haze* line as much as a silhouette line.
- **Mesas:** 5–7 distinct flat-topped forms, all on the right half of the frame.
  - fx 0.55–0.75: tops at **fy 0.344–0.357**, only ~0.01 of frame height above the horizon
    line; warm because the glow is behind them — at fx 0.69 fy 0.404 the form reads
    **RGB (88, 77, 66), L 78.5, warmth +22.2**.
  - fx 0.85–0.96: fy 0.337–0.352, barely separable from the haze; (74, 66, 54) L 67, +20.5.
  - **Left of fx 0.30 there is no distant mesa at all.** The skyline there (tops at
    fy 0.317–0.326, the highest in the frame) is the top edge of the *near* dark landform
    described below. It is not hazed, because it is not far away — the colour right under
    that edge is (12, 25, 33), L 23. If you give it haze it will read as a distant mountain
    and the whole left side of the frame will sit at the wrong distance.
  - Cool-vs-warm rule: the *readable* distant forms carry warmth from the glow (+20), while
    the near-left mass is the coldest thing in the frame (−14.5). Coolness here means *near and
    unlit*, not *far and hazed* — the opposite of the usual aerial-perspective instinct.
- **The near-left landform.** The left third of the frame between fy 0.33 and fy 0.56 is a
  large, very dark, strongly blue mass: measured over fx 0.02–0.20, fy 0.36–0.52 it is
  **RGB (18, 25, 26), L 23.7, warmth −8.5, std 8.3, p5 11.3, p95 39.9**; its upper part
  (fy 0.36–0.44) is colder still at (15, 25, 29), L 22.8, **warmth −14.5, std 4.8**. That
  std of 4.8 against the horizon band's 26.2 is the point: it is flat, with essentially no
  visible surface detail, and reads as a silhouette lit only by skylight — a shadowed
  bank/bluff the camera is standing beside. It is the darkest large area in the frame after
  the car. Do **not** texture it and do **not** haze it.
- **Aerial perspective is the strongest colour lever in the shot.** Same ground, right side
  of frame, sampled by depth:

  | fy | luma | RGB | warmth |
  |---|---|---|---|
  | 0.36–0.40 | 61.2 | (63, 61, 58) | +5.2 |
  | 0.42–0.46 | 69.0 | (78, 68, 55) | +22.6 |
  | 0.48–0.52 | 71.1 | (82, 70, 55) | +27.0 |
  | 0.55–0.60 | 82.5 | (93, 81, 67) | +25.9 |
  | 0.62–0.67 | 106.1 | (130, 102, 76) | +54.3 |
  | 0.70–0.75 | 147.0 | (178, 142, 106) | +72.7 |
  | 0.78–0.83 | 143.3 | (172, 139, 107) | +64.5 |

  Warmth goes from **+5 at the horizon to +73 in the road** — a 68-point swing over ~40 m of
  depth. Fog colour at the horizon is therefore a **cool grey-green, RGB ≈ (56, 59, 55)**
  (the horizon band's mean), not a warm desert haze. Fog that is warm/orange at distance is
  the single most common way this frame gets missed.
- Horizon band as a whole: **luma 58.0, warmth +0.7, near-black 13.0.** The 13 % black is
  almost entirely the near-left landform — it is not a dark sky, and the car's roof only just
  reaches into the band at fy 0.516.

## 5. Road

**The road is much brighter and far warmer than instinct says.** Near asphalt measures
**L 133, warmth +63, RGB (161, 128, 98)**. It is sun-bleached grey aggregate sitting in
low amber light. Do not build dark grey asphalt and tint it later.

- Asphalt patch `04_road_surface` (x 1450–2350, y 1180–1500): luma **133.0**, warmth
  **+62.7**, near-black **0.2 %**, blown 0.0 %, p5 89.8, p95 177.0, std 27.2, **sharp 14.46**
  — the sharpest large region in the frame. The road carries the most high-frequency detail
  of any surface; if the road is smooth, the frame reads plastic.
- Point samples: (fx 0.509, fy 0.964) → (142, 103, 69) L 108.9 warm +73;
  (fx 0.763, fy 0.846) → (171, 139, 111) L 143.7 warm +60;
  (fx 0.872, fy 0.781) → (161, 129, 99) L 133.4 warm +62.
- **Surface:** fine-to-medium aggregate, visible as individual light specks at full res, plus
  **alligator/fatigue cracking** — irregular interconnected cells. In pixels: crack lines are
  **1–3 px wide** and cell pitch is **~44–55 px** in the near field (autocorrelation of the
  patch at y 1300–1460 peaks at 44 and 53 px). At ≈290 px/m that is **crack cells of roughly
  15–19 cm and cracks 4–10 mm wide** — plausible, real alligator cracking on an old highway.
  Two length scales are present: the alligator cells and a coarser patch-level variation
  (~80–95 px). Feed both if you want it to read at full res.
- **Centreline:** a solid **double yellow**, both lines continuous, no dashes. It runs from
  about (fx 0.49, fy 0.94) up to the right edge at fy ≈ 0.62. Measured stripe centres
  (px, from a yellow-excess peak tracker):

  | fy | inner line fx | outer line fx |
  |---|---|---|
  | 0.70 | 0.774 | 0.807 |
  | 0.78 | 0.668 | 0.715 |
  | 0.85 | 0.574 | 0.625 |
  | 0.91 | 0.490 | 0.542 |

  Perpendicular stripe-centre separation ≈ **45 px ≈ 0.155 m** at fy 0.78 (horizontal peak
  separation × sin 22.3°, the line's angle to horizontal). That is a shade tighter than the
  US standard double yellow (two 4-inch stripes + 4-inch gap = 0.20 m centre to centre), so
  the lines are proportionally slightly narrow and the gap slightly tight — match the plate,
  it is close enough that the standard reads correctly. Lines are **faded and
  eroded at the edges**, not crisp vector stripes; their peak warmth is higher than the
  surrounding asphalt (yellowness spikes of 170–180 vs ~90 background).
- **White edge line** on the left of the road at **x ≈ 870 px (fx 0.32) at the bottom of
  frame** (crop read, ±0.02 — too eroded to peak-detect), running up-right, roughly parallel
  with the yellow pair. It is worn and partly buried in dust.
- **Shoulder / verge:** left of the white line is dirt and gravel — `06_foreground_dirt`
  (x 0–1100, y 1300–1536): luma **87.6**, warmth **+35.9**, RGB (104, 85, 68), sharp 11.71.
  So the shoulder is **darker and 20+ points less warm than the asphalt next to it**. That
  contrast (rough dark shoulder, bright warm road) is what makes the road read as a road.
- At the bottom edge the road darkens: ground luma falls from 147 at fy 0.75 to **84 at
  fy 0.99**. Partly the near foreground sitting in the shadow of the camera-side bank, partly
  the frame's edge falloff. Do not let the foreground stay as bright as the mid-distance.

## 6. Car

**Bounds:** x 672–2004 px, y 792–1184 px ⇒ **1332 × 392 px = 48.4 % of frame width,
25.5 % of frame height**, base at fy 0.771.

- **Type:** late-1960s American 2-door hardtop fastback — 1968–70 Chevelle / Torino /
  Mustang-fastback family **[from crop reads, not measurable]**. Long hood, short deck,
  continuous fastback roofline into the tail, pronounced rear haunch. **Four round
  headlamps** in a horizontal grille, thick chrome front bumper with the parking lamps in it.
- **Wheels:** dark steel wheels with **no chrome hubcaps**, thick tyres, both visible (front
  at fx ≈ 0.28-0.33, rear at fx ≈ 0.65-0.70). They read almost black — the wheel face is
  not a shiny disc in this frame.
- **Paint:** glossy black with clearcoat. Body-only crop (x 760–1900, y 860–1130):
  **luma 41.4, near-black 53.8 %, p95 138.8, std 41.6** — over half the body is below luma 30
  and nothing on it is brighter than ~139. Deep shadow sample at (fx 0.545, fy 0.625):
  RGB (18, 14, 9), L 14.2.
- **What the paint reflects, and where:**
  - upper flank / shoulder line: a warm horizon band — (fx 0.436, fy 0.651) →
    **RGB (89, 65, 46), L 68.9, warmth +42.2**. This is the sun's glow mirrored on the body
    and it is the single most important highlight on the car.
  - lower panels / sills: cool sky reflection — (fx 0.291, fy 0.716) →
    **RGB (33, 41, 40), L 39.2, warmth −6.2** (G ≈ B > R, teal).
  - So the body is **cool-dark low, warm-bright high**. A uniform grey specular will not
    read; the reflection has to be a *horizon gradient*.
- **Glass:** near-black and cool, **not** a bright sky mirror. Window sample
  (fx 0.363, fy 0.579): **RGB (3, 6, 6), L 5.5**. The greenhouse is one of the few true
  near-black areas in the frame. Resist making glass shiny-bright.
- **Chrome:** the bumper and trim catch the horizon and read as warm-bright thin lines
  against the black body — the local p95 of the car region is 139, and those thin bright
  bands are what reaches it. Chrome should be tight, broken by panel gaps, and warm.
- **Dust on lower panels:** visible — the lower third of the body, the front bumper and the
  wheel arches are lifted from black to a dusty grey-tan, and the boundary is ragged, not a
  gradient. Effect on the numbers: it is why `car_body_only` p95 reaches 139 and why the
  body isn't a clean 30 % black mass.
- **Contact shadow:** dark and tight under the sills. No long cast shadow is readable in the
  plate — the sun is behind the car, so the shadow falls away from camera and is hidden by
  the body. The ground band's p5 of 10.9 is the under-car shadow plus the darkened
  foreground, not a long shadow.

## 7. Dust and atmosphere

- The plume is **subtle, low and translucent** — not a rooster tail. It starts at the rear
  tyre (fx ≈ 0.69-0.72, fy ≈ 0.72-0.76), stays within roughly 1 m of the ground, and trails
  right and slightly down (toward the frame-right).
- **It is measurable as a brightness lift on the road behind the car:** the ground right of
  the car (x 2000–2320, y 1120–1220) is **L 154.7, warmth +71.0**; the same-depth road away
  from the car (x 2400–2700, y 1120–1220) is **L 128.6, warmth +64.9**. So the veil lifts
  the surface by **≈ +25 luma** and a few points of warmth, and does **not** desaturate it.
- Plus a fine airborne haze across the whole mid-ground: this is what makes the horizon band
  cool and flat (std 26.2) instead of a hard silhouette edge.
- **Veiling glare, not god rays.** Nothing in the frame has a hard-edged volumetric shape.
  If you find yourself writing a shaft, stop.

## 8. Grade

Do the tone curve and the split-tone against these measured percentiles:

| percentile | luma | RGB | warmth | reading |
|---|---|---|---|---|
| p0.5 | 2.3 | (1.8, 2.7, 2.6) | −0.8 | |
| **p1** | **4.0** | **(3.2, 4.5, 4.2)** | **−1.0** | **black floor: lifted to 4, not 0** |
| p5 | 13.9 | (11.9, 14.5, 13.1) | −1.3 | |
| p10 | 24.7 | (19.9, 25.9, 26.9) | **−7.0** | shadows go cyan-green |
| p25 | 48.9 | (40.6, 51.0, 52.1) | **−11.5** | |
| **p50** | **70.4** | **(69.3, 71.1, 66.2)** | **+3.1** | midtones nearly neutral |
| p75 | 102.0 | (118.6, 99.2, 80.8) | +37.8 | |
| p90 | 134.6 | (163.3, 129.6, 99.0) | +64.3 | |
| **p99** | **176.8** | **(215.7, 171.0, 119.0)** | **+96.7** | |
| p99.5 | 182.1 | (219.6, 176.6, 125.6) | +94.1 | |

- **Shadow tint: cyan-green.** R is the lowest channel, **G and B are within 2 of each
  other and G is usually slightly higher** — it is a green-teal, not a blue-teal. At p10 the
  tint is R −6/−7 under G and B.
- **Highlight tint: amber.** R − B climbs from +38 at p75 to +97 at p99. G sits at ~0.75 R.
- **Midtones are almost neutral** (p50 warmth +3.1). The split-tone has to cross over near
  luma 70 or the image turns orange-and-blue cartoon.
- **Black lift:** the darkest 1 % sits at **luma 4 with a slight green-cyan cast**, and p0.5
  at 2.3. Lift blacks to ~4/255 and tint them faintly cyan; do not crush to 0.
- **Luma histogram** (16-step buckets, % of frame): 0–16: 5.7 · 16–32: 7.8 · 32–48: 10.6 ·
  48–64: 18.4 · 64–80: 17.3 · 80–96: 11.7 · 96–112: 9.0 · 112–128: 7.0 · 128–144: 5.9 ·
  144–160: 3.7 · 160–176: 1.9 · 176–192: 1.0 · 192–208: 0.1 · above 208: 0.0.
  The distribution is a broad plateau at 48–96 with a fast, thin tail. A curve that leaves a
  fat shoulder above 190 is wrong.
- **Grain:** visible but fine; it is why the sky's `sharp` is 4.65 rather than the ~1–2 you
  would get from a pure gradient, and why the plate's sharpness survives downscaling.
  **[recommendation]** film grain amount 12–18 at 1080p, monochrome, not chroma noise.
- **Bloom:** present only as the soft halo inside the glow band (fy 0.29–0.345). With a
  ceiling of luma 197, bloom must be **threshold-high and weight-low**; a 0.6-threshold
  bloom will take the road over 200 and fail the `blown = 0.0 %` test.
- **Vignette: mild, not heavy.** Corners sample dark (40 × 40 px corners read L 5–19) but
  that is mostly content (unlit ground and a shadowed bank); the top edge of the sky runs
  L 48–98 across the interior with no edge darkening beyond the frame border, and there is
  no symmetric radial falloff — only a thin **~8–12 px black border at the extreme left and
  right edges** (not top/bottom). **[recommendation]** vignette weight 0.2–0.25, radius wide.
  A heavy 0.5+ vignette is a fiction people import from social media; it is not in this plate.

---

## 9. Region statistics (crops as delivered)

All values computed exactly as `bands.py` computes them.

| crop | region (x0,y0,x1,y1) | mean RGB | luma | warmth | near-black % | blown % | p5 | p95 | std | sharp |
|---|---|---|---|---|---|---|---|---|---|---|
| full frame | 0,0,2752,1536 | 81.9, 75.5, 65.2 | 76.1 | +16.7 | 12.6 | 0.00 | 13.9 | 150.3 | 40.2 | 8.28 |
| `01_sky_clouds` | 700,60,1900,520 | 67.6, 76.0, 75.6 | 74.2 | −8.0 | 0.0 | 0.00 | 46.3 | 112.3 | 22.3 | 4.65 |
| `02_horizon_mesas` | 0,440,2752,780 | 66.0, 63.7, 56.8 | 63.7 | +9.2 | 22.2 | 0.00 | 17.3 | 152.4 | 40.4 | 5.07 |
| `03_car_full` | 560,700,2150,1260 | 80.3, 69.2, 55.6 | 70.6 | +24.7 | 29.1 | 0.01 | 5.4 | 160.9 | 51.6 | 10.48 |
| `04_road_surface` | 1450,1180,2350,1500 | 160.6, 128.3, 97.9 | 133.0 | +62.7 | 0.2 | 0.00 | 89.8 | 177.0 | 27.2 | 14.46 |
| `05_dust_plume` | 1850,1000,2450,1300 | 169.7, 134.9, 101.3 | 139.9 | +68.4 | 1.2 | 0.00 | 99.2 | 178.0 | 26.9 | 14.79 |
| `06_foreground_dirt` | 0,1300,1100,1536 | 103.7, 84.8, 67.8 | 87.6 | +35.9 | 2.3 | 0.00 | 47.8 | 130.8 | 26.3 | 11.71 |
| car body only | 760,860,1900,1130 | 48.6, 40.3, 31.0 | 41.4 | +17.6 | 53.8 | 0.03 | 3.8 | 138.8 | 41.6 | 8.35 |
| near-left landform | 55,552,550,798 | 18.0, 25.1, 26.5 | 23.7 | −8.5 | **81.9** | 0.00 | 11.3 | 39.9 | 8.3 | 3.21 |
| band sky | 0.15–0.85 w, 0.03–0.35 h | 69.3, 76.6, 75.1 | 75.0 | −5.9 | 1.1 | 0.00 | 44.7 | 134.3 | 28.3 | 4.64 |
| band horizon | 0.15–0.85 w, 0.35–0.52 h | 55.8, 59.0, 55.1 | 58.0 | +0.7 | 13.0 | 0.00 | 21.7 | 104.2 | 26.2 | 5.86 |
| band mid | 0.15–0.85 w, 0.52–0.70 h | 66.2, 55.5, 43.4 | 56.9 | +22.8 | 34.0 | 0.00 | 4.9 | 127.8 | 40.9 | 8.31 |
| band ground | 0.15–0.85 w, 0.70–0.97 h | 137.6, 110.3, 84.6 | 114.2 | +53.0 | 8.4 | 0.00 | 10.9 | 171.3 | 42.9 | 14.58 |

`blown` is quoted to two decimals here, so the 143 stray highlight pixels show up as 0.00–0.03
rather than the `0.0` that `bands.py` prints after rounding.

Machine-readable copy: `reference/measurements.json`.

---

## 10. Crops delivered (`reference/crops/`)

| file | size | what to look at it for |
|---|---|---|
| `01_sky_clouds.png` | 1200×460, 1:1 | cloud structure, the below-lit underside, the rain curtain, how flat the dark cloud is |
| `02_horizon_mesas.png` | 2752×340, 1:1 | every mesa silhouette, the haze colour, the dark left landform |
| `03_car_full.png` | 1590×560, 1:1 | proportions, four headlamps, steel wheels, where the warm horizon reflection sits, dust on the sills |
| `04_road_surface.png` | 900×320, 1:1 | aggregate, alligator cracks at true scale, the double yellow at true scale |
| `05_dust_plume.png` | 800×320, 1:1 | the plume: how little of it there is, and its softness |
| `06_foreground_dirt.png` | 1100×236, 1:1 | shoulder texture and how much darker it is than the road |

Working strips and controls (same folder, `_` prefix — provenance for the claims above):

| file | size | what it settles |
|---|---|---|
| `_overview_1376.png` | 1376×768 | whole composition |
| `_grid_1376.png` | 1376×768 | same, with an A1–J8 labelled grid if you need to point at a cell |
| `_sky_strip.png` / `_horizon_strip.png` / `_ground_strip.png` | 1376 wide | the three horizontal zones in isolation |
| `_car_ends.png` | 1130×450 | left end vs right end of the car — **proves the front is at frame-left** (grille + four round headlamps on the left crop, rear haunch on the right) |
| `_bottom_montage.png` | 600×776 | the bottom band in three slices — where the asphalt, the yellow pair and the shoulder actually are |
| `_road_exit.png` | 702×250 | the road leaving the frame at the right edge around fy 0.62 |

---

## 11. How a real-time renderer fakes this, cheapest first

Target: integrated Radeon, one static frame, no budget for per-pixel volumetrics.

### Sky — one texture, no dome geometry
A single **4k equirect (2:1) JPG/EXR** on a `skybox`/`PhotoDome` plus the same image run
through `CubeTexture.CreateFromPrefilteredData` (PMREM) as the scene environment. Zero
lights needed for the sky itself, one texture fetch. This is the only technique that gives
you the below-lit cloud underside, the left-to-right warm gradient and the horizon break at
once — a procedural gradient sky cannot, and painting the glow separately always looks like
a painted glow.
*Impossible:* real cloud self-shadowing, moving rain curtains. Fake the curtain by baking it
into the equirect.

### Sun and exposure — one directional light, no disc
One `DirectionalLight` at 4–6° elevation, warm colour (~3000 K → `Color3(1.0, 0.78, 0.55)`),
plus the sky's PMREM for fill (this replaces the hemispheric light entirely). The glow lives
in the sky texture; **do not draw a sun mesh or a lens flare** — there is no disc in the
plate, and a drawn disc instantly reads as a game. Exposure is a single number on
`ImageProcessingConfiguration.exposure`; calibrate it against the road patch, not the sky.
*Impossible:* correct spectral falloff, atmospheric scattering. Skip both.

### Terrain — flat cards, not meshes
The mesas stand only 0.01–0.02 of frame height above the horizon and are heavily hazed:
**billboard planes with a baked alpha silhouette**, filled with a flat haze colour sampled
from the plate and fogged. At this size, geometry buys nothing and costs fill rate. The dark
near-left landform is the same trick in reverse: a single dark card, `emissiveColor` ≈
(0.055, 0.086, 0.104) — its measured (18, 25, 26) over 255 — unlit, no texture, no fog.
*Impossible:* parallax between mesas (you cannot tell at 0.01–0.02 frame height), real haze
scattering. Use `scene.fogMode = FOGMODE_EXP2` with a **cool grey-green** fog colour
(≈ 56, 59, 55) and let the colour gradient be in the cards.

### Road — photo textures at two tile scales, nothing else
A photographed asphalt diffuse + normal + roughness, 1024 tile, repeated so the tile is
about **1.5–2 m** in world space, plus a second, much larger tile (~15–20 m) modulating it to
break the repeat. Crack detail lives in the albedo/normal — you cannot afford parallax-
correct crack geometry and at this camera distance nobody can tell.
The centreline is a **separate decal plane** (a long quad following the road) with a faded
white-ish/yellow photo strip and an alpha that erodes at the edges — not painted into the
asphalt tile, because it must not repeat with it.
*Impossible:* cracks that cast shadows, aggregate that reads at 1:1 in the far field.
Accept the far-field smear; the plate has it too (p95 of the road is 177, not clipped white).

### Car — GLB + clearcoat, and the environment does the work
A ~5 m low-poly-to-mid-poly muscle car GLB with a **clearcoat PBR material**: base near-black
(`#050506`), clearcoat 1.0, clearcoat roughness 0.05–0.10, base roughness 0.35 → 0.6 on the
lower panels (the dust). The warm horizon streak and the cool lower flank come **entirely**
from the PMREM environment — get the sky right and the car is 70 % done. Add dust as a
vertex-colour or a roughness/albedo mask on the lower third with a ragged edge.
*Impossible:* the exact specular shapes in the plate (they are an artefact of a specific
environment we do not have), true anisotropic clearcoat flow. Do not chase pixel-level
reflection match; match the **horizontal warm band high / cool dark low** distribution.

### Dust — sprites, and very few of them
A `ParticleSystem` with a soft radial alpha texture, ~150–300 particles, spawn at the rear
contact patch, short lifetime, low velocity, colour ≈ (0.75, 0.62, 0.48) with additive or
`ALPHA_COMBINE` at 0.15–0.35 opacity, sized 0.3–1.5 m, drifting frame-right. Plus **one**
large soft quad for the horizon veil. This is ~10 draw calls and costs nothing.
*Impossible:* light-scattering dust that actually brightens the ground it covers (the plate's
+25 luma lift is a physical scattering effect). Approximate by putting a soft bright decal on
the ground behind the car.

### Grade — one image-processing chain, in this order
`DefaultRenderingPipeline`: ACES tone mapping → exposure → **bloom, threshold ≈ 0.75,
weight ≈ 0.25** → grain 12–18 → vignette 0.2–0.25 → colour curves. Then, in a second pass or
via `imageProcessingConfiguration.colorCurves`: lift blacks to 4 with a cyan-green bias, cool
the shadows, warm the highlights, cross over near luma 70.
*Impossible:* a real film emulation (halation, per-channel curves, printer lights) at this
budget. Nothing in the plate needs it — the measured curve above is flat and simple.

---

## 12. Who owns which number

Each part, and the band cell it is allowed to move. Measure your own frame and report the
delta; nobody hits the reference alone.

| part | owns | must not break |
|---|---|---|
| **sky** | sky band luma 75 ±3, warmth −6 ±3, near-black ≤2 %; provides the PMREM env | nothing else needs to move |
| **sun** | ground band luma 114 ±8; the ceiling (blown 0.0 %, max luma 180–197) | sky band must not blow out |
| **terrain** | horizon band luma 58 ±4, warmth +1 ±4, near-black 13 ±4 | must not raise the horizon above 0.352 |
| **road** | ground band luma 114 ±6, warmth +53 ±6, ground sharp ≈ 14.8 at 1920 (14.6 at 2752) | must not brighten the horizon band |
| **car** | mid band near-black 34 ±4, mid luma 57 ±4; car bbox above | must not close the sky |
| **dust** | mid/ground veil: the +25 luma lift behind the rear wheel; frame near-black must not rise | must not lift the sky |
| **post** | p1 4 ±2, p50 70 ±3, p99 177 ±5, blown 0.0 %, shadow/highlight tints | must not clip; nothing above 200 |
| **camera** | horizon 0.352, car bbox 0.244–0.728 / 0.516–0.771, fov 28.4° vertical | framing is the thing band comparisons depend on |

---

## 13. Traps, stated plainly

1. **`fov = 42°` is ≈ 26 mm equivalent** (68.6° horizontal on 16:9), about 1.5× too wide in
   focal length. With it you will pass the band numbers and fail the composition.
2. **Sharpness across resolutions.** The whole-frame figure barely moves — 8.28 at 2752 wide,
   8.12 after LANCZOS downscale to 1920 — so `bands.py` comparisons between a 1920 render and
   the reference are fair. Per band it does move: at 1920 the reference measures sky 3.71,
   horizon 5.68, mid 8.98, ground 14.82 (at 2752: 4.64 / 5.86 / 8.31 / 14.58), i.e. the sky
   loses ~20 % of its apparent sharpness on downscale while the ground gains a little. Do not
   compare a single band's sharpness across resolutions; compare frames at the same size.
   A render measuring 3–4 overall is genuinely missing detail, not merely rendering smaller —
   the placeholder baseline of 0.24 is a frame with no texture at all.
3. **The horizon is at 35 % from the top, not 50 %.** Two vision models read this frame as
   "sky dominates, low horizon" and both were wrong; the sky is only the top third and 65 %
   of the frame is ground. Measure it (`dL/dy` peaks at y 540), do not eyeball it.
4. **Fog colour is cool green-grey, not sand.** (56, 59, 55). Warm fog is the fastest way to
   lose the horizon band's warmth figure of +0.7.
5. **Asphalt is not dark.** L 133, warmth +63.
6. **Effectively nothing is blown.** Only 143 px (0.003 %) exceed luma 200, p99.9 is 192, and
   the bulk of the frame tops out near 197. Any bloom, any specular, any "sun" that pushes a
   region past 200 breaks the frame's most distinctive property.
7. **Blacks are lifted to 4, cyan-green, not crushed.** p1 = 4.0, RGB (3.2, 4.5, 4.2).
8. **The plate's perspective is only approximately self-consistent.** The camera solution in
   §1 reproduces every measured landmark, but if you push a 3D inversion harder (lane
   widths vs car size vs horizon) the residuals are 10–20 %. Treat this as a beautiful
   plate, not a calibrated photograph: hit the 2D landmarks, do not defend a 3D solve.
9. **Do not add a heavy vignette or a grain-heavy "film" look.** The plate's corners are dark
   because of content. The grain is fine and monochrome.
