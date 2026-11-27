// Can a drift be held? Try the input patterns a player would actually use.
import { chromium } from "playwright";

const url = process.argv[2] || "http://localhost:5199/?hold=1";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await page.goto(url, { waitUntil: "load" });
await page.waitForFunction(() => typeof window.RACER === "object", { timeout: 60000 });

const out = await page.evaluate(() => {
  const s = RACER.state.bind(RACER);
  const deg = (r) => +(Math.abs((r * 180) / Math.PI)).toFixed(0);
  const kmh = () => +(s().speed * 3.6).toFixed(0);

  const run = (entry, hbSeconds, after) => {
    RACER.place(0, 0, 0);
    RACER.resetScore();
    RACER.press("KeyW", true);
    for (let i = 0; i < 900 && s().speed < entry / 3.6; i++) RACER.sim(1);
    RACER.press("KeyD", true);
    RACER.press("Space", true);
    RACER.sim(Math.round(hbSeconds * 60));
    RACER.press("Space", false);
    if (after === "counter") {
      RACER.press("KeyD", false);
      RACER.press("KeyA", true);
    } else if (after === "neutral") {
      RACER.press("KeyD", false);
    }
    const marks = [];
    for (let i = 0; i < 150; i++) {
      RACER.sim(1);
      if (i % 30 === 29) marks.push({ t: +((i + 1) / 60).toFixed(1), slip: deg(s().slip), kmh: kmh() });
    }
    const sc = RACER.score();
    RACER.press("KeyA", false);
    RACER.press("KeyD", false);
    RACER.press("KeyW", false);
    RACER.sim(60);
    return { entry, hbSeconds, after, marks, chainAtEnd: sc.chain, mult: sc.mult, banked: RACER.score().total };
  };

  return [
    run(70, 0.4, "hold"),
    run(70, 0.4, "counter"),
    run(90, 0.4, "hold"),
    run(90, 0.4, "counter"),
  ];
});

for (const r of out) {
  console.log(
    `entry ${r.entry} hb ${r.hbSeconds}s after ${r.after.padEnd(8)} -> ` +
      r.marks.map((m) => `${m.slip}deg@${m.kmh}kmh`).join("  ") +
      `  | chain ${r.chainAtEnd} x${r.mult} banked ${r.banked}`
  );
}
await browser.close();
