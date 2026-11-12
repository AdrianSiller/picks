// Gates: every build, each type of pick is checked against the log and turned off or back on by itself.
//  - ON types are judged by their real picks (results.json, last 30 days).
//  - OFF types keep being followed "in the shadows": every graded candidate that would have been a pick (data/cands).
// Score: z = (hits - expected hits at the price's break-even) / sd. Off when z <= -1.5 with 12+ picks (clearly losing for
// its prices, not just a bad night); back on when the shadow picks reach z >= 0 with 12+ (hitting at least what the price needs).
import M from "../model.js";

const W = 30, MIN = 12, OFF = -1.5, ON = 0;
// Seeds: types we already paused by hand on Nov 10-11 (they start off and come back by themselves if their shadow recovers)
const SEED = {"NFL|prop": "41% en el registro", "NBA|3PM|over": "52% cuando necesita 62%", "NBA|REB|over": "50% cuando necesita 59%", "NBA|AST|over": "44% cuando necesita 60%",
  "NBA|game|sp": "3 de 8", "SOC|tot": "5 de 13", "SOC|dc1h": "1 de 4"};
const keyOf = x => x.kind === "soc" ? `SOC|${x.k}` : x.kind === "game" ? `${x.sport}|game|${x.bet}` : x.sport === "NFL" ? "NFL|prop" : `${x.sport}|${x.m}|${x.s}`;
const qual = x => x.kind === "soc" ? x.pr >= 0.62 && x.p >= 1.2 : x.kind === "game" ? x.pr >= 0.6 && (x.e == null || x.e >= -0.02) : x.pr >= 0.62 && x.role !== 0 && (x.e == null || x.e >= -0.02);
function stat(list) { let n = 0, h = 0, eh = 0, v = 0, u = 0;
  for (const x of list) { const q = 1 / x.p; n++; h += x.hit; eh += q; v += q * (1 - q); u += x.hit ? x.p - 1 : -1; }
  return {n, h, be: n ? +(eh / n).toFixed(3) : null, z: v ? +((h - eh) / Math.sqrt(v)).toFixed(2) : 0, u: +u.toFixed(2)}; }

export function gates({R, read, dloc, now, prev}) {
  const old = (prev && prev.gates) || null, since = new Date(now.getTime() - W * 864e5).toISOString().slice(0, 10);
  const picks = {}, shadow = {};
  for (const d of R.days || []) if (d.date >= since) for (const x of d.items) if (x.hit != null && x.p) (picks[keyOf(x)] = picks[keyOf(x)] || []).push({d: d.date, p: x.p, hit: x.hit});
  for (let i = 1; i <= W; i++) { const day = dloc(new Date(now.getTime() - i * 864e5).toISOString(), "America/Mexico_City"), s = read(`cands/${day}.json`, null);
    if (s) for (const x of s.items) if (x.res && x.res.hit != null && x.p && qual(x)) { const k = x.kind === "game" ? `${x.sport}|game|${x.bet}` : keyOf(x); (shadow[k] = shadow[k] || []).push({d: day, p: x.p, hit: x.res.hit}); } }
  const out = {}, log = [], today = dloc(now.toISOString(), "America/Mexico_City");
  // First run: every type starts being judged from its 30-day log (seeds start paused from today)
  const first = !old;
  for (const k of new Set([...Object.keys(picks), ...Object.keys(shadow), ...Object.keys(SEED), ...Object.keys(old || {})])) {
    if (k.includes("undefined")) continue;
    // Each state is judged only by what happened since it started: a type that came back is not re-judged by its old bad picks,
    // and a paused one has to prove itself with shadow picks from after the pause
    const o = old && old[k], was = o ? o.on : !SEED[k], since0 = (o && o.at) || (first && !SEED[k] ? since : today), P = stat((picks[k] || []).filter(x => x.d >= since0)), S = stat((shadow[k] || []).filter(x => x.d >= since0));
    let on = was, why = o ? o.why : SEED[k] || "", at = since0;
    if (was && P.n >= MIN && P.z <= OFF) { on = false; at = today; why = `${P.h} de ${P.n} cuando el momio pedía ${Math.round(P.be * 100)}%`; }
    else if (!was && S.n >= MIN && S.z >= ON) { on = true; at = today; why = ""; }
    if (on !== was) log.push({at: now.toISOString(), k, on, P, S});
    out[k] = {on, why, at, P: stat(picks[k] || []), S: stat(shadow[k] || [])};
  }
  return {gates: out, changes: log};
}
