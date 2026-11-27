// Time series of a handbrake pull, so the slide can be read frame by frame.
import { chromium } from "playwright";

const url = process.argv[2] || "http://localhost:5199/?trace=1";
const entry = Number(process.argv[3] || 60);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await page.goto(url, { waitUntil: "load" });
await page.waitForFunction(() => typeof window.RACER === "object", { timeout: 60000 });

const rows = await page.evaluate((entry) => {
  const s = RACER.state.bind(RACER);
  const deg = (r) => (r * 180) / Math.PI;
  RACER.place(0, 0, 0);
  RACER.resetScore();
  RACER.press("KeyW", true);
  for (let i = 0; i < 900 && s().speed < entry / 3.6; i++) RACER.sim(1);
  const out = [];
  const sample = (tag) => {
    const st = s();
    out.push(
      [tag, +(st.speed * 3.6).toFixed(0), +deg(st.slip).toFixed(0), +(st.forwardSpeed * 3.6).toFixed(0),
       Math.hypot(st.vx - st.forwardSpeed * Math.sin(st.yaw), 0).toFixed(0)].join(",")
    );
  };
  sample("pre");
  RACER.press("KeyD", true);
  RACER.press("Space", true);
  for (let i = 0; i < 30; i++) {
    RACER.sim(1);
    if (i % 5 === 4) sample("hb" + (i + 1));
  }
  RACER.press("Space", false);
  for (let i = 0; i < 120; i++) {
    RACER.sim(1);
    if (i % 10 === 9) sample("rel" + (i + 1));
  }
  return out;
}, entry);

console.log("tag,kmh,slipDeg,forwardKmh");
console.log(rows.join("\n"));
console.log("score", JSON.stringify(await page.evaluate(() => RACER.score())));
console.log("state", JSON.stringify(await page.evaluate(() => {
  const s = RACER.state();
  return { kmh: +(s.speed * 3.6).toFixed(0), slip: +((s.slip * 180) / Math.PI).toFixed(0) };
})));
await browser.close();
