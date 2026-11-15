// Capture the hero lab canvas at a fixed size, headless.
//   node scripts/shot.mjs --port 5301 --out out/name.png [--w 1920 --h 1080] [--wait 3000]
// Prints: the output path, page console errors, and HERO.stats() as JSON.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
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
const url = `http://localhost:${port}/lab/?shot=${Date.now()}`;

mkdirSync(dirname(out), { recursive: true });

const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });

const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

await page.goto(url, { waitUntil: "load", timeout: 60000 });
await page.waitForFunction("window.HERO_READY === true", null, { timeout: 60000 });
// let asset loads and any post-load warmup settle
await page.waitForTimeout(wait);

const stats = await page.evaluate("window.HERO ? window.HERO.stats() : null");
const errDiv = await page.evaluate("document.getElementById('err')?.textContent || ''");

await page.locator("#c").screenshot({ path: out });

console.log(JSON.stringify({ out, errors: errors.slice(0, 6), errDiv, stats }, null, 1));
await browser.close();
