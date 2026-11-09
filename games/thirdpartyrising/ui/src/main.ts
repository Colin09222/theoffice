// Third Party Rising — interface. Plain TypeScript and DOM; all game rules live in the
// simulation (Rust), all text and content in data/content/*.json.

import { createBackend, type Backend } from "./backend";
import { GLMap, buildMesh, type Mesh, type Marker, type MultiPoly } from "./map";

// ------------------------------------------------------------------ helpers
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const money = (n: number) => (n < 0 ? "-$" : "$") + Math.abs(Math.round(n)).toLocaleString("en-US");
const num = (n: number) => Math.round(n).toLocaleString("en-US");
const pct = (x: number, d = 1) => (x * 100).toFixed(d) + "%";
const hex = (c: number) => "#" + (c & 0xffffff).toString(16).padStart(6, "0");
const rgb = (c: number): [number, number, number] => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const text = async (path: string) => { const r = await fetch("./" + path); if (!r.ok) throw new Error(`${path}: ${r.status}`); return r.text(); };
const P = 8, PLAYER = 4, K = 8;
const AUTOSAVE = "tpr-autosave-v1";

function dateOf(day: number): string {
  const d = new Date(Date.UTC(2025, 0, 1 + day));
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// ------------------------------------------------------------------ global state
let be: Backend;
let statesJson = "", contentBundle = "";
let C: { issues: any[]; events: any[]; bribes: any[]; scandals: any[] };
let S: any, US: any;
let pack: any, geo: any;
let snap: any = null, costs: any = null, seats: any[] = [], county: any = null, history: any[] = [];
let map: GLMap | null = null;
let meshes: { counties: Mesh; house: Mesh | null; senate: Mesh | null } | null = null;
let proj: (lon: number, lat: number) => [number, number];
const ui = { tab: "desk", mode: "lead", speed: 0, sel: -1, repeat: false, lastLog: -1, busy: false, acc: 0, won: false, lastYear: 0, tick: 0, reminded: 0 };
let timer: any = null;

function toast(html: string, cls = "") {
  const t = document.createElement("div");
  t.className = "toast " + cls; t.innerHTML = html;
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), 7000);
}
function modal(html: string) { $("#modal").innerHTML = html ? `<div class="dialog">${html}</div>` : ""; }
const modalOpen = () => $("#modal").innerHTML !== "";

async function boot() {
  try {
    be = await createBackend();
    const [st, issues, events, scandals, bribes, names, strings, us] = await Promise.all(
      ["states.json", "content/issues.json", "content/events.json", "content/scandals.json", "content/bribes.json", "content/names.json", "content/strings.json", "us.json"].map(text));
    statesJson = st;
    const I = JSON.parse(issues);
    C = { issues: I.issues, events: JSON.parse(events).events, bribes: JSON.parse(bribes).bribes, scandals: JSON.parse(scandals).scandals };
    contentBundle = JSON.stringify({ issues: I.issues, platforms: I.platforms, events: C.events, scandals: C.scandals, bribes: C.bribes, names: JSON.parse(names) });
    S = JSON.parse(strings); US = JSON.parse(us);
    titleScreen();
  } catch (e: any) {
    $("#app").innerHTML = `<div class="title"><div class="card"><h2>Could not start</h2><p>${esc(e?.message || e)}</p></div></div>`;
  }
}

// ------------------------------------------------------------------ title
function titleScreen() {
  clearInterval(timer); map = null; snap = null;
  const has = !!localStorage.getItem(AUTOSAVE);
  $("#app").innerHTML = `<div class="title"><div class="card">
    <h1>Third Party <span>Rising</span></h1><div class="rule"></div>
    <p>${esc(S.tagline)}</p>
    <div class="btns"><button class="primary" data-act="new">New game</button>${has ? `<button data-act="continue">Continue</button>` : ""}<button data-act="loadfile">Load a save file</button></div>
    <small>${esc(S.disclaimer)}</small>
    <small style="margin-top:10px">Simulation: ${be.kind === "native" ? "native build" : "WebAssembly build"} · saves are local files · nothing is sent anywhere</small>
    <input type="file" id="file" accept=".json" style="display:none" />
  </div></div>`;
  $("#file").addEventListener("change", async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) loadSave(await f.text());
  });
}

async function loadSave(save: string) {
  try {
    const usps = JSON.parse(save).world.usps;
    await loadPack(usps);
    await be.load(save, contentBundle);
    await enterGame();
  } catch (e: any) {
    modal(`<h2>That save could not be loaded</h2><p>${esc(e?.message || e)}</p><div class="choices"><button data-act="closemodal">Close</button></div>`);
  }
}

async function loadPack(usps: string) {
  const [p, g] = await Promise.all([text(`packs/${usps}.json`), text(`packs/${usps}.geo.json`)]);
  pack = JSON.parse(p); geo = JSON.parse(g); (pack as any)._raw = p;
  const fix = (l: number) => (l > 0 ? l - 360 : l); // Alaska's Aleutians cross the antimeridian
  let lon0 = 0, lat0 = 0;
  for (const c of pack.counties) { lon0 += fix(c.lon); lat0 += c.lat; }
  lon0 /= pack.counties.length; lat0 /= pack.counties.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  proj = (lon, lat) => [(fix(lon) - lon0) * k, lat - lat0];
}

// ------------------------------------------------------------------ setup
const COLORS = [0xc64fd0, 0xf28b30, 0x2cb5a9, 0x8d6be8, 0xe8d24a, 0x56c1ee, 0xe86a92, 0x9ac44a];
const setup = { usps: "", place: -1, county: -1, name: "", leader: "", color: COLORS[0], platform: new Array(K).fill(0), seed: 0, real: true, q: "" };

function usProj(lon: number, lat: number, usps: string): [number, number] {
  if (lon > 0) lon -= 360;
  if (usps === "AK") { lon = -117 + (lon + 150) * 0.2; lat = 26.5 + (lat - 62) * 0.34; }
  else if (usps === "HI") { lon = -105 + (lon + 157); lat = 26 + (lat - 20.5); }
  return [(lon + 96) * 0.79, lat];
}

function setupScreen() {
  setup.usps = ""; setup.place = -1; setup.county = -1; setup.seed = Math.floor(Math.random() * 1e9); setup.q = "";
  $("#app").innerHTML = `<div class="setup"><div class="mapwrap"><canvas id="gl"></canvas><canvas id="ov" class="ov"></canvas><div class="maphint" id="hint"></div><div class="tip" id="tip" style="display:none"></div></div><div class="side" id="side"></div></div>`;
  map = new GLMap($("#gl") as HTMLCanvasElement, $("#ov") as HTMLCanvasElement);
  map.resize();
  showUS();
  renderSetup();
}

function showUS() {
  const m = map!;
  const mesh = buildMesh(US.states.map((s: any) => s.polys), (lon, lat, f) => usProj(lon, lat, US.states[f].usps));
  m.setMesh(mesh); m.fit(mesh.bounds, 0.04); m.setMarkers([]); m.selected = -1;
  const col = new Float32Array(US.states.length * 3);
  US.states.forEach((_: any, i: number) => { const v = 0.2 + ((i * 37) % 11) * 0.012; col.set([v, v + 0.05, v + 0.11], i * 3); });
  m.setColors(col);
  $("#hint").innerHTML = `<h2>Choose a state</h2><div class="dim">All fifty are playable. Click one.</div>`;
  m.onHover = (f, e) => tip(f < 0 ? "" : `<b>${esc(US.states[f].name)}</b><br><span class="dim">${num(US.states[f].pop)} people</span>`, e);
  m.onClick = async (f) => { if (f >= 0) await pickState(US.states[f].usps); };
}

