// FotMob match details for every team we have games for: xG, shots, shots on target, possession, corners and big chances per
// match, plus each player's minutes / shots / shots on target. Finished matches never change, so each one is fetched once and
// kept in data/fm/cache.json (small summaries); every run only adds the new ones. Runs on its own (hourly), the build only reads it.
import fs from "node:fs";
import path from "node:path";
import {J, pool} from "./lib.mjs";
import {LEAGUES, sim} from "./fotmob.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), ".."), DATA = path.join(ROOT, "data");
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8")); } catch (e) { return d; } };
const latest = read("latest.json", {}), cache = read("fm/cache.json", {m: {}}), map = read("fm/teams.json", {});
const names = {}; for (const g of ((latest.soc || {}).games || [])) { names[g.home.abbr] = g.home.name; names[g.away.abbr] = g.away.name; }
const t0 = Date.now(), MAXNEW = +(process.env.FM_MAX || 900);

// FotMob team ids from league tables (our leagues, domestic leagues of continental teams, and the continental tables themselves)
const idx = [];
for (const id of [...Object.keys(LEAGUES), 42, 73, 10216]) { const j = await J(`https://www.fotmob.com/api/data/leagues?id=${id}`).catch(() => null); if (!j || !j.table) continue;
  for (const t of j.table) { const d = t.data || t; const tabs = d.table ? [d.table.all] : (d.tables || []).map(x => x.table && x.table.all); for (const all of tabs) for (const r of all || []) if (!idx.some(x => x.id === r.id)) idx.push({id: r.id, n: r.name, sn: r.shortName}); } }
console.log("fotmob equipos en tablas:", idx.length);

const val = (stats, key) => { for (const grp of stats || []) for (const x of grp.stats || []) if (x.key === key && x.rawStats && x.rawStats[0]) return [x.rawStats[0].value, x.rawStats[1] && x.rawStats[1].value]; return [null, null]; };
const pst = (p, key) => { for (const grp of p.stats || []) for (const v of Object.values(grp.stats || {})) if (v.key === key) return v.stat && v.stat.value; return null; };
let fetched = 0;
await pool(Object.entries(names), 4, async ([ab, name]) => {
  let id = map[ab] && map[ab].id;
  if (!id) { const best = idx.map(r => ({r, s: Math.max(sim(name, r.n), sim(name, r.sn || ""))})).sort((a, b) => b.s - a.s)[0]; if (!best || best.s < 1) return; id = best.r.id; map[ab] = {id, n: best.r.n}; }
  const tj = await J(`https://www.fotmob.com/api/data/teams?id=${id}`).catch(() => null); const fx = (tj && tj.fixtures && tj.fixtures.allFixtures && tj.fixtures.allFixtures.fixtures) || [];
  const done = fx.filter(f => f.status && f.status.finished && !/friendl/i.test((f.tournament && f.tournament.name) || "")).sort((a, b) => a.status.utcTime < b.status.utcTime ? 1 : -1).slice(0, 12);
  map[ab].ms = done.map(f => String(f.id));
  for (const f of done) { const mid = String(f.id); if (cache.m[mid] || fetched >= MAXNEW) continue; fetched++;
    const md = await J(`https://www.fotmob.com/api/data/matchDetails?matchId=${mid}`).catch(() => null); if (!md || !md.content) continue;
    const st = md.content.stats && md.content.stats.Periods && md.content.stats.Periods.All && md.content.stats.Periods.All.stats, hd = md.header || {}, tm = hd.teams || [];
    const pl = {}; for (const p of Object.values(md.content.playerStats || {})) { const mn = pst(p, "minutes_played"); if (!mn) continue; pl[p.id] = [p.teamId === (tm[0] || {}).id ? "h" : "a", mn, pst(p, "total_shots") || 0, pst(p, "ShotsOnTarget") || 0, pst(p, "goals") || 0, p.name]; }
    cache.m[mid] = {d: f.status.utcTime, comp: (f.tournament && f.tournament.name) || "", h: (tm[0] || {}).id, a: (tm[1] || {}).id, sc: [(tm[0] || {}).score, (tm[1] || {}).score],
      xg: val(st, "expected_goals"), sh: val(st, "total_shots"), sot: val(st, "ShotsOnTarget"), pos: val(st, "BallPossesion"), cor: val(st, "corners"), bc: val(st, "big_chance"), pl}; }
});
// Keep the cache from growing forever: drop matches older than 150 days
for (const [k, v] of Object.entries(cache.m)) if (Date.now() - new Date(v.d) > 150 * 864e5) delete cache.m[k];
fs.mkdirSync(path.join(DATA, "fm"), {recursive: true});
fs.writeFileSync(path.join(DATA, "fm/cache.json"), JSON.stringify(cache)); fs.writeFileSync(path.join(DATA, "fm/teams.json"), JSON.stringify(map));
console.log(`fotmob: ${Object.keys(map).length} equipos, ${fetched} partidos nuevos, ${Object.keys(cache.m).length} en caché, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
