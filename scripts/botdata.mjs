// Telegram texts (data/bot.json), organized as menus: sport -> what (top / game picks / one game) and, for soccer, league.
// The bot worker only walks this tree; every text already uses the same filters as the app.
import M from "../model.js";
import {LBL} from "./results.mjs";

const TZ = "America/Mexico_City";
const esc = s => String(s == null ? "" : s).replace(/[&<>]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;"}[c]));
const fx = x => x ? (+x).toFixed(2) : "—";
const pct = x => Math.round(x * 100) + "%";
const hora = d => new Date(d).toLocaleString("es-MX", {weekday: "short", hour: "numeric", minute: "2-digit", timeZone: TZ});
const propLbl = (sp, c) => `${c.s === "over" ? "Over" : "Under"} ${c.l} ${LBL[sp][c.m]}`;
const gameLbl = l => l.replace(" (moneyline)", " ML").replace(" (spread)", "");
export const LG = {"Liga MX": "mx", "La Liga": "esp", "Premier": "eng", "Bundesliga": "ger", "Serie A": "ita", "Ligue 1": "fra", "Champions": "ucl"};

function parlay(top) {
  const pool = top.filter(c => !c.sm && !c.q && c.p); let best = null;
  for (let a = 0; a < pool.length; a++) for (let b = a + 1; b < pool.length; b++) {
    if (pool[a].g === pool[b].g) continue; const p = pool[a].pr * pool[b].pr; if (!best || p > best.p) best = {legs: [pool[a], pool[b]], p};
  }
  return best;
}
const propLine = (sp, c, i) => `${i != null ? `${i + 1}. ` : "• "}<b>${esc(c.n)}</b> (${esc(c.t)}) · ${propLbl(sp, c)} · <b>${fx(c.p)}</b> · ${pct(c.pr)}${c.q ? " ⚠️ en duda" : ""}` +
  (c.mv === -1 ? `\n   📉 <i>la línea se movió en contra (abrió en ${c.ol})</i>` : c.mv === 1 ? `\n   📈 <i>la línea se movió a favor (abrió en ${c.ol})</i>` : "") + (c.h10 ? `\n   <i>cumplió ${c.h10[0]} de ${c.h10[1]}${c.hc && c.hc[1] ? `, esta temporada ${c.hc[0]} de ${c.hc[1]}` : ""}</i>` : "");

function players(sp, D, now, hours) {
  const G = Object.fromEntries(D.games.map(g => [g.id, g])), soon = g => g && new Date(g.date) > now && new Date(g.date) - now < hours * 36e5;
  const games = D.games.filter(soon), icon = sp === "NBA" ? "🏀 NBA" : "🏈 NFL";
  if (!games.length) return null;
  const cands = D.cands.filter(c => soon(G[c.g])), top = M.topPicks(cands, sp), cfg = M.CFG[sp];
  const model = g => D.teams[g.home.abbr] && D.teams[g.away.abbr] ? M.gameModel(g, {...cfg, teams: D.teams, outs: D.outs || {}}) : null;
  const topTxt = [`<b>${icon} · Top ${top.length}</b>`, "", ...top.map((c, i) => propLine(sp, c, i))];
  const pl = parlay(top);
  if (pl) topTxt.push("", `<b>Parlay más sólido</b>: ${pl.legs.map(c => `${esc(c.n)} ${propLbl(sp, c)}`).join(" + ")} · ${fx(pl.legs[0].p * pl.legs[1].p)} · ${pct(pl.p)}`);
  const mlRows = [], gameList = [];
  for (const g of games) {
    const m = model(g), tag = `${g.away.abbr} @ ${g.home.abbr}`;
    if (m && m.play) mlRows.push(`🎯 ${esc(tag)} (${hora(g.date)}): <b>${esc(gameLbl(m.best.lbl))}</b> · ${fx(m.best.price)} · ${pct(m.best.p)}`);
    const props = []; const seen = new Set();
    for (const c of D.cands.filter(c => c.g === g.id && !M.fails(c, sp)).sort((a, b) => M.score(b, sp) - M.score(a, sp))) { if (seen.has(c.aid)) continue; seen.add(c.aid); props.push(c); if (props.length === 8) break; }
    const L = [`<b>${esc(g.away.name)} @ ${esc(g.home.name)}</b>`, hora(g.date), ""];
    if (m && m.play) L.push(`🎯 <b>Pick de partido</b>: ${esc(gameLbl(m.best.lbl))} · <b>${fx(m.best.price)}</b> · ${pct(m.best.p)}`);
    else if (m) L.push(`🎯 Sin pick sólido de ML o spread (proyectamos casi lo mismo que la casa).`);
    if (m && m.value) L.push(`💸 Opción de valor (arriesgada): ${esc(gameLbl(m.value.lbl))} · ${fx(m.value.price)} · ${pct(m.value.p)}`);
    const L0 = g.lines || {}; if (L0.total) L.push(`Total ${L0.total} · ML ${g.away.abbr} ${fx(L0.mlAway)} / ${g.home.abbr} ${fx(L0.mlHome)}`);
    const outs = (g.inj || []).filter(i => i[2] === "Out").map(i => `${i[1]} (${i[0]})`);
    if (outs.length) L.push(`Fuera: ${esc(outs.join(", "))}`);
    L.push("", props.length ? `<b>Props sólidos (${props.length})</b>` : "Ningún prop de este partido pasa los filtros. Mejor no forzarlo.", ...props.map(c => propLine(sp, c)));
    gameList.push({id: g.id, d: g.date, solid: !!((m && m.play) || props.length), b: `${g.away.abbr} @ ${g.home.abbr} · ${new Date(g.date).toLocaleTimeString("es-MX", {hour: "numeric", minute: "2-digit", timeZone: TZ})}`, t: L.join("\n"),
      chk: {sp: sp.toLowerCase(), h: g.home.abbr, a: g.away.abbr, outs: (g.inj || []).filter(i => i[2] === "Out").map(i => i[1]), props: props.map(c => ({aid: c.aid, n: c.n, lbl: propLbl(sp, c)}))}});
  }
  const mlTxt = [`<b>${icon} · Picks de partido (ML / spread)</b>`, "", ...(mlRows.length ? mlRows : ["Hoy ningún partido tiene un pick sólido de ML o spread."])];
  return {top: topTxt.join("\n"), ml: mlTxt.join("\n"), all: [topTxt.join("\n"), mlTxt.join("\n")].join("\n\n"), games: gameList};
}

function soccer(S, now, hours) {
  const soon = g => new Date(g.date) > now && new Date(g.date) - now < hours * 36e5, games = S.games.filter(soon);
  if (!games.length) return null;
  const B = M.buildSoccer(S), G = Object.fromEntries(S.games.map(g => [g.id, g])), GM = Object.fromEntries(B.games.map(x => [x.id, x]));
  const row = c => { const g = G[c.g]; return `• ${esc(g.away.abbr)} @ ${esc(g.home.abbr)} (${hora(g.date)}) · <b>${esc(c.lbl)}</b> · ${c.p ? `<b>${(c.est ? "≈" : "") + fx(c.p)}</b>` : "sin momio"} · ${pct(c.pr)}`; };
  const out = {top: null, leagues: []};
  const top = M.socTop(B.cands.filter(c => soon(G[c.g])), G, null, 10);
  out.top = [`<b>⚽ Soccer · Top ${top.length}</b> (próximas ${hours} h)`, "", ...(top.length ? top.map(row) : ["Ningún partido tiene un pick sólido con momio."])].join("\n");
  for (const [lg, code] of Object.entries(LG)) {
    const gs = games.filter(g => g.lg === lg); if (!gs.length) continue;
    const lt = M.socTop(B.cands.filter(c => soon(G[c.g]) && G[c.g].lg === lg), G, lg, 10);
    const gameList = gs.map(g => {
      const m = GM[g.id], ok = B.cands.filter(c => c.g === g.id && M.socOk(c)).sort((a, b) => (!!b.p - !!a.p) || M.socScore(b) - M.socScore(a)).slice(0, 5);
      const L = [`<b>${esc(g.away.name)} @ ${esc(g.home.name)}</b>`, `${lg} · ${hora(g.date)}`, ""];
      const best = ok.find(c => c.p);
      L.push(best ? `🎯 <b>Pick</b>: ${esc(best.lbl)} · <b>${(best.est ? "≈" : "") + fx(best.p)}</b> · ${pct(best.pr)}` : "🎯 Sin pick sólido con momio: el modelo y la casa no coinciden lo suficiente.");
      const others = ok.filter(c => c !== best); if (others.length) L.push("", "<b>Otras opciones</b>", ...others.map(c => `• ${esc(c.lbl)} · ${c.p ? (c.est ? "≈" : "") + fx(c.p) : "sin momio"} · ${pct(c.pr)}`));
      if (m) L.push("", "<b>1 Up</b> (compáralo en tu casa)", `• ${esc(g.home.abbr)}: ${pct(m.up1H)} · conviene si paga ${fx(1 / m.up1H)} o más`, `• ${esc(g.away.abbr)}: ${pct(m.up1A)} · conviene si paga ${fx(1 / m.up1A)} o más`);
      const L0 = g.lines || {}; if (L0.mlHome) L.push("", `1X2: ${g.home.abbr} ${fx(L0.mlHome)} · empate ${fx(L0.draw)} · ${g.away.abbr} ${fx(L0.mlAway)}${L0.total ? ` · goles ${L0.total}` : ""}`);
      if (g.xi) L.push(`📋 Alineaciones confirmadas: ${["h", "a"].filter(k => g.xi[k]).map(k => { const t = g[k === "h" ? "home" : "away"].abbr, m = g.xi[k].miss; return m.length ? `${t} sin ${m.length} titular${m.length > 1 ? "es" : ""} habitual${m.length > 1 ? "es" : ""} (${esc(m.join(", "))})` : `${t} con su once habitual`; }).join("; ")}. Ya entra en el modelo.`);
      else if (g.rot) L.push(`⚠️ ${["h", "a"].filter(k => g.rot[k]).map(k => `${g[k === "h" ? "home" : "away"].abbr} ${g.rot[k].next != null ? `juega Champions en ${g.rot[k].next} días (posible rotación)` : "viene de jugar Champions"}`).join("; ")}. Revisa alineaciones con ↻ Actualizar en la app antes de apostar.`);
      const meta = S.meta || {}, reg = ab => ((meta[ab] || {}).reg || []).map(x => [x[0], x[1]]);
      return {id: g.id, d: g.date, solid: !!best, b: `${g.away.abbr} @ ${g.home.abbr} · ${new Date(g.date).toLocaleString("es-MX", {weekday: "short", hour: "numeric", minute: "2-digit", timeZone: TZ})}`, t: L.join("\n"),
        chk: {sp: "soc", slug: g.slug, h: g.home.abbr, a: g.away.abbr, pick: best ? {lbl: best.lbl, team: best.team || (best.side === "H" || best.side === "1X" ? "H" : best.side === "A" || best.side === "X2" ? "A" : null)} : null, xi: {h: reg(g.home.abbr), a: reg(g.away.abbr)}, lineups: !!g.xi}};
    });
    out.leagues.push({code, lg, top: [`<b>⚽ ${lg} · mejores picks</b>`, "", ...(lt.length ? lt.map(row) : ["Ningún partido de esta liga tiene un pick sólido con momio."])].join("\n"), games: gameList});
  }
  return out;
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
  return {v: 3, generatedAt: latest.generatedAt, foot: `<i>Datos de las ${at} · antes de apostar dale ↻ Actualizar en la app</i>`,
    nba: players("NBA", latest.nba, now, 30), nfl: players("NFL", latest.nfl, now, 24 * 6), soc: soccer(latest.soc, now, 72), res: results(R)};
}
