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

- M0 scene: engine, flat ground, 12 reference blocks, hemispheric + directional light.
- M1 vehicle: kinematic bicycle model with a grip-limited yaw rate, wheel spin driven by
  signed forward travel, front-wheel steer.
- Chase camera: spring arm, look-at 3 m ahead, lens opens 46 -> 53 degrees with speed.
  No ray pull-in yet (nothing to pull in against on a flat plane).
- HUD: km/h and gear letter.
- Test hook: `window.RACER`.

## Measured, not estimated

| test | result |
|---|---|
| 0-100 km/h | 4.35 s |
| top speed, 10 s flat out | 141 km/h |
| yaw rate at 145 km/h, full lock | 17 deg/s (grip capped at 12 m/s^2) |
| yaw rate at 40 km/h, full lock | 61 deg/s |
| braking, 130 km/h to stop | 3.1 s |
| wheel spin vs distance | spin delta == -distance / tyre radius, sign flips in reverse |

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
```

`requestAnimationFrame` does not fire in a headless harness, so `sim()` is the only way to
test physics there. Keep it in the shipped file.