function tip(html: string, e: MouseEvent) {
  const t = $("#tip"); if (!t) return;
  if (!html) { t.style.display = "none"; return; }
  const r = t.parentElement!.getBoundingClientRect();
  t.innerHTML = html; t.style.display = "block";
  t.style.left = Math.min(e.clientX - r.left + 14, r.width - 230) + "px"; t.style.top = Math.min(e.clientY - r.top + 14, r.height - 150) + "px";
}

async function pickState(usps: string) {
  await loadPack(usps);
  setup.usps = usps; setup.place = 0; setup.county = -1; setup.q = "";
  const m = map!;
  const mesh = buildMesh(geo.counties, (lon, lat) => proj(lon, lat));
  m.setMesh(mesh); m.fit(mesh.bounds);
  const col = new Float32Array(pack.counties.length * 3);
  pack.counties.forEach((c: any, i: number) => { const d = Math.min(1, Math.log10(1 + c.pop / Math.max(1, c.landKm2 || 1)) / 3.2); col.set([0.14 + d * 0.16, 0.19 + d * 0.2, 0.27 + d * 0.24], i * 3); });
  m.setColors(col);
  $("#hint").innerHTML = `<h2>${esc(pack.name)}</h2><div class="dim">Pick your home town from the list, or click a county to narrow it. <a href="#" data-act="backus" style="color:var(--gold)">Change state</a></div>`;
  m.onHover = (f, e) => tip(f < 0 ? "" : `<b>${esc(pack.counties[f].name)}</b><br><span class="dim">${num(pack.counties[f].pop)} people</span>`, e);
  m.onClick = (f) => { setup.county = f === setup.county ? -1 : f; m.selected = setup.county; m.redraw(); renderTowns(); };
  setupMarkers(); renderSetup();
}

function setupMarkers() {
  const ms: Marker[] = [];
  pack.places.slice(0, 250).forEach((p: any, i: number) => {
    const [x, y] = proj(p.lon, p.lat); const home = i === setup.place;
    ms.push({ x, y, size: home ? 12 : Math.max(3.5, Math.min(8, Math.log10(p.pop) * 1.5 - 1)), rgb: home ? [1, 0.86, 0.45] : [0.8, 0.84, 0.9], label: i < 40 || home ? p.name : undefined, rank: home ? -1 : i });
  });
  if (setup.place >= 250) { const p = pack.places[setup.place]; const [x, y] = proj(p.lon, p.lat); ms.push({ x, y, size: 12, rgb: [1, 0.86, 0.45], label: p.name, rank: -1 }); }
  map!.setMarkers(ms);
}

function renderTowns() {
  const el = $("#townlist"); if (!el) return;
  const q = setup.q.trim().toLowerCase();
  const rows: string[] = [];
  for (let i = 0; i < pack.places.length && rows.length < 150; i++) {
    const p = pack.places[i];
    if (setup.county >= 0 && p.county !== setup.county) continue;
    if (q && !p.name.toLowerCase().includes(q)) continue;
    rows.push(`<div data-act="town" data-i="${i}" class="${i === setup.place ? "sel" : ""}"><span>${esc(p.name)} <span class="faint">${esc(p.kind)}</span></span><span class="dim num">${num(p.pop)}</span></div>`);
  }
  el.innerHTML = rows.join("") || `<div class="dim">No incorporated places match.</div>`;
}

function renderSetup() {
  const side = $("#side"); if (!side) return;
  if (!setup.usps) {
    side.innerHTML = `<h2>Found your party</h2><p class="dim">Start by choosing a state on the map. You will pick a real town, name your party, and write its platform.</p>
      <p class="dim">The first milestone covers one whole state: city council and mayor, county commission, state house, state senate and governor, with the state's real seat counts and election calendar.</p>
      <p><button data-act="title">Back</button></p>`;
    return;
  }
  const pl = pack.places[setup.place];
  const plat = C.issues.map((is: any, k: number) => `<div class="name">${esc(is.name)}</div><div class="pos">${[-2, -1, 0, 1, 2].map((v) => `<button class="${setup.platform[k] === v ? "on" : ""}" data-act="plat" data-k="${k}" data-v="${v}">${v > 0 ? "+" + v : v}</button>`).join("")}</div><div class="ends"><span>${esc(is.neg)}</span><span>${esc(is.pos)}</span></div>`).join("");
  side.innerHTML = `<h2>Found your party in ${esc(pack.name)}</h2>
    <div class="step">1 · Home town</div>
    <input type="search" id="q" placeholder="Search ${pack.places.length} towns and cities" value="${esc(setup.q)}" />
    <div class="list" id="townlist"></div>
    <div class="dim" style="margin-top:5px">${pl ? `<b style="color:var(--gold)">${esc(pl.name)}</b>, ${esc(pack.counties[pl.county].name)} · ${num(pl.pop)} people` : ""}${setup.county >= 0 ? ` · showing ${esc(pack.counties[setup.county].name)} only` : ""}</div>
    <div class="step">2 · Party and leader</div>
    <input type="text" id="pname" maxlength="40" placeholder="Party name" value="${esc(setup.name)}" style="margin-top:6px" />
    <input type="text" id="lname" maxlength="40" placeholder="Your politician's name" value="${esc(setup.leader)}" style="margin-top:6px" />
    <div class="swatches">${COLORS.map((c) => `<i class="${c === setup.color ? "sel" : ""}" style="background:${hex(c)}" data-act="color" data-c="${c}"></i>`).join("")}</div>
    <div class="step">3 · Platform</div>
    <div class="dim">Neither end of any line is better. You gain where your platform sits close to local opinion, so different platforms suit different places.</div>
    <div class="plat">${plat}</div>
    <div class="step">4 · Options</div>
    <label style="display:block;margin-top:6px"><input type="checkbox" id="real" ${setup.real ? "checked" : ""}/> Start real office-holders in their real seats (name, party and office only)</label>
    <div style="display:flex;gap:8px;align-items:center;margin-top:8px"><span class="dim">Seed</span><input type="number" id="seed" value="${setup.seed}" /></div>
    <div style="display:flex;gap:8px;margin-top:18px"><button class="primary" data-act="start" style="flex:1;padding:10px">Found the party</button><button data-act="title">Back</button></div>
    <p class="faint" style="font-size:11.5px">${esc(S.disclaimer)}</p>`;
  renderTowns();
  $("#q").addEventListener("input", (e) => { setup.q = (e.target as HTMLInputElement).value; renderTowns(); });
  $("#pname").addEventListener("input", (e) => (setup.name = (e.target as HTMLInputElement).value));
  $("#lname").addEventListener("input", (e) => (setup.leader = (e.target as HTMLInputElement).value));
  $("#seed").addEventListener("input", (e) => (setup.seed = Math.abs(parseInt((e.target as HTMLInputElement).value) || 0)));
  $("#real").addEventListener("change", (e) => (setup.real = (e.target as HTMLInputElement).checked));
}

async function startGame() {
  const pl = pack.places[setup.place];
  const cfg = { seed: setup.seed, homePlace: pl.geoid, partyName: setup.name.trim() || "New Party", leaderName: setup.leader.trim() || "Alex Founder", color: setup.color, platform: setup.platform, realNames: setup.real, aiOnly: false };
  try {
    await be.newGame(statesJson, pack._raw, contentBundle, JSON.stringify(cfg));
    await enterGame();
  } catch (e: any) {
    modal(`<h2>Could not start</h2><p>${esc(e?.message || e)}</p><div class="choices"><button data-act="closemodal">Close</button></div>`);
  }
}

