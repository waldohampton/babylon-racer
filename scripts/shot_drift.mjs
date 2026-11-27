// A frame as the player sees it: chase camera, mid-drift. Physics stepped
// deterministically, then paused so the frame holds still for the capture.
import { chromium } from "playwright";

const url = process.argv[2] || "http://localhost:5199/?shot=drift";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await page.goto(url, { waitUntil: "load" });
await page.waitForFunction(() => typeof window.RACER === "object", { timeout: 60000 });
await page.waitForFunction(() => RACER.scene().meshes.some((m) => /muscle-car_body/.test(m.name)), { timeout: 60000 });

const readout = await page.evaluate(() => {
  RACER.pause(true);
  RACER.place(0, 0, 0);
  RACER.resetScore();
  RACER.press("KeyW", true);
  RACER.sim(300); // ~5 s of throttle
  RACER.press("KeyD", true);
  RACER.press("Space", true);
  RACER.sim(24);
  RACER.press("Space", false);
  RACER.sim(110);
  return { score: RACER.score(), kmh: Math.round(RACER.state().speed * 3.6) };
});
await page.waitForTimeout(700); // let the chase arm settle onto the pose
await page.screenshot({ path: "/home/waldo/repos/babylon-racer/out/drift_chase.png" });
await page.evaluate(() => {
  RACER.press("KeyD", false);
  RACER.press("KeyW", false);
  RACER.pause(false);
});
console.log(JSON.stringify(readout));
console.log("shot: out/drift_chase.png");
await browser.close();
