// SportsGameOdds: prices for NFL player props and Champions "both teams score" / corners. Needs SGO_API_KEY.
import {J, normName} from "./lib.mjs";
import M from "../model.js";

const API = "https://api.sportsgameodds.com/v2/events";
const STAT = {REC: "receiving_receptions", RECYDS: "receiving_yards", CAR: "rushing_attempts", RUSHYDS: "rushing_yards", CMP: "passing_completions", PASSYDS: "passing_yards", RRY: "rushing+receiving_yards"};
const BK = {draftkings: "DraftKings", fanduel: "FanDuel", betmgm: "BetMGM", caesars: "Caesars", espnbet: "ESPN BET", bovada: "Bovada", fanatics: "Fanatics", betrivers: "BetRivers"};
const decAm = a => { a = Number(a); return a ? +(a > 0 ? 1 + a / 100 : 1 + 100 / -a).toFixed(2) : null; };

async function events(key, league, hours) {
  const now = new Date(), until = new Date(now.getTime() + hours * 36e5);
  const r = await J(`${API}?leagueID=${league}&oddsAvailable=true&startsAfter=${now.toISOString()}&startsBefore=${until.toISOString()}&limit=50&apiKey=${key}`);
  return (r && r.data) || [];
}
// Best book at the exact line (DraftKings first, else the best price); else the closest line
function pickBook(odd, line) {
  const bb = Object.entries((odd && odd.byBookmaker) || {}).filter(([, v]) => v.available !== false && v.odds && v.overUnder != null);
  const same = bb.filter(([, v]) => Number(v.overUnder) === line);
  const p = same.find(([b]) => b === "draftkings") || same.sort((x, y) => decAm(y[1].odds) - decAm(x[1].odds))[0];
  if (p) return {bk: BK[p[0]] || p[0], p: decAm(p[1].odds), line};
  const cl = bb.sort((x, y) => Math.abs(Number(x[1].overUnder) - line) - Math.abs(Number(y[1].overUnder) - line) || (x[0] === "draftkings" ? -1 : 1))[0];
  return cl ? {bk: BK[cl[0]] || cl[0], p: decAm(cl[1].odds), line: Number(cl[1].overUnder)} : null;
}

export async function priceNFL(key, nfl) {
  if (!key || !nfl.cands.length) return 0;
  const evs = await events(key, "NFL", 24 * 8); let n = 0;
  for (const c of nfl.cands) {
    let pid = null, ev = null;
    for (const e of evs) { for (const [id, p] of Object.entries(e.players || {})) { if (normName(p.name || `${p.firstName} ${p.lastName}`) === normName(c.n)) { pid = id; ev = e; break; } } if (pid) break; }
    if (!pid) continue;
    const b = pickBook(ev.odds[`${STAT[c.m]}-${pid}-game-ou-${c.s}`], c.l); if (!b || !b.p) continue;
    if (b.line !== c.l) { const r = M.repricePr(c, b.line); Object.assign(c, {moved: c.l, l: b.line, hc: r.hc, h10: r.h10, hp: r.hp, hh: r.hh, pr0: +r.pr0.toFixed(3), pr: +r.pr.toFixed(3)}); }
    Object.assign(c, {p: b.p, bk: b.bk, imp: +(1 / b.p).toFixed(3), e: +(c.pr - 1 / b.p).toFixed(3)}); n++;
  }
  return n;
}

// Champions: match by team names and kickoff time
export async function priceUCL(key, soc) {
  const ucl = soc.games.filter(g => g.lg === "Champions"); if (!key || !ucl.length) return 0;
  const evs = await events(key, "UEFA_CHAMPIONS_LEAGUE", 24 * 7); let n = 0;
  const nm = s => normName(s).replace(/\b(fc|cf|sc|ac|sv|afc|club|de|cp)\b/g, "").replace(/\s+/g, " ").trim();
  const like = (a, b) => { a = nm(a); b = nm(b); return a === b || a.includes(b) || b.includes(a) || a.split(" ")[0] === b.split(" ")[0]; };
  for (const g of ucl) {
    const e = evs.find(e => Math.abs(new Date(e.status && e.status.startsAt) - new Date(g.date)) < 3 * 36e5 && like(e.teams.home.names.long, g.home.name) && like(e.teams.away.names.long, g.away.name));
    if (!e) continue;
    const od = id => { const o = e.odds[id]; if (!o) return null; const dk = (o.byBookmaker || {}).draftkings; return decAm((dk && dk.available !== false && dk.odds) || o.bookOdds); };
    const y = od("bothTeamsScored-all-game-yn-yes"), no = od("bothTeamsScored-all-game-yn-no");
    if (y && no) g.btts = [y, no];
    const co = e.odds["cornerKicks-all-game-ou-over"], cu = e.odds["cornerKicks-all-game-ou-under"];
    if (co && cu) { const line = Number(((co.byBookmaker || {}).draftkings || {}).overUnder || co.bookOverUnder);
      const ov = pickBook(co, line), un = pickBook(cu, line);
      if (ov && un && ov.line === line && un.line === line) g.corn = {line, over: ov.p, under: un.p};
      // No single book listed: use the consensus price when both sides share the line
      else if (Number(co.bookOverUnder) === Number(cu.bookOverUnder) && co.bookOdds && cu.bookOdds) g.corn = {line: Number(co.bookOverUnder), over: decAm(co.bookOdds), under: decAm(cu.bookOdds)}; }
    n++;
  }
  return n;
}
