// Capture the hero lab canvas at a fixed size, headless.
//   node scripts/shot.mjs --port 5301 --out out/name.png [--w 1920 --h 1080] [--wait 3000]
// Prints: the output path, page console errors, and HERO.stats() as JSON.
//
// Two traps this file exists to dodge:
//  1. page.screenshot through the compositor can write an all-black PNG while
//     the scene is fine, because SwiftShader renders at ~1 fps. The capture is
//     taken from the canvas drawing buffer instead (preserveDrawingBuffer).
//  2. Vite HMR reloads the document the moment any part file changes, which
//     destroys the execution context mid-capture. Every attempt is retried.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
};

const port = arg("port", "5301");
const out = arg("out", "out/frame.png");
const w = Number(arg("w", "1920"));
const h = Number(arg("h", "1080"));
const wait = Number(arg("wait", "3000"));
const base = `http://localhost:${port}/lab/`;

mkdirSync(dirname(out), { recursive: true });

const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });

const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

let stats = null;
let errDiv = "";
let captured = false;

for (let attempt = 1; attempt <= 4 && !captured; attempt++) {
  try {
    await page.goto(`${base}?shot=${Date.now()}`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction("window.HERO_READY === true", null, { timeout: 60000 });
    // let asset loads and any post-load warmup settle
    await page.waitForTimeout(wait);

    stats = await page.evaluate("window.HERO ? window.HERO.stats() : null");
    errDiv = await page.evaluate("document.getElementById('err')?.textContent || ''");

    const isolate = arg("isolate", "");
    if (isolate) {
      await page.evaluate((keep) => window.HERO.isolate(keep), isolate);
      await page.waitForTimeout(1200);
    }

    const dataUrl = await page.evaluate(() => {
      if (window.HERO && window.HERO.scene) window.HERO.scene.render();
      return document.getElementById("c").toDataURL("image/png");
    });
    const b64 = String(dataUrl).split(",")[1] || "";
    if (b64.length < 5000) throw new Error(`capture looks empty (${b64.length} b64 chars)`);
    writeFileSync(out, Buffer.from(b64, "base64"));
    captured = true;
  } catch (e) {
    errors.push(`attempt ${attempt}: ${String(e).split("\n")[0]}`);
    await page.waitForTimeout(1500);
  }
}

console.log(JSON.stringify({ out, captured, errors: errors.slice(0, 8), errDiv, stats }, null, 1));
await browser.close();
if (!captured) process.exit(1);
