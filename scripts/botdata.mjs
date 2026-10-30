// Ready-to-send Telegram texts per sport (data/bot.json), read by the bot worker when you ask for picks.
import M from "../model.js";
import {LBL} from "./results.mjs";

const TZ = "America/Mexico_City";
const esc = s => String(s == null ? "" : s).replace(/[&<>]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;"}[c]));
const fx = x => x ? (+x).toFixed(2) : "—";
const pct = x => Math.round(x * 100) + "%";
const hora = d => new Date(d).toLocaleString("es-MX", {weekday: "short", hour: "numeric", minute: "2-digit", timeZone: TZ});
const propLbl = (sp, c) => `${c.s === "over" ? "Over" : "Under"} ${c.l} ${LBL[sp][c.m]}`;

function parlay(top, price) {
  const pool = top.filter(c => !c.sm && !c.q && price(c)); let best = null;
  for (let a = 0; a < pool.length; a++) for (let b = a + 1; b < pool.length; b++) {
    if (pool[a].g === pool[b].g) continue; const p = pool[a].pr * pool[b].pr; if (!best || p > best.p) best = {legs: [pool[a], pool[b]], p};
  }
  return best;
}

function players(sp, D, now, hours) {
  const G = Object.fromEntries(D.games.map(g => [g.id, g])), soon = g => g && new Date(g.date) > now && new Date(g.date) - now < hours * 36e5;
  const games = D.games.filter(soon);
  if (!games.length) return null;
  const top = M.topPicks(D.cands.filter(c => soon(G[c.g])), sp), L = [];
  L.push(`<b>${sp === "NBA" ? "🏀 NBA" : "🏈 NFL"}</b> · ${games.length} partido${games.length > 1 ? "s" : ""}`, "");
  top.forEach((c, i) => L.push(`${i + 1}. <b>${esc(c.n)}</b> (${esc(c.t)}) · ${propLbl(sp, c)} · <b>${fx(c.p)}</b> · ${pct(c.pr)}${c.q ? " ⚠️ en duda" : ""}`));
  const cfg = M.CFG[sp], gp = [];
  for (const g of games) { if (!D.teams[g.home.abbr] || !D.teams[g.away.abbr]) continue; const m = M.gameModel(g, {...cfg, teams: D.teams, outs: D.outs || {}});
    if (m.play) gp.push(`🎯 ${esc(g.away.abbr)} @ ${esc(g.home.abbr)} (${hora(g.date)}): <b>${esc(m.best.lbl.replace(" (moneyline)", " ML").replace(" (spread)", ""))}</b> · ${fx(m.best.price)} · ${pct(m.best.p)}`); }
  if (gp.length) L.push("", "<b>Picks de partido</b>", ...gp);
  const pl = parlay(top, c => c.p);
  if (pl) L.push("", `<b>Parlay más sólido</b>: ${pl.legs.map(c => `${esc(c.n)} ${propLbl(sp, c)}`).join(" + ")} · ${fx(pl.legs[0].p * pl.legs[1].p)} · ${pct(pl.p)}`);
  return L.join("\n");
}

function soccer(S, now, hours) {
  const soon = g => new Date(g.date) > now && new Date(g.date) - now < hours * 36e5, games = S.games.filter(soon);
  if (!games.length) return null;
  const B = M.buildSoccer({...S, games: S.games}), G = Object.fromEntries(S.games.map(g => [g.id, g]));
  const top = M.socTop(B.cands.filter(c => soon(G[c.g])), G, null, 8), L = [`<b>⚽ Soccer</b> · ${games.length} partidos en las próximas ${hours} h`, ""];
  top.forEach((c, i) => { const g = G[c.g]; L.push(`${i + 1}. ${esc(g.away.abbr)} @ ${esc(g.home.abbr)} (${esc(g.lg)}, ${hora(g.date)}) · <b>${esc(c.lbl)}</b> · ${c.p ? `<b>${fx(c.p)}</b>` : "sin momio"} · ${pct(c.pr)}`); });
  const pl = parlay(top, c => c.p);
  if (pl) L.push("", `<b>Parlay más sólido</b>: ${pl.legs.map(c => `${esc(G[c.g].home.abbr)} ${esc(c.lbl)}`).join(" + ")} · ${fx(pl.legs[0].p * pl.legs[1].p)} · ${pct(pl.p)}`);
  return L.join("\n");
}

function results(R) {
  const day = (R.days || []).find(d => d.items.some(x => x.hit === 0 || x.hit === 1)); if (!day) return "Todavía no hay resultados calificados.";
  const NAME = {NBA: "🏀 NBA", NFL: "🏈 NFL", SOC: "⚽ Soccer"}, L = [`<b>Cómo nos fue el ${new Date(day.date + "T12:00:00").toLocaleDateString("es-MX", {day: "numeric", month: "short"})}</b>`];
  for (const sp of ["NBA", "NFL", "SOC"]) {
    const it = day.items.filter(x => x.sport === sp && x.hit !== undefined); if (!it.length) continue;
    const done = it.filter(x => x.hit === 0 || x.hit === 1), w = done.filter(x => x.hit).length, u = done.reduce((s, x) => s + (x.hit ? (x.p || 1.91) - 1 : -1), 0);
    L.push("", `<b>${NAME[sp]}</b>: ${w} de ${done.length} · ${u >= 0 ? "+" : ""}${u.toFixed(1)} u`);
    it.forEach(x => L.push(`${x.hit === null ? "➖" : x.hit ? "✅" : "❌"} ${esc(x.n)} · ${esc(x.lbl)}${x.act ? ` (${esc(x.act)})` : ""}`));
  }
  return L.join("\n");
}

export function botData(latest, R, now) {
  const at = new Date(latest.generatedAt).toLocaleTimeString("es-MX", {hour: "numeric", minute: "2-digit", timeZone: TZ});
  const foot = `\n\n<i>Datos de las ${at} · antes de apostar dale ↻ Actualizar en la app</i>`;
  const wrap = (t, none) => (t || none) + foot;
  return {generatedAt: latest.generatedAt,
    nba: wrap(players("NBA", latest.nba, now, 30), "🏀 Hoy no hay partidos de NBA con picks."),
    nfl: wrap(players("NFL", latest.nfl, now, 24 * 6), "🏈 No hay partidos de NFL próximos con picks."),
    soc: wrap(soccer(latest.soc, now, 48), "⚽ No hay partidos de soccer en las próximas 48 h."),
    res: results(R)};
}
