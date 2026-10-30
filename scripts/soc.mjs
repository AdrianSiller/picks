// Soccer: Liga MX, La Liga and Champions for the next days. Lines from DraftKings (via ESPN), team form with corners.
import {J, pool, dkLines, dloc, ymd} from "./lib.mjs";

const SITE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const CORE = "https://sports.core.api.espn.com/v2/sports/soccer/leagues";
const LEAGUES = [["mex.1", "Liga MX"], ["esp.1", "La Liga"], ["uefa.champions", "Champions"]];
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
  const games = [], teamIds = {};
  await pool(evs, 5, async ({e, slug, lg}) => {
    const c = e.competitions[0], H = c.competitors.find(x => x.homeAway === "home"), A = c.competitors.find(x => x.homeAway === "away");
    const tm = x => ({abbr: x.team.abbreviation, name: x.team.displayName, record: (x.records && x.records[0] && x.records[0].summary) || ""});
    teamIds[H.team.abbreviation] = H.team.id; teamIds[A.team.abbreviation] = A.team.id;
    const base = `${CORE}/${slug}/events/${e.id}/competitions/${e.id}/odds`;
    const [o, pb] = await Promise.all([J(base + "?lang=en&region=us"), J(base + "/100/propBets?lang=en&region=us&limit=1000")]);
    const cl = [...new Set(((pb && pb.items) || []).filter(i => i.type && i.type.name === "Total Corners").map(i => i.current && i.current.target && i.current.target.value).filter(v => v != null))].sort((a, b) => a - b);
    games.push({id: e.id, lg, slug, date: e.date, venue: c.venue && c.venue.fullName, home: tm(H), away: tm(A), lines: dkLines(o) || {}, cl, btts: null});
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
      const corn = t => { const T = ((sm && sm.boxscore && sm.boxscore.teams) || []).find(x => x.team.id === t.team.id); const st = T && (T.statistics || []).find(x => x.name === "wonCorners"); return st ? +st.displayValue : null; };
      const slug = (e.league && e.league.slug) || "";
      return [dloc(e.date).slice(5), CODE[slug] || ((e.league && e.league.abbreviation) || "?").slice(0, 5), op.team.abbreviation, me.homeAway === "home" ? "h" : "a", sc(me), sc(op), corn(me), corn(op), klass(slug)];
    })).filter(Boolean);
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
  return {asOf: now.toISOString(), games, teams};
}
