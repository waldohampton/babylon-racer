# HERO LAB — shared contract

Read this before doing anything. Every agent works under these rules.

## The goal

One frame, at `http://localhost:<your port>/lab/`, that reads like
`reference/target.png`: a black muscle car on a cracked desert highway, low
storm sun behind it, storm sky overhead, dust in the air, filmic grade.

The scene is already wired. Each surface of the shot is a **part**: one file,
one owner. You replace a placeholder with the real thing.

## What you own

Exactly one file: `lab/src/parts/<yours>.ts`. Plus any assets you add under
`assets/<yours>/`.

You do NOT touch, ever:

- `lab/src/main.ts` (scene wiring, camera default, part order)
- `lab/src/parts/*.ts` belonging to another agent
- `scripts/shot.mjs`, `scripts/bands.py`, `reference/target.png`
- the game itself (`src/`, `index.html`) — this lab is separate from it

If you believe a change outside your file is required, do not make it. Report
it instead, with the reason.

## Your interface

```ts
export function installX(ctx: LabCtx) { /* build into ctx.scene */ }
```

`LabCtx = { scene, engine, camera }`. It is called once at boot, after every
part above it in `main.ts`. Load assets asynchronously inside your function.

## Commands

```bash
# your dev server (use YOUR port from the table below)
cd ~/repos/babylon-racer
npx vite --port 53XX --strictPort      # background it

# capture the frame (1920x1080, canvas only, headless)
node scripts/shot.mjs --port 53XX --out out/<yourname>.png

# measure it against the reference
./venv/bin/python scripts/bands.py out/<yourname>.png
```

`bands.py` prints luma, warmth (R-B), blown and near-black percentages per band
(sky / horizon / mid / ground) against the reference still's own numbers, plus
whole-frame percentiles and a sharpness figure. **This is your evidence.** A
claim of "looks better" without a before/after band table is not a result.

Current placeholder baseline (measure your own, this is for reference):

```
band       luma    ref      d |   warm    ref      d | blown% black%
sky        84.7   75.0   +9.7 |   -0.6   -5.9   +5.3 |    5.5    0.2
horizon   124.9   58.0  +66.9 |   30.8    0.7  +30.1 |   32.0    2.6
mid        33.3   56.9  -23.6 |    4.0   22.8  -18.8 |    0.0    0.0
ground     33.3  114.2  -80.9 |    4.0   53.0  -49.0 |    0.0    0.0
frame    luma  66.8 | p1  6.9 | p50 37.5 | p99 255.0 | sharp 0.24
```

Nobody hits the reference alone. The sky agent, the sun agent and the ground
agent each move these numbers; that is expected. Report your own delta, do not
try to make the whole table match by yourself, and never fake a match by
editing `bands.py` or its REFERENCE dict.

## Environment facts, so you do not waste calls

- Babylon.js **9.36**, tree-shaken ESM imports (`@babylonjs/core/...`).
  Importing `@babylonjs/core` root defeats tree-shaking; do not.
- The GPU is **integrated AMD Radeon**. Headless chromium renders on
  SwiftShader (CPU) at 5 to 15 times slower than the real machine. **FPS in the
  lab is meaningless.** Do not tune performance by fps, and do not report it as
  a win or a regression.
- CC0 assets only. Poly Haven's API is keyless:
  `https://api.polyhaven.com/assets?t=textures&categories=...` then
  `https://api.polyhaven.com/files/<id>` for the `Diffuse` / `nor_gl` / `Rough`
  maps of a 1k set. Repack to 1024 JPEG q82. Report the MB you added.
- Do not add a 1 GB scanned model. Anything over ~20 MB is out.
- Texture tile size is a measurement, not a taste call: Poly Haven publishes
  each scan's real world size in `dimensions` (cm). Use it.
- `requestAnimationFrame` may not fire the way you expect headless; if you need
  a deterministic frame, force values at load rather than over time.

## Reporting

Your final answer must contain:

1. What you built, in one paragraph, and the file you own.
2. The band table **before and after**, pasted, plus the sharpness figure.
3. A screenshot path you produced (`out/<yourname>.png`).
4. Asset bytes added, if any.
5. What you could not do, or what you had to fake, stated plainly.
6. Anything another part must do for yours to look right (for example: "sky
   must provide an environment map before the car paint reflects anything").

A child that reports success without the band numbers will be sent back.

## Ports

| part | port |
|---|---|
| sky | 5301 |
| sun | 5302 |
| terrain | 5303 |
| road | 5304 |
| car | 5305 |
| dust | 5306 |
| post | 5307 |
| camera | 5308 |
| perf | 5309 |
| reference spec | 5310 |
