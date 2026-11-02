// Daily build: downloads everything, writes data/latest.json, snapshots today's picks and grades past ones.
// Usage: SGO_API_KEY=... node scripts/build.mjs   (RUN_SGO=0 reuses yesterday's SportsGameOdds prices)
import fs from "node:fs";
import path from "node:path";
import {buildNBA} from "./nba.mjs";
import {buildNFL} from "./nfl.mjs";
import {buildSOC} from "./soc.mjs";
import {priceNFL, priceUCL} from "./sgo.mjs";
import {snapshot, grade} from "./results.mjs";
import {dloc} from "./lib.mjs";
import {botData} from "./botdata.mjs";
import M from "../model.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DATA = path.join(ROOT, "data");
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8")); } catch (e) { return d; } };
const write = (f, v) => { fs.mkdirSync(path.dirname(path.join(DATA, f)), {recursive: true}); fs.writeFileSync(path.join(DATA, f), JSON.stringify(v)); };
const now = new Date(), key = process.env.SGO_API_KEY;
const prev = read("latest.json", {});
// RUN_SGO: "1" always, "0" never, "auto" (default) once per Mexico City day (the free plan has a monthly limit)
const today0 = dloc(now.toISOString(), "America/Mexico_City"), mode = process.env.RUN_SGO || "auto";
const runSgo = mode === "1" || (mode === "auto" && dloc(prev.sgoAt || "2000-01-01T00:00:00Z", "America/Mexico_City") !== today0);
const t0 = Date.now(), log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);

async function step(name, f, fallback) {
  try { const v = await f(); log(name, "ok"); return v; } catch (e) { console.error(name, "FAILED:", e && e.stack || e); return fallback; }
}
// A failed sport keeps yesterday's data instead of blanking the page
const keep = (v, old) => v && v.games ? v : old || {asOf: now.toISOString(), games: [], cands: [], logs: {}, teams: {}};

const nba = keep(await step("NBA", () => buildNBA(now)), prev.nba);
const nfl = keep(await step("NFL", () => buildNFL(now)), prev.nfl);
const soc = keep(await step("Soccer", () => buildSOC(now)), prev.soc);

if (runSgo && key) {
  log("SGO NFL priced", await step("SGO NFL", () => priceNFL(key, nfl), 0));
  log("SGO UCL matched", await step("SGO UCL", () => priceUCL(key, soc), 0));
} else {
  // Carry prices from the previous build when the props and lines match
  const old = new Map(((prev.nfl || {}).cands || []).filter(c => c.p).map(c => [c.aid + c.m + c.s, c]));
  for (const c of nfl.cands) { const o = old.get(c.aid + c.m + c.s); if (o && !c.p && (o.l === c.l || o.moved === c.l)) Object.assign(c, {p: o.p, bk: o.bk, l: o.l, moved: o.moved, pr: o.pr, imp: o.imp, e: o.e}); }
  const og = new Map(((prev.soc || {}).games || []).map(g => [g.id, g]));
  for (const g of soc.games) { const o = og.get(g.id); if (o) { if (o.btts) g.btts = o.btts; if (o.corn) g.corn = o.corn; } }
}

// Opening lines: first line and price seen for each prop (and each soccer match); later builds compare against them
const open = read("open.json", {}), seenK = new Set();
for (const [sp, D] of [["NBA", nba], ["NFL", nfl]]) for (const c of D.cands) {
  if (!c.p) continue; const k = `${sp}|${c.g}|${c.aid}|${c.m}|${c.s}`; seenK.add(k);
  if (!open[k]) { open[k] = {l: c.l, p: c.p, at: now.toISOString()}; continue; }
  c.ol = open[k].l; c.op = open[k].p; c.mv = M.lineMove(c, c.ol, c.op);
  if (c.mv === -1) { c.mvAdj = -0.03; c.pr = +Math.max(0.05, c.pr - 0.03).toFixed(3); c.e = +(c.pr - 1 / c.p).toFixed(3); }
}
for (const g of soc.games) { const L = g.lines || {}; if (!L.mlHome) continue; const k = `SOC|${g.id}`; seenK.add(k);
  if (!open[k]) open[k] = {mlHome: L.mlHome, draw: L.draw, mlAway: L.mlAway, total: L.total, overOdds: L.overOdds, underOdds: L.underOdds, at: now.toISOString()};
  else g.open = open[k]; }
for (const k of Object.keys(open)) if (!seenK.has(k) && now - new Date(open[k].at) > 2 * 864e5) delete open[k];
write("open.json", open);

const latest = {generatedAt: now.toISOString(), sgoAt: runSgo && key ? now.toISOString() : prev.sgoAt, nba, nfl, soc};
write("latest.json", latest);
log("latest.json", (JSON.stringify(latest).length / 1024).toFixed(0) + " KB", `NBA ${nba.games.length} games/${nba.cands.length} props · NFL ${nfl.games.length}/${nfl.cands.length} · soccer ${soc.games.length}`);

// Today's snapshot (overwritten by later runs of the same day) and grading of the last 10 days
// Each pick goes to the snapshot of its game's day (Mexico City), so a late run never mixes tomorrow into today
const items = snapshot(latest, now), byDay = {};
for (const x of items) (byDay[dloc(x.d || now.toISOString(), "America/Mexico_City")] = byDay[dloc(x.d || now.toISOString(), "America/Mexico_City")] || []).push(x);
for (const [d, its] of Object.entries(byDay)) {
  const snap = read(`snap/${d}.json`, null);
  // Picks of games that already started stay as they were; the rest are replaced by this run's version
  const kept = snap ? snap.items.filter(x => !its.some(y => y.sport === x.sport && y.g === x.g)) : [];
  write(`snap/${d}.json`, {date: d, items: kept.concat(its)});
}

const days = [];
for (let i = 0; i < 10; i++) {
  const d = dloc(new Date(now.getTime() - i * 864e5).toISOString(), "America/Mexico_City"), s = read(`snap/${d}.json`, null);
  if (!s) continue;
  if (s.items.some(x => x.res == null)) { await step(`grade ${d}`, () => grade(s.items)); write(`snap/${d}.json`, s); }
  days.push({date: d, items: s.items.map(x => ({sport: x.sport, kind: x.kind, n: x.n, t: x.t, lbl: x.lbl, p: x.p, g: x.g, m: x.m, s: x.s, k: x.k, side: x.side, bet: x.bet, pr: x.pr, role: x.role, mv: x.mv, hit: x.res ? x.res.hit : undefined, act: x.res ? x.res.act : undefined}))});
}
// Days graded before this pipeline existed (or whose snapshot is gone) stay in the file
const oldDays = read("results.json", {days: []}).days.filter(d => !days.some(x => x.date === d.date));
write("results.json", {updatedAt: now.toISOString(), days: days.concat(oldDays).sort((a, b) => a.date < b.date ? 1 : -1).slice(0, 30)});
await step("bot.json", () => write("bot.json", botData(latest, read("results.json", {days: []}), now)));
log("done");
