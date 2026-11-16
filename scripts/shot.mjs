// Capture the hero lab canvas at a fixed size, headless.
//   node scripts/shot.mjs --port 5301 --out out/name.png [--w 1920 --h 1080] [--wait 3000] [--isolate re] [--slow]
//
// FAST PATH (default whenever the Windows Chrome binary exists): drive Windows
// Chrome with --headless=new --screenshot. Measured on this machine: 9.5 s
// versus 50-90 s for Playwright/SwiftShader, with 0.9905 luma correlation and
// mean |difference| 4.7/255 against it. Why this matters: WSL has no /dev/dri,
// so Linux-side Chromium is a CPU rasterizer and the lab frame is 2.4 M
// triangles. Every iteration was paying that, on the CPU, at ~1 fps.
//
// SLOW PATH (fallback, and required for --isolate or stats): Playwright with
// SwiftShader. Two traps it dodges:
//  1. page.screenshot through the compositor can write an all-black PNG while
//     the scene is fine. Capture from the canvas drawing buffer instead.
//  2. Vite HMR reloads the document when any part file changes, killing the
//     execution context mid-capture. Every attempt is retried.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, existsSync, copyFileSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { execFileSync } from "node:child_process";

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
};
const flag = (name) => process.argv.includes(`--${name}`);

const port = arg("port", "5301");
const out = arg("out", "out/frame.png");
const w = Number(arg("w", "1920"));
const h = Number(arg("h", "1080"));
const wait = Number(arg("wait", "3000"));
const isolate = arg("isolate", "");
const page = arg("page", "lab/");
const base = `http://localhost:${port}/${page}`;
const WIN_CHROME = "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe";

mkdirSync(dirname(out), { recursive: true });

function captureViaWindowsChrome() {
  const stamp = Date.now();
  const winTmp = `C:\\Users\\waldo\\AppData\\Local\\Temp\\hero_${stamp}.png`;
  const wslTmp = `/mnt/c/Users/waldo/AppData/Local/Temp/hero_${stamp}.png`;
  const budget = Math.max(wait + 20000, 45000);
  execFileSync(
    WIN_CHROME,
    [
      "--headless=new",
      "--disable-gpu-sandbox",
      `--screenshot=${winTmp}`,
      `--window-size=${w},${h}`,
      `--virtual-time-budget=${budget}`,
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      `${base}?shot=${stamp}`,
    ],
    { stdio: "ignore", timeout: 180000 }
  );
  if (!existsSync(wslTmp)) throw new Error("windows chrome wrote no file");
  copyFileSync(wslTmp, out);
  try { unlinkSync(wslTmp); } catch { /* leave it */ }
  return { out, captured: true, mode: "windows-chrome-gpu", errors: [], stats: null };
}

async function captureViaPlaywright() {
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
      await page.waitForTimeout(wait);

      stats = await page.evaluate("window.HERO ? window.HERO.stats() : null");
      errDiv = await page.evaluate("document.getElementById('err')?.textContent || ''");

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

  await browser.close();
  return { out, captured, mode: "playwright-swiftshader", errors: errors.slice(0, 8), errDiv, stats };
}

// --isolate and stats only exist on the Playwright path, so anything asking for
// them takes the slow path. Everything else gets the GPU path.
let result;
if (isolate || flag("slow") || !existsSync(WIN_CHROME)) {
  result = await captureViaPlaywright();
} else {
  try {
    result = captureViaWindowsChrome();
  } catch (e) {
    result = await captureViaPlaywright();
    result.fallbackReason = String(e);
  }
}

console.log(JSON.stringify(result, null, 1));
if (!result.captured) process.exit(1);
