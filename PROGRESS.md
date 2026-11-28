# Progress

## Current state (2026-11-27, session complete)

Branch `master`, clean, `00a1dd2 feat: drifting, with scoring`, pushed, Pages deployed.
Dev server runs on http://localhost:5199 (`npm run dev`).
Live: https://waldohampton.github.io/babylon-racer/

Full handoff, including the monetisation research and the tuning numbers, lives in the
vault: `Documents/Waldo 2/Babylon Racer Handoff 2026-11.md`.

### What we did this session

- Added a phone quality tier, touch stick and handbrake button, 1k car GLB.
- Fixed the visible vibration: fixed 60 Hz physics was stamped straight to the
  renderer, so the body jumped whole steps against a smooth camera. Now the drawn
  pose is interpolated between the last two physics states, and the accumulator
  drops its backlog above 8 steps instead of banking it.
- Front wheels now steer with the physics angle (41.3 deg at lock, rears straight).
- Built drifting: grip and slide regimes, a lateral grip budget, throttle holding
  the rear away, and steering that asks for a drift angle instead of a yaw rate.
- Scoring: slip window, speed floor, speed x angle^1.2 rate, chain multiplier,
  bank on straighten, donut guard.
- Chase camera aims at the direction of travel so slides are visible.
- Probes added under `scripts/` for steering, drift hold, multiplier and capture.

### Verify before committing

```
npx tsc --noEmit
node scripts/check_steer.mjs "http://localhost:5199/"
node scripts/check_drift_hold.mjs "http://localhost:5199/"
```

### Open items

1. No course, restart key or target scores. Nothing monetises without a 3 minute session.
2. No collision, so crashing costs nothing yet.
3. Best score not persisted.
4. No sound.
5. Portal SDK not integrated, no submission made.
6. Real phone frame rate still unmeasured.
