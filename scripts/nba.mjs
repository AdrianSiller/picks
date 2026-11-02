// NBA: today's games, DraftKings lines and props (via ESPN), player logs, defense by position, injuries.
import {J, pool, dkLines, dloc, ymd, avg, athleteId} from "./lib.mjs";
import M from "../model.js";

const SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const CORE = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba";
const LOG = "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes";
const PREV = 2026; // ESPN season id of last season (2025-26)
const IDX = {PTS: 4, REB: 5, AST: 6, "3PM": 7};
const PTYPES = {"Total Points": "PTS", "Total Assists": "AST", "Total Rebounds": "REB", "Total 3-Point Field Goals": "3PM"};
const posOf = p => p === "C" ? "C" : (p === "F" || p === "SF" || p === "PF") ? "F" : "G";

function parseLog(g) {
  if (!g) return [];
  const st = (g.seasonTypes || []).find(s => /Regular Season/.test(s.displayName)); if (!st) return [];
  const L = g.labels, iM = L.indexOf("MIN"), iP = L.indexOf("PTS"), iR = L.indexOf("REB"), iA = L.indexOf("AST"), i3 = L.indexOf("3PT");
  const rows = [];
  for (const c of st.categories || []) for (const e of c.events || []) {
    const m = (g.events || {})[e.eventId]; if (!m) continue;
    const t3 = String(e.stats[i3] || "0-0").split("-").map(Number);
    rows.push([dloc(m.gameDate), m.opponent && m.opponent.abbreviation, m.atVs === "@" ? "@" : "vs", +e.stats[iM] || 0, +e.stats[iP] || 0, +e.stats[iR] || 0, +e.stats[iA] || 0, t3[0] || 0, t3[1] || 0]);
  }
  return rows.filter(r => r[3] > 0).sort((a, b) => a[0] < b[0] ? 1 : -1);
}

const teamResults = (s, ab) => ((s && s.events) || []).filter(e => e.competitions[0].status.type.completed).map(e => {
  const cc = e.competitions[0].competitors, me = cc.find(x => x.team.abbreviation === ab), op = cc.find(x => x.team.abbreviation !== ab);
  return {id: e.id, row: [dloc(e.date), op.team.abbreviation, me.homeAway === "home" ? "vs" : "@", Number(me.score && me.score.value != null ? me.score.value : me.score), Number(op.score && op.score.value != null ? op.score.value : op.score)]};
});

