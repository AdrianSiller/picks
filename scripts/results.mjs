// Snapshot of each day's picks and grading once the games are final.
import {J, pool} from "./lib.mjs";
import M from "../model.js";

const URL = {NBA: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=", NFL: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=", SOC: "https://site.api.espn.com/apis/site/v2/sports/soccer/all/summary?event="};
export const LBL = {NBA: {PTS: "puntos", REB: "rebotes", AST: "asistencias", "3PM": "triples"},
  NFL: {REC: "recepciones", RECYDS: "yardas recibidas", CAR: "acarreos", RUSHYDS: "yardas por tierra", CMP: "pases completos", PASSYDS: "yardas por pase", RRY: "yardas tierra + recepción"}};
const propLbl = (sport, c) => `${c.s === "over" ? "Over" : "Under"} ${c.l} ${LBL[sport][c.m]}`;

// Picks whose game starts in the next `hours`: the top 10 the page shows plus the suggested game picks
export function snapshot(data, now, hours = 30) {
  const soon = g => g && new Date(g.date) - now < hours * 36e5 && new Date(g.date) > now - 2 * 36e5, items = [];
  for (const sport of ["NBA", "NFL"]) {
    const D = data[sport.toLowerCase()]; if (!D || !D.games.length) continue;
    const G = Object.fromEntries(D.games.map(g => [g.id, g])), cfg = M.CFG[sport];
    for (const c of M.topPicks(D.cands, sport)) if (soon(G[c.g])) items.push({sport, kind: "prop", d: G[c.g].date, g: c.g, aid: c.aid, n: c.n, t: c.t, pos: c.pos, m: c.m, l: c.l, s: c.s, p: c.p || null, pr: c.pr, e: c.e, role: c.role, min: c.min, tg: c.tg, cr: c.cr, mv: c.mv || 0, cal: c.calAdj || 0, lbl: propLbl(sport, c)});
    for (const g of D.games) { if (!soon(g) || !D.teams[g.home.abbr] || !D.teams[g.away.abbr]) continue;
      const gm = M.gameModel(g, {...cfg, teams: D.teams, outs: D.outs || {}});
      if (gm.play) items.push({sport, kind: "game", d: g.date, pr: gm.best.p, cal: gm.best.cal || 0, e: gm.best.e, g: g.id, side: gm.best.side, bet: gm.best.kind, line: gm.best.line, p: gm.best.price, n: `${g.away.abbr} @ ${g.home.abbr}`, lbl: gm.best.lbl.replace(" (moneyline)", " · ML").replace(" (spread)", "")}); }
  }
  const S = data.soc;
  if (S && S.games.length) {
    const B = M.buildSoccer(S), G = Object.fromEntries(S.games.map(g => [g.id, g])), seen = new Set();
    const add = (c, why) => { const g = G[c.g]; if (!soon(g) || seen.has(c.g + c.k + c.side)) return; seen.add(c.g + c.k + c.side);
      items.push({sport: "SOC", kind: "soc", lg: g.lg, d: g.date, pr: c.pr, cal: c.cal || 0, e: c.e, g: c.g, k: c.k, side: c.side, team: c.team, line: c.line, p: c.p || null, n: `${g.away.abbr} @ ${g.home.abbr}`, lbl: c.lbl, why}); };
    M.socTop(B.cands, G, null).forEach(c => add(c, "top"));
    for (const g of S.games) { const best = B.cands.filter(c => c.g === g.id && c.p && M.socOk(c)).sort((a, b) => M.socScore(b) - M.socScore(a))[0]; if (best) add(best, "game"); }
  }
  return items;
}

