// Long drift: does the multiplier climb, and does the donut guard bite?
import { chromium } from "playwright";

const url = process.argv[2] || "http://localhost:5199/?long=1";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 650 } });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await page.goto(url, { waitUntil: "load" });
await page.waitForFunction(() => typeof window.RACER === "object", { timeout: 60000 });

const out = await page.evaluate(() => {
  const s = RACER.state.bind(RACER);

  // --- long drift: 6 s of held slide, sampling the score
  RACER.place(0, 0, 0);
  RACER.resetScore();
  RACER.press("KeyW", true);
  for (let i = 0; i < 900 && s().speed < 20; i++) RACER.sim(1);
  RACER.press("KeyD", true);
  RACER.press("Space", true);
  RACER.sim(24);
  RACER.press("Space", false);
  const samples = [];
  for (let i = 0; i < 360; i++) {
    RACER.sim(1);
    if (i % 60 === 59) {
      const sc = RACER.score();
      samples.push({ t: +((i + 1) / 60).toFixed(1), slip: sc.slipDeg, chain: sc.chain, mult: sc.mult, kmh: Math.round(s().speed * 3.6) });
    }
  }
  const atEnd = RACER.score();
  RACER.press("KeyD", false);
  RACER.press("KeyW", false);
  RACER.sim(90);
  const banked = RACER.score();

  // --- donut: hold the handbrake and steer at low speed, scoring must stop
  RACER.place(0, 0, 0);
  RACER.resetScore();
  RACER.press("KeyW", true);
  for (let i = 0; i < 900 && s().speed < 9; i++) RACER.sim(1);
  RACER.press("KeyD", true);
  RACER.press("Space", true);
  const donut = [];
  for (let i = 0; i < 900; i++) {
    RACER.sim(1);
    if (i % 120 === 119) {
      const sc = RACER.score();
      donut.push({ t: +((i + 1) / 60).toFixed(0), slip: sc.slipDeg, chain: sc.chain, kmh: Math.round(s().speed * 3.6) });
    }
  }
  RACER.press("Space", false);
  RACER.press("KeyD", false);
  RACER.press("KeyW", false);

  return { longDrift: samples, banked: banked.total, lastBank: atEnd.lastBank, donut };
});

console.log("LONG DRIFT (6 s held)");
for (const r of out.longDrift) console.log(`  t=${r.t}s slip=${r.slip}deg chain=${r.chain} x${r.mult} ${r.kmh}kmh`);
console.log("banked total:", out.banked);
console.log("DONUT (handbrake held, 15 s)");
for (const r of out.donut) console.log(`  t=${r.t}s slip=${r.slip}deg chain=${r.chain} ${r.kmh}kmh`);

// a frame with the HUD showing a live chain
await page.evaluate(() => {
  RACER.place(0, 0, 0);
  RACER.resetScore();
  RACER.press("KeyW", true);
  for (let i = 0; i < 900 && RACER.state().speed < 20; i++) RACER.sim(1);
  RACER.press("KeyD", true);
  RACER.press("Space", true);
  RACER.sim(24);
  RACER.press("Space", false);
  RACER.sim(150);
  RACER.freezeCam(9, 3.2, -6, 0, 0.9, 0);
  for (let i = 0; i < 3; i++) RACER.scene().render();
});
await page.screenshot({ path: "/home/waldo/repos/babylon-racer/out/drift_hud.png" });
console.log("shot: out/drift_hud.png");
await browser.close();