// ------------------------------------------------------------------ game shell
async function enterGame() {
  modal("");
  $("#app").innerHTML = `<header class="bar" id="bar"></header>
    <main class="game"><div class="mapwrap"><canvas id="gl"></canvas><canvas id="ov" class="ov"></canvas><div class="modes" id="modes"></div><div class="legend" id="legend"></div><div class="tip" id="tip" style="display:none"></div></div>
    <aside class="panel"><div class="tabs" id="tabs"></div><div class="body" id="body"></div></aside></main>
    <footer class="queue" id="queue"></footer>`;
  map = new GLMap($("#gl") as HTMLCanvasElement, $("#ov") as HTMLCanvasElement);
  map.resize();
  const mk = (f: MultiPoly[]) => (f && f.length ? buildMesh(f, (lon, lat) => proj(lon, lat)) : null);
  meshes = { counties: mk(geo.counties)!, house: mk(geo.house), senate: mk(geo.senate) };
  snap = await be.snapshot(); costs = await be.detail({ t: "costs" }); seats = await be.detail({ t: "seats" });
  history = await be.detail({ t: "history" });
  ui.sel = snap.arenas[snap.homeArena].county; ui.lastLog = snap.log.length ? snap.log[0].n : -1; ui.speed = 0; ui.tab = "desk"; ui.mode = "lead"; ui.won = false; ui.lastYear = snap.date[0];
  map.onHover = (f, e) => tip(hoverText(f), e);
  map.onClick = (f) => { if (f < 0) return; ui.sel = ui.mode === "house" || ui.mode === "senate" ? shapeCounty(f) : f; ui.tab = "place"; refreshCounty().then(render); };
  applyMode(); map.fit(meshes.counties.bounds);
  await refreshCounty();
  render();
  clearInterval(timer);
  timer = setInterval(tickLoop, 100);
  if (snap.day <= 40) intro();
}

function intro() {
  const home = pack.places[snap.arenas[snap.homeArena].place];
  modal(`<h2>${esc(snap.parties[PLAYER].name)} is founded</h2>
    <p>${esc(dateOf(snap.day))}, ${esc(home.name)}, ${esc(pack.name)}. You have ${money(snap.parties[PLAYER].money)}, a handful of volunteers and no one has heard of you.</p>
    <p class="dim">Time runs when you press play. Queue operations for your volunteers, file for a seat on the ${esc(home.name)} council before the deadline, and build from there: mayor, county, legislature, governor. County and state races need a ballot line, and the ballot line needs signatures.</p>
    <p class="dim">There are shortcuts. They work. They are also how parties end.</p>
    <div class="choices"><button class="primary" data-act="closemodal">Get to work</button></div>`);
}

async function tickLoop() {
  if (ui.busy || !snap) return;
  ui.tick++;
  if (ui.speed > 0 && !modalOpen()) {
    ui.acc += ui.speed * 0.1;
    const n = Math.floor(ui.acc);
    if (n > 0) {
      ui.acc -= n; ui.busy = true;
      try { await be.step(n); await refresh(); } finally { ui.busy = false; }
    }
  }
}

async function refresh(full = false) {
  snap = await be.snapshot();
  if (ui.tab === "place" || full) await refreshCounty();
  const yearChanged = snap.date[0] !== ui.lastYear;
  if (full || yearChanged || ((ui.tab === "offices" || ui.mode === "house" || ui.mode === "senate") && ui.tick % 10 === 0)) seats = await be.detail({ t: "seats" });
  if (yearChanged) {
    ui.lastYear = snap.date[0];
    history = await be.detail({ t: "history" });
    try { localStorage.setItem(AUTOSAVE, await be.save()); } catch { /* storage full or unavailable: file saves still work */ }
  }
  news();
  remind();
  if (snap.pending.length && !modalOpen()) showEvent(snap.pending[0]);
  const ls = snap.parties[PLAYER].leader;
  if (!ui.won && ls && ls.seat >= 0 && seats[ls.seat]?.kind === 5 && ls.seat === snap.govSeat) {
    ui.won = true; ui.speed = 0;
    modal(`<h2>Governor of ${esc(pack.name)}</h2><p>${esc(ls.name)} takes the oath. A party that began in ${esc(pack.places[snap.arenas[snap.homeArena].place].name)} now runs the state.</p><p class="dim">The national map comes in a later version. Until then the state is yours to keep, if you can.</p><div class="choices"><button class="primary" data-act="closemodal">Keep governing</button></div>`);
  }
  render();
}

/** One warning per election when filing is about to close and the party has nobody on a ballot. */
function remind() {
  const left = snap.electionDay - snap.day - snap.fileDeadline;
  if (left > 14 || left <= 0 || ui.reminded === snap.electionDay || snap.races.length) return;
  const me = party(PLAYER), hc = snap.arenas[snap.homeArena].county;
  const open = seats.some((s) => s.electionDay === snap.electionDay && ((s.kind <= 1 && s.area === snap.homeArena) || (s.kind >= 2 && me.qualified && (s.kind === 5 || s.counties.includes(hc)))));
  if (!open) return;
  ui.reminded = snap.electionDay;
  if (ui.speed > 1) ui.speed = 1;
  toast(`Filing closes in ${left} days and you have no candidates. See <b>Offices</b>.`, "bad");
}

async function refreshCounty() { if (ui.sel >= 0) county = await be.detail({ t: "county", i: ui.sel }); }

async function cmd(c: any, quiet = false): Promise<boolean> {
  const r = await be.command(c);
  if (!r.ok && !quiet) toast(esc(r.err || "That did not work."), "bad");
  await refresh(true);
  return r.ok;
}

// ------------------------------------------------------------------ naming
const placeOf = (arena: number) => pack.places[snap.arenas[arena].place];
function seatName(s: { kind: number; area: number; ord: number }): string {
  switch (s.kind) {
    case 0: return `${placeOf(s.area).name} council, seat ${s.ord + 1}`;
    case 1: return `Mayor of ${placeOf(s.area).name}`;
    case 2: return `${pack.counties[s.area].name} commission, seat ${s.ord + 1}`;
    case 3: return pack.house[s.ord]?.name ?? `House seat ${s.ord + 1}`;
    case 4: return pack.senate[s.ord]?.name ?? `Senate seat ${s.ord + 1}`;
    default: return `Governor of ${pack.name}`;
  }
}
const seatNameI = (i: number) => (seats[i] ? seatName(seats[i]) : "an office");
const party = (p: number) => snap.parties[p] ?? { name: "Independent", color: 0x8a94a3 };
const chip = (p: number) => `<i class="chip" style="background:${hex(party(p).color)}"></i>`;
function opTarget(o: { kind: number; target: number; arg: number }): string {
  if (o.kind === 2) return placeOf(o.target).name;
  if (o.kind === 8) return seatNameI(o.arg);
  if (o.kind === 7) return "";
  return pack.counties[o.target]?.name ?? "";
}
function shapeCounty(shape: number): number {
  const list = ui.mode === "house" ? pack.house : pack.senate;
  const s = list.find((x: any) => x.shape === shape);
  return s ? s.county : ui.sel;
}