function nbaStat(s, aid, m) {
  for (const t of (s.boxscore && s.boxscore.players) || []) { const st = t.statistics[0], L = st.labels;
    const a = st.athletes.find(x => x.athlete.id === aid); if (!a) continue; if (!a.stats || !a.stats.length || !(+a.stats[L.indexOf("MIN")] > 0)) return null;
    const v = k => k === "3PT" ? +String(a.stats[L.indexOf(k)]).split("-")[0] : +a.stats[L.indexOf(k)];
    return {PTS: v("PTS"), REB: v("REB"), AST: v("AST"), "3PM": v("3PT")}[m]; }
  return null;
}
function nflStat(s, aid, m) {
  const got = {}; let found = false;
  for (const t of (s.boxscore && s.boxscore.players) || []) for (const st of t.statistics || []) {
    const a = (st.athletes || []).find(x => x.athlete.id === aid); if (!a) continue; found = true;
    st.keys.forEach((k, i) => { const raw = String(a.stats[i]); k.split("/").forEach((kk, j) => got[kk] = parseFloat((raw.split("/")[j] || raw).replace(/,/g, "")) || 0); });
  }
  if (!found) return null;
  const g = k => got[k] || 0;
  return {REC: g("receptions"), RECYDS: g("receivingYards"), CAR: g("rushingAttempts"), RUSHYDS: g("rushingYards"), CMP: g("completions"), PASSYDS: g("passingYards"), RRY: g("rushingYards") + g("receivingYards")}[m];
}
const final = s => s && s.header && s.header.competitions && s.header.competitions[0].status.type.completed;
const scores = s => { const cc = s.header.competitions[0].competitors, h = cc.find(x => x.homeAway === "home"), a = cc.find(x => x.homeAway === "away"); return {h: +h.score, a: +a.score, hid: h.team.id, aid: a.team.id}; };

// Grade every pending item whose game is final. hit: 1, 0, or null (void / push)
export async function grade(items) {
  const todo = items.filter(x => x.res == null);
  const ids = [...new Set(todo.map(x => x.sport + "|" + x.g))], sum = {};
  await pool(ids, 6, async k => { const [sp, g] = k.split("|"); sum[k] = await J(URL[sp] + g); });
  for (const x of todo) {
    const s = sum[x.sport + "|" + x.g]; if (!final(s)) continue;
    const sc = scores(s);
    if (x.kind === "prop") {
      const v = x.sport === "NBA" ? nbaStat(s, x.aid, x.m) : nflStat(s, x.aid, x.m);
      x.res = v == null ? {hit: null, act: "no jugó"} : {hit: (x.s === "over" ? v > x.l : v < x.l) ? 1 : 0, act: String(v)};
    } else if (x.kind === "game") {
      const me = x.side === "H" ? sc.h : sc.a, op = x.side === "H" ? sc.a : sc.h, m = x.bet === "ml" ? me - op : me + x.line - op;
      x.res = {hit: m > 0 ? 1 : m < 0 ? 0 : null, act: `${sc.a}-${sc.h}`};
    } else {
      const corners = id => { const T = ((s.boxscore && s.boxscore.teams) || []).find(t => t.team.id === id), st = T && T.statistics.find(z => z.name === "wonCorners"); return st ? +st.displayValue : null; };
      const h = sc.h, a = sc.a; let hit;
      switch (x.k) {
        case "1x2": hit = x.side === "H" ? h > a : x.side === "A" ? a > h : h === a; break;
        case "dc": hit = x.side === "1X" ? h >= a : a >= h; break;
        case "dc1h": { const cc = s.header.competitions[0].competitors, ht = side => { const c = cc.find(z => z.homeAway === side); return c && c.linescores && c.linescores[0] ? +c.linescores[0].displayValue : null; };
          const hh = ht("home"), ha = ht("away"); hit = hh == null || ha == null ? null : x.side === "1X" ? hh >= ha : ha >= hh; break; }
        case "hc": { const m = x.side === "H" ? h - a + x.line : a - h + x.line; hit = m === 0 ? null : m > 0; break; }
        case "tot": hit = x.side === "O" ? h + a > x.line : h + a < x.line; break;
        case "btts": hit = (h > 0 && a > 0) === (x.side === "Y"); break;
        case "tt": { const gl = x.team === "H" ? h : a; hit = x.side === "O" ? gl > x.line : gl < x.line; break; }
        case "cor": { const ch = corners(sc.hid), ca = corners(sc.aid); hit = ch == null || ca == null ? null : x.side === "O" ? ch + ca > x.line : ch + ca < x.line; break; }
      }
      x.res = {hit: hit == null ? null : hit ? 1 : 0, act: `${a}-${h}`};
    }
  }
  return items;
}
