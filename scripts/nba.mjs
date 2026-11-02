// NBA: today's games, DraftKings lines and props (via ESPN), player logs, defense by position, injuries.
import {J, pool, dkLines, dloc, ymd, avg, med, athleteId} from "./lib.mjs";
import M from "../model.js";

const SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const CORE = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba";
const LOG = "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes";
const CUR_LBL = "2026-27 Regular Season", PREV_LBL = "2025-26 Regular Season";
const PREV = 2026; // ESPN season id of last season (2025-26)
const IDX = {PTS: 4, REB: 5, AST: 6, "3PM": 7};
const PTYPES = {"Total Points": "PTS", "Total Assists": "AST", "Total Rebounds": "REB", "Total 3-Point Field Goals": "3PM"};
const posOf = p => p === "C" ? "C" : (p === "F" || p === "SF" || p === "PF") ? "F" : "G";

// season: exact label, so a player who has not played this season does not get last season as "this season"
function parseLog(g, season) {
  if (!g) return [];
  const st = (g.seasonTypes || []).find(s => s.displayName === season); if (!st) return [];
  const L = g.labels, iM = L.indexOf("MIN"), iP = L.indexOf("PTS"), iR = L.indexOf("REB"), iA = L.indexOf("AST"), i3 = L.indexOf("3PT"), iF = L.indexOf("FT");
  const rows = [];
  for (const c of st.categories || []) for (const e of c.events || []) {
    const m = (g.events || {})[e.eventId]; if (!m) continue;
    const t3 = String(e.stats[i3] || "0-0").split("-").map(Number);
    rows.push([dloc(m.gameDate), m.opponent && m.opponent.abbreviation, m.atVs === "@" ? "@" : "vs", +e.stats[iM] || 0, +e.stats[iP] || 0, +e.stats[iR] || 0, +e.stats[iA] || 0, t3[0] || 0, t3[1] || 0, iF >= 0 ? +String(e.stats[iF] || "0").split("-")[0] || 0 : 0]);
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
    teams[ab] = {cur: cur.map(x => x.row), prevN: prev.length, prevW: prev.filter(x => x.row[3] > x.row[4]).length, prevDiff: +(prev.reduce((s, x) => s + x.row[3] - x.row[4], 0) / (prev.length || 1)).toFixed(2),
      prevPF: +(prev.reduce((s, x) => s + x.row[3], 0) / (prev.length || 1)).toFixed(1), prevPA: +(prev.reduce((s, x) => s + x.row[4], 0) / (prev.length || 1)).toFixed(1)};
    recent[ab] = cur.map(x => x.id).reverse().concat(prev.map(x => x.id).reverse()).slice(0, 12);
  });

  // Defense by position: what each team allowed to G / F / C in its last 12 games vs the average of today's teams
  const box = {};
  await pool([...new Set(Object.values(recent).flat())], 8, async id => {
    const s = await J(`${SITE}/summary?event=${id}`); if (!s) return; const out = {};
    for (const t of (s.boxscore && s.boxscore.players) || []) {
      const st = t.statistics[0], L = st.labels, iP = L.indexOf("PTS"), iR = L.indexOf("REB"), iA = L.indexOf("AST"), i3 = L.indexOf("3PT"), iF = L.indexOf("FT");
      const agg = {G: [0, 0, 0, 0], F: [0, 0, 0, 0], C: [0, 0, 0, 0], sty: [0, 0, 0], pos: 0};
      const iFG = L.indexOf("FG"), iOR = L.indexOf("OREB"), iTO = L.indexOf("TO");
      for (const a of st.athletes) { if (!a.stats || !a.stats.length) continue; const k = posOf((a.athlete.position && a.athlete.position.abbreviation) || "G");
        agg[k][0] += +a.stats[iP] || 0; agg[k][1] += +a.stats[iR] || 0; agg[k][2] += +a.stats[iA] || 0; agg[k][3] += +String(a.stats[i3] || "0").split("-")[0] || 0;
        const p3 = 3 * (+String(a.stats[i3] || "0").split("-")[0] || 0), pf = iF >= 0 ? +String(a.stats[iF] || "0").split("-")[0] || 0 : 0; agg.sty[0] += p3; agg.sty[2] += pf; agg.sty[1] += (+a.stats[iP] || 0) - p3 - pf;
        // Possessions ≈ shots + 0.44 × free throws − offensive rebounds + turnovers
        const fga = iFG >= 0 ? +String(a.stats[iFG] || "0-0").split("-")[1] || 0 : 0, fta = iF >= 0 ? +String(a.stats[iF] || "0-0").split("-")[1] || 0 : 0;
        agg.pos += fga + 0.44 * fta - (iOR >= 0 ? +a.stats[iOR] || 0 : 0) + (iTO >= 0 ? +a.stats[iTO] || 0 : 0); }
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
  // Style of defense: points allowed from threes / inside the arc / free throws vs the average of today's teams
  const sty = {}; for (const [ab, ids] of Object.entries(recent)) { const a = [0, 0, 0]; let n = 0;
    for (const id of ids) { const b = box[id]; if (!b || !b[ab]) continue; const opp = Object.keys(b).find(k => k !== ab); if (!opp || !b[opp].sty) continue; n++; for (let i = 0; i < 3; i++) a[i] += b[opp].sty[i]; }
    if (n) sty[ab] = {n, a: a.map(x => x / n)}; }
  const lgS = [0, 1, 2].map(i => { const v = Object.values(sty); return v.length ? v.reduce((s, x) => s + x.a[i], 0) / v.length : 1; });
  for (const [ab, v] of Object.entries(sty)) { v.f = v.a.map((x, i) => +(x / (lgS[i] || 1)).toFixed(3)); if (def[ab]) def[ab].sty = v.f; }
  // Pace: possessions per game of each team (its own and its rivals', averaged), last 12 games
  const pace = {}; for (const [ab, ids] of Object.entries(recent)) { let s = 0, n = 0;
    for (const id of ids) { const b = box[id]; if (!b || !b[ab]) continue; const opp = Object.keys(b).find(k => k !== ab); if (!opp || !b[ab].pos || !b[opp].pos) continue; s += (b[ab].pos + b[opp].pos) / 2; n++; }
    if (n >= 3) pace[ab] = s / n; }

  // Player logs: this season and last
  const outIds = Object.entries(inj).filter(([, s]) => s === "Out").map(([id]) => id);
  const ids = [...new Set(props.map(p => p.aid).concat(outIds))], logs = {};
  await pool(ids, 8, async id => { const [c, p] = await Promise.all([J(`${LOG}/${id}/gamelog`), J(`${LOG}/${id}/gamelog?season=${PREV}`)]); logs[id] = {c: parseLog(c, CUR_LBL), p: parseLog(p, PREV_LBL)}; });

  // Candidates: the better side of every prop with enough support
  // Rest: days since each team's last game (1 = second night of a back-to-back)
  const restOf = (ab, date) => { const cur = (teams[ab] || {}).cur || []; if (!cur.length) return null; const last = cur[cur.length - 1][0];
    return Math.round((new Date(dloc(date) + "T12:00:00Z") - new Date(last + "T12:00:00Z")) / 864e5); };
  games.forEach(g => { g.rest = {h: restOf(g.home.abbr, g.date), a: restOf(g.away.abbr, g.date)}; });
  // Scoring environment: game total vs the average total of today's teams this season
  const allRows = Object.values(teams).flatMap(T => T.cur), lgTot = allRows.length ? allRows.reduce((s, r) => s + r[3] + r[4], 0) / allRows.length : 225;
  games.forEach(g => { const t = Number(g.lines.total); if (t) g.env = {total: t, avg: Math.round(lgTot * 10) / 10, env: +((t - lgTot) / lgTot).toFixed(3)}; });
  // Minutes model: when a rotation player is newly out, part of his minutes go to active teammates (mostly his own
  // position group, some to the neighbouring one), up to +6 each and 38 in total; when a regular comes back after missing the last game,
  // teammates of his position give some back. vm = expected minutes today / his usual minutes.
  const grp = {G: ["G", "F"], F: ["F", "G", "C"], C: ["C", "F"]};
  const known = Object.entries(logs).map(([id, L]) => ({id, R: roster[id], min: avg((L.c.length ? L.c : L.p.slice(0, 20)).map(r => r[3])) || 0, lastD: (L.c[0] || [])[0]})).filter(x => x.R && x.min >= 12);
  const MV = {}, minNotes = {}, US = {};
  // Shots and touches: besides minutes, the teammates already on the floor take more of the shots and passes of a new absence.
  // 35% of his points, 30% of his three-point attempts and (if he is a passer, 5+) 30% of his assists go to active teammates
  // in proportion to what each already does; at most +15% per stat and player.
  const per = (id, k) => { const L = logs[id]; const r = L ? (L.c.length ? L.c : L.p.slice(0, 20)) : []; return avg(r.map(x => x[k])) || 0; };
  for (const ab of Object.keys(teamIds)) {
    const team = known.filter(x => x.R.t === ab), lastTeam = ((teams[ab] || {}).cur || []).slice(-1)[0];
    const out = team.filter(x => (inj[x.id] || x.R.inj) === "Out"), act = team.filter(x => (inj[x.id] || x.R.inj) !== "Out");
    const add = Object.fromEntries(act.map(x => [x.id, 0]));
    // Only new absences: if he already missed the team's last game, his teammates' recent minutes already show it.
    // 60% of his minutes are shared among the players we track (the rest goes to the deep bench).
    for (const o of out.filter(o => o.min >= 15 && lastTeam && o.lastD === lastTeam[0])) {
      for (const [k, w] of [[0, 0.42], [1, 0.18]]) { const pos = grp[o.R.pos][k]; if (!pos) continue; const rec = act.filter(x => x.R.pos === pos), tot = rec.reduce((s, x) => s + x.min, 0);
        rec.forEach(x => { add[x.id] += o.min * w * x.min / (tot || 1); }); }
      (minNotes[ab] = minNotes[ab] || []).push(`Sin ${o.R.n} (${Math.round(o.min)} min por juego)`);
      for (const [stat, k, sh, need] of [["PTS", 4, 0.35, 8], ["3PM", 8, 0.3, 3], ["AST", 6, 0.3, 5]]) {
        const tot0 = per(o.id, k); if (tot0 < need) continue;
        const rec = act.filter(x => per(x.id, k) > 0), tot = rec.reduce((s, x) => s + per(x.id, k), 0);
        rec.forEach(x => { const mine = per(x.id, k), extra = tot0 * sh * mine / (tot || 1); US[x.id] = US[x.id] || {}; US[x.id][stat] = (US[x.id][stat] || 1) + extra / mine; });
      }
    }
    for (const b of act.filter(x => x.min >= 24 && lastTeam && x.lastD && x.lastD < lastTeam[0])) {
      const rec = act.filter(x => x !== b && x.R.pos === b.R.pos), tot = rec.reduce((s, x) => s + x.min, 0);
      rec.forEach(x => { add[x.id] -= Math.min(6, b.min * 0.5 * x.min / (tot || 1)); });
      (minNotes[ab] = minNotes[ab] || []).push(`Regresa ${b.R.n} (no jugó el último partido)`);
    }
    act.forEach(x => { const a = M.clamp(add[x.id], -6, 6), nm = Math.min(38, x.min + a); MV[x.id] = x.min ? nm / x.min : 1; });
  }
  games.forEach(g => { const nh = minNotes[g.home.abbr], na = minNotes[g.away.abbr]; if (nh || na) g.usage = {h: nh || [], a: na || []}; });
  const G = Object.fromEntries(games.map(g => [g.id, g])), all = [];
  for (const p of props) {
    const R = roster[p.aid], L = logs[p.aid]; if (!R || !L) continue;
    const st = inj[p.aid] || R.inj; if (st === "Out") continue;
    const g = G[p.g], h = R.t === g.home.abbr; if (!h && R.t !== g.away.abbr) continue;
    const o = h ? g.away.abbr : g.home.abbr, cur = L.c, prev = L.p, both = cur.concat(prev); if (cur.length < 2) continue;
    let vm = MV[p.aid] || 1; if (Math.abs(vm - 1) < 0.08) vm = 1;
    let us = Math.min(1.15, (US[p.aid] || {})[p.m] || 1); if (us < 1.03) us = 1;
    // Pace: today's game = average of both teams' pace; his numbers come at his team's pace. ±6% at most.
    const myT = R.t, pc = pace[myT] && pace[o] ? M.clamp(((pace[myT] + pace[o]) / 2) / pace[myT], 0.94, 1.06) : 1, pcF = Math.abs(pc - 1) < 0.015 ? 1 : pc;
    // Home / away: his numbers at today's venue vs overall (this season and last), leaning to 1 with few games. ±8% at most.
    const here = both.filter(r => r[2] === (h ? "vs" : "@")).slice(0, 20), all20 = both.slice(0, 40), iS = IDX[p.m];
    const mAll = all20.length ? all20.reduce((s, r) => s + r[iS], 0) / all20.length : 0, mHere = here.length ? here.reduce((s, r) => s + r[iS], 0) / here.length : 0;
    const venRaw = mAll > 0 && here.length >= 4 ? mHere / mAll : 1, ven = M.clamp(1 + (venRaw - 1) * here.length / (here.length + 10), 0.92, 1.08), venF = Math.abs(ven - 1) < 0.02 ? 1 : ven;
    const k = vm * us * pcF * venF, i = IDX[p.m], vc = cur.map(r => r[i] * k), vp = prev.map(r => r[i] * k), oppRows = both.filter(r => r[1] === o), vo = oppRows.map(r => r[i] * k);
    const min = avg(cur.map(r => r[3])), d = def[o], fPos = M.defFactor(d && d.f[R.pos + p.m], d ? d.n : 0, 15);
    // Style matchup: where his points come from (threes / inside the arc / free throws, last 10) against what this defense allows from each
    let f = fPos, styInfo = null;
    if (d && d.sty && (p.m === "PTS" || p.m === "3PM")) {
      const r10s = both.slice(0, 10), pts = r10s.reduce((s, r) => s + r[4], 0), p3 = r10s.reduce((s, r) => s + 3 * r[7], 0), pf = r10s.reduce((s, r) => s + (r[9] || 0), 0);
      const sh = pts > 0 ? [p3 / pts, Math.max(0, pts - p3 - pf) / pts, pf / pts] : [0.35, 0.5, 0.15];
      const raw = p.m === "3PM" ? d.sty[0] : sh[0] * d.sty[0] + sh[1] * d.sty[1] + sh[2] * d.sty[2], fS = M.defFactor(raw, d.n, 15);
      f = Math.sqrt(fPos * fS); styInfo = {sh: sh.map(x => +x.toFixed(2)), def: d.sty, fS: +fS.toFixed(3), fPos: +fPos.toFixed(3)};
    }
    // Role for this stat: steady minutes (20+, std dev of the last 8 games up to 7) and the stat is part of his job:
    // shooters (4+ threes tried) for 3PM, scorers (12+) for points, centers or 6+ boards for rebounds, 4+ assists for assists.
    // A bench shooter qualifies for threes; a wing's rebounds or a big's assists do not.
    const m8 = both.slice(0, 8).map(r => r[3]), mAvg = m8.reduce((s, v) => s + v, 0) / (m8.length || 1);
    const msd = Math.sqrt(m8.reduce((s, v) => s + (v - mAvg) ** 2, 0) / (m8.length || 1)), r10 = both.slice(0, 10), av = k => r10.reduce((s, r) => s + r[k], 0) / (r10.length || 1);
    // Rebounds and assists: not by position but by how steady he is in that stat (a guard who grabs boards to push the break
    // counts). Overs: 3+ per game and low swing (coefficient of variation up to 0.5); unders: low swing (up to 0.6).
    const sv = r10.map(r => r[i]), sm = sv.reduce((s, v) => s + v, 0) / (sv.length || 1), cv = sm ? Math.sqrt(sv.reduce((s, v) => s + (v - sm) ** 2, 0) / (sv.length || 1)) / sm : 9;
    const statRole = s => ({"3PM": av(8) >= 4, PTS: av(4) >= 12, REB: s === "over" ? sm >= 3 && cv <= 0.5 : cv <= 0.6, AST: s === "over" ? sm >= 3 && cv <= 0.5 : cv <= 0.6})[p.m];
    const roleOf = s => min * vm >= 20 && msd <= 7 && statRole(s) ? 1 : 0;
    let best = null;
    for (const s of ["over", "under"]) {
      const price = s === "over" ? p.po : p.pu; if (!price || price < 1.25) continue; if (s === "over" && min < 20) continue;
      const hs = M.hitStats(vc, vp, vo, p.l, s);
      // Explosive / defensive game, and blowout risk (starters sit late when the spread is 11+)
      const big = Math.abs(Number(g.lines.spreadHome) || 0) >= 11 && min >= 30;
      const envAdj = +((g.env ? M.envAdj(g.env.env, s, pace[myT] && pace[o] ? 0.3 : 0.6) : 0) + (big ? (s === "over" ? -0.03 : 0.02) : 0)).toFixed(3);
      const pr = M.clamp(M.withDef(hs.pr0, s, f) + envAdj, 0.05, 0.95);
      const c = {g: p.g, aid: p.aid, n: R.n, pos: R.pos, t: R.t, o, h, m: p.m, l: p.l, s, p: price, bk: "DraftKings", pr: +pr.toFixed(3), pr0: +hs.pr0.toFixed(3), f: +f.toFixed(3), hd: 1, chg: hs.chg, nC: vc.length,
        imp: +(1 / price).toFixed(3), e: +(pr - 1 / price).toFixed(3), hc: hs.hc, h10: hs.h10, hp: hs.hp, hh: hs.hh,
        aC: avg(cur.map(r => r[i])), a10: avg(both.slice(0, 10).map(r => r[i])), md10: med(both.slice(0, 10).map(r => r[i])), sty: styInfo, pace: +pcF.toFixed(3), ven: +venF.toFixed(3), aP: avg(prev.map(r => r[i])), aH: avg(oppRows.map(r => r[i])), vm: +vm.toFixed(2), us: +us.toFixed(2), minExp: +(min * vm).toFixed(1), envAdj, blow: big ? 1 : 0, min, msd: Math.round(msd * 10) / 10, role: roleOf(s), cv: +cv.toFixed(2), sm: hs.hc[1] + hs.hp[1] < 15, vc, vp, vo};
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
