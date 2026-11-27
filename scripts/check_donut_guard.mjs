// Donut guard at speed, and a frame with the car visibly sideways.
import { chromium } from "playwright";

const url = process.argv[2] || "http://localhost:5199/?guard=1";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await page.goto(url, { waitUntil: "load" });
await page.waitForFunction(() => typeof window.RACER === "object", { timeout: 60000 });

const guard = await page.evaluate(() => {
  const s = RACER.state.bind(RACER);
  RACER.place(0, 0, 0);
  RACER.resetScore();
  RACER.press("KeyW", true);
  for (let i = 0; i < 900 && s().speed < 40; i++) RACER.sim(1);
  RACER.press("KeyD", true);
  RACER.press("Space", true);
  RACER.sim(20);
  const rows = [];
  let prevChain = 0;
  for (let i = 0; i < 1200; i++) {
    RACER.sim(1);
    if (i % 90 === 89) {
      const sc = RACER.score();
      rows.push({
        t: Math.round((i + 1) / 60),
        slip: sc.slipDeg,
        kmh: Math.round(s().speed * 3.6),
        eligible: s().speed >= 8 && sc.slipDeg >= 12,
        chain: sc.chain,
        gained: +(sc.chain - prevChain).toFixed(0),
      });
      prevChain = sc.chain;
    }
  }
  return rows;
});

console.log("t,slip,kmh,eligible,chain,points gained per 1.5 s");
for (const r of guard) console.log(`${r.t},${r.slip},${r.kmh},${r.eligible},${r.chain},${r.gained}`);

await page.evaluate(() => {
  const s = RACER.state.bind(RACER);
  RACER.place(0, 0, 0);
  RACER.resetScore();
  RACER.press("KeyW", true);
  for (let i = 0; i < 900 && s().speed < 20; i++) RACER.sim(1);
  RACER.press("KeyD", true);
  RACER.press("Space", true);
  RACER.sim(24);
  RACER.press("Space", false);
  RACER.sim(110);
  const st = s();
  RACER.freezeCam(st.x + 7.5, 2.4, st.z - 6.5, st.x, 0.85, st.z);
  for (let i = 0; i < 3; i++) RACER.scene().render();
});
await page.screenshot({ path: "/home/waldo/repos/babylon-racer/out/drift_car.png" });
console.log("shot: out/drift_car.png");
await browser.close();