export async function buildNBA(now = new Date()) {
  const day = ymd(dloc(now.toISOString()));
  const sb = await J(`${SITE}/scoreboard?dates=${day}`);
  if (!sb) throw new Error("ESPN NBA scoreboard unavailable");
  const events = ((sb && sb.events) || []).filter(e => e.status.type.state !== "post");
  if (!events.length) return {asOf: now.toISOString(), games: [], cands: [], logs: {}, teams: {}, def: {}, outs: {}, rmin: {}};
  const games = [], props = [], teamIds = {}, inj = {};
  await pool(events, 5, async e => {
    const c = e.competitions[0], H = c.competitors.find(x => x.homeAway === "home"), A = c.competitors.find(x => x.homeAway === "away");
    const tm = x => ({id: x.team.id, abbr: x.team.abbreviation, name: x.team.displayName, record: (x.records && x.records[0] && x.records[0].summary) || ""});
    teamIds[H.team.abbreviation] = H.team.id; teamIds[A.team.abbreviation] = A.team.id;
    const base = `${CORE}/events/${e.id}/competitions/${e.id}/odds`;
    const [o, s, pb] = await Promise.all([J(base + "?lang=en&region=us"), J(`${SITE}/summary?event=${e.id}`), J(base + "/100/propBets?lang=en&region=us&limit=1000")]);
    const gi = [];
    for (const t of (s && s.injuries) || []) for (const x of t.injuries || []) { gi.push([t.team.abbreviation, x.athlete.displayName, x.status]); inj[x.athlete.id] = x.status; }
    games.push({id: e.id, date: e.date, venue: c.venue && c.venue.fullName, home: tm(H), away: tm(A), lines: dkLines(o) || {}, inj: gi});
    // Props come in pairs per player and market: first Over, then Under
    const seen = {};
    for (const it of (pb && pb.items) || []) { const m = PTYPES[it.type && it.type.name], aid = athleteId(it.athlete && it.athlete.$ref); if (!m || !aid) continue; (seen[aid + "|" + m] = seen[aid + "|" + m] || []).push(it); }
    for (const [k, arr] of Object.entries(seen)) { if (arr.length < 2) continue; const [aid, m] = k.split("|");
      props.push({g: e.id, aid, m, l: Number(arr[0].current && arr[0].current.target ? arr[0].current.target.value : arr[0].odds.total.value), po: +arr[0].odds.decimal.value, pu: +arr[1].odds.decimal.value}); }
  });
  games.sort((a, b) => a.date < b.date ? -1 : 1);

  // Rosters (positions) and team schedules (results this season and last)
  const roster = {}, teams = {}, recent = {};
  await pool(Object.entries(teamIds), 5, async ([ab, id]) => {
    const [r, c, p] = await Promise.all([J(`${SITE}/teams/${id}/roster`), J(`${SITE}/teams/${id}/schedule`), J(`${SITE}/teams/${id}/schedule?season=${PREV}`)]);
    for (const a of (r && r.athletes) || []) roster[a.id] = {n: a.displayName, t: ab, pos: posOf((a.position && a.position.abbreviation) || "G"), inj: a.injuries && a.injuries[0] && a.injuries[0].status};
    const cur = teamResults(c, ab), prev = teamResults(p, ab);
    teams[ab] = {cur: cur.map(x => x.row), prevN: prev.length, prevW: prev.filter(x => x.row[3] > x.row[4]).length, prevDiff: +(prev.reduce((s, x) => s + x.row[3] - x.row[4], 0) / (prev.length || 1)).toFixed(2)};
    recent[ab] = cur.map(x => x.id).reverse().concat(prev.map(x => x.id).reverse()).slice(0, 12);
  });

  // Defense by position: what each team allowed to G / F / C in its last 12 games vs the average of today's teams
  const box = {};
  await pool([...new Set(Object.values(recent).flat())], 8, async id => {
    const s = await J(`${SITE}/summary?event=${id}`); if (!s) return; const out = {};
    for (const t of (s.boxscore && s.boxscore.players) || []) {
      const st = t.statistics[0], L = st.labels, iP = L.indexOf("PTS"), iR = L.indexOf("REB"), iA = L.indexOf("AST"), i3 = L.indexOf("3PT");
      const agg = {G: [0, 0, 0, 0], F: [0, 0, 0, 0], C: [0, 0, 0, 0]};
      for (const a of st.athletes) { if (!a.stats || !a.stats.length) continue; const k = posOf((a.athlete.position && a.athlete.position.abbreviation) || "G");
        agg[k][0] += +a.stats[iP] || 0; agg[k][1] += +a.stats[iR] || 0; agg[k][2] += +a.stats[iA] || 0; agg[k][3] += +String(a.stats[i3] || "0").split("-")[0] || 0; }
      out[t.team.abbreviation] = agg;
    }
    box[id] = out;
  });
  const MS = ["PTS", "REB", "AST", "3PM"], allowed = {};
  for (const [ab, ids] of Object.entries(recent)) { const a = {G: [0, 0, 0, 0], F: [0, 0, 0, 0], C: [0, 0, 0, 0]}; let n = 0;
    for (const id of ids) { const b = box[id]; if (!b || !b[ab]) continue; const opp = Object.keys(b).find(k => k !== ab); if (!opp) continue; n++;
      for (const k of ["G", "F", "C"]) for (let i = 0; i < 4; i++) a[k][i] += b[opp][k][i]; }
    allowed[ab] = {n, a}; }
  const lg = {}; for (const k of ["G", "F", "C"]) for (let i = 0; i < 4; i++) { let s = 0, n = 0; for (const v of Object.values(allowed)) { s += v.a[k][i]; n += v.n; } lg[k + MS[i]] = n ? s / n : 1; }
  const def = {}; for (const [ab, v] of Object.entries(allowed)) { if (!v.n) continue; const f = {}; for (const k of ["G", "F", "C"]) for (let i = 0; i < 4; i++) f[k + MS[i]] = +((v.a[k][i] / v.n) / lg[k + MS[i]]).toFixed(3); def[ab] = {n: v.n, f}; }

  // Player logs: this season and last
  const outIds = Object.entries(inj).filter(([, s]) => s === "Out").map(([id]) => id);
  const ids = [...new Set(props.map(p => p.aid).concat(outIds))], logs = {};
  await pool(ids, 8, async id => { const [c, p] = await Promise.all([J(`${LOG}/${id}/gamelog`), J(`${LOG}/${id}/gamelog?season=${PREV}`)]); logs[id] = {c: parseLog(c), p: parseLog(p)}; });

  // Candidates: the better side of every prop with enough support
  // Rest: days since each team's last game (1 = second night of a back-to-back)
  const restOf = (ab, date) => { const cur = (teams[ab] || {}).cur || []; if (!cur.length) return null; const last = cur[cur.length - 1][0];
    return Math.round((new Date(dloc(date) + "T12:00:00Z") - new Date(last + "T12:00:00Z")) / 864e5); };
  games.forEach(g => { g.rest = {h: restOf(g.home.abbr, g.date), a: restOf(g.away.abbr, g.date)}; });
  const G = Object.fromEntries(games.map(g => [g.id, g])), all = [];
  for (const p of props) {
    const R = roster[p.aid], L = logs[p.aid]; if (!R || !L) continue;
    const st = inj[p.aid] || R.inj; if (st === "Out") continue;
    const g = G[p.g], h = R.t === g.home.abbr; if (!h && R.t !== g.away.abbr) continue;
    const o = h ? g.away.abbr : g.home.abbr, cur = L.c, prev = L.p, both = cur.concat(prev); if (cur.length < 2) continue;
    const i = IDX[p.m], vc = cur.map(r => r[i]), vp = prev.map(r => r[i]), oppRows = both.filter(r => r[1] === o), vo = oppRows.map(r => r[i]);
    const min = avg(cur.map(r => r[3])), d = def[o], f = M.defFactor(d && d.f[R.pos + p.m], d ? d.n : 0, 15);
    // Role: main = 26+ minutes this season with steady minutes lately (std dev of the last 8 games up to 7)
    const m8 = both.slice(0, 8).map(r => r[3]), mAvg = m8.reduce((s, v) => s + v, 0) / (m8.length || 1);
    const msd = Math.sqrt(m8.reduce((s, v) => s + (v - mAvg) ** 2, 0) / (m8.length || 1)), role = min >= 26 && msd <= 7 ? 1 : 0;
    let best = null;
    for (const s of ["over", "under"]) {
      const price = s === "over" ? p.po : p.pu; if (!price || price < 1.25) continue; if (s === "over" && min < 20) continue;
      const hs = M.hitStats(vc, vp, vo, p.l, s), pr = M.withDef(hs.pr0, s, f);
      const c = {g: p.g, aid: p.aid, n: R.n, pos: R.pos, t: R.t, o, h, m: p.m, l: p.l, s, p: price, bk: "DraftKings", pr: +pr.toFixed(3), pr0: +hs.pr0.toFixed(3), f: +f.toFixed(3), hd: 1,
        imp: +(1 / price).toFixed(3), e: +(pr - 1 / price).toFixed(3), hc: hs.hc, h10: hs.h10, hp: hs.hp, hh: hs.hh,
        aC: avg(vc), a10: avg(both.slice(0, 10).map(r => r[i])), aP: avg(vp), aH: avg(vo), min, msd: Math.round(msd * 10) / 10, role, sm: hs.hc[1] + hs.hp[1] < 15, vc, vp, vo};
      if (st && st !== "Active") c.q = 1;
      if ((h ? g.rest.h : g.rest.a) === 1) c.b2b = 1;
      if (!best || c.pr > best.pr) best = c;
    }
    if (best && best.pr >= 0.55) all.push(best);
  }
  // Keep the best market per player and up to 14 players per game
  const cands = [], perG = {};
  for (const c of all.sort((a, b) => M.score(b, "NBA") - M.score(a, "NBA"))) {
    const L = perG[c.g] = perG[c.g] || []; if (L.length >= 14 || L.some(x => x.aid === c.aid)) continue; L.push(c); cands.push(c);
  }
  const keepLogs = {}; cands.forEach(c => { const L = logs[c.aid]; keepLogs[c.aid] = L.c.concat(L.p).slice(0, 10); });

  // Injury cost for the game model, and minutes of regulars so the Refresh button can recompute it
  const outs = {}, rmin = {};
  for (const [id, L] of Object.entries(logs)) { const R = roster[id]; if (!R) continue;
    const rows = L.c.length ? L.c : L.p.slice(0, 20), m = avg(rows.map(r => r[3])); if (!m || m < 15) continue;
    (rmin[R.t] = rmin[R.t] || {})[R.n] = m;
    if (inj[id] === "Out") (outs[R.t] = outs[R.t] || []).push([R.n, m, Math.min(3, Math.round(m / 18 * 2) / 2)]); }
  return {asOf: now.toISOString(), games, cands, logs: keepLogs, teams, def, outs, rmin};
}