// ------------------------------------------------------------------ news and events
function logText(e: any): string {
  const t: string = S.log[String(e.kind)] || "";
  const pn = (p: number) => esc(party(p).name);
  const f: Record<string, string> = {};
  switch (e.kind) {
    case 1: case 2: case 3: case 6: case 7: case 8: case 11: case 17: f.party = pn(e.a); break;
    case 4: case 5: case 18: f.party = pn(e.c); f.seat = esc(seatNameI(e.a)); f.pct = pct(e.f); f.name = esc(e.name); break;
    case 9: f.scandal = esc((C.scandals[e.b]?.text || "").replace("{name}", `${e.name} (${party(e.c).name})`)) + (e.f > 0 ? " They have resigned." : ""); break;
    case 10: f.name = esc(e.name); f.seat = esc(seatNameI(e.b)); break;
    case 12: { const o = { kind: e.a, target: e.b, arg: e.b }; f.op = esc(S.ops[e.a]?.verb || ""); f.target = esc(opTarget(o));
      f.amount = e.a === 3 ? ` (+${Math.round(e.f)} volunteers)` : e.a === 4 ? ` (${money(e.f)} raised)` : e.a === 5 ? ` (+${num(e.f)} valid signatures)` : ""; break; }
    case 13: f.year = String(e.b); f.party = pn(e.c); f.chamber = e.a === 3 ? "state house" : "state senate"; f.n = String(Math.round(e.f)); break;
    case 14: f.party = pn(e.a); f.issue = esc(C.issues[e.b]?.name || ""); break;
    case 15: f.result = e.f > 0 ? "a new monthly donor has signed on." : "no cheque this time."; break;
    case 16: f.bribe = esc(C.bribes[e.b]?.name || ""); break;
  }
  return t.replace(/\{(\w+)\}/g, (_, k) => f[k] ?? "");
}
const visible = (e: any) => !(e.kind === 16 && e.a !== PLAYER) && !(e.kind === 14 && e.a !== PLAYER);

function news() {
  const fresh = snap.log.filter((e: any) => e.n > ui.lastLog).reverse();
  if (snap.log.length) ui.lastLog = snap.log[0].n;
  // Election night: one summary of every race the party was in.
  const results = fresh.filter((e: any) => (e.kind === 4 || e.kind === 5) && e.c === PLAYER);
  if (results.length) {
    ui.speed = 0;
    const wins = results.filter((e: any) => e.kind === 4).length;
    const gov = fresh.find((e: any) => e.kind === 4 && seats[e.a]?.kind === 5);
    modal(`<h3 style="margin-top:0">${esc(dateOf(results[0].day))}</h3><h2>Election night</h2>
      <p>${wins ? `${wins} of your ${results.length} candidate${results.length > 1 ? "s" : ""} won.` : results.length > 1 ? "None of your candidates won this time." : "Not this time."} ${wins ? "Winners take office on 1 January." : "The work you did is still there: the roots, the volunteers, the name."}</p>
      ${results.map((e: any) => `<div class="row"><div class="l"><b>${esc(seatNameI(e.a))}</b><small>${esc(e.name)}</small></div><b class="${e.kind === 4 ? "good" : "bad"}">${e.kind === 4 ? "Won" : "Lost"} · ${pct(e.f)}</b></div>`).join("")}
      ${gov && gov.c !== PLAYER ? `<p class="dim">Governor: ${esc(gov.name)} (${esc(party(gov.c).name)}) wins with ${pct(gov.f)}.</p>` : ""}
      <div class="choices"><button class="primary" data-act="closemodal">Continue</button></div>`);
  }
  for (const e of fresh) {
    if (results.includes(e)) continue;
    if (!visible(e)) continue;
    const mine = (e.kind <= 3 || e.kind === 6 || e.kind === 7 || e.kind === 8 || e.kind === 17 ? e.a : e.c) === PLAYER;
    if (e.kind === 12) continue; // routine completions go to the News tab only
    const important = [2, 3, 4, 5, 6, 7, 8].includes(e.kind) && mine;
    if (mine || [1, 11, 13].includes(e.kind) || (e.kind === 4 && seats[e.a]?.kind === 5)) toast(logText(e), e.kind === 4 || e.kind === 2 || e.kind === 8 ? "good" : [3, 5, 6, 7, 17].includes(e.kind) ? "bad" : "");
    if (important && ui.speed > 3) ui.speed = 0; // stop the clock for big news
    if (e.kind === 7 && mine) modal(`<h2>Charges</h2><p>The investigation into ${esc(party(PLAYER).name)} ends in indictments. Your leader is finished. Donors are gone, half the treasury is forfeit, and support has collapsed.</p><p class="dim">A successor has taken over what is left of the party. You can rebuild, slowly.</p><div class="choices"><button data-act="closemodal">Carry on</button></div>`);
  }
}

function showEvent(p: any) {
  const ev = C.events.find((e: any) => e.id === p.event);
  if (!ev) { be.command({ t: "choose", slot: p.slot, choice: 0 }); return; }
  ui.speed = 0;
  const fx = (c: any) => (c.effects || []).map((e: any) => {
    const v = e.v, up = v > 0;
    const lab: Record<string, string> = { money: money(v), rep: "reputation", heat: "exposure", volunteers: `${up ? "+" : ""}${v} volunteers`, awareness: "awareness", buzz: "momentum", donors: "a donor", sigs: "signatures", recognition: "name recognition" };
    const arrow = e.op === "money" || e.op === "volunteers" ? "" : up ? "▲ " : "▼ ";
    const bad = e.op === "heat" ? up : !up;
    return `<span class="${bad ? "bad" : "good"}">${arrow}${lab[e.op] || e.op}${e.scope === "state" ? " statewide" : ""}</span>`;
  }).join(" · ");
  modal(`<h3 style="margin-top:0">${esc(dateOf(snap.day))}</h3><h2>${esc(ev.title)}</h2><p>${esc(ev.text)}</p><div class="choices">${ev.choices.map((c: any, i: number) => `<button data-act="choose" data-slot="${p.slot}" data-i="${i}" data-ev="${esc(ev.id)}">${esc(c.label)}<small>${fx(c) || "No effect"}</small></button>`).join("")}</div>`);
}

