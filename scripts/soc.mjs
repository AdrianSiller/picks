// Soccer: Liga MX, La Liga and Champions for the next days. Lines from DraftKings (via ESPN), team form with corners.
import {J, pool, dkLines, dloc, ymd} from "./lib.mjs";
import {fotmobXG} from "./fotmob.mjs";

const SITE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const CORE = "https://sports.core.api.espn.com/v2/sports/soccer/leagues";
const LEAGUES = [["mex.1", "Liga MX"], ["esp.1", "La Liga"], ["eng.1", "Premier"], ["ger.1", "Bundesliga"], ["ita.1", "Serie A"], ["fra.1", "Ligue 1"], ["uefa.champions", "Champions"]];
const CODE = {"mex.1": "LMX", "esp.1": "LL", "uefa.champions": "UCL", "uefa.europa": "UEL", "uefa.europa.conf": "UECL", "eng.1": "PL", "ger.1": "BUN", "ita.1": "SA", "fra.1": "L1",
  "por.1": "POR", "ned.1": "ERE", "tur.1": "TUR", "bel.1": "BEL", "aut.1": "AUT", "gre.1": "GRE", "nor.1": "NOR", "sco.1": "SCO", "den.1": "DEN", "sui.1": "SUI", "cze.1": "CZE",
  "concacaf.leagues.cup": "LC", "concacaf.champions": "CC", "usa.1": "MLS"};
// Domestic cups, qualifiers and friendlies are often against much weaker teams: the model leaves them out
const klass = slug => /friendly/.test(slug) ? "FRI" : /qual/.test(slug) ? "QUAL" : (/^(uefa|concacaf)\./.test(slug) || /\.\d$/.test(slug)) ? "" : "CUP";
const days = (now, n) => Array.from({length: n}, (_, i) => ymd(dloc(new Date(now.getTime() + i * 864e5).toISOString(), "America/Mexico_City")));

