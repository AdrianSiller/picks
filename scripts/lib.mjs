// Small helpers shared by the build scripts. Plain fetch, no dependencies (Node 20+).
export const sleep = ms => new Promise(r => setTimeout(r, ms));

// GET JSON with retries; 400/404 return null right away
export async function J(url, tries = 3) {
  for (let t = 0; t < tries; t++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
      if (r.status === 400 || r.status === 404) return null;
    } catch (e) { /* network hiccup: retry */ }
    await sleep(600 * (t + 1));
  }
  return null;
}

// Run f over arr with n workers, keeping order
export async function pool(arr, n, f) {
  const out = new Array(arr.length); let i = 0;
  await Promise.all(Array.from({length: Math.min(n, arr.length)}, async () => { while (i < arr.length) { const k = i++; out[k] = await f(arr[k], k); } }));
  return out;
}

export const A2D = a => { a = Number(a); return a ? +(a > 0 ? 1 + a / 100 : 1 + 100 / -a).toFixed(2) : null; };
export const dec = x => x == null || x === "" ? null : +Number(x).toFixed(2);
export const r1 = x => Math.round(x * 10) / 10;
export const avg = a => a.length ? r1(a.reduce((s, v) => s + v, 0) / a.length) : null;
export const dloc = (iso, tz = "America/New_York") => new Date(iso).toLocaleDateString("en-CA", {timeZone: tz});
export const ymd = d => d.replace(/-/g, "");
export const athleteId = ref => ((ref || "").match(/athletes\/(\d+)/) || [])[1];
export const teamId = ref => ((ref || "").match(/teams\/(\d+)/) || [])[1];

// DraftKings (provider 100) game lines from ESPN's core odds endpoint
export function dkLines(o) {
  const dk = o && (o.items || []).find(i => i.provider && i.provider.id === "100");
  if (!dk) return null;
  const h = (dk.homeTeamOdds || {}).current || {}, a = (dk.awayTeamOdds || {}).current || {};
  const L = {provider: "DraftKings",
    spreadHome: h.pointSpread && h.pointSpread.american, spreadAway: a.pointSpread && a.pointSpread.american,
    spreadHomeOdds: dec(h.spread && h.spread.decimal), spreadAwayOdds: dec(a.spread && a.spread.decimal),
    mlHome: dec(h.moneyLine && h.moneyLine.decimal), mlAway: dec(a.moneyLine && a.moneyLine.decimal),
    total: dk.overUnder, overOdds: A2D(dk.overOdds), underOdds: A2D(dk.underOdds)};
  if (dk.drawOdds && dk.drawOdds.moneyLine != null) L.draw = A2D(dk.drawOdds.moneyLine);
  return L;
}

export const normName = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[.'’]/g, "").replace(/\b(jr|sr|ii|iii|iv)\b/g, "").replace(/\bcameron\b/g, "cam").replace(/\s+/g, " ").trim();