// ------------------------------------------------------------------ map colouring
function applyMode() {
  if (!map || !meshes) return;
  const m = ui.mode;
  if ((m === "house" && meshes.house) || (m === "senate" && meshes.senate)) map.setMesh(m === "house" ? meshes.house! : meshes.senate!, meshes.counties);
  else map.setMesh(meshes.counties);
  map.selected = m === "house" || m === "senate" ? -1 : ui.sel;
  colorMap(); markers();
}
const DARK: [number, number, number] = [0.1, 0.13, 0.18];
const mix = (a: number[], b: number[], t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function colorMap() {
  if (!map || !meshes || !snap) return;
  const m = ui.mode, nc = pack.counties.length;
  const me = rgb(party(PLAYER).color);
  if (m === "house" || m === "senate") {
    const mesh = m === "house" ? meshes.house : meshes.senate;
    if (!mesh) return;
    const list = m === "house" ? pack.house : pack.senate, kind = m === "house" ? 3 : 4;
    const col = new Float32Array(mesh.n * 3).fill(0.16);
    const tally: Record<number, Record<number, number>> = {};
    for (const s of seats) { if (s.kind !== kind) continue; const sh = list[s.ord]?.shape ?? 0; (tally[sh] ??= {})[s.holderParty] = (tally[sh][s.holderParty] || 0) + 1; }
    for (const sh in tally) {
      const e = Object.entries(tally[sh]).sort((a, b) => b[1] - a[1]); const total = e.reduce((a, b) => a + b[1], 0);
      const p = Number(e[0][0]); const c = p < P ? rgb(party(p).color) : [0.5, 0.53, 0.58];
      col.set(mix(DARK, c, 0.45 + 0.5 * (e[0][1] / total)), Number(sh) * 3);
    }
    map.setColors(col); return;
  }
  const col = new Float32Array(nc * 3);
  for (let c = 0; c < nc; c++) {
    let out: number[];
    if (m === "lead") {
      let a = -1, av = 0, bv = 0;
      for (let p = 0; p < P; p++) { const v = snap.support[c * P + p]; if (v > av) { bv = av; av = v; a = p; } else if (v > bv) bv = v; }
      out = mix(DARK, rgb(party(Math.max(0, a)).color), 0.3 + Math.min(0.55, (av - bv) * 1.15));
    } else if (m === "mine") out = mix(DARK, me, Math.min(1, Math.sqrt(snap.support[c * P + PLAYER] / 0.35)));
    else if (m === "aware") out = mix(DARK, [0.3, 0.8, 0.78], snap.aware[c]);
    else out = mix(DARK, [0.95, 0.76, 0.3], Math.min(1, Math.log(1 + (snap.org[c] * 4000) / pack.counties[c].pop) / 2.5));
    col.set(out, c * 3);
  }
  map.setColors(col);
}

function markers() {
  if (!map || !snap) return;
  const ms: Marker[] = []; const arenaPlaces = new Set(snap.arenas.map((a: any) => a.place));
  snap.arenas.forEach((a: any, i: number) => {
    const p = pack.places[a.place]; const [x, y] = proj(p.lon, p.lat); const home = i === snap.homeArena;
    ms.push({ x, y, size: home ? 13 : 7, rgb: home ? [1, 0.86, 0.45] : [0.93, 0.95, 0.97], label: p.name, rank: home ? -1 : i });
  });
  pack.places.slice(0, 120).forEach((p: any, i: number) => { if (arenaPlaces.has(i)) return; const [x, y] = proj(p.lon, p.lat); ms.push({ x, y, size: 4, rgb: [0.6, 0.65, 0.72], label: p.name, rank: 200 + i }); });
  map.setMarkers(ms);
}

function hoverText(f: number): string {
  if (f < 0 || !snap) return "";
  if (ui.mode === "house" || ui.mode === "senate") {
    const kind = ui.mode === "house" ? 3 : 4, list = ui.mode === "house" ? pack.house : pack.senate;
    const ss = seats.filter((s) => s.kind === kind && list[s.ord]?.shape === f);
    return ss.slice(0, 6).map((s) => `<b>${esc(seatName(s))}</b><br>${chip(s.holderParty)}${esc(s.holder?.name || "Vacant")} <span class="dim">· next ${s.next}</span>`).join("<br>") || "";
  }
  const c = pack.counties[f];
  const rows = snap.parties.map((p: any, i: number) => ({ p, v: snap.support[f * P + i], i })).filter((x: any) => x.p.active && x.v > 0.003).sort((a: any, b: any) => b.v - a.v).slice(0, 5)
    .map((x: any) => `<div style="display:flex;justify-content:space-between;gap:14px"><span>${chip(x.i)}${esc(x.p.name)}</span><span class="num">${pct(x.v)}</span></div>`).join("");
  return `<b>${esc(c.name)}</b><div class="dim" style="margin-bottom:4px">${num(c.pop)} people</div>${rows}<div class="dim" style="margin-top:4px">Your volunteers: ${Math.round(snap.org[f])} · known to ${pct(snap.aware[f], 0)}</div>`;
}

// ------------------------------------------------------------------ rendering
const last: Record<string, string> = {};
function put(id: string, html: string) { if (last[id] !== html || !$("#" + id)?.innerHTML) { const el = $("#" + id); if (el) { el.innerHTML = html; last[id] = html; } } }

function render() {
  if (!snap || !$("#bar")) return;
  const me = party(PLAYER), day = snap.day;
  const vols = snap.org.reduce((a: number, b: number) => a + b, 0);
  const toEl = snap.electionDay - day;
  put("bar", `<div class="brand"><i class="chip" style="background:${hex(me.color)};width:13px;height:13px"></i>${esc(me.name)}</div>
    <div class="date">${esc(dateOf(day))}</div>
    <div class="speed">${[[0, "❚❚"], [1, "▶"], [3, "▶▶"], [10, "▶▶▶"], [30, "▶▶▶▶"]].map(([s, l]) => `<button class="${ui.speed === s ? "on" : ""}" data-act="speed" data-s="${s}" title="${s ? s + " days a second" : "Pause (space)"}">${l}</button>`).join("")}</div>
    <div class="stat"><b class="${me.money < 0 ? "bad" : ""}">${money(me.money)}</b><span>${me.net >= 0 ? "+" : ""}${money(me.net)} a day</span></div>
    <div class="stat"><b>${num(vols)}</b><span>volunteers</span></div>
    <div class="stat"><b>${pct(me.statewide, 2)}</b><span>statewide</span></div>
    <div class="stat"><b class="${me.rep < -0.05 ? "bad" : me.rep > 0.05 ? "good" : ""}">${me.rep >= 0 ? "+" : ""}${Math.round(me.rep * 100)}</b><span>reputation</span></div>
    <div class="stat" style="min-width:120px"><b>${me.qualified ? `<span class="good">On the ballot</span>` : `${num(me.sigs)} / ${num(snap.need)}`}</b>${me.qualified ? `<span>ballot line</span>` : `<div class="meter"><i style="width:${Math.min(100, (me.sigs / snap.need) * 100)}%"></i></div>`}</div>
    <div class="stat"><b>${toEl} days</b><span>to election day</span></div>
    <div class="grow"></div><button data-act="save">Save</button><button data-act="menu">Menu</button>`);
  put("modes", [["lead", "Leading party"], ["mine", "Your support"], ["aware", "Awareness"], ["org", "Volunteers"], ...(meshes?.house ? [["house", "State house"]] : []), ...(meshes?.senate ? [["senate", "State senate"]] : [])].map(([k, l]) => `<button class="${ui.mode === k ? "on" : ""}" data-act="mode" data-m="${k}">${l}</button>`).join(""));
  put("legend", snap.parties.filter((p: any) => p.active).map((p: any) => `<span style="white-space:nowrap;margin-right:9px">${chip(p.id)}${esc(p.name)} <span class="dim num">${pct(p.statewide)}</span></span>`).join(" "));
  put("tabs", [["desk", "Desk"], ["place", "County"], ["offices", "Offices"], ["party", "Party"], ["rivals", "Rivals"], ["news", "News"]].map(([k, l]) => `<button class="${ui.tab === k ? "on" : ""}" data-act="tab" data-t="${k}">${l}</button>`).join(""));
  put("body", ({ desk: tabDesk, place: tabPlace, offices: tabOffices, party: tabParty, rivals: tabRivals, news: tabNews } as any)[ui.tab]());
  const used = snap.ops.length;
  put("queue", `<span class="dim">Operations ${used}/${snap.slots}</span><button class="small ${ui.repeat ? "on" : ""}" data-act="repeat" title="New operations start again when they finish">Repeat ${ui.repeat ? "on" : "off"}</button>` +
    (snap.ops.map((o: any) => `<span class="op"><span class="x" data-cmd='${JSON.stringify({ t: "cancel", slot: o.slot })}'>✕</span><b>${esc(S.ops[o.kind].verb)} ${esc(opTarget(o))}${o.repeat ? " ↻" : ""}</b><span class="dim">${o.left} days left</span><span class="meter"><i style="width:${(1 - o.left / o.total) * 100}%"></i></span></span>`).join("") || `<span class="faint">Nothing queued. Pick a county on the map, or use the Desk.</span>`));
  colorMap();
  if (map) { const want = ui.mode === "house" || ui.mode === "senate" ? -1 : ui.sel; if (map.selected !== want) { map.selected = want; map.redraw(); } }
}

function supportBars(sh: number[], min = 0.004): string {
  const e = sh.map((v, i) => ({ v, i })).filter((x) => x.v > min).sort((a, b) => b.v - a.v);
  return `<div class="bars">${e.map((x) => `<i style="width:${x.v * 100}%;background:${hex(party(x.i).color)}" title="${esc(party(x.i).name)} ${pct(x.v)}"></i>`).join("")}</div>
    <div style="font-size:12px">${e.slice(0, 4).map((x) => `<span style="margin-right:9px;white-space:nowrap">${chip(x.i)}${x.i === PLAYER ? "<b>" : ""}${pct(x.v)}${x.i === PLAYER ? "</b>" : ""}</span>`).join("")}</div>`;
}

function opButton(kind: number, target: number, arg = -1, label?: string): string {
  const spec = costs.ops[kind]; const cost = kind === 8 ? costs.campaign[seats[arg]?.kind ?? 0] : spec.cost;
  const full = snap.ops.length >= snap.slots; const dup = snap.ops.some((o: any) => o.kind === kind && o.target === target && o.arg === arg);
  const dis = full || dup || party(PLAYER).money < cost || (kind === 5 && party(PLAYER).qualified);
  return `<button ${dis ? "disabled" : ""} title="${esc(S.ops[kind].help)}" data-cmd='${JSON.stringify({ t: "op", kind, target, arg })}' data-rep="1">${esc(label || S.ops[kind].name)}<small>${spec.days} days · ${cost ? money(cost) : "free"}${dup ? " · running" : ""}</small></button>`;
}

function advice(): string {
  const me = party(PLAYER), home = snap.arenas[snap.homeArena], hc = home.county;
  const toEl = snap.electionDay - snap.day;
  if (me.investigated) return "You are under investigation. There is nothing to do but wait, and stay clean.";
  if (!snap.ops.length) return "Your volunteers are idle. Queue <b>Recruit volunteers</b> and <b>Canvass the town</b> at home to get started.";
  const localUp = seats.some((s) => s.kind <= 1 && s.area === snap.homeArena && s.electionDay - snap.day > snap.fileDeadline && s.electionDay - snap.day < 420);
  if (!snap.races.length && localUp) return `There is a local election coming in ${esc(placeOf(snap.homeArena).name)}. Open <b>Offices</b> and file before the deadline (${snap.fileDeadline} days before election day).`;
  if (snap.races.some((r: any) => r.cands.some((c: any) => c.p === PLAYER && c.camp < 0.7)) && toEl < 200) return "You have a candidate on the ballot. <b>Campaign pushes</b> and <b>canvassing the town</b> move local races most.";
  if (snap.org[hc] < 25) return "More volunteers at home make every canvass and petition go further.";
  if (!me.qualified) return `County and state races need a ballot line: ${num(snap.need)} valid signatures in ${esc(pack.name)}. Run <b>petition drives</b> where you have volunteers, or pay circulators.`;
  if (snap.slots <= 2 && me.money > 4000) return "An organizer on staff gives you another operation slot. See <b>Party</b>.";
  return "Spread out: recruit and canvass in neighbouring counties where your platform fits, and keep an eye on the next filing deadline.";
}

function raceCard(r: any): string {
  const mine = r.cands.find((c: any) => c.p === PLAYER);
  const d = r.electionDay - snap.day;
  if (!mine) return r.electParty === PLAYER ? `<div class="card"><b>${esc(seatName(r))}</b><div class="good">Won. ${esc(r.elect?.name)} takes office on 1 January.</div></div>` : "";
  return `<div class="card"><div style="display:flex;justify-content:space-between"><b>${esc(seatName(r))}</b><span class="dim">${d} days</span></div>
    <div class="dim">${esc(mine.pol.name)} · ${num(r.voters)} expected voters</div>${supportBars(r.poll, 0)}
    <div class="acts" style="margin-top:7px">${opButton(8, 0, r.i, "Campaign push")}${r.kind <= 1 ? opButton(2, r.area) : `<button data-cmd='${JSON.stringify({ t: "withdraw", seat: r.i })}'>Withdraw<small>ends this candidacy</small></button>`}</div></div>`;
}

function tabDesk(): string {
  const me = party(PLAYER), l = me.leader, home = snap.arenas[snap.homeArena], hc = home.county;
  const office = l && l.seat >= 0 ? seatNameI(l.seat) : "No office yet";
  const sig = (n: number) => `<button class="small" ${me.money < n * snap.sigPrice ? "disabled" : ""} data-cmd='${JSON.stringify({ t: "sigs", n })}'>Pay for ${num(n)} (${money(n * snap.sigPrice)})</button>`;
  const total = me.seats.reduce((a: number, b: number) => a + b, 0);
  return `<div class="card tipc"><b class="gold">Next</b><div>${advice()}</div></div>
    <h3>Leader</h3><div class="kv"><span>${esc(l?.name || "")}</span><b>${esc(office)}</b><span>Name recognition</span><b>${pct(l?.recog || 0, 0)}</b><span>Offices held by the party</span><b>${total} <span class="dim">(${me.seats.map((n: number, k: number) => (n ? `${n} ${S.offices[k].toLowerCase()}` : "")).filter(Boolean).join(", ") || "none"})</span></b></div>
    <h3>Ballot access</h3>${me.qualified ? `<div><span class="good">On the ballot in ${esc(pack.name)}.</span> <span class="dim">To keep the line, poll at least ${pct(snap.retain, 1)} for governor or across the legislature when the governor is elected.</span></div>`
      : `<div class="meter" style="height:10px"><i style="width:${Math.min(100, (me.sigs / snap.need) * 100)}%"></i></div><div class="dim" style="margin:4px 0 6px">${num(me.sigs)} of ${num(snap.need)} valid signatures. Local races are open to you already; county and state races need the ballot line. <span class="faint">(The requirement is an estimate of ${esc(pack.name)}'s rule.)</span></div>${sig(500)} ${sig(5000)}`}
    <h3>Your races</h3>${snap.races.map(raceCard).join("") || `<div class="dim">No candidates filed. See <a href="#" data-act="tab" data-t="offices" style="color:var(--gold)">Offices</a>.</div>`}
    <h3>At home · ${esc(placeOf(snap.homeArena).name)}, ${esc(pack.counties[hc].name)}</h3>
    <div class="kv" style="margin-bottom:8px"><span>Volunteers here</span><b>${Math.round(snap.org[hc])}</b><span>People who know the party</span><b>${pct(snap.aware[hc], 0)}</b><span>Local roots in town</span><b>${"●".repeat(Math.round(home.roots * 2))}${"○".repeat(Math.max(0, 5 - Math.round(home.roots * 2)))}</b></div>
    <div class="acts">${opButton(3, hc)}${opButton(2, snap.homeArena)}${opButton(1, hc)}${opButton(4, hc)}${opButton(6, hc)}${me.qualified ? "" : opButton(5, hc)}</div>`;
}

function seatRow(s: any): string {
  const d = s.electionDay - snap.day; const mine = s.cands.find((c: any) => c.p === PLAYER);
  const me = party(PLAYER); const need = s.kind >= 2 && !me.qualified;
  let act = "";
  if (mine) act = `<span class="gold">Filed: ${esc(mine.pol.name)}</span> <button class="small" data-cmd='${JSON.stringify({ t: "withdraw", seat: s.i })}'>Withdraw</button>`;
  else if (s.electParty === PLAYER) act = `<span class="good">Won</span>`;
  else if (d <= snap.fileDeadline) act = `<span class="faint">Filing closed</span>`;
  else if (d > 420) act = `<span class="faint">Filing opens ${esc(dateOf(s.electionDay - 420))}</span>`;
  else if (need) act = `<span class="faint">Needs the ballot line</span>`;
  else {
    const lbusy = snap.races.some((r: any) => r.cands.some((c: any) => c.p === PLAYER && c.pol.i === me.leader?.i)) || snap.races.some((r: any) => r.elect && r.elect.i === me.leader?.i);
    act = `<button class="small" ${lbusy ? "disabled" : ""} data-cmd='${JSON.stringify({ t: "file", seat: s.i, leader: true })}'>Run yourself</button> <button class="small" ${me.money < costs.recruit[s.kind] ? "disabled" : ""} data-cmd='${JSON.stringify({ t: "file", seat: s.i, leader: false })}'>Recruit (${money(costs.recruit[s.kind])})</button>`;
  }
  const others = s.cands.filter((c: any) => c.p !== PLAYER).map((c: any) => chip(c.p)).join("");
  return `<div class="row"><div class="l"><b>${esc(seatName(s))}</b><small>${chip(s.holderParty)}${esc(s.holder?.name || "Vacant")}${s.holder?.real ? ` <span class="tag" title="A real office-holder: name, party and office only">real</span>` : ""} · election ${s.next}${d < 420 && d > 0 ? ` (${d} days)` : ""} ${others}</small></div><div style="text-align:right;white-space:nowrap">${act}</div></div>`;
}

function tabOffices(): string {
  const ha = snap.homeArena, hc = snap.arenas[ha].county;
  const sec = (title: string, list: any[], cap = 14) => (list.length ? `<h3>${esc(title)}</h3>${list.slice(0, cap).map(seatRow).join("")}${list.length > cap ? `<div class="faint">and ${list.length - cap} more</div>` : ""}` : "");
  const cover = (kind: number) => seats.filter((s) => s.kind === kind && s.counties.includes(hc)).sort((a, b) => a.electionDay - b.electionDay);
  const by = (kind: number, area: number) => seats.filter((s) => s.kind === kind && s.area === area).sort((a, b) => a.electionDay - b.electionDay);
  return `<div class="dim" style="margin-top:10px">The ladder from ${esc(placeOf(ha).name)} to the governor's office. File at least ${snap.fileDeadline} days before election day. Your leader can run for one office at a time; recruited candidates cost money but build the party.</div>
    ${sec(placeOf(ha).name, [...by(1, ha), ...by(0, ha)])}${sec(pack.counties[hc].name, by(2, hc))}${sec(`State house districts covering ${pack.counties[hc].name}`, cover(3))}${sec(`State senate districts covering ${pack.counties[hc].name}`, cover(4))}${sec("Statewide", seats.filter((s) => s.kind === 5))}
    <div class="faint" style="margin-top:12px">Seats elsewhere are listed on the County tab when you select a county. Council sizes, commission sizes and local election years are estimates; legislative seat counts and cycles follow the state's real rules.</div>`;
}

function tabPlace(): string {
  if (!county || county.i !== ui.sel) return `<div class="dim" style="margin-top:12px">Select a county on the map.</div>`;
  const c = pack.counties[ui.sel], me = party(PLAYER);
  const towns = snap.arenas.map((a: any, i: number) => ({ a, i })).filter((x: any) => x.a.county === ui.sel);
  const fit = C.issues.map((is: any, k: number) => `<div style="display:flex;justify-content:space-between;font-size:12px"><span>${esc(is.name)}</span><span class="faint">${esc(is.neg)} ↔ ${esc(is.pos)}</span></div><div class="track"><i class="county" style="left:${((county.ideal[k] + 2) / 4) * 100}%" title="Where this county sits"></i><i style="left:${((me.platform[k] + 2) / 4) * 100}%;background:${hex(me.color)}" title="Your platform"></i></div>`).join("");
  const ad = (t: number) => `<button ${me.money < county.adCost * t ? "disabled" : ""} data-cmd='${JSON.stringify({ t: "ads", county: ui.sel, tier: t })}'>${["", "Radio and flyers", "Local TV week", "Saturation buy"][t]}<small>${money(county.adCost * t)}</small></button>`;
  const local = county.seats.slice().sort((a: any, b: any) => a.kind - b.kind || a.electionDay - b.electionDay);
  return `<h2 style="margin-top:12px">${esc(c.name)}</h2><div class="dim">${num(c.pop)} people${c.income ? ` · median household income ${money(c.income)}` : ""}${c.age ? ` · median age ${c.age}` : ""}</div>
    ${supportBars(county.support)}
    <div class="kv" style="margin-top:8px"><span>Your volunteers</span><b>${Math.round(county.org)}</b><span>People who know the party</span><b>${pct(county.aware, 0)}</b><span>Campaign momentum</span><b>${county.press.toFixed(1)}</b></div>
    <h3>Operations here</h3><div class="acts">${opButton(3, ui.sel)}${opButton(1, ui.sel)}${opButton(4, ui.sel)}${opButton(6, ui.sel)}${me.qualified ? "" : opButton(5, ui.sel)}${towns.map((t: any) => opButton(2, t.i, -1, `Canvass ${pack.places[t.a.place].name}`)).join("")}</div>
    <h3>Advertising</h3><div class="acts">${ad(1)}${ad(2)}<button ${me.money < costs.adState ? "disabled" : ""} data-cmd='${JSON.stringify({ t: "ads", county: -1, tier: 1 })}'>Statewide radio<small>${money(costs.adState)}</small></button></div>
    <h3>Platform fit <span class="faint" style="text-transform:none;letter-spacing:0">▮ county · ● you</span></h3>${fit}
    <h3>Offices elected here</h3>${local.slice(0, 16).map(seatRow).join("") || `<div class="dim">None.</div>`}${local.length > 16 ? `<div class="faint">and ${local.length - 16} more</div>` : ""}`;
}

function tabParty(): string {
  const me = party(PLAYER);
  const plat = C.issues.map((is: any, k: number) => `<div class="name">${esc(is.name)}</div><div class="pos">${[-2, -1, 0, 1, 2].map((v) => `<button class="${me.platform[k] === v ? "on" : ""}" data-cmd='${JSON.stringify({ t: "platform", issue: k, pos: v })}'>${v > 0 ? "+" + v : v}</button>`).join("")}</div><div class="ends"><span>${esc(is.neg)}</span><span>${esc(is.pos)}</span></div>`).join("");
  const heat = me.heat;
  const heatWord = heat < 0.05 ? "Clean" : heat < 0.6 ? "A few loose ends" : heat < 1.4 ? "People are talking" : "Dangerously exposed";
  return `<h3>Staff and money</h3><div class="kv"><span>Treasury</span><b>${money(me.money)}</b><span>Net per day</span><b>${money(me.net)}</b><span>Monthly donors</span><b>${me.donors}</b><span>Organizers (each adds an operation slot; $1,500 to hire, $100 a day)</span><b>${me.organizers}</b></div>
    <div class="acts" style="margin-top:8px"><button data-cmd='{"t":"hire","n":1}' ${me.money < 1500 || me.organizers >= 10 ? "disabled" : ""}>Hire an organizer<small>$1,500 · +1 slot</small></button><button data-cmd='{"t":"hire","n":-1}' ${me.organizers < 1 ? "disabled" : ""}>Let one go<small>saves $100 a day</small></button>${opButton(7, snap.arenas[snap.homeArena].county)}</div>
    <h3>Platform</h3><div class="dim">Changing a position after the first four months costs reputation: voters notice.</div><div class="plat">${plat}</div>
    <h3>Shortcuts</h3><div class="card warn"><div style="display:flex;justify-content:space-between"><b>Exposure: ${heatWord}</b><span class="dim">${me.investigated ? `<span class="bad">Under investigation</span>` : ""}</span></div>
      <div class="meter" style="margin:6px 0"><i style="width:${Math.min(100, heat * 40)}%;background:var(--bad)"></i></div>
      <div class="dim">These work. Each one leaves a trail. Enough of a trail starts an investigation, and an investigation can end the leader, the money and most of the party. Exposure fades over years, not months.</div>
      ${C.bribes.map((b: any, i: number) => `<div class="row"><div class="l"><b>${esc(b.name)}</b><small>${esc(b.result)}</small></div><button class="small danger" ${me.money < costs.bribes[i] ? "disabled" : ""} data-act="bribe" data-i="${i}">${money(costs.bribes[i])}</button></div>`).join("")}</div>`;
}

function chart(): string {
  if (history.length < 2) return `<div class="faint">A chart of statewide support appears after the first two years.</div>`;
  const W = 400, H = 130, n = history.length;
  const max = Math.max(0.1, ...history.flatMap((r: any) => r.support.slice(2)));
  const line = (p: number, top: number) => history.map((r: any, i: number) => `${((i / (n - 1)) * W).toFixed(1)},${(H - Math.min(1, r.support[p] / top) * H).toFixed(1)}`).join(" ");
  return `<div class="dim">Statewide support of the newer parties, ${history[0].year}–${history[n - 1].year} (top of chart ${pct(max, 0)})</div><svg viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px;background:#0f151d;border:1px solid var(--line);border-radius:5px;margin-top:4px">${[2, 3, 4, 5, 6, 7].map((p) => `<polyline fill="none" stroke="${hex(party(p).color)}" stroke-width="${p === PLAYER ? 2.4 : 1.3}" points="${line(p, max)}"/>`).join("")}</svg>`;
}

function tabRivals(): string {
  const rows = snap.parties.filter((p: any) => p.active).sort((a: any, b: any) => b.statewide - a.statewide).map((p: any) => `<tr><td>${chip(p.id)}${p.id === PLAYER ? "<b>" : ""}${esc(p.name)}${p.id === PLAYER ? "</b>" : ""}${p.investigated ? ` <span class="tag bad">investigated</span>` : ""}${p.qualified ? "" : ` <span class="tag">no ballot line</span>`}</td><td>${pct(p.statewide)}</td><td>${p.seats[0] + p.seats[1] + p.seats[2]}</td><td>${p.seats[3]}</td><td>${p.seats[4]}</td><td>${p.seats[5] ? "●" : ""}</td></tr>`).join("");
  const founders = snap.parties.filter((p: any) => p.active && p.id > PLAYER).map((p: any) => `<div class="row"><div class="l"><b>${chip(p.id)}${esc(p.name)}</b><small>Founded ${esc(dateOf(p.founded))} in ${esc(p.home >= 0 ? placeOf(p.home).name : "")} · led by ${esc(p.leader?.name || "")}${p.ruined ? ` · disgraced ${p.ruined}×` : ""}</small></div><span class="dim">${C.issues.map((_: any, k: number) => (p.platform[k] > 0 ? "+" : p.platform[k] < 0 ? "−" : "·")).join("")}</span></div>`).join("");
  const gov = seats[snap.govSeat];
  return `<h3>Standing</h3><table class="t"><tr><th>Party</th><th>Support</th><th>Local</th><th>House</th><th>Senate</th><th>Gov</th></tr>${rows}</table>
    <div class="dim" style="margin-top:8px">Governor: ${gov ? `${chip(gov.holderParty)}${esc(gov.holder?.name || "Vacant")} · next election ${gov.next}` : ""}</div>
    <h3>Trend</h3>${chart()}
    <h3>Insurgent parties</h3>${founders || `<div class="dim">No other new parties yet. They appear over time, founded by fictional politicians, and play by the same rules you do.</div>`}`;
}

function tabNews(): string {
  return `<div class="news" style="margin-top:8px">${snap.log.filter(visible).map((e: any) => `<div><time>${esc(dateOf(e.day))}</time>${logText(e)}</div>`).join("") || `<div class="dim">Nothing yet.</div>`}</div>`;
}

// ------------------------------------------------------------------ input
document.addEventListener("click", async (ev) => {
  const el = (ev.target as HTMLElement).closest("[data-act],[data-cmd]") as HTMLElement | null;
  if (!el || (el as HTMLButtonElement).disabled) return;
  if (el.tagName === "A") ev.preventDefault();
  if (el.dataset.cmd) {
    const c = JSON.parse(el.dataset.cmd);
    if (c.t === "op" && ui.repeat) c.repeat = true;
    await cmd(c);
    return;
  }
  const d = el.dataset;
  switch (d.act) {
    case "new": setupScreen(); break;
    case "title": titleScreen(); break;
    case "continue": { const s = localStorage.getItem(AUTOSAVE); if (s) await loadSave(s); break; }
    case "loadfile": $("#file").click(); break;
    case "backus": setup.usps = ""; showUS(); renderSetup(); break;
    case "town": setup.place = Number(d.i); setupMarkers(); renderSetup(); break;
    case "color": setup.color = Number(d.c); renderSetup(); break;
    case "plat": setup.platform[Number(d.k)] = Number(d.v); renderSetup(); break;
    case "start": await startGame(); break;
    case "closemodal": modal(""); break;
    case "speed": ui.speed = Number(d.s); render(); break;
    case "mode": ui.mode = d.m!; if (ui.mode === "house" || ui.mode === "senate") seats = await be.detail({ t: "seats" }); applyMode(); render(); break;
    case "tab": ui.tab = d.t!; await refresh(true); break;
    case "repeat": ui.repeat = !ui.repeat; render(); break;
    case "save": { const name = `third-party-rising-${snap.usps}-${snap.date.join("-")}.tprsave.json`; const where = await be.saveToFile(name, await be.save()); toast(`Saved: ${esc(where)}`, "good"); break; }
    case "menu": ui.speed = 0; modal(`<h2>Leave this game?</h2><p class="dim">The game autosaves at the start of each year. Use Save to write a file now.</p><div class="choices"><button data-act="save">Save to a file</button><button data-act="title2" class="danger">Back to the title screen</button><button data-act="closemodal">Keep playing</button></div>`); break;
    case "title2": modal(""); titleScreen(); break;
    case "choose": {
      const evd = C.events.find((e: any) => e.id === d.ev); const i = Number(d.i);
      modal(""); await cmd({ t: "choose", slot: Number(d.slot), choice: i });
      if (evd?.choices[i]?.result) toast(esc(evd.choices[i].result));
      break;
    }
    case "bribe": {
      const b = C.bribes[Number(d.i)];
      modal(`<h2>${esc(b.name)}</h2><p>${esc(b.text)}</p><p class="dim">${esc(b.result)} Cost: ${money(costs.bribes[Number(d.i)])}. This cannot be undone, and it adds to your exposure.</p><div class="choices"><button class="danger" data-act="bribe2" data-i="${d.i}">Do it</button><button data-act="closemodal">Walk away</button></div>`);
      break;
    }
    case "bribe2": modal(""); if (await cmd({ t: "bribe", i: Number(d.i) })) toast("Done. Nobody saw anything.", "bad"); break;
  }
});
document.addEventListener("keydown", (e) => {
  if (!snap || !$("#bar") || (e.target as HTMLElement).tagName === "INPUT") return;
  if (e.code === "Space") { e.preventDefault(); ui.speed = ui.speed ? 0 : 3; render(); }
  const sp: Record<string, number> = { Digit1: 1, Digit2: 3, Digit3: 10, Digit4: 30 };
  if (sp[e.code]) { ui.speed = sp[e.code]; render(); }
});

// Test hook for automated browser runs; not used by the game itself.
(window as any).__tpr = { ui, setup, usProj, get map() { return map; }, get proj() { return proj; }, get pack() { return pack; }, get snap() { return snap; }, get seats() { return seats; }, step: async (n: number) => { await be.step(n); await refresh(true); }, cmd };

boot();
