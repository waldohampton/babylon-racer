# babylon-racer

Extensible racing POC on Babylon.js 9.36. Plan: `C:\Users\waldo\Downloads\babylon-racer-poc-plan.md`.

## Run

```
npm install
npm run dev      # http://localhost:5199
npm run build    # production bundle, check the gzip number
```

Keys: W/S throttle and brake, A/D steer, Space handbrake, R reset (reset not wired yet).

## What exists

- M0 scene: engine, scanned sand ground, 12 concrete reference blocks, photographed
  sky, one sun with a real shadow.
- M1 vehicle: kinematic bicycle model with a grip-limited yaw rate, wheel spin driven by
  signed forward travel, front-wheel steer.
- Chase camera: spring arm, look-at 3 m ahead, lens opens 46 -> 53 degrees with speed.
  No ray pull-in yet (nothing to pull in against on a flat plane).
- HUD: km/h and gear letter.
- Test hook: `window.RACER` (also exposes `RACER.scene()` and `RACER.engine()`).

## Look layer (`src/render/look.ts`)

Every surface is a real asset with a measured size, not a colour picked by eye.

| surface | asset | real size | tiling |
|---|---|---|---|
| ground | Poly Haven `aerial_sand` (CC0) | 150 m scan, 4k albedo / 2k normal / 1k ARM | 600 m plane = 4 repeats |
| blocks | Poly Haven `brushed_concrete` (CC0) | 2.5 m scan, 1k | 6 m box = 2.4 repeats |
| sky + IBL | Poly Haven `kloofendal_43d_clear_puresky` (CC0) | 1k HDR | prefiltered at load |
| car body | Grabd3D "Muscle Car" (CC0), 19,806 tris | 4.68 x 1.92 x 1.39 m | stock atlas, paint remapped to black |

- PBR throughout: albedo, normal and an ARM map (R = AO, G = roughness, B = metallic), so
  roughness and occlusion are photographed rather than guessed.
- The HDRI is both the skybox and the light probe. There is no hemispheric cheat light; the
  ambient comes from the photograph, which is why black paint has shape.
- One sun with a 2048 blurred-ESM shadow map. The frustum is pinned to a 70 m box that
  follows the car, because with auto-fitted bounds the blocks at 60 m put the car's shadow
  on about four texels.
- ACES tonemapping at exposure 1.0, light vignette, and EXP2 fog at 0.0024 so the 600 m
  plane has no visible edge.
- The stock car atlas is butter yellow with racing stripes. `assets/car/body_basecolor_black.jpg`
  remaps the paint islands to black while keeping the baked panel shading, and the body
  material carries a clear coat so a black car still reads.

Total added: 11 MB of textures plus a 1.2 MB HDR, all CC0.

## Mobile

`src/core/quality.ts` picks a tier at boot: a coarse pointer *and* a screen under
820 px gets the low tier. `?q=low` / `?q=high` forces one for testing.

| | high (desktop) | low (phone) |
|---|---|---|
| device pixel ratio cap | 2 | 2 |
| ground albedo / normal | 4k / 2k | 1k / 1k |
| car maps | 2k, in the stock GLB | 1k, `muscle-grab3d-1k.glb` |
| shadow map | 2048, blur 24 | 1024, blur 16 |
| clear coat on paint | on | off |
| ground plane / fog | 600 m / 0.0024 | 400 m / 0.006 |

Measured at 390x844, DPR 3, touch emulated: backing store 780x1688 (2x; it was
1x before, which meant a 3x phone rendered at a third of its pixels), 1k ground,
1024 shadow, clear coat off, 1k car maps, no console errors. Desktop stays on 4k
ground, 600 m plane, 2048 shadow, clear coat on, 2k car maps.

Touch controls: stick bottom-left (up is throttle, down is brake, sideways is
steer, 0.14 dead zone per axis), handbrake bottom-right, both anchored to
`env(safe-area-inset-*)` and hidden until the first real `touchstart`, so a
touchscreen laptop stays on keys. They write into `Input.touch`, which the
keyboard path merges in `tick()`, so physics still reads one struct.

`python3 scripts/make_mobile_glb.py in.glb out.glb 1024 82` rebuilds a GLB with
smaller embedded textures, rewriting every buffer offset with 4 byte alignment.
The stock car's five 2k maps are about 80 MB of GPU memory decompressed; the 1k
rebuild is 0.88 MB on disk against 1.26.

Not measured: real phone frame rate. The only renderer available here is a
software rasterizer, so the tier was sized by texture and buffer budgets, not by
an fps reading on a device.

## Frame loop

Physics runs at a fixed 60 Hz behind an accumulator. The drawn pose is
interpolated between the last two physics states using the accumulator
remainder. Without that, the body advances in whole steps (0.5 m per step at
100 km/h) while the chase camera smooths continuously, and the mismatch reads as
the car vibrating in the frame. Above 8 steps in one frame the backlog is
dropped instead of banked: a growing accumulator pins the interpolation factor
at 1, which silently disables the interpolation and puts the game in permanent
slow motion.

