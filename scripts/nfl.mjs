// NFL: this week's games, DraftKings lines and prop lines (via ESPN), player logs, what each defense allows by position.
import {J, pool, dkLines, dloc, avg, r1, athleteId} from "./lib.mjs";
import M from "../model.js";

const SITE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl";
const LOG = "https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes";
const CUR_LBL = "2026 Regular Season", PREV_LBL = "2025 Regular Season";
const PREV = 2025;
const PTYPES = {"Total Receptions": "REC", "Total Receiving Yards": "RECYDS", "Total Carries": "CAR", "Total Rushing Yards": "RUSHYDS",
  "Total Pass Completions": "CMP", "Total Passing Yards": "PASSYDS", "Total Rushing Plus Receiving Yards": "RRY"};
const POSOK = {REC: ["RB", "WR", "TE"], RECYDS: ["RB", "WR", "TE"], CAR: ["RB", "QB"], RUSHYDS: ["RB", "QB"], CMP: ["QB"], PASSYDS: ["QB"], RRY: ["RB", "WR"]};
// log row: [MM-DD, opp, at, REC, RECYDS, CAR, RUSHYDS, CMP, PASSYDS, TD, TGT]
const VAL = {REC: r => r[3], RECYDS: r => r[4], CAR: r => r[5], RUSHYDS: r => r[6], CMP: r => r[7], PASSYDS: r => r[8], RRY: r => r[4] + r[6]};
const SKIP = new Set(["Out", "Injured Reserve", "Doubtful", "Suspended", "Physically Unable to Perform"]);
const md = iso => dloc(iso).slice(5);
const posOf = p => p === "FB" ? "RB" : p;
// Roofed or retractable stadiums by home team
const DOMES = new Set(["ATL", "DAL", "DET", "HOU", "IND", "LV", "LAR", "LAC", "MIN", "NO", "ARI"]);
const PASSM = new Set(["PASSYDS", "CMP", "REC", "RECYDS"]);
const MUKEYS = ["RBRUSHYDS", "RBRECYDS", "WRRECYDS", "TERECYDS", "QBPASSYDS", "RBREC", "WRREC", "TEREC"];

// season: exact label, so a player who has not played this season does not get last season as "this season"
function parseLog(g, season) {
  if (!g || !g.names) return [];
  const st = (g.seasonTypes || []).find(s => s.displayName === season); if (!st) return [];
  const ix = k => g.names.indexOf(k), I = {rec: ix("receptions"), recy: ix("receivingYards"), car: ix("rushingAttempts"), rushy: ix("rushingYards"), cmp: ix("completions"), passy: ix("passingYards"), rtd: ix("rushingTouchdowns"), rctd: ix("receivingTouchdowns"), tgt: ix("receivingTargets")};
  const v = (s, i) => i < 0 ? 0 : (parseFloat(String(s[i]).replace(/,/g, "")) || 0);
  const rows = [];
  for (const c of st.categories || []) for (const e of c.events || []) {
    const m = (g.events || {})[e.eventId]; if (!m) continue; const s = e.stats;
    rows.push([dloc(m.gameDate), m.opponent && m.opponent.abbreviation, m.atVs === "@" ? "@" : "vs", v(s, I.rec), v(s, I.recy), v(s, I.car), v(s, I.rushy), v(s, I.cmp), v(s, I.passy), v(s, I.rtd) + v(s, I.rctd), v(s, I.tgt)]);
  }
  return rows.sort((a, b) => a[0] < b[0] ? 1 : -1).map(r => [r[0].slice(5)].concat(r.slice(1)));
}

const teamResults = (s, ab) => ((s && s.events) || []).filter(e => e.competitions[0].status.type.completed).map(e => {
  const cc = e.competitions[0].competitors, me = cc.find(x => x.team.abbreviation === ab), op = cc.find(x => x.team.abbreviation !== ab);
  const sc = x => Number(x.score && x.score.value != null ? x.score.value : x.score);
  return {id: e.id, row: [md(e.date), op.team.abbreviation, me.homeAway === "home" ? "vs" : "@", sc(me), sc(op)]};
});

