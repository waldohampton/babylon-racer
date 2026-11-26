// Check: do the front wheels turn with the steering, and by how much?
// Prints wheel forward direction relative to the car's right axis, in degrees.
import { chromium } from "playwright";

const url = process.argv[2] || "http://localhost:5199/?steercheck=1";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await page.goto(url, { waitUntil: "load" });
await page.waitForFunction(() => typeof window.RACER === "object", { timeout: 60000 });
await page.waitForFunction(() => {
  const s = window.RACER.scene();
  return s.meshes.some((m) => /muscle-car_body/.test(m.name));
}, { timeout: 60000 });

const result = await page.evaluate(() => {
  const s = RACER.scene();
  RACER.pause(true);
  RACER.place(0, 0, 0);
  const root = s.transformNodes.find((n) => n.name === "carRoot");
  const V = root.position.constructor;
  const wheels = s.transformNodes.filter((n) => /wheel_(fl|fr|rl|rr)$/i.test(n.name));
  const read = () => {
    const right = root.getDirection(new V(1, 0, 0));
    const nose = root.getDirection(new V(0, 0, 1));
    return wheels.map((w) => {
      w.computeWorldMatrix(true);
      // the pivot's own +Z lies along the car's nose
      const z = w.getDirection(new V(0, 0, 1));
      const fx = z.x, fz = z.z;
      const deg = (Math.atan2(fx * right.x + fz * right.z, fx * nose.x + fz * nose.z) * 180) / Math.PI;
      return [w.name.replace("muscle-car_wheel_", ""), +deg.toFixed(1)];
    });
  };
  const out = { centred: read() };
  RACER.press("KeyD", true);
  RACER.sim(30, 1 / 60);
  RACER.press("KeyD", false);
  out.rightLock = { steer: +(RACER.state().steer * 57.2958).toFixed(1), wheels: read() };
  RACER.press("KeyA", true);
  RACER.sim(60, 1 / 60);
  RACER.press("KeyA", false);
  out.leftLock = { steer: +(RACER.state().steer * 57.2958).toFixed(1), wheels: read() };
  return out;
});
console.log(JSON.stringify(result, null, 1));
await browser.close();
