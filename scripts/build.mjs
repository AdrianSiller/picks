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

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DATA = path.join(ROOT, "data");
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8")); } catch (e) { return d; } };
const write = (f, v) => { fs.mkdirSync(path.dirname(path.join(DATA, f)), {recursive: true}); fs.writeFileSync(path.join(DATA, f), JSON.stringify(v)); };
const now = new Date(), key = process.env.SGO_API_KEY, runSgo = process.env.RUN_SGO !== "0";
const prev = read("latest.json", {});
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

const latest = {generatedAt: now.toISOString(), nba, nfl, soc};
write("latest.json", latest);
log("latest.json", (JSON.stringify(latest).length / 1024).toFixed(0) + " KB", `NBA ${nba.games.length} games/${nba.cands.length} props · NFL ${nfl.games.length}/${nfl.cands.length} · soccer ${soc.games.length}`);

// Today's snapshot (overwritten by later runs of the same day) and grading of the last 10 days
const today = dloc(now.toISOString(), "America/Mexico_City");
const snap = read(`snap/${today}.json`, null);
const items = snapshot(latest, now);
// Keep items already in the snapshot whose game started (later runs no longer see them as upcoming)
const merged = snap ? snap.items.filter(x => !items.some(y => y.sport === x.sport && y.g === x.g)).concat(items) : items;
write(`snap/${today}.json`, {date: today, items: merged});

const days = [];
for (let i = 0; i < 10; i++) {
  const d = dloc(new Date(now.getTime() - i * 864e5).toISOString(), "America/Mexico_City"), s = read(`snap/${d}.json`, null);
  if (!s) continue;
  if (s.items.some(x => x.res == null)) { await step(`grade ${d}`, () => grade(s.items)); write(`snap/${d}.json`, s); }
  days.push({date: d, items: s.items.map(x => ({sport: x.sport, kind: x.kind, n: x.n, t: x.t, lbl: x.lbl, p: x.p, g: x.g, hit: x.res ? x.res.hit : undefined, act: x.res ? x.res.act : undefined}))});
}
// Days graded before this pipeline existed (or whose snapshot is gone) stay in the file
const oldDays = read("results.json", {days: []}).days.filter(d => !days.some(x => x.date === d.date));
write("results.json", {updatedAt: now.toISOString(), days: days.concat(oldDays).sort((a, b) => a.date < b.date ? 1 : -1).slice(0, 30)});
await step("bot.json", () => write("bot.json", botData(latest, read("results.json", {days: []}), now)));
log("done");