export async function buildNFL(now = new Date()) {
  const sb = await J(`${SITE}/scoreboard`);
  if (!sb) throw new Error("ESPN NFL scoreboard unavailable");
  const events = ((sb && sb.events) || []).filter(e => e.status.type.state !== "post");
  const week = sb && sb.week ? sb.week.number : null;
  const out = {asOf: now.toISOString(), week, games: [], cands: [], logs: {}, teams: {}, mu: {}};
  if (!events.length) return out;

  // All 32 teams: rosters (positions) and schedules (results, game ids for the defense numbers)
  const tl = await J(`${SITE}/teams`), teamList = ((((((tl || {}).sports || [])[0] || {}).leagues || [])[0] || {}).teams || []).map(t => t.team);
  if (!teamList.length) throw new Error("ESPN teams list unavailable");
  const roster = {}, teams = {}, played = {};
  await pool(teamList, 6, async t => {
    const ab = t.abbreviation;
    const [r, c, p] = await Promise.all([J(`${SITE}/teams/${t.id}/roster`), J(`${SITE}/teams/${t.id}/schedule`), J(`${SITE}/teams/${t.id}/schedule?season=${PREV}`)]);
    for (const grp of (r && r.athletes) || []) for (const a of grp.items || []) roster[a.id] = {grp: grp.position, n: a.displayName, t: ab, pos: posOf((a.position && a.position.abbreviation) || ""), inj: a.injuries && a.injuries[0] && a.injuries[0].status};
    const cur = teamResults(c, ab), prev = teamResults(p, ab);
    teams[ab] = {cur: cur.map(x => x.row), prevN: prev.length, prevW: prev.filter(x => x.row[3] > x.row[4]).length, prevDiff: +(prev.reduce((s, x) => s + x.row[3] - x.row[4], 0) / (prev.length || 1)).toFixed(2)};
    played[ab] = cur.map(x => x.id);
  });

  // Box scores of every game this season -> yards and catches allowed by position
  const box = {};
  await pool([...new Set(Object.values(played).flat())], 8, async id => {
    const s = await J(`${SITE}/summary?event=${id}`); if (!s) return; const o = {}, use = {};
    for (const t of (s.boxscore && s.boxscore.players) || []) {
      const a = Object.fromEntries(MUKEYS.map(k => [k, 0])), U = use[t.team.abbreviation] = {};
      for (const st of t.statistics || []) {
        const K = st.keys || [], col = k => K.findIndex(x => x === k || x.split("/").includes(k));
        for (const at of st.athletes || []) {
          const pos = (roster[at.athlete.id] || {}).pos, num = k => { const i = col(k); if (i < 0) return 0; const raw = String(at.stats[i]); return parseFloat((raw.includes("/") && k === "completions" ? raw.split("/")[0] : raw).replace(/,/g, "")) || 0; };
          // Volume per player (targets and carries) for the usage model
          if (st.name === "receiving") (U[at.athlete.id] = U[at.athlete.id] || {tg: 0, car: 0}).tg += num("receivingTargets");
          if (st.name === "rushing") (U[at.athlete.id] = U[at.athlete.id] || {tg: 0, car: 0}).car += num("rushingAttempts");
          if (st.name === "rushing" && pos === "RB") a.RBRUSHYDS += num("rushingYards");
          if (st.name === "receiving" && ["RB", "WR", "TE"].includes(pos)) { a[pos + "RECYDS"] += num("receivingYards"); a[pos + "REC"] += num("receptions"); }
          if (st.name === "passing" && pos === "QB") a.QBPASSYDS += num("passingYards");
        }
      }
      o[t.team.abbreviation] = a;
    }
    box[id] = o; box[id].__use = use;
  });
  const allowed = {};
  for (const [ab, ids] of Object.entries(played)) { const a = Object.fromEntries(MUKEYS.map(k => [k, 0])); let n = 0;
    for (const id of ids) { const b = box[id]; if (!b || !b[ab]) continue; const opp = Object.keys(b).find(k => k !== ab && k !== "__use"); if (!opp) continue; n++; MUKEYS.forEach(k => a[k] += b[opp][k]); }
    if (n) allowed[ab] = {n, a: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, r1(v / n)]))}; }
  const mu = {};
  for (const k of MUKEYS.concat(["RBTOT"])) {
    const val = ab => k === "RBTOT" ? allowed[ab].a.RBRUSHYDS + allowed[ab].a.RBRECYDS : allowed[ab].a[k];
    Object.keys(allowed).sort((x, y) => val(y) - val(x)).forEach((ab, i) => { const m = mu[ab] = mu[ab] || {a: {}, r: {}, n: allowed[ab].n}; m.a[k] = r1(val(ab)); m.r[k] = i + 1; });
  }
  const lgAvg = Object.fromEntries(MUKEYS.concat(["RBTOT"]).map(k => [k, Object.values(mu).reduce((s, m) => s + m.a[k], 0) / (Object.keys(mu).length || 1)]));
  const muKey = (pos, m) => m === "RRY" ? (pos === "RB" ? "RBTOT" : null) : ["CAR", "RUSHYDS"].includes(m) ? (pos === "RB" ? "RBRUSHYDS" : null)
    : ["CMP", "PASSYDS"].includes(m) ? "QBPASSYDS" : m === "REC" ? pos + "REC" : m === "RECYDS" ? pos + "RECYDS" : null;

  // This week's games: lines, injuries, prop lines (no prices on ESPN; SportsGameOdds adds them later)
  const games = [], props = [], inj = {};
  await pool(events, 5, async e => {
    const c = e.competitions[0], H = c.competitors.find(x => x.homeAway === "home"), A = c.competitors.find(x => x.homeAway === "away");
    const tm = x => ({abbr: x.team.abbreviation, name: x.team.displayName, record: (x.records && x.records[0] && x.records[0].summary) || ""});
    const base = `${CORE}/events/${e.id}/competitions/${e.id}/odds`;
    const [o, s, pb] = await Promise.all([J(base + "?lang=en&region=us"), J(`${SITE}/summary?event=${e.id}`), J(base + "/100/propBets?lang=en&region=us&limit=1000")]);
    const gi = [];
    for (const t of (s && s.injuries) || []) for (const x of t.injuries || []) { gi.push([t.team.abbreviation, x.athlete.displayName, x.status]); inj[x.athlete.id] = x.status; }
    games.push({id: e.id, date: e.date, venue: c.venue && c.venue.fullName, city: c.venue && c.venue.address && c.venue.address.city, home: tm(H), away: tm(A), lines: dkLines(o) || {}, inj: gi});
    const seen = {};
    for (const it of (pb && pb.items) || []) { const nm = String((it.type && it.type.name) || "").replace(/\s*\(incl\. overtime\)/, ""), m = PTYPES[nm], aid = athleteId(it.athlete && it.athlete.$ref); if (!m || !aid) continue; (seen[aid + "|" + m] = seen[aid + "|" + m] || []).push(it); }
    for (const [k, arr] of Object.entries(seen)) { const [aid, m] = k.split("|"); const l = arr[0].current && arr[0].current.target && arr[0].current.target.value; if (l != null) props.push({g: e.id, aid, m, l: Number(l)}); }
  });
  games.sort((a, b) => a.date < b.date ? -1 : 1);

  // Weather at kickoff for open-air stadiums (Open-Meteo, free); wind is what hurts passing
  await pool(games, 4, async g => {
    if (DOMES.has(g.home.abbr)) { g.wx = {indoor: true}; return; }
    const city = g.city; if (!city) return;
    const geo = await J(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&country_code=US`);
    const p = geo && geo.results && geo.results[0]; if (!p) return;
    const f = await J(`https://api.open-meteo.com/v1/forecast?latitude=${p.latitude}&longitude=${p.longitude}&hourly=temperature_2m,wind_speed_10m,wind_gusts_10m,precipitation_probability&wind_speed_unit=mph&temperature_unit=fahrenheit&timezone=UTC&forecast_days=8`);
    const hrs = f && f.hourly && f.hourly.time; if (!hrs) return;
    const k = hrs.indexOf(g.date.slice(0, 13) + ":00"); if (k < 0) return;
    g.wx = {temp: Math.round(f.hourly.temperature_2m[k]), wind: Math.round(f.hourly.wind_speed_10m[k]), gust: Math.round(f.hourly.wind_gusts_10m[k]), rain: f.hourly.precipitation_probability[k]};
  });

  // Scoring environment: each team's implied points (total and spread) vs the league's points per game
  const allRows = Object.values(teams).flatMap(T => T.cur), lgPts = allRows.length ? allRows.reduce((s, r) => s + r[3], 0) / allRows.length : 22;
  games.forEach(g => { const t = Number(g.lines.total), sh = Number(g.lines.spreadHome); if (!t || isNaN(sh)) return;
    const hT = t / 2 - sh / 2, aT = t / 2 + sh / 2; g.env = {total: t, avg: Math.round(lgPts * 20) / 10, h: +hT.toFixed(1), a: +aT.toFixed(1), eh: +((hT - lgPts) / lgPts).toFixed(3), ea: +((aT - lgPts) / lgPts).toFixed(3), env: +((t - 2 * lgPts) / (2 * lgPts)).toFixed(3)}; });
  const ids = [...new Set(props.map(p => p.aid))], logs = {};
  await pool(ids, 8, async id => { const [c, p] = await Promise.all([J(`${LOG}/${id}/gamelog`), J(`${LOG}/${id}/gamelog?season=${PREV}`)]); logs[id] = {c: parseLog(c, CUR_LBL), p: parseLog(p, PREV_LBL)}; });
  // Also fetch active skill players with no snaps this season (back from a long injury): their last season tells their share
  const inPlay0 = new Set(games.flatMap(g => [g.home.abbr, g.away.abbr])), seen = new Set(Object.values(box).flatMap(b => Object.values((b && b.__use) || {}).flatMap(U => Object.keys(U))));
  const backIds = Object.entries(roster).filter(([aid, Rr]) => inPlay0.has(Rr.t) && Rr.grp === "offense" && ["RB", "WR", "TE"].includes(Rr.pos) && !seen.has(aid) && !logs[aid] && !SKIP.has(inj[aid] || Rr.inj)).map(([aid]) => aid);
  await pool(backIds, 8, async id => { const p = await J(`${LOG}/${id}/gamelog?season=${PREV}`); logs[id] = {c: [], p: parseLog(p, PREV_LBL)}; });

  // Usage model: each player's share of his team's targets and carries in the games he played. When a starter is out,
  // his share goes to the active teammates (the WR2 becomes the WR1, the backup RB gets the carries); when a starter
  // comes back, the others' share goes down. vm = expected volume today / his usual volume.
  const usage = {};
  for (const [ab, ids] of Object.entries(played)) {
    const P = {}; let tgT = 0, carT = 0, n = 0, last = null;
    for (const id of ids) { const U = box[id] && box[id].__use && box[id].__use[ab]; if (!U) continue; n++; last = U;
      for (const [aid, v] of Object.entries(U)) { const q = P[aid] = P[aid] || {n: 0, tg: 0, car: 0}; q.n++; q.tg += v.tg; q.car += v.car; tgT += v.tg; carT += v.car; } }
    usage[ab] = {P, n, tgG: n ? tgT / n : 0, carG: n ? carT / n : 0, last: last || {}};
  }
  const statusOf = aid => inj[aid] || (roster[aid] || {}).inj;
  function teamUsage(ab) {
    const T = usage[ab]; if (!T || !T.n) return null;
    // Players back from a long injury (no games this season) use last season's volume, when we have their log
    for (const [aid, Rr] of Object.entries(roster)) { if (Rr.t !== ab || T.P[aid] || !["RB", "WR", "TE"].includes(Rr.pos) || SKIP.has(statusOf(aid))) continue;
      const L = logs[aid]; if (!L || L.p.length < 4 || L.c.length) continue; const n = L.p.length;
      T.P[aid] = {n, tg: L.p.reduce((s, r) => s + r[10], 0), car: L.p.reduce((s, r) => s + r[5], 0), back: true}; }
    const ids = Object.keys(T.P).filter(aid => roster[aid] && roster[aid].t === ab && ["RB", "WR", "TE"].includes(roster[aid].pos));
    const shT = aid => T.tgG ? T.P[aid].tg / T.P[aid].n / T.tgG : 0, shC = aid => T.carG ? T.P[aid].car / T.P[aid].n / T.carG : 0;
    // Players already out last game are left out of the base: their teammates' recent numbers already show it
    // Base = who played the last game; active = who plays today. A new absence lowers the active share (the rest gain),
    // a starter coming back raises it (the rest lose)
    const base = ids.filter(aid => T.last[aid]), active = ids.filter(aid => !SKIP.has(statusOf(aid)));
    const norm = (list, f) => list.reduce((s, a) => s + f(a), 0);
    const sumT = norm(active, shT) / (norm(base, shT) || 1), sumC = norm(active.filter(a => roster[a].pos === "RB"), shC) / (norm(base.filter(a => roster[a].pos === "RB"), shC) || 1);
    const vm = {}, notes = [];
    for (const a of active) vm[a] = {t: sumT ? M.clamp(1 / Math.max(sumT, 0.6), 0.75, 1.4) : 1, c: roster[a].pos === "RB" && sumC ? M.clamp(1 / Math.max(sumC, 0.5), 0.7, 1.5) : 1};
    for (const a of ids.filter(a => SKIP.has(statusOf(a)) && T.last[a])) { if (shT(a) >= 0.12) notes.push(`Sin ${roster[a].n} (${Math.round(shT(a) * 100)}% de los targets)`); else if (roster[a].pos === "RB" && shC(a) >= 0.1) notes.push(`Sin ${roster[a].n} (${Math.round(shC(a) * 100)}% de los acarreos)`); }
    for (const a of active.filter(a => !T.last[a] && T.P[a].n >= 2 && (shT(a) >= 0.12 || (roster[a].pos === "RB" && shC(a) >= 0.2)))) notes.push(`Regresa ${roster[a].n} (${T.P[a].back ? "sin jugar esta temporada; se usa su volumen de la pasada" : "no jugó el último partido"})`);
    const dbg = ids.map(a => ({n: roster[a].n, pos: roster[a].pos, st: statusOf(a) || "", last: !!T.last[a], back: !!T.P[a].back, g: T.P[a].n, shT: +shT(a).toFixed(2), shC: +shC(a).toFixed(2)})).filter(x => x.shT >= 0.05 || x.shC >= 0.05);
    return {vm, notes, dbg, sumT: +sumT.toFixed(2), sumC: +sumC.toFixed(2)};
  }
  const TU = {}; games.forEach(g => [g.home.abbr, g.away.abbr].forEach(ab => { TU[ab] = teamUsage(ab); }));
  games.forEach(g => { const nh = TU[g.home.abbr] && TU[g.home.abbr].notes, na = TU[g.away.abbr] && TU[g.away.abbr].notes; if ((nh && nh.length) || (na && na.length)) g.usage = {h: nh || [], a: na || []}; });
  const G = Object.fromEntries(games.map(g => [g.id, g])), all = [];
  for (const p of props) {
    const R = roster[p.aid], L = logs[p.aid]; if (!R || !L || !(POSOK[p.m] || []).includes(R.pos)) continue;
    const st = inj[p.aid] || R.inj; if (SKIP.has(st)) continue;
    const g = G[p.g], h = R.t === g.home.abbr; if (!h && R.t !== g.away.abbr) continue;
    const o = h ? g.away.abbr : g.home.abbr, cur = L.c, prev = L.p, both = cur.concat(prev); if (cur.length < 2) continue;
    // Volume today vs his usual: scale his past values when a teammate is out or back
    const um = (TU[R.t] && TU[R.t].vm[p.aid]) || {t: 1, c: 1}, crB = avg(cur.map(r => r[5])) || 0, tgB = avg(cur.map(r => r[10])) || 0;
    let vm = ["REC", "RECYDS"].includes(p.m) ? um.t : ["CAR", "RUSHYDS"].includes(p.m) ? um.c : p.m === "RRY" ? (crB + tgB ? (um.c * crB + um.t * tgB) / (crB + tgB) : 1) : 1;
    if (Math.abs(vm - 1) < 0.08) vm = 1;
    const V0 = VAL[p.m], V = r => V0(r) * vm, vc = cur.map(V), vp = prev.map(V), vo = both.filter(r => r[1] === o).map(V);
    const mk = muKey(R.pos, p.m), d = mk && mu[o], f = d ? M.defFactor(d.a[mk] / lgAvg[mk], d.n, 6) : 1;
    let best = null;
    for (const s of ["over", "under"]) {
      const hs = M.hitStats(vc, vp, vo, p.l, s), wind = (g.wx && g.wx.wind) || 0;
      // Strong wind: passing and receiving overs lose, unders gain a little
      const wadj = PASSM.has(p.m) && wind >= 15 ? (s === "over" ? (wind >= 20 ? -0.07 : -0.04) : (wind >= 20 ? 0.04 : 0.02)) : 0;
      // Team expected to score a lot -> overs; game script: big favorites run more, big underdogs throw more
      const te = g.env ? (h ? g.env.eh : g.env.ea) : 0, tsp = h ? Number(g.lines.spreadHome) : Number(g.lines.spreadAway);
      const script = R.pos === "RB" && ["CAR", "RUSHYDS"].includes(p.m) && !isNaN(tsp) ? (tsp <= -6 ? 0.02 : tsp >= 6 ? -0.02 : 0) * (s === "under" ? -1 : 1) : 0;
      const envAdj = +((["CMP", "PASSYDS", "REC", "RECYDS", "RRY", "RUSHYDS"].includes(p.m) ? M.envAdj(te, s, 0.5) : 0) + script).toFixed(3);
      const pr = M.clamp(M.withDef(hs.pr0, s, f) + wadj + envAdj, 0.05, 0.95);
      const c = {g: p.g, aid: p.aid, n: R.n, pos: R.pos, t: R.t, o, h, m: p.m, l: p.l, el: p.l, s, pr: +pr.toFixed(3), pr0: +hs.pr0.toFixed(3), f: +f.toFixed(3), hd: mk ? 1 : 0,
        hc: hs.hc, h10: hs.h10, hp: hs.hp, hh: hs.hh, aC: avg(cur.map(V0)), a10: avg(both.slice(0, 10).map(V0)), aP: avg(prev.map(V0)), aH: avg(both.filter(r => r[1] === o).map(V0)),
        sm: hs.hc[1] + hs.hp[1] < 10 ? 1 : 0, wind: wadj ? wind : 0, wadj, envAdj, q: st === "Questionable" ? 1 : 0, tg: +(tgB * um.t).toFixed(1), cr: +(crB * um.c).toFixed(1), vm: +vm.toFixed(2), vc, vp, vo};
      // Role: main = starting QB, WR/TE with 5+ targets a game, RB with 12+ carries (or 8+ carries and 3.5+ targets for catching props)
      const tgA = c.tg, crA = c.cr; c.role = R.pos === "QB" ? (avg(cur.map(r => r[7])) >= 12 ? 1 : 0) : ["WR", "TE"].includes(R.pos) ? (tgA >= 5 ? 1 : 0)
        : (crA >= 12 || (["REC", "RECYDS"].includes(p.m) && crA >= 8 && tgA >= 3.5) ? 1 : 0);
      if (!best || c.pr > best.pr) best = c;
    }
    if (best && best.pr >= 0.55) all.push(best);
  }
  const cands = [], perG = {}, perP = {};
  for (const c of all.sort((a, b) => M.score(b, "NFL") - M.score(a, "NFL"))) {
    if ((perG[c.g] || 0) >= 16 || (perP[c.aid] || 0) >= 2) continue; perG[c.g] = (perG[c.g] || 0) + 1; perP[c.aid] = (perP[c.aid] || 0) + 1; cands.push(c);
  }
  cands.forEach(c => { const L = logs[c.aid]; out.logs[c.aid] = L.c.concat(L.p).slice(0, 8); });
  const inPlay = new Set(games.flatMap(g => [g.home.abbr, g.away.abbr]));
  out.usageDebug = Object.fromEntries(Object.entries(TU).filter(([, v]) => v).map(([k, v]) => [k, {sumT: v.sumT, sumC: v.sumC, players: v.dbg}]));
  Object.assign(out, {games, cands, teams: Object.fromEntries(Object.entries(teams).filter(([k]) => inPlay.has(k))), mu: Object.fromEntries(Object.entries(mu).map(([k, v]) => [k, {a: v.a, r: v.r}]))});
  return out;
}
