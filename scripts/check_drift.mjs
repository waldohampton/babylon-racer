// Does it drift, and did the approved corner radii survive the change?
import { chromium } from "playwright";

const url = process.argv[2] || "http://localhost:5199/?driftcheck=1";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await page.goto(url, { waitUntil: "load" });
await page.waitForFunction(() => typeof window.RACER === "object", { timeout: 60000 });

const out = await page.evaluate(() => {
  const s = RACER.state.bind(RACER);
  const R = (v) => +v.toFixed(1);

  // ---- 1. corner radius without the handbrake, to prove the feel is unchanged
  const radius = (kmh) => {
    RACER.place(0, 0, 0);
    RACER.press("KeyW", true);
    for (let i = 0; i < 900 && s().speed < kmh / 3.6; i++) RACER.sim(1);
    RACER.press("KeyW", false); // coast: holding the throttle during the test
    RACER.sim(10); //       measured the car accelerating into the corner
    const entry = s().speed;
    RACER.press("KeyA", true);
    RACER.sim(30); // reach the steering stop
    let prev = Math.atan2(s().vx, s().vz);
    let turned = 0;
    let travelled = 0;
    const v0 = s().speed;
    for (let i = 0; i < 40; i++) {
      RACER.sim(1);
      const st = s();
      let d = Math.atan2(st.vx, st.vz) - prev;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      turned += d;
      prev = Math.atan2(st.vx, st.vz);
      travelled += st.speed / 60;
    }
    RACER.press("KeyA", false);
    return {
      targetKmh: kmh,
      radius: R(Math.abs(turned) > 1e-6 ? travelled / Math.abs(turned) : 9999),
      speed: R((v0 * 3.6 + s().speed * 3.6) / 2),
    };
  };

  const radii = [30, 60, 90, 120].map(radius);

  // ---- 2. handbrake drift: pull it at speed, hold the slide, measure the angle
  const drift = (entryKmh, handbrakeKey, holdSeconds) => {
    RACER.place(0, 0, 0);
    RACER.resetScore();
    RACER.press("KeyW", true);
    for (let i = 0; i < 900 && s().speed < entryKmh / 3.6; i++) RACER.sim(1);
    RACER.press("KeyD", true);
    RACER.press(handbrakeKey, true);
    const steps = Math.round(holdSeconds * 60);
    let maxSlip = 0, sumSlip = 0, minSpeed = 999;
    for (let i = 0; i < steps; i++) {
      RACER.sim(1);
      const st = s();
      const deg = Math.abs((st.slip * 180) / Math.PI);
      maxSlip = Math.max(maxSlip, deg);
      sumSlip += deg;
      minSpeed = Math.min(minSpeed, st.speed);
    }
    RACER.press(handbrakeKey, false);
    const afterBrake = { slip: R(+(s().slip * 180) / Math.PI), speed: R(s().speed * 3.6), score: RACER.score() };
    // keep the throttle and the steering, let the slide run on
    let held = 0;
    for (let i = 0; i < 90; i++) {
      RACER.sim(1);
      if (Math.abs((s().slip * 180) / Math.PI) >= 12) held++;
    }
    const sustained = { slip: R(+((s().slip * 180) / Math.PI)), speed: R(s().speed * 3.6) };
    RACER.press("KeyD", false);
    RACER.press("KeyW", false);
    // straighten up so the chain banks
    RACER.sim(120);
    return {
      entry: entryKmh,
      maxSlip: R(maxSlip),
      avgSlipWhileBraking: R(sumSlip / steps),
      minSpeed: R(minSpeed * 3.6),
      afterBrake,
      slipStillOver12Frames: held,
      sustained,
      final: RACER.score(),
    };
  };

  return { radii, driftSpace: drift(60, "Space", 0.8), driftHigh: drift(110, "Space", 0.8) };
});

console.log(JSON.stringify(out, null, 1));
await browser.close();
