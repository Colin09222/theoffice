// Automated browser playthrough: builds nothing, expects `npm run build` to have been run in ui/.
// Usage: node tools/playtest.mjs [outDir]   (needs Playwright + Chromium on the machine)
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2] || join(root, "shots");
const port = 5199;
const server = spawn(process.execPath, [join(root, "ui", "node_modules", "vite", "bin", "vite.js"), "preview", "--port", String(port), "--strictPort"], { cwd: join(root, "ui"), stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
try {
  await sleep(1500);
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  const shot = (n) => page.screenshot({ path: join(out, n + ".png") });
  const T = (f, ...a) => page.evaluate(f, ...a);
  const clearDialog = async () => { for (let i = 0; i < 5 && (await page.locator("#modal .dialog").count()); i++) { await page.locator("#modal .choices button").first().click(); await sleep(80); } };
  const click = async (sel) => { for (let i = 0; ; i++) { await clearDialog(); try { await page.click(sel, { timeout: 1200 }); return; } catch (e) { if (i > 6) throw e; } } };
  await page.goto(`http://localhost:${port}/`);
  await page.waitForSelector("[data-act=new]");
  await shot("01-title");
  await page.click("[data-act=new]");
  await sleep(600);
  await shot("02-choose-state");
  // click Ohio on the real map
  const xy = await T(() => { const t = window.__tpr; const [x, y] = t.usProj(-82.8, 40.3, "OH"); const [sx, sy] = t.map.toScreen(x, y); const r = document.querySelector("#ov").getBoundingClientRect(); return [sx + r.left, sy + r.top]; });
  await page.mouse.click(xy[0], xy[1]);
  await page.waitForSelector("#townlist div");
  await page.fill("#q", "Athens");
  await sleep(200);
  await page.click("#townlist div");
  await page.fill("#pname", "Hocking Valley Union");
  await page.fill("#lname", "Morgan Reyes");
  for (const [k, v] of [[0, 1], [1, 1], [2, 1], [3, 1], [5, 1], [6, 1], [7, 2]]) await page.click(`[data-act=plat][data-k="${k}"][data-v="${v}"]`);
  await page.fill("#seed", "20250201");
  await sleep(300);
  await shot("03-setup");
  await page.click("[data-act=start]");
  await page.waitForSelector("#bar .brand");
  await sleep(500);
  await shot("04-founded");
  await clearDialog();
  const state = () => T(() => { const s = window.__tpr.snap, me = s.parties[4]; return { date: s.date.join("-"), money: me.money, sigs: me.sigs, qualified: me.qualified, statewide: me.statewide, seats: me.seats, leaderSeat: me.leader && me.leader.seat, races: s.races.length, ops: s.ops.length, heat: me.heat }; });
  // queue first operations from the Desk using the real buttons
  const clickOp = async (kind) => { const b = page.locator(`#body button[data-cmd*='"kind":${kind},']:not([disabled])`).first(); if (await b.count()) { await clearDialog(); await b.click({ timeout: 3000 }).catch(() => {}); await sleep(120); return true; } return false; };
  await clickOp(3); await clickOp(2);
  await shot("05-desk");
  // file for the council
  await click("[data-act=tab][data-t=offices]"); await sleep(300);
  await shot("06-offices");
  const run = page.locator("#body button[data-cmd*='\"leader\":true']:not([disabled])");
  const n = await run.count();
  // pick the first council seat with an election this year
  await clearDialog(); await run.first().click(); await sleep(300);
  console.log("filed; run buttons seen:", n, JSON.stringify(await state()));
  await click("[data-act=tab][data-t=desk]"); await sleep(200);
  // play to election day, handling events and re-queuing operations like a player would
  await click("[data-act=speed][data-s='30']");
  let guard = 0;
  const playUntil = async (pred) => {
    while (!(await T(pred)) && guard++ < 4000) {
      if (await page.locator("#modal .dialog").count()) {
        await clearDialog();
        if (await T(() => window.__tpr.ui.speed === 0)) await click("[data-act=speed][data-s='30']");
        continue;
      }
      const s = await state();
      if (s.ops < 2) { await click("[data-act=tab][data-t=desk]"); await sleep(60); (await clickOp(8)) || (await clickOp(2)) || (await clickOp(3)) || (await clickOp(1)); if (await T(() => window.__tpr.ui.speed === 0)) await click("[data-act=speed][data-s='30']"); }
      await sleep(150);
    }
  };
  await playUntil(() => window.__tpr.snap.date[0] === 2025 && window.__tpr.snap.date[1] >= 9);
  await click("[data-act=speed][data-s='0']");
  await click("[data-act=tab][data-t=desk]"); await sleep(300);
  await shot("07-campaign");
  await click("[data-act=mode][data-m=mine]"); await sleep(300);
  await click("[data-act=tab][data-t=place]"); await sleep(300);
  await shot("08-county");
  await click("[data-act=mode][data-m=house]"); await sleep(500);
  await page.mouse.move(520, 430); await sleep(200);
  await shot("09-house-map");
  await click("[data-act=mode][data-m=lead]");
  await click("[data-act=speed][data-s='30']");
  await playUntil(() => window.__tpr.snap.date[0] >= 2026 && window.__tpr.snap.date[1] >= 2);
  await click("[data-act=speed][data-s='0']"); await sleep(300);
  await click("[data-act=tab][data-t=news]"); await sleep(300);
  await shot("10-after-election");
  console.log("after first election:", JSON.stringify(await state()));
  await click("[data-act=tab][data-t=party]"); await sleep(300);
  await shot("11-party");
  await click("[data-act=tab][data-t=rivals]"); await sleep(300);
  await shot("12-rivals");
  // save / load round trip through the real buttons is file-based; check the autosave path instead
  const saved = await T(() => !!localStorage.getItem("tpr-autosave-v1"));
  console.log("autosave present:", saved);
  if (errors.length) { console.log("PAGE ERRORS:\n" + errors.join("\n")); failed = true; }
  await browser.close();
} catch (e) { console.error(e); failed = true; } finally { server.kill(); }
process.exit(failed ? 1 : 0);
