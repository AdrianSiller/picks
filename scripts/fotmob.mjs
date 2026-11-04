// FotMob (free, reachable from GitHub): each team's season xG and xG conceded per match, from the league's xG table.
// One request per league. Matched to ESPN teams by name.
import {J} from "./lib.mjs";
// Our 7 leagues plus the domestic leagues of usual Champions teams
const LEAGUES = {47: "PL", 87: "LL", 54: "BUN", 55: "SA", 53: "L1", 230: "LMX", 61: "POR", 57: "ERE", 40: "BEL", 71: "TUR", 135: "GRE", 64: "SCO", 38: "AUT", 69: "SUI", 46: "DEN", 122: "CZE", 59: "NOR"};
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\b(fc|cf|ac|sc|afc|ssc|sv|vfb|vfl|rc|cd|ud|sl|as|og|club|de|the|sk|fk|bk|if|1\.)\b/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const words = s => norm(s).split(" ").filter(w => w.length > 2);
const sim = (a, b) => { const A = words(a), B = words(b); if (!A.length || !B.length) return 0; let n = 0; for (const w of A) if (B.some(x => x === w || (w.length > 3 && (x.startsWith(w) || w.startsWith(x))))) n++; return n / Math.min(A.length, B.length); };

export async function fotmobXG(teamNames) {
  const rows = [];
  for (const [id, code] of Object.entries(LEAGUES)) {
    const j = await J(`https://www.fotmob.com/api/data/leagues?id=${id}`).catch(() => null); if (!j || !j.table) continue;
    for (const t of j.table) { const d = t.data || t, xg = d.table && d.table.xg; if (!xg) continue;
      for (const r of xg) if (r.played >= 3 && r.xg != null) rows.push({n: r.name, sn: r.shortName, lg: code, p: r.played, xg: r.xg / r.played, xga: r.xgConceded / r.played, gf: +String(r.scoresStr || "0-0").split("-")[0] / r.played, ga: +String(r.scoresStr || "0-0").split("-")[1] / r.played}); }
  }
  const out = {};
  for (const [ab, name] of Object.entries(teamNames)) {
    const best = rows.map(r => ({r, s: Math.max(sim(name, r.n), sim(name, r.sn))})).sort((a, b) => b.s - a.s)[0];
    if (best && best.s >= 1) { const r = best.r; out[ab] = {n: r.n, lg: r.lg, p: r.p, xg: +r.xg.toFixed(2), xga: +r.xga.toFixed(2), gf: +r.gf.toFixed(2), ga: +r.ga.toFixed(2)}; }
  }
  return {teams: out, rows: rows.length};
}
