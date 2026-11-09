// Starts a game in several states in a real browser and screenshots the map: a rendering check
// for awkward geography (Alaska, Hawaii, Texas, New Hampshire's 400 seats, Nebraska's one chamber).
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const { chromium } = createRequire(import.meta.url)("playwright");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2] || join(root, "shots");
const states = process.argv.slice(3).length ? process.argv.slice(3) : ["TX", "AK", "NH", "HI", "NE", "CA"];
const port = 5198;
const server = spawn(process.execPath, [join(root, "ui", "node_modules", "vite", "bin", "vite.js"), "preview", "--port", String(port), "--strictPort"], { cwd: join(root, "ui"), stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
try {
  await sleep(1500);
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  for (const st of states) {
    await page.goto(`http://localhost:${port}/`);
    await page.click("[data-act=new]");
    await sleep(400);
    const xy = await page.evaluate((st) => { const t = window.__tpr; const s = t.map.fill; const US = null; return null; }, st);
    // click the state by its centroid from us.json
    const pos = await page.evaluate(async (st) => { const us = await (await fetch("./us.json")).json(); const s = us.states.find((x) => x.usps === st); const t = window.__tpr; const [x, y] = t.usProj(s.lon, s.lat, st); const [sx, sy] = t.map.toScreen(x, y); const r = document.querySelector("#ov").getBoundingClientRect(); return [sx + r.left, sy + r.top]; }, st);
    await page.mouse.click(pos[0], pos[1]);
    await page.waitForSelector("#townlist div", { timeout: 15000 });
    const picked = await page.evaluate(() => window.__tpr.setup.usps);
    await page.click("[data-act=start]");
    await page.waitForSelector("#bar .brand", { timeout: 15000 });
    await page.click("[data-act=closemodal]");
    await page.evaluate(() => window.__tpr.step(300));
    const hasHouse = await page.locator("[data-act=mode][data-m=house]").count();
    await page.click(`[data-act=mode][data-m=${hasHouse ? "house" : "senate"}]`);
    await sleep(700);
    await page.screenshot({ path: join(out, `state-${st}.png`) });
    const info = await page.evaluate(() => { const s = window.__tpr.snap; return { usps: s.usps, date: s.date.join("-"), seats: window.__tpr.seats.length, parties: s.parties.filter((p) => p.active).map((p) => `${p.name} ${(p.statewide * 100).toFixed(1)}%`) }; });
    console.log(st, picked === st ? "ok" : `PICKED ${picked}`, JSON.stringify(info));
    if (picked !== st) failed = true;
  }
  if (errors.length) { console.log("PAGE ERRORS:\n" + errors.join("\n")); failed = true; }
  await browser.close();
} catch (e) { console.error(e); failed = true; } finally { server.kill(); }
process.exit(failed ? 1 : 0);