export async function buildSOC(now = new Date(), nDays = 6) {
  const evs = []; let okBoards = 0;
  for (const [slug, lg] of LEAGUES) await pool(days(now, nDays), 3, async d => {
    const sb = await J(`${SITE}/${slug}/scoreboard?dates=${d}`); if (sb) okBoards++;
    for (const e of (sb && sb.events) || []) if (e.status.type.state === "pre" && !evs.some(x => x.e.id === e.id)) evs.push({e, slug, lg});
  });
  if (!okBoards) throw new Error("ESPN soccer scoreboards unavailable");
  const games = [], teamIds = {}, PBT = {}, TTRAW = [], XI = {}, PL = {}, WANT = new Set(), PGN = {n: 0};
  await pool(evs, 5, async ({e, slug, lg}) => {
    const c = e.competitions[0], H = c.competitors.find(x => x.homeAway === "home"), A = c.competitors.find(x => x.homeAway === "away");
    const tm = x => ({abbr: x.team.abbreviation, name: x.team.displayName, record: (x.records && x.records[0] && x.records[0].summary) || ""});
    teamIds[H.team.abbreviation] = H.team.id; teamIds[A.team.abbreviation] = A.team.id;
    const base = `${CORE}/${slug}/events/${e.id}/competitions/${e.id}/odds`;
    const [o, pb] = await Promise.all([J(base + "?lang=en&region=us"), J(base + "/100/propBets?lang=en&region=us&limit=1000")]);
    // DraftKings side markets (price in current.over.decimal): both teams score, double chance, 1st half result, corners
    const items = (pb && pb.items) || [], of = n => items.filter(i => i.type && i.type.name === n), pr = i => i && i.current && i.current.over ? +i.current.over.decimal : null;
    const tid = i => ((i.team && i.team.$ref) || "").match(/teams\/(\d+)/)?.[1];
    const lines = dkLines(o) || {}, g = {id: e.id, lg, slug, date: e.date, venue: c.venue && c.venue.fullName, home: tm(H), away: tm(A), lines, cl: [], btts: null};
    const bt = of("Both Teams To Score"); if (bt.length >= 2 && pr(bt[0]) && pr(bt[1])) g.btts = [pr(bt[0]), pr(bt[1])];
    for (const i of of("Double Chance")) { const t = tid(i); if (t === H.team.id) lines.dc1 = pr(i); else if (t === A.team.id) lines.dc2 = pr(i); }
    const h1 = {}; for (const i of of("1st Half Moneyline")) { const t = tid(i); h1[t === H.team.id ? "h" : t === A.team.id ? "a" : "d"] = pr(i); }
    if (h1.h && h1.d && h1.a) g.h1 = h1;
    // Corners: over ladder then under ladder; main line = the one with the most even prices
    const co = of("Total Corners").map(i => ({l: i.current && i.current.target ? +i.current.target.value : null, p: pr(i)})).filter(x => x.l != null);
    const half = Math.floor(co.length / 2), lad = {};
    co.forEach((x, k) => { (lad[x.l] = lad[x.l] || {})[k < half ? "over" : "under"] = x.p; });
    g.cl = Object.keys(lad).map(Number).sort((a, b) => a - b);
    const main = g.cl.filter(l => lad[l].over && lad[l].under).sort((a, b) => Math.abs(lad[a].over - lad[a].under) - Math.abs(lad[b].over - lad[b].under))[0];
    if (main != null) g.corn = {line: main, over: lad[main].over, under: lad[main].under};
    // Goals per team: each team has an over ladder and an under ladder; the over one gets pricier as the line goes up
    for (const [side, T] of [["H", H], ["A", A]]) {
      const its = of("Team Total Goals").filter(i => tid(i) === T.team.id).map(i => ({l: i.current && i.current.target ? +i.current.target.value : null, p: pr(i)})).filter(x => x.l != null && x.p);
      const seen = {}, s1 = [], s2 = []; for (const x of its) { (seen[x.l] ? s2 : s1).push(x); seen[x.l] = 1; }
      const rising = s => s.length < 2 || s[s.length - 1].p > s[0].p === s[s.length - 1].l > s[0].l;
      const [ov, un] = rising(s1) ? [s1, s2] : [s2, s1], lad = {};
      ov.forEach(x => (lad[x.l] = lad[x.l] || {}).over = x.p); un.forEach(x => (lad[x.l] = lad[x.l] || {}).under = x.p);
      const ls = Object.keys(lad).map(Number).filter(l => lad[l].over && lad[l].under);
      if (ls.length) { g.tt = g.tt || {}; g.tt[side] = {lines: ls.sort((a, b) => a - b).map(l => [l, lad[l].over, lad[l].under])}; }
      if (!TTRAW.length && its.length) TTRAW.push({g: e.id, side, its});
    }
    // Corners per team (first price of each team's line = over, second = under)
    for (const [side, T] of [["H", H], ["A", A]]) { const it = of("Team Total Corners").filter(i => tid(i) === T.team.id && i.current && i.current.target);
      if (it.length >= 2 && pr(it[0]) && pr(it[1]) && it[0].current.target.value === it[1].current.target.value) (g.tc = g.tc || {})[side] = {line: +it[0].current.target.value, over: pr(it[0]), under: pr(it[1])}; }
    // Players' shots on target: "1+" and "2+" prices
    g.psot = of("Shots on Target Milestones").map(i => ({aid: (((i.athlete || {}).$ref || "").match(/athletes\/(\d+)/) || [])[1], t: i.current && i.current.target ? +i.current.target.value : null, p: pr(i)}))
      .filter(x => x.aid && (x.t === 1 || x.t === 2) && x.p && x.p >= 1.05 && x.p <= 5);
    for (const x of g.psot) WANT.add(x.aid);
    // Players' total shots: "1+" to "4+" prices
    g.pshot = of("Shots Milestones").map(i => ({aid: (((i.athlete || {}).$ref || "").match(/athletes\/(\d+)/) || [])[1], t: i.current && i.current.target ? +i.current.target.value : null, p: pr(i)}))
      .filter(x => x.aid && x.t >= 1 && x.t <= 4 && x.p && x.p >= 1.1 && x.p <= 5);
    for (const x of g.pshot) WANT.add(x.aid);
    // Anytime goalscorer prices
    g.pgoal = of("Anytime Goalscorer").map(i => ({aid: (((i.athlete || {}).$ref || "").match(/athletes\/(\d+)/) || [])[1], p: pr(i)})).filter(x => x.aid && x.p && x.p >= 1.1 && x.p <= 6);
    for (const x of g.pgoal) WANT.add(x.aid);
    PGN.n += of("Anytime Goalscorer").length;
    // Inventory of the side markets the book publishes (to know what else can be priced)
    for (const i of items) { const n = (i.type && i.type.name) || "?"; PBT[n] = PBT[n] || {n: 0, ex: null}; PBT[n].n++; if (!PBT[n].ex) PBT[n].ex = {team: tid(i) === H.team.id ? "H" : tid(i) === A.team.id ? "A" : tid(i) || null, ath: !!i.athlete, t: i.current && i.current.target ? i.current.target.value : null, p: pr(i), u: i.current && i.current.under ? +i.current.under.decimal : null}; }
    games.push(g);
  });
  games.sort((a, b) => a.date < b.date ? -1 : 1);

  // Each team's last 12 competitive matches in any competition, with corners from the box score
  const teams = {};
  await pool(Object.entries(teamIds), 4, async ([ab, id]) => {
    const s = await J(`${SITE}/all/teams/${id}/schedule`);
    const done = ((s && s.events) || []).filter(e => e.competitions[0].status.type.completed && klass((e.league && e.league.slug) || "") !== "FRI")
      .sort((a, b) => a.date < b.date ? 1 : -1).slice(0, 12);
    teams[ab] = (await pool(done, 4, async e => {
      const c = e.competitions[0], me = c.competitors.find(x => x.team.id === id) || c.competitors.find(x => x.team.abbreviation === ab), op = c.competitors.find(x => x !== me);
      if (!me || !op) return null;
      const sc = x => Number(x.score && x.score.value != null ? x.score.value : x.score);
      const sm = await J(`${SITE}/all/summary?event=${e.id}`);
      const stat = (t, name) => { const T = ((sm && sm.boxscore && sm.boxscore.teams) || []).find(x => x.team.id === t.team.id); const st = T && (T.statistics || []).find(x => x.name === name); return st && st.displayValue !== "" ? parseFloat(st.displayValue) : null; };
      const corn = t => stat(t, "wonCorners");
      const slug = (e.league && e.league.slug) || "";
      // Who started (to know each team's usual eleven)
      const ros = ((sm && sm.rosters) || []).find(r => r.team && r.team.id === me.team.id);
      const xi = ros ? (ros.roster || []).filter(p => p.starter && p.athlete).map(p => [p.athlete.id, p.athlete.shortName || p.athlete.displayName]) : [];
      // Each player's shots in this match (for shots-on-target props)
      if (ros) for (const p of ros.roster || []) { if (!p.athlete || !p.stats) continue; const v = n => { const s = p.stats.find(x => x.name === n); return s ? +s.value || 0 : 0; };
        if (!v("appearances") && !p.starter) continue;
        const q = PL[p.athlete.id] = PL[p.athlete.id] || {n: p.athlete.shortName || p.athlete.displayName, t: ab, rows: []};
        q.rows.push([e.date, v("shotsOnTarget"), v("totalShots"), p.starter ? 1 : 0, v("totalGoals"), v("goalAssists"), klass(slug)]); }
      if (xi.length >= 10) (XI[ab] = XI[ab] || []).push({d: e.date, cls: klass(slug), xi});
      return [dloc(e.date).slice(5), CODE[slug] || ((e.league && e.league.abbreviation) || "?").slice(0, 5), op.team.abbreviation, me.homeAway === "home" ? "h" : "a", sc(me), sc(op), corn(me), corn(op), klass(slug),
        // How it plays: shots, shots on target and possession, for and against (indexes 9-13)
        stat(me, "totalShots"), stat(me, "shotsOnTarget"), stat(me, "possessionPct"), stat(op, "totalShots"), stat(op, "shotsOnTarget")];
    })).filter(Boolean);
  });
  // Usual eleven: players who started at least 3 of the team's last 5 league / continental matches
  const meta = {};
  for (const [ab, list] of Object.entries(XI)) {
    const last5 = list.filter(x => x.cls !== "CUP").sort((a, b) => a.d < b.d ? 1 : -1).slice(0, 5), cnt = {};
    for (const m of last5) for (const [id, nm] of m.xi) (cnt[id] = cnt[id] || {nm, n: 0}).n++;
    if (last5.length >= 3) meta[ab] = {reg: Object.entries(cnt).filter(([, v]) => v.n >= 3).sort((a, b) => b[1].n - a[1].n).map(([id, v]) => [id, v.nm, v.n]), of: last5.length};
  }
  // Confirmed lineups (out ~1 h before): games starting within 90 minutes get their eleven compared with the usual one
  await pool(games.filter(g => new Date(g.date) - now < 90 * 6e4 && new Date(g.date) > now), 4, async g => {
    const s = await J(`${SITE}/${g.slug}/summary?event=${g.id}`), ros = (s && s.rosters) || [];
    if (ros.length !== 2 || !ros.every(r => (r.roster || []).some(p => p.starter))) return;
    g.xi = {};
    for (const [k, T] of [["h", g.home], ["a", g.away]]) {
      const r = ros.find(x => x.homeAway === (k === "h" ? "home" : "away")), m = meta[T.abbr]; if (!r || !m) continue;
      const ids = new Set((r.roster || []).filter(p => p.starter && p.athlete).map(p => String(p.athlete.id)));
      g.xi[k] = {miss: m.reg.filter(([id]) => !ids.has(String(id))).map(x => x[1])};
    }
  });
  // Champions within a few days of a league match: rotation before it, fatigue after it
  const yr = now.getUTCFullYear(), full = md => { const d = new Date(`${yr}-${md}T12:00:00Z`); return d - now > 60 * 864e5 ? new Date(`${yr - 1}-${md}T12:00:00Z`) : d; };
  for (const g of games.filter(g => g.lg !== "Champions")) {
    const gd = new Date(g.date), rot = {};
    for (const side of ["home", "away"]) {
      const ab = g[side].abbr, next = games.find(x => x.lg === "Champions" && (x.home.abbr === ab || x.away.abbr === ab) && new Date(x.date) > gd);
      const dn = next ? (new Date(next.date) - gd) / 864e5 : 99;
      const prev = (teams[ab] || []).find(r => r[1] === "UCL"), dp = prev ? (gd - full(prev[0])) / 864e5 : 99;
      if (dn <= 4) rot[side[0]] = {next: Math.round(dn)}; else if (dp >= 0 && dp <= 3.5) rot[side[0]] = {prev: Math.round(dp)};
    }
    if (rot.h || rot.a) g.rot = rot;
  }
  // Shot logs only for players with a shots-on-target price, last 10 league / continental matches, newest first
  const players = {}; for (const id of WANT) { const q = PL[id]; if (!q) continue; const rows = q.rows.filter(r => r[6] !== "CUP").sort((a, b) => a[0] < b[0] ? 1 : -1).slice(0, 10).map(r => r.slice(0, 6)); if (rows.length >= 5 && rows.filter(r => r[3]).length >= Math.max(4, Math.ceil(rows.length * 0.6))) players[id] = {n: q.n, t: q.t, rows}; }
  // Season xG and xG conceded per match (FotMob); a failure only leaves the model on goals
  let xg = {}; try { const names = {}; for (const g of games) { names[g.home.abbr] = g.home.name; names[g.away.abbr] = g.away.name; } const r = await fotmobXG(names); xg = r.teams; console.log("fotmob xG:", Object.keys(xg).length, "de", Object.keys(names).length, "equipos"); } catch (e) { console.log("fotmob falló", e.message); }
  return {asOf: now.toISOString(), games, teams, meta, players, xg, pgRaw: PGN.n, pbt: Object.fromEntries(Object.entries(PBT).map(([k, v]) => [k, v.n]))};
}
