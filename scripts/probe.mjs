// Probe: load the game, print every console message and page error, dump the
// scene tree summary. Headless rendering is slow here, so nothing is judged on
// the picture, only on what the browser says.
import { chromium } from "playwright";

const url = process.argv[2] || "http://localhost:5199/";
const wait = Number(process.argv[3] || 9000);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("console", (m) => console.log("CONSOLE", m.type(), m.text().slice(0, 300)));
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
page.on("requestfailed", (r) => console.log("REQFAIL", r.url(), r.failure()?.errorText));
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(wait);

const info = await page.evaluate(() => {
  const out = {};
  try {
    const s = window.RACER.scene();
    out.meshes = s.meshes.length;
    out.enabled = s.meshes.filter((m) => m.isEnabled()).length;
    out.ready = s.meshes.filter((m) => m.material && m.material.isReady(m)).length;
    out.noMaterial = s.meshes.filter((m) => !m.material && m.getTotalVertices() > 0).map((m) => m.name).slice(0, 8);
    out.carWheels = s.meshes.filter((m) => /wheel_/i.test(m.name)).map((m) => m.name);
    const v = s.activeCamera ? s.activeCamera.position : null;
    out.cam = v ? [v.x, v.y, v.z].map((n) => +n.toFixed(2)) : null;
    const b = s.getMeshByName("hull");
    out.hullEnabled = b ? b.isEnabled() : "missing";
    const m0 = s.meshes.find((m) => /muscle/.test(m.name));
    out.modelBBox = m0 ? JSON.stringify(m0.getHierarchyBoundingVectors(true).min) : "none";
    out.env = s.environmentTexture ? s.environmentTexture.isReady() : "none";
  } catch (e) {
    out.err = String(e);
  }
  out.errPane = document.getElementById("err").textContent.trim();
  out.hud = document.getElementById("hud").innerText.replace(/\s+/g, " ");
  return out;
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
