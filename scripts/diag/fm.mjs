import fs from "node:fs";
const out = {}, get = async (k, u) => { try { const r = await fetch(u, {headers: {"user-agent": "Mozilla/5.0"}}); const t = await r.text(); out[k] = {status: r.status, len: t.length, head: t.slice(0, 300)}; return t; } catch (e) { out[k] = {err: e.message}; return ""; } };
const s = await get("search", "https://www.fotmob.com/api/search/suggest?term=Jagiellonia&lang=en");
const lg = await get("league196", "https://www.fotmob.com/api/data/leagues?id=196");
let tid = null; try { const j = JSON.parse(lg); const t = j.table[0].data.table.all; out.teams196 = t.map(x => [x.id, x.name]).slice(0, 20); tid = (t.find(x => /Jagiell/.test(x.name)) || t[0]).id; } catch (e) { out.lgerr = e.message; }
const tm = await get("team", `https://www.fotmob.com/api/data/teams?id=${tid}`);
fs.mkdirSync("data/fm", {recursive: true}); fs.writeFileSync("data/fm/team.json", tm);
let mid = null; try { const j = JSON.parse(tm); out.teamKeys = Object.keys(j); const fx = j.fixtures && (j.fixtures.allFixtures || {}).fixtures || []; out.fx0 = fx.slice(0, 2); const done = fx.filter(f => f.status && f.status.finished); mid = done.length ? done[done.length - 1].id : null; out.nDone = done.length; } catch (e) { out.tmerr = e.message; }
const md = await get("match", `https://www.fotmob.com/api/data/matchDetails?matchId=${mid}`); fs.writeFileSync("data/fm/match.json", md);
fs.writeFileSync("data/fm/diag.json", JSON.stringify(out, null, 1));
