// The Odds API (free plan, 500 credits a month): Pinnacle, the sharpest book, as the reference probability, plus the best
// price among several books. Once per Mexico City day; cost ≈ 1 credit per soccer league and 2-3 for NBA / NFL.
const API = "https://api.the-odds-api.com/v4/sports";
const SOC = {"Liga MX": "soccer_mexico_ligamx", "La Liga": "soccer_spain_la_liga", "Premier": "soccer_epl", "Bundesliga": "soccer_germany_bundesliga", "Serie A": "soccer_italy_serie_a", "Ligue 1": "soccer_france_ligue_one", "Champions": "soccer_uefa_champs_league", "Europa": "soccer_uefa_europa_league", "Nations League": "soccer_uefa_nations_league"};
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\b(fc|cf|ac|sc|afc|ssc|sv|vfb|vfl|rc|cd|ud|sl|as|og|club|de|the)\b/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const sim = (a, b) => { const A = new Set(norm(a).split(" ").filter(w => w.length > 2)), B = new Set(norm(b).split(" ").filter(w => w.length > 2)); let n = 0; for (const w of A) if (B.has(w) || [...B].some(x => x.startsWith(w) || w.startsWith(x))) n++; return n / Math.max(1, Math.min(A.size, B.size)); };

async function fetchSport(key, sport, markets) {
  const r = await fetch(`${API}/${sport}/odds/?apiKey=${key}&regions=eu&markets=${markets}&oddsFormat=decimal`);
  if (!r.ok) { console.log("odds api", sport, r.status); return {events: [], left: r.headers.get("x-requests-remaining")}; }
  return {events: await r.json(), left: r.headers.get("x-requests-remaining")};
}
// Attach to each of our games: pin = Pinnacle's prices; best = best price per outcome and which book
function attach(games, events, soccer) {
  for (const g of games) {
    const ev = events.filter(e => Math.abs(new Date(e.commence_time) - new Date(g.date)) < 4 * 36e5)
      .map(e => ({e, s: sim(e.home_team, g.home.name) + sim(e.away_team, g.away.name)})).sort((a, b) => b.s - a.s)[0];
    if (!ev || ev.s < 1) continue;
    const e = ev.e, pin = (e.bookmakers || []).find(b => b.key === "pinnacle"), mk = (b, k) => (b && b.markets || []).find(m => m.key === k);
    const price = (b, k, name, point) => { const m = mk(b, k); const o = m && m.outcomes.find(x => x.name === name && (point == null || x.point === point)); return o ? o.price : null; };
    const out = {};
    if (pin) { out.h = price(pin, "h2h", e.home_team); out.a = price(pin, "h2h", e.away_team); if (soccer) out.d = price(pin, "h2h", "Draw");
      const t = mk(pin, "totals"); if (t) { const ov = t.outcomes.find(x => x.name === "Over"), un = t.outcomes.find(x => x.name === "Under"); if (ov && un && ov.point === un.point) out.tot = {line: ov.point, o: ov.price, u: un.price}; }
      const s = mk(pin, "spreads"); if (s) { const hh = s.outcomes.find(x => x.name === e.home_team), aa = s.outcomes.find(x => x.name === e.away_team); if (hh && aa) out.spr = {h: hh.point, ph: hh.price, pa: aa.price}; } }
    const best = {}; for (const [k, name] of [["h", e.home_team], ["a", e.away_team], ...(soccer ? [["d", "Draw"]] : [])]) for (const b of e.bookmakers || []) { const p = price(b, "h2h", name); if (p && (!best[k] || p > best[k].p)) best[k] = {p, bk: b.title}; }
    if (out.h || Object.keys(best).length) { g.pin = out; g.best = best; }
  }
}
export async function oddsApi(key, {nba, nfl, soc}, now) {
  let left = null, n = 0;
  for (const [lg, sport] of Object.entries(SOC)) { const gs = soc.games.filter(g => g.lg === lg && new Date(g.date) - now < 3 * 864e5); if (!gs.length) continue;
    const r = await fetchSport(key, sport, "h2h"); attach(gs, r.events, true); left = r.left; n++; }
  if (nba.games.length) { const r = await fetchSport(key, "basketball_nba", "h2h,totals"); attach(nba.games, r.events, false); left = r.left; n++; }
  if (nfl.games.some(g => new Date(g.date) - now < 2 * 864e5)) { const r = await fetchSport(key, "americanfootball_nfl", "h2h,spreads,totals"); attach(nfl.games, r.events, false); left = r.left; n++; }
  return {calls: n, left};
}
