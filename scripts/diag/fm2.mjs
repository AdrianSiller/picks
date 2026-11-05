import fs from "node:fs";
const J = async u => { const r = await fetch(u, {headers: {"user-agent": "Mozilla/5.0"}}); return {s: r.status, t: await r.text()}; };
const out = {};
const tm = JSON.parse((await J("https://www.fotmob.com/api/data/teams?id=8650")).t); // Liverpool
const fx = tm.fixtures.allFixtures.fixtures.filter(f => f.status.finished); const f = fx[fx.length - 1]; out.match = f.id;
const md = await J(`https://www.fotmob.com/api/data/matchDetails?matchId=${f.id}`); out.status = md.s; out.len = md.t.length;
let j = null; try { j = JSON.parse(md.t); } catch (e) { out.err = e.message; out.head = md.t.slice(0, 300); }
if (j) { out.keys = Object.keys(j); out.content = Object.keys(j.content || {}); out.header = JSON.stringify(j.header).slice(0, 600); out.general = JSON.stringify(j.general).slice(0, 400);
  out.stats = JSON.stringify(j.content.stats).slice(0, 5000); out.ps = JSON.stringify(j.content.playerStats).slice(0, 3000); out.lineup = JSON.stringify(j.content.lineup).slice(0, 1500); }
fs.mkdirSync("data/fm", {recursive: true}); fs.writeFileSync("data/fm/diag2.json", JSON.stringify(out, null, 1));