## Drifting

Pull the handbrake (Space, or the BRAKE button on touch) and the rear breaks
away. The physics has two regimes:

- **Grip.** Sideways speed is deleted and the velocity is rebuilt on the new
  heading, so a corner costs nothing. That is not physical, it is the arcade lie
  the car was tuned around, and the corner radii below depend on it.
- **Slide.** The velocity keeps pointing where it pointed and the body rotates
  around its own momentum. Grip becomes a budget: the tyres claw back at most
  `handbrakeLatAccel` (7 m/s^2, against 26 gripping) metres per second of
  sideways speed per second, and the rest is the drift. Throttle keeps the rear
  broken away at 8 m/s^2, so releasing the handbrake does not hook the car up
  instantly. The slide ends when the body and the path come within 3 deg.

While sliding, the steering asks for a drift **angle**, not a yaw rate: full
lock one way asks for 48.7 deg, countersteer asks for none, and the body is
driven toward that angle at up to 1.4 rad/s. Free yaw rate was tried first and
every slide either died in half a second or spun the car, with no window in
between; measured 43 to 46 deg held for six seconds with the angle controller.

The camera aims at the direction of travel, weighted by slip, instead of at the
body. Gripping, the two are identical; drifting, the car stays visible at an
angle rather than pointing dead away from the lens.

Scoring (`src/core/score.ts`) follows the numbers shipped drift games converged
on: 12 to 75 deg of slip, at least 29 km/h, points per second of
`speed * (angle/45)^1.2 * 10`, a multiplier climbing 0.5 every 1.5 s held to
x10, banked when you straighten up for 0.6 s. Banked points are never taken
away, only the live chain is at risk. Circling slowly in one direction stops
paying after a turn and a quarter, but that guard only applies below 65 km/h so
a long fast drift does not trip it.

## Measured, not estimated

| test | result |
|---|---|
| 0-100 km/h | 4.17 s |
| top speed, 10 s flat out | 145 km/h |
| corner radius at 30 km/h, full lock | 2.96 m |
| corner radius at 60 km/h | 10.5 m |
| corner radius at 90 km/h | 23.6 m |
| corner radius at 120 km/h | 42.1 m |
| yaw rate at 145 km/h, full lock | 17 deg/s (grip capped at 26 m/s^2) |
| braking, 130 km/h to stop | 3.1 s |
| wheel spin vs distance | spin delta == -distance / tyre radius, sign flips in reverse |
| front wheel steer angle | 41.3 deg right at full lock, -41.3 left, rear wheels 0 |
| drift angle, held | 43 to 46 deg for 6 s at 70 and 90 km/h entry |
| drift speed bleed | 72 to 48 km/h across that 6 s drift, throttle down |
| points at 45 deg, 20 m/s | 200/s before the multiplier, so a 6 s chain reached 980 at x3 |
| donut, handbrake held 20 s | pays until the slide drops it under 29 km/h, then stops |

The corner radii started at 5.56 / 22.6 / 51.1 / 91.2 m with a 12 m/s^2 grip cap and
0.55 rad of lock. Above walking pace that cap was the binding constraint, not the steering
geometry, which is why raising lock alone did nothing. 26 m/s^2 and 0.72 rad of lock put
them at 2.96 / 10.5 / 23.6 / 42.1 m. Full lock at 145 km/h holds speed with no lateral
slip and no oscillation, so the tighter numbers are stable, just arcade.

## Not built yet (plan milestones)

M2 track + sectors, M3 collision and surface query, M5 lap timing, M6 lighting and post,
M7 touch controls. The car drives through the reference blocks today: there is no collision
system until M3.

## Test hook

```js
RACER.state()            // x,z,yaw,speed,forwardSpeed,steer,wheelSpin
RACER.sim(n, 1/60)       // step physics n times with no render loop (headless-safe)
RACER.pause(true)        // stop the render loop from stepping physics
RACER.press('KeyW', true)
RACER.place(x, z, yaw)
RACER.freezeCam(x,y,z, tx,ty,tz)  // park the camera; releaseCam() to resume
RACER.dbg()              // fps, mesh count, draw calls, triangles
RACER.scene()            // live Scene, for checking what actually loaded
RACER.engine()           // live Engine
```

`requestAnimationFrame` does not fire in a headless harness, so `sim()` is the only way to
test physics there. Keep it in the shipped file.

## Capture notes

`node scripts/shot.mjs --port 5199 --page "" --out out/x.png` drives Windows Chrome. It
needs the tab brought to the front before the compositor produces a frame, so a capture
that comes back as the flat clear colour means the frame chain had not started, not that
the scene is empty. `node scripts/probe.mjs <url> <waitMs>` prints console errors and what
loaded, which is the cheaper check.
