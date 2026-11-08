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
// Best moneyline price among the books The Odds API covers (Pinnacle included), to know if your book pays less than the market
const bestLine = g => { const b = g.best; if (!b || !(b.h || b.a)) return null;
  const it = [["h", g.home.abbr], ["d", "Empate"], ["a", g.away.abbr]].filter(([k]) => b[k]).map(([k, n]) => `${esc(n)} ${b[k].p.toFixed(2)} (${esc(b[k].bk)})`);
  return `💰 Mejor momio del mercado: ${it.join(" · ")}`; };
export const LG = {"Liga MX": "mx", "La Liga": "esp", "Premier": "eng", "Bundesliga": "ger", "Serie A": "ita", "Ligue 1": "fra", "Champions": "ucl", "Europa": "uel"};

// Bets you can mark from the bot: each pick gets a short stable ref (same pick = same ref across builds) and the fields grading needs
let BETS = {};
const SHORT = {PTS: "pts", REB: "reb", AST: "ast", "3PM": "triples", REC: "rec", RECYDS: "yd rec", CAR: "acarreos", RUSHYDS: "yd tierra", CMP: "comp", PASSYDS: "yd pase", RRY: "yd t+r"};
const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
const reg = x => { const r = hash([x.sport, x.kind, x.g, x.aid, x.m, x.l, x.s, x.side, x.bet, x.k, x.line, x.team].join("|")); BETS[r] = x; return r; };
const propBet = (sp, c, d) => reg({sport: sp, kind: "prop", d, g: c.g, aid: c.aid, m: c.m, l: c.l, s: c.s, p: c.p, pr: c.pr, lbl: `${c.n} ${propLbl(sp, c)}`, b: `${c.n.split(" ").slice(-1)[0]} ${c.s === "over" ? "O" : "U"}${c.l} ${SHORT[c.m] || c.m}`});
const gameBet = (sp, g, o) => reg({sport: sp, kind: "game", d: g.date, g: g.id, side: o.side, bet: o.kind, line: o.line, p: o.price, pr: o.p, lbl: `${g.away.abbr} @ ${g.home.abbr} · ${o.kind === "tot" ? "Total " + o.lbl : gameLbl(o.lbl)}`, b: `${o.kind === "tot" ? `${g.away.abbr}@${g.home.abbr} ` : ""}${o.kind === "tot" ? o.lbl : gameLbl(o.lbl)}`});
const up1Bet = (g, side, pr) => reg({sport: "SOC", kind: "up1", nomark: 1, d: g.date, g: g.id, team: side, pr, lbl: `${g.away.abbr} @ ${g.home.abbr} · 1 Up ${side === "H" ? g.home.abbr : g.away.abbr}`, b: `1 Up ${side === "H" ? g.home.abbr : g.away.abbr}`});
const socBet = (g, c) => reg({sport: "SOC", kind: "soc", d: g.date, g: g.id, k: c.k, side: c.side, team: c.team, aid: c.aid, line: c.line, p: c.p, pr: c.pr, lbl: `${g.away.abbr} @ ${g.home.abbr} · ${c.lbl}`, b: (s => s.length > 40 ? s.slice(0, 39) + "…" : s)(`${g.away.abbr}@${g.home.abbr}: ${c.lbl}`)});

function parlay(top) {
  const pool = top.filter(c => !c.sm && !c.q && c.p); let best = null;
  for (let a = 0; a < pool.length; a++) for (let b = a + 1; b < pool.length; b++) {
    if (pool[a].g === pool[b].g) continue; const p = pool[a].pr * pool[b].pr; if (!best || p > best.p) best = {legs: [pool[a], pool[b]], p};
  }
  return best;
}
// Why each pick: the same reasons as the app, ✅ = supports the pick, ⚠️ = goes against it
const POSPL = {G: "bases y escoltas", F: "aleros", C: "centros", WR: "WR", TE: "TE", RB: "RB", QB: "QB"};
const MUK = c => c.pos === "RB" && ["CAR", "RUSHYDS"].includes(c.m) ? "RBRUSHYDS" : ["RB", "WR", "TE"].includes(c.pos) && ["REC", "RECYDS"].includes(c.m) ? c.pos + c.m : c.pos === "QB" && ["CMP", "PASSYDS"].includes(c.m) ? "QBPASSYDS" : null;
function whyProp(sp, c, D, g, max) {
  const st = LBL[sp][c.m], over = c.s === "over", R = [], ok = b => b ? "✅" : "⚠️";
  if (c.h10 && c.h10[1]) { const mix = c.nC != null && c.nC < c.h10[1] ? ` (${c.h10[1] - c.nC} de la temporada pasada)` : "";
    R.push({w: 3, t: `${ok(c.h10[0] / c.h10[1] >= 0.6)} Racha: cumplió ${c.h10[0]} de sus últimos ${c.h10[1]}${mix}${c.md10 != null ? `, lo normal en él: ${c.md10}${c.a10 != null && Math.abs(c.a10 - c.md10) >= Math.max(1, c.l * 0.1) ? ` (promedio ${c.a10}, inflado por ${c.a10 > c.md10 ? "una noche grande" : "una noche mala"})` : ""}` : c.a10 != null ? `, promedia ${c.a10}` : ""}`}); }
  if (c.hc && c.hc[1] >= 3 && c.nC != null && c.nC < (c.h10 || [0, 0])[1]) R.push({w: 2, t: `${ok(c.hc[0] / c.hc[1] >= 0.6)} Esta temporada: ${c.hc[0]} de ${c.hc[1]}${c.aC != null ? `, promedia ${c.aC}` : ""}`});
  if (c.chg) R.push({w: 3, t: `${ok((c.chg > 0) === over)} Cambio de rol: este año promedia ${Math.abs(Math.round(c.chg * 100))}% ${c.chg > 0 ? "más" : "menos"} ${st} que el pasado`});
  const mk = sp === "NFL" && MUK(c), mu = mk && D.mu && D.mu[c.o];
  if (mu && mu.r[mk] != null && (mu.r[mk] <= 10 || mu.r[mk] > 22)) { const top = mu.r[mk] <= 10; R.push({w: 2, t: `${ok(over === top)} Rival: ${c.o} es de las defensas que ${top ? "más" : "menos"} permiten a ${POSPL[c.pos] || c.pos} (#${mu.r[mk]} de 32)`}); }
  else if (c.sty && c.m === "PTS") { const z = ["triples", "dentro del arco (pintura y media)", "tiros libres"], main = c.sty.sh.indexOf(Math.max(...c.sty.sh)), dz = Math.round((c.sty.def[main] - 1) * 100), p = Math.round((c.f - 1) * 100);
    R.push({w: 2, t: `${Math.abs(p) < 2 ? "➖" : ok((p > 0) === over)} Rival por estilo: ${Math.round(c.sty.sh[main] * 100)}% de sus puntos salen de ${z[main]} y ${c.o} permite ${Math.abs(dz)}% ${dz >= 0 ? "más" : "menos"} de lo normal ahí${Math.abs(Math.round((c.sty.fPos - 1) * 100)) >= 3 ? `; a su posición le permite ${Math.abs(Math.round((c.sty.fPos - 1) * 100))}% ${c.sty.fPos > 1 ? "más" : "menos"}` : ""}`}); }
  else if (c.f && Math.abs(c.f - 1) >= 0.03) { const p = Math.round((c.f - 1) * 100); R.push({w: 2, t: `${ok((p > 0) === over)} Rival: ${c.o} permite ${Math.abs(p)}% ${p > 0 ? "más" : "menos"} ${st} de lo normal a ${POSPL[c.pos] || c.pos}`}); }
  if (c.vm && c.vm !== 1) { const up = c.vm > 1, un = g && g.usage ? (c.h ? g.usage.h : g.usage.a) || [] : [];
    R.push({w: 3, t: `${ok(up === over)} ${sp === "NBA" ? `Minutos: se esperan ~${c.minExp} (normalmente ${c.min})` : `Volumen: ${up ? "sube" : "baja"} ~${Math.round(Math.abs(c.vm - 1) * 100)}%`}${un.length ? ` por ${un.join("; ")}` : ""}`}); }
  if (c.us && c.us > 1) R.push({w: 3, t: `${ok(over)} Más tiros por las bajas de su equipo: ~${Math.round((c.us - 1) * 100)}% más ${st}`});
  if (c.ctx && c.hx) R.push({w: 3, t: `${ok(c.hx[0] / c.hx[1] >= 0.5)} Con las bajas de hoy (${c.ctx.who.join(", ")}): en ${c.ctx.n} juegos así cumplió ${c.hx[0]} de ${c.hx[1]} y promedia ${c.ctx.avg} ${st} (en general ${c.ctx.all})`});
  if (c.sf && c.sf !== 1) R.push({w: 2, t: `${ok((c.sf > 1) === over)} Marcador esperado: ${c.t} ${c.spr < 0 ? "favorito" : "underdog"} por ${Math.abs(c.spr)}, su volumen ${c.sf > 1 ? "sube" : "baja"} ~${Math.abs(Math.round((c.sf - 1) * 100))}%`});
  if (c.envAdj >= 0.015 || c.envAdj <= -0.015) { const good = c.envAdj > 0, env = g && g.env;
    R.push({w: 2, t: `${ok(good)} ${c.blow && !good ? "Spread grande: riesgo de paliza y menos minutos al final" : `Tipo de partido: ${env ? (sp === "NBA" ? `total ${env.total} contra ${env.avg} de promedio` : `su equipo espera ${c.h ? env.h : env.a} puntos`) : ""} (${good === over ? "a favor" : "en contra"})`}`.replace(" ()", "")}); }
  if (c.mv) R.push({w: 3, t: c.mv < 0 ? `⚠️ La línea se movió en contra (abrió en ${c.ol})` : `✅ La línea se movió a favor (abrió en ${c.ol})`});
  if (c.hh && c.hh[1] >= 2) R.push({w: 1, t: `${ok(c.hh[0] / c.hh[1] >= 0.5)} Contra ${c.o}: ${c.hh[0]} de ${c.hh[1]}`});
  if (c.wind) R.push({w: 1, t: `${ok(!over)} Viento de ${c.wind} mph`});
  if (c.b2b) R.push({w: 1, t: `${ok(!over)} Segunda noche seguida`});
  return R.sort((a, b) => b.w - a.w).slice(0, max).map(r => `   ${esc(r.t)}`);
}
// Soccer: form and goals of each team in its last 10 (league and continental) matches
function whySoc(S, g, c, B) {
  const rows = ab => (S.teams[ab] || []).filter(r => !r[8]).slice(0, 10), H = rows(g.home.abbr), A = rows(g.away.abbr), R = [];
  const form = r => { const w = r.filter(x => x[4] > x[5]).length, d = r.filter(x => x[4] === x[5]).length; return `${w}G ${d}E ${r.length - w - d}P`; };
  const cnt = (r, f) => `${r.filter(f).length} de ${r.length}`;
  const avg = (r, f) => r.length ? (r.reduce((s, x) => s + f(x), 0) / r.length).toFixed(1) : "–";
  // ✅ both teams support the pick, ⚠️ both go against it, ➖ mixed
  const two = (a, b) => a && b ? "✅" : !a && !b ? "⚠️" : "➖", rate = (r, f) => r.length ? r.filter(f).length / r.length : 0;
  if (c.k === "btts") { const f = x => x[4] > 0 && x[5] > 0, y = c.side === "Y";
    R.push(`${two((rate(H, f) >= 0.55) === y, (rate(A, f) >= 0.55) === y)} Ambos anotaron en ${cnt(H, f)} de ${g.home.abbr} y ${cnt(A, f)} de ${g.away.abbr}`); }
  else if (c.k === "tot") { const f = x => x[4] + x[5] > c.line, o = c.side === "O";
    R.push(`${two((rate(H, f) >= 0.5) === o, (rate(A, f) >= 0.5) === o)} Más de ${c.line} goles en ${cnt(H, f)} de ${g.home.abbr} y ${cnt(A, f)} de ${g.away.abbr} (promedian ${avg(H, x => x[4] + x[5])} y ${avg(A, x => x[4] + x[5])} goles por partido)`); }
  else if (c.k === "tt") { const mine = c.team === "H" ? H : A, opp = c.team === "H" ? A : H, ab = c.team === "H" ? g.home.abbr : g.away.abbr, ob = c.team === "H" ? g.away.abbr : g.home.abbr, o = c.side === "O";
    R.push(`${two((+avg(mine, x => x[4]) > c.line) === o, (+avg(opp, x => x[5]) > c.line) === o)} ${ab} mete ${avg(mine, x => x[4])} goles por partido; ${ob} recibe ${avg(opp, x => x[5])}`); }
  else if (c.k === "cor") R.push(`Corners esperados: ${(B && B.lc ? B.lc.toFixed(1) : "–")}`);
  else {
    // Result picks: which team we back, how it does at this venue, how the rival does at the other, form, goals, absences, the book
    const side = c.side === "1X" || c.side === "H" ? "H" : c.side === "X2" || c.side === "A" ? "A" : null;
    const T = side === "A" ? g.away : g.home, O = side === "A" ? g.home : g.away, TR = side === "A" ? A : H, OR = side === "A" ? H : A;
    const tv = TR.filter(x => x[3] === (side === "A" ? "a" : "h")).slice(0, 5), ov = OR.filter(x => x[3] === (side === "A" ? "h" : "a")).slice(0, 5);
    const rec = r => { const w = r.filter(x => x[4] > x[5]).length, d = r.filter(x => x[4] === x[5]).length; return {w, d, l: r.length - w - d, n: r.length, t: `${w}G ${d}E ${r.length - w - d}P`}; };
    const needWin = c.k === "1x2" || (c.k === "hc" && c.line < 0), good = r => needWin ? r.w / (r.n || 1) >= 0.5 : (r.w + r.d) / (r.n || 1) >= 0.6, bad = r => needWin ? r.w / (r.n || 1) <= 0.2 : r.l / (r.n || 1) >= 0.5;
    const ok = b => b ? "✅" : "⚠️", where = side === "A" ? "de visitante" : "de local", owhere = side === "A" ? "de local" : "de visitante";
    if (side) {
      const a = rec(tv), b = rec(ov), f1 = rec(TR.slice(0, 5)), f2 = rec(OR.slice(0, 5));
      if (a.n) R.push(`${good(a) ? "✅" : bad(a) ? "⚠️" : "➖"} ${T.abbr} ${where}: ${a.t} (últimos ${a.n})`);
      if (b.n) R.push(`${b.l / b.n >= 0.5 || (needWin && b.w / b.n <= 0.2) ? "✅" : b.w / b.n >= 0.6 ? "⚠️" : "➖"} ${O.abbr} ${owhere}: ${b.t} (últimos ${b.n})`);
      R.push(`${f1.w * 3 + f1.d > f2.w * 3 + f2.d ? "✅" : f1.w * 3 + f1.d < f2.w * 3 + f2.d ? "⚠️" : "➖"} Forma (últimos 5): ${T.abbr} ${f1.t} · ${O.abbr} ${f2.t}`);
      R.push(`${+avg(TR, x => x[4] - x[5]) >= +avg(OR, x => x[4] - x[5]) ? "✅" : "⚠️"} Goles por partido: ${T.abbr} mete ${avg(TR, x => x[4])} y recibe ${avg(TR, x => x[5])} · ${O.abbr} mete ${avg(OR, x => x[4])} y recibe ${avg(OR, x => x[5])}`);
      if (T.record || O.record) R.push(`ℹ️ Temporada (G-E-P): ${T.abbr} ${T.record || "–"} · ${O.abbr} ${O.record || "–"}`);
      const L0 = g.lines || {}, inv = L0.mlHome && L0.draw && L0.mlAway ? 1 / L0.mlHome + 1 / L0.draw + 1 / L0.mlAway : null;
      if (inv) { const pT = (1 / (side === "A" ? L0.mlAway : L0.mlHome)) / inv, pO = (1 / (side === "A" ? L0.mlHome : L0.mlAway)) / inv;
        R.push(`${pT >= pO ? "✅" : "➖"} La casa (plantel, momento, bajas): ${T.abbr} gana ${pct(pT)}, empate ${pct((1 / L0.draw) / inv)}, ${O.abbr} gana ${pct(pO)}`); }
      if (g.xi) { const m = (g.xi[side === "A" ? "a" : "h"] || {}).miss || [], mo = (g.xi[side === "A" ? "h" : "a"] || {}).miss || [];
        R.push(`${m.length >= 3 ? "⚠️" : "✅"} Alineaciones: ${T.abbr} ${m.length ? `sin ${m.length} titulares` : "con su once habitual"} · ${O.abbr} ${mo.length ? `sin ${mo.length} titulares` : "con su once habitual"}`); }
      else if (g.rot && g.rot[side === "A" ? "a" : "h"]) R.push(`⚠️ ${T.abbr} juega Champions en pocos días: posible rotación (revisa alineaciones)`);
    } else R.push(`Forma: ${g.home.abbr} ${form(H)} · ${g.away.abbr} ${form(A)}`);
  }
  if (c.pm != null && c.mk != null) R.push(`${Math.abs(c.pm - c.mk) <= 0.05 ? "✅" : "ℹ️"} Modelo ${pct(c.pm)} · casa ${pct(c.mk)}: ${Math.abs(c.pm - c.mk) <= 0.05 ? "coinciden" : c.pm > c.mk ? "el modelo lo ve un poco más probable que la casa" : "la casa lo ve más probable que el modelo"}`);
  return R.map(t => `   ${esc(t)}`);
}
// Game pick (NBA / NFL): projection vs the line, form and absences
function whyGame(g, m) {
  const fav = m.margin >= 0 ? g.home.abbr : g.away.abbr, L = [];
  L.push(`Proyectamos ${fav} por ~${Math.abs(m.margin).toFixed(1)} pts${g.lines && g.lines.spreadHome != null ? ` (spread de la casa: ${g.home.abbr} ${g.lines.spreadHome})` : ""}`);
  L.push(`Récord: ${g.away.abbr} ${m.A.w}-${m.A.l} (dif. ${m.A.diff >= 0 ? "+" : ""}${m.A.diff.toFixed(1)}) · ${g.home.abbr} ${m.H.w}-${m.H.l} (dif. ${m.H.diff >= 0 ? "+" : ""}${m.H.diff.toFixed(1)})`);
  if (m.H.inj || m.A.inj) L.push(`Bajas: ${[[g.away.abbr, m.A.inj], [g.home.abbr, m.H.inj]].filter(x => x[1]).map(x => `${x[0]} −${x[1]} pts`).join(" · ")}`);
  if (g.rest && (g.rest.h === 1 || g.rest.a === 1)) L.push(`Segunda noche seguida: ${[g.rest.a === 1 ? g.away.abbr : null, g.rest.h === 1 ? g.home.abbr : null].filter(Boolean).join(" y ")}`);
  return L.map(t => `   ${esc(t)}`);
}
/* ---------- short format: the pick in bold and 2-3 short reasons below ---------- */
const SH = {PTS: "pts", REB: "reb", AST: "ast", "3PM": "triples", REC: "rec", RECYDS: "yardas", CAR: "acarreos", RUSHYDS: "yardas", CMP: "pases", PASSYDS: "yardas", RRY: "yardas"};
function shortProp(sp, c, D, g, n) {
  const over = c.s === "over", R = [], add = (w, ok, t) => R.push({w, ok, t});
  if (c.h10 && c.h10[1]) add(3, c.h10[0] / c.h10[1] >= 0.6, `Pegó ${c.h10[0]} de ${c.h10[1]}${c.md10 != null ? ` · lo normal en él: ${c.md10}` : ""}`);
  if (c.chg) add(2, (c.chg > 0) === over, `Este año ${c.chg > 0 ? "+" : "−"}${Math.abs(Math.round(c.chg * 100))}% de ${SH[c.m] || c.m} vs el pasado`);
  const mk = sp === "NFL" && MUK(c), mu = mk && D.mu && D.mu[c.o];
  if (mu && mu.r[mk] != null && (mu.r[mk] <= 10 || mu.r[mk] > 22)) { const top = mu.r[mk] <= 10; add(2, over === top, `${c.o}: de las que ${top ? "más" : "menos"} permiten a ${POSPL[c.pos] || c.pos}`); }
  else if (c.sty && c.m === "PTS") { const z = ["en triples", "dentro del arco", "en tiros libres"], main = c.sty.sh.indexOf(Math.max(...c.sty.sh)), dz = c.sty.def[main] - 1;
    if (Math.abs(dz) >= 0.04) add(2, (dz > 0) === over, `${c.o} ${dz > 0 ? "débil" : "fuerte"} ${z[main]}, donde él anota más`); }
  else if (c.f && Math.abs(c.f - 1) >= 0.04) add(2, (c.f > 1) === over, `${c.o} permite ${c.f > 1 ? "+" : "−"}${Math.abs(Math.round((c.f - 1) * 100))}% de ${SH[c.m] || c.m} a ${POSPL[c.pos] || c.pos}`);
  if (c.vm && c.vm !== 1) { const un = g && g.usage ? (c.h ? g.usage.h : g.usage.a) || [] : [], who = un.map(x => x.replace(/^Sin /, "").replace(/ \(.*$/, "")).slice(0, 2).join(" y ");
    add(3, (c.vm > 1) === over, `${c.vm > 1 ? "Más" : "Menos"} ${sp === "NBA" ? "minutos" : "volumen"}${who ? (c.vm > 1 ? `: no juega ${who}` : `: ${who}`) : ""}`); }
  if (c.us && c.us > 1) add(2, over, "Más tiros por las bajas de su equipo");
  if (c.ctx && c.hx) { const who = c.ctx.who.slice(0, 2).map(n => n.split(" ").slice(-1)[0]).join(" y "), ok = c.hx[0] / c.hx[1] >= 0.5;
    add(3, ok, `Sin ${who} (como hoy): ${c.hx[0]} de ${c.hx[1]} y promedia ${c.ctx.avg} (normal ${c.ctx.all})`); }
  if (c.sf && c.sf !== 1) { const run = ["CAR", "RUSHYDS"].includes(c.m) || (c.m === "RRY" && c.pos === "RB"), fav = c.spr < 0;
    add(2, (c.sf > 1) === over, `${c.t} ${fav ? "favorito" : "underdog"} por ${Math.abs(c.spr)}: ${run ? (fav ? "correrá más" : "correrá menos") : (fav ? "pasará menos" : "pasará más")}`); }
  if (c.pace && c.pace !== 1) add(1, (c.pace > 1) === over, `Partido ${c.pace > 1 ? "rápido" : "lento"} (${c.pace > 1 ? "+" : "−"}${Math.abs(Math.round((c.pace - 1) * 100))}% posesiones)`);
  if (c.ven && c.ven !== 1) add(1, (c.ven > 1) === over, `Rinde ${c.ven > 1 ? "más" : "menos"} ${c.h ? "de local" : "de visita"}`);
  if (c.envAdj >= 0.015 || c.envAdj <= -0.015) add(1, c.envAdj > 0, c.blow && c.envAdj < 0 ? "Riesgo de paliza: menos minutos al final" : `Partido de ${(c.envAdj > 0) === over ? (over ? "muchos" : "pocos") : (over ? "pocos" : "muchos")} puntos`);
  if (c.mv) add(3, c.mv > 0, c.mv > 0 ? "La línea se movió a su favor" : `La línea se movió en contra (abrió en ${c.ol})`);
  if (c.b2b) add(1, !over, "Segunda noche seguida");
  if (c.wind) add(1, !over, `Viento de ${c.wind} mph`);
  // Best supporting reasons first; the strongest warning always shows if there is one
  const pro = R.filter(r => r.ok).sort((a, b) => b.w - a.w), con = R.filter(r => !r.ok).sort((a, b) => b.w - a.w);
  const pick = pro.slice(0, con.length && con[0].w >= 2 ? n - 1 : n).concat(con.length && con[0].w >= 2 ? [con[0]] : []);
  return pick.map(r => `- ${r.ok ? "" : "⚠️ "}${esc(r.t)}`);
}
// Compact reason: one short indented line under the pick (the full reasons live behind 🔍 Más detalle)
const IND = "      ";
const one = (sp, c, D, g) => { const r = shortProp(sp, c, D, g, 3), pro = r.find(x => !x.includes("⚠️")) || r[0]; return pro ? [IND + pro.replace(/^- /, "")] : []; };
const shortPick = (sp, c) => `<b>${esc(c.n)} ${c.s === "over" ? "Over" : "Under"} ${c.l} ${SH[c.m] || c.m}</b> · ${fx(c.p)} · ${pct(c.pr)}${c.q ? " ⚠️ en duda" : ""}`;
// How each team plays (last 10 with box data): shots on target for / against, possession, and goals per shot on target
function styleOf(S, ab) {
  const r = (S.teams[ab] || []).filter(x => !x[8] && x[10] != null).slice(0, 10); if (r.length < 4) return null;
  const a = f => r.reduce((s, x) => s + f(x), 0) / r.length, sotF = a(x => x[10]), sotA = a(x => x[13] || 0), pos = a(x => x[11] || 0), gf = a(x => x[4]);
  return {n: r.length, sotF, sotA, pos, conv: sotF ? gf / sotF : 0};
}
function styleLine(S, g) {
  const tag = (ab, s) => { const t = [];
    if (s.sotF >= 6) t.push("llega mucho"); else if (s.sotF <= 3.5) t.push("llega poco");
    if (s.sotA >= 5.5) t.push("concede mucho"); else if (s.sotA <= 3) t.push("concede poco");
    if (s.conv >= 0.45) t.push("mete casi todo lo que llega (puede bajar)"); else if (s.conv <= 0.2) t.push("falla mucho (puede mejorar)");
    return `${ab} ${s.sotF.toFixed(1)} a puerta, recibe ${s.sotA.toFixed(1)}, ${Math.round(s.pos)}% posesión${t.length ? ` (${t.join(", ")})` : ""}`; };
  const h = styleOf(S, g.home.abbr), a = styleOf(S, g.away.abbr); if (!h && !a) return null;
  return `🧭 ${[h && tag(g.home.abbr, h), a && tag(g.away.abbr, a)].filter(Boolean).join(" · ")}`;
}
function shortSoc(S, g, c, gi) {
  const w = M.socWhy(S.teams, g, c, gi);
  return w.lines.slice(-3).map(t => `- ${t.startsWith("Nuestro modelo solo") ? "⚠️ " : ""}${esc(t)}`);
}

// Game total and "no pick" explanations
function whyTot(g, t) {
  const L = [`Proyectamos ~${t.proj.toFixed(0)} puntos (línea ${t.line}): ${g.home.abbr} ~${t.eh.toFixed(0)} y ${g.away.abbr} ~${t.ea.toFixed(0)}`,
    `Por partido este año: ${g.home.abbr} mete ${t.h.cpf.toFixed(1)} y recibe ${t.h.cpa.toFixed(1)} · ${g.away.abbr} mete ${t.a.cpf.toFixed(1)} y recibe ${t.a.cpa.toFixed(1)}`,
    `Modelo ${pct(t.pm)} al over · casa ${pct(t.mk)}`];
  if (g.rest && (g.rest.h === 1 || g.rest.a === 1)) L.push("Segunda noche seguida para uno de los dos (menos piernas, menos puntos)");
  return L.map(x => `   ${esc(x)}`);
}
function whyNo(g, m) {
  const fav = m.margin >= 0 ? g.home.abbr : g.away.abbr, top = m.opts.slice().sort((a, b) => b.p - a.p)[0];
  return [`   Proyectamos ${esc(fav)} por ~${Math.abs(m.margin).toFixed(1)}${g.lines && g.lines.spreadHome != null ? ` y la casa tiene ${esc(g.home.abbr)} ${g.lines.spreadHome}` : ""}`,
    ...(top ? [`   Lo más probable: ${esc(gameLbl(top.lbl))} con ${pct(top.p)}${top.p >= 0.6 ? `, pero a ${fx(top.price)} paga menos de lo que vale` : " (pedimos 60%)"}`] : [])];
}
function totLine(g, t) {
  if (!t) return [];
  if (t.play) return [`📈 <b>Total</b>: ${esc(t.best.lbl)} · <b>${fx(t.best.price)}</b> · ${pct(t.best.p)}`, ...whyTot(g, t)];
  return [`📈 Total ${t.line}: sin pick${t.far ? " (el modelo y la casa están muy lejos; algo no estamos viendo)" : ` (proyectamos ~${t.proj.toFixed(0)}, ${Math.abs(t.proj - t.line) < 4 ? "casi igual a la línea" : "pero no alcanza el 60%"})`}`];
}
const propLine = (sp, c, i, brief) => brief ? `${i != null ? `${i + 1}. ` : "• "}<b>${esc(c.n)}</b> (${esc(c.t)}) · ${propLbl(sp, c)} · <b>${fx(c.p)}</b> · ${pct(c.pr)}${c.q ? " ⚠️ en duda" : ""}` : `${i != null ? `${i + 1}. ` : "• "}<b>${esc(c.n)}</b> (${esc(c.t)}) · ${propLbl(sp, c)} · <b>${fx(c.p)}</b> · ${pct(c.pr)}${c.q ? " ⚠️ en duda" : ""}` +
  (c.mv === -1 ? `\n   📉 <i>la línea se movió en contra (abrió en ${c.ol})</i>` : c.mv === 1 ? `\n   📈 <i>la línea se movió a favor (abrió en ${c.ol})</i>` : "") + (c.h10 ? `\n   <i>cumplió ${c.h10[0]} de ${c.h10[1]}${c.hc && c.hc[1] ? `, esta temporada ${c.hc[0]} de ${c.hc[1]}` : ""}</i>` : "");

function players(sp, D, now, hours, started = []) {
  const G = Object.fromEntries(D.games.map(g => [g.id, g])), soon = g => g && new Date(g.date) > now && new Date(g.date) - now < hours * 36e5;
  const games = D.games.filter(soon), icon = sp === "NBA" ? "🏀 NBA" : "🏈 NFL";
  if (!games.length && !started.length) return null;
  const cands = D.cands.filter(c => soon(G[c.g])), top = M.topPicks(cands, sp), cfg = M.CFG[sp];
  const model = g => D.teams[g.home.abbr] && D.teams[g.away.abbr] ? M.gameModel(g, {...cfg, teams: D.teams, outs: D.outs || {}}) : null;
  const prob = M.probables(cands, sp, Math.max(4, 8 - top.length), top);
  const topTxt = [`<b>${icon} · picks de hoy</b>`, "", ...(top.length ? top.flatMap(c => [`✅ ${shortPick(sp, c)}`, ...one(sp, c, D, G[c.g])]) : ["Hoy ninguno llega a sólido."]),
    ...(prob.length ? ["", ...prob.flatMap(c => [`🟡 ${shortPick(sp, c)}`, ...one(sp, c, D, G[c.g])])] : []), "", "<i>✅ sólido · 🟡 paga lo justo</i>"];
  const pl = parlay(top);
  if (pl) topTxt.push("", `<b>Parlay más sólido</b>: ${pl.legs.map(c => `${esc(c.n)} ${propLbl(sp, c)}`).join(" + ")} · ${fx(pl.legs[0].p * pl.legs[1].p)} · ${pct(pl.p)}`);
  const mlRows = [], gameList = [], mlBets = [], topBets = top.concat(prob).map(c => propBet(sp, c, G[c.g].date));
  for (const g of games) {
    const m = model(g), tag = `${g.away.abbr} @ ${g.home.abbr}`;
    if (m && m.play) mlBets.push(gameBet(sp, g, m.best));
    if (m && m.tot && m.tot.play) { mlBets.push(gameBet(sp, g, m.tot.best)); mlRows.push(`📈 ${esc(tag)} (${hora(g.date)}): <b>Total ${esc(m.tot.best.lbl)}</b> · ${fx(m.tot.best.price)} · ${pct(m.tot.best.p)}`); }
    if (m && m.play) mlRows.push(`🎯 ${esc(tag)} (${hora(g.date)}): <b>${esc(gameLbl(m.best.lbl))}</b> · ${fx(m.best.price)} · ${pct(m.best.p)}`);
    const props = []; const seen = new Set();
    for (const c of D.cands.filter(c => c.g === g.id && !M.fails(c, sp)).sort((a, b) => M.score(b, sp) - M.score(a, sp))) { if (seen.has(c.aid)) continue; seen.add(c.aid); props.push(c); if (props.length === 8) break; }
    const L = [`<b>${esc(g.away.name)} @ ${esc(g.home.name)}</b>`, hora(g.date), ""];
    if (m && m.play) L.push(`🎯 <b>Pick de partido</b>${m.tier === "fair" ? " 🟡 paga lo justo" : ""}: ${esc(gameLbl(m.best.lbl))} · <b>${fx(m.best.price)}</b> · ${pct(m.best.p)}`, ...whyGame(g, m));
    else if (m) L.push(`🎯 Sin pick sólido de ML o spread`, ...whyNo(g, m));
    if (m) L.push(...totLine(g, m.tot));
    if (m && m.value) L.push(`💸 Opción de valor (arriesgada): ${esc(gameLbl(m.value.lbl))} · ${fx(m.value.price)} · ${pct(m.value.p)}`);
    const L0 = g.lines || {}; if (L0.total) L.push(`Total ${L0.total} · ML ${g.away.abbr} ${fx(L0.mlAway)} / ${g.home.abbr} ${fx(L0.mlHome)}`);
    const outs = (g.inj || []).filter(i => i[2] === "Out").map(i => `${i[1]} (${i[0]})`);
    if (outs.length) L.push(`Fuera: ${esc(outs.join(", "))}`);
    L.push("", props.length ? `<b>Props sólidos (${props.length})</b>` : "Ningún prop de este partido pasa los filtros. Mejor no forzarlo.", ...props.flatMap(c => [propLine(sp, c, null, true), ...whyProp(sp, c, D, g, 4)]));
    // Short version (what the bot shows) and the long one behind "🔍 Más detalle"
    const S0 = [`<b>${esc(g.away.abbr)} @ ${esc(g.home.abbr)}</b> · ${hora(g.date)}`, ""];
    if (m) { const fav = m.margin >= 0 ? g.home.abbr : g.away.abbr, mg = Math.abs(m.margin).toFixed(0), sl = L0.spreadHome != null ? ` (casa: ${g.home.abbr} ${L0.spreadHome})` : "";
      if (m.play) S0.push(`🎯 <b>${esc(gameLbl(m.best.lbl))}</b> · ${fx(m.best.price)} · ${pct(m.best.p)}`, `${IND}Proyectamos ${esc(fav)} por ~${mg}${sl}`);
      else S0.push(`🎯 Sin pick de ML/spread <i>(proyectamos ${esc(fav)} por ~${mg}${sl})</i>`);
      if (m.tot && m.tot.play) S0.push(`📈 <b>Total ${esc(m.tot.best.lbl)}</b> · ${fx(m.tot.best.price)} · ${pct(m.tot.best.p)}`, `${IND}Proyectamos ~${m.tot.proj.toFixed(0)} puntos`); }
    { const bl = bestLine(g); if (bl) L.push(bl); }
    if (props.length) S0.push("", ...props.flatMap(c => [`✅ ${shortPick(sp, c)}`, ...one(sp, c, D, g)]));
    if (outs.length) S0.push("", `<i>Fuera: ${esc(outs.slice(0, 3).map(x => x.replace(/ \(.*$/, "")).join(", "))}${outs.length > 3 ? ` y ${outs.length - 3} más` : ""}</i>`);
    gameList.push({id: g.id, d: g.date, tl: L.join("\n"), solid: !!((m && m.play) || (m && m.tot && m.tot.play) || props.length), b: `${g.away.abbr} @ ${g.home.abbr} · ${new Date(g.date).toLocaleTimeString("es-MX", {hour: "numeric", minute: "2-digit", timeZone: TZ})}`, t: S0.join("\n"),
      bets: [...(m && m.play ? [gameBet(sp, g, m.best)] : []), ...(m && m.tot && m.tot.play ? [gameBet(sp, g, m.tot.best)] : []), ...props.map(c => propBet(sp, c, g.date))],
      chk: {sp: sp.toLowerCase(), h: g.home.abbr, a: g.away.abbr, outs: (g.inj || []).filter(i => i[2] === "Out").map(i => i[1]), props: props.map(c => ({aid: c.aid, n: c.n, lbl: propLbl(sp, c)}))}});
  }
  // Search: every player with props in these games (solid or not, with the reason) and every team
  const byP = {}; for (const c of cands) (byP[c.aid] = byP[c.aid] || []).push(c);
  const find = Object.values(byP).map(list => {
    const c0 = list[0], g = G[c0.g], sorted = list.slice().sort((a, b) => M.score(b, sp) - M.score(a, sp)), L = [`<b>${esc(c0.n)}</b> (${esc(c0.t)}) · ${esc(g.away.abbr)} @ ${esc(g.home.abbr)} · ${hora(g.date)}`, ""];
    for (const c of sorted) { const why = M.fails(c, sp);
      if (!why) L.push(shortPick(sp, c), ...shortProp(sp, c, D, g, 3));
      else L.push(`▫️ ${propLbl(sp, c)} · ${fx(c.p)} · ${pct(c.pr)} <i>(no entra: ${esc(why)})</i>`); }
    if (!sorted.some(c => !M.fails(c, sp))) L.push("", "<i>Hoy ninguno de sus props pasa los filtros.</i>");
    return {n: c0.n, t: c0.t, sp: sp.toLowerCase(), aid: c0.aid, txt: L.join("\n"), refs: sorted.filter(c => c.p).map(c => propBet(sp, c, g.date))};
  });
  const teams = games.map(g => ({names: [g.home.abbr, g.home.name, g.away.abbr, g.away.name], key: `${sp.toLowerCase()}:g:${g.id}`, b: `${g.away.abbr} @ ${g.home.abbr}`}));
  const mlTxt = [`<b>${icon} · Picks de partido (ML, spread y total)</b>`, "", ...(mlRows.length ? mlRows : [games.length ? "Ningún partido por jugar tiene un pick sólido de ML, spread o total." : "No quedan partidos por empezar."]), ...startedLines(started.filter(x => x.kind === "game"), now)];
  topTxt.push(...startedLines(started.filter(x => x.kind === "prop"), now));
  return {top: topTxt.join("\n"), ml: mlTxt.join("\n"), all: [topTxt.join("\n"), mlTxt.join("\n")].join("\n\n"), games: gameList, bets: {top: topBets, ml: mlBets, all: [...topBets, ...mlBets]}, find, teams};
}

// One day of soccer: the matches still to play that day, plus (today) the picks already started with their status
const dlocMx = iso => new Date(iso).toLocaleDateString("en-CA", {timeZone: TZ});
const stIcon = (x, now) => x.res ? (x.res.hit === 1 ? "✅" : x.res.hit === 0 ? "❌" : "➖") : now - new Date(x.d) < 2.5 * 36e5 ? "⏳" : "🕓";
const startedLines = (list, now) => list.length ? ["", "<b>Ya empezaron</b>", ...list.map(x => `${stIcon(x, now)} ${esc(x.n)} · ${esc(x.lbl)}${x.res && x.res.act != null ? ` (${esc(x.res.act)})` : ""} · ${x.p ? fx(x.p) : "—"}`)] : [];
// Soccer compact: badge (how it is backed) + pick in bold, and one short reason
const BADGE = {ok: "✅", form: "📈", market: "⚠️", far: "⚠️"};
const up1Price = pr => +(1 / (pr * 1.06)).toFixed(2); // estimated book price for a 1 Up (usual ~6% margin)
function brief(S, g, c, gi) {
  const w = M.socWhy(S.teams, g, c, gi), rows = ab => (S.teams[ab] || []).filter(r => !r[8]).slice(0, 10);
  let t = "";
  if (c.k === "pshot" || c.k === "psot") t = `${c.ph[0]} de sus últimos ${c.ph[1]}${c.md != null ? ` · normal: ${c.md}` : ""}`;
  else if (c.k === "pgoal") t = `${c.gl} goles en sus últimos ${c.ph[1]}`;
  else { const side = c.k === "up1" || c.k === "1x2" || c.k === "dc" || c.k === "dc1h" ? (c.side === "1X" || c.side === "H" ? "H" : c.side === "X2" || c.side === "A" ? "A" : null) : null;
    if (side) { const T = side === "H" ? g.home.abbr : g.away.abbr, O = side === "H" ? g.away.abbr : g.home.abbr, TR = rows(T), OR = rows(O);
      const w2 = TR.filter(x => x[4] > x[5]).length, l2 = OR.filter(x => x[4] < x[5]).length, nl = TR.filter(x => x[4] < x[5]).length;
      t = c.k === "dc" || c.k === "dc1h" ? `${T} sin perder en ${TR.length - nl} de ${TR.length}` : `${T} ganó ${w2} de ${TR.length}`; 
      if (c.k === "up1") t += ` · anotó en ${TR.filter(x => x[4] > 0).length}`; }
    else if (c.k === "btts") { const f = x => x[4] > 0 && x[5] > 0, a = rows(g.home.abbr), b = rows(g.away.abbr); t = `anotaron ambos: ${a.filter(f).length}/${a.length} ${g.home.abbr} · ${b.filter(f).length}/${b.length} ${g.away.abbr}`; }
    else t = (w.lines.find(x => !x.startsWith("Nuestro modelo") && !x.startsWith("Con pago")) || w.lines[0] || "").replace(/ por partido/g, ""); }
  if (c.early >= 0.005) t += ` · anticipado +${Math.round(c.early * 100)}`;
  if (w.back === "market") t += " · lo sostiene el mercado"; if (w.back === "far") t += " · el modelo ve de más";
  return {t, b: BADGE[w.back] || "•", back: w.back};
}
function soccer(S, now, hours, day, started = []) {
  const games = S.games.filter(g => new Date(g.date) > now && dlocMx(g.date) === day);
  if (!games.length && !started.length) return null;
  const B = M.buildSoccer(S), G = Object.fromEntries(S.games.map(g => [g.id, g])), GM = Object.fromEntries(B.games.map(x => [x.id, x]));
  const FLAG = {"Liga MX": "🇲🇽", "La Liga": "🇪🇸", Premier: "🏴", Bundesliga: "🇩🇪", "Serie A": "🇮🇹", "Ligue 1": "🇫🇷", Champions: "⭐", Europa: "🟠"};
  const short = l => l.replace(" tiros a puerta", " a puerta").replace("Ambos anotan: Sí", "Ambos anotan");
  const row = c => { const g = G[c.g], br = brief(S, g, c, GM[g.id]); return [`${br.b} <b>${esc(short(c.lbl))}</b> · ${c.p ? (c.est ? "≈" : "") + fx(c.p) : "sin momio"} · ${pct(c.pr)}`, `   ↳ ${esc(br.t)}`].join("\n"); };
  // Picks grouped by match (best match first), each match with its header
  const byGame = (list, flag) => { const ord = [], m = {}; for (const c of list) { if (!m[c.g]) { m[c.g] = []; ord.push(c.g); } m[c.g].push(c); }
    ord.sort((x, y) => new Date(G[x].date) - new Date(G[y].date)); // by kick-off time
    return ord.flatMap((id, i) => { const g = G[id]; return [...(i ? [""] : []), `${flag ? (FLAG[g.lg] || "⚽") + " " : "🕐 "}<b>${esc(g.away.abbr)} @ ${esc(g.home.abbr)}</b> · ${hora(g.date).replace(/^\S+ /, "")}`, ...m[id].sort((x, y) => (M.isPl(x) - M.isPl(y)) || y.pr - x.pr).map(row)]; }); };
  const backed = c => !["market", "far"].includes(brief(S, G[c.g], c, GM[c.g]).back);
  const out = {top: null, leagues: []};
  const inDay = c => G[c.g] && games.includes(G[c.g]);
  // Probables: the backed picks of every match (up to 2 per match) that are not already solid
  const probOf = (gs, skip, n) => { const pool = gs.flatMap(g => M.socGamePicks(B.cands.filter(c => c.g === g.id), GM[g.id]).filter(x => x.c && !skip.includes(x.c)).slice(0, 2).map(x => x.c));
    return pool.filter(backed).sort((a, b) => b.pr - a.pr).slice(0, n); };
  const tierTxt = (title, top, prob, emptyMsg, flag) => [title, "", ...byGame([...top, ...prob], flag), ...(!top.length && !prob.length ? [emptyMsg] : ["", "<i>✅ nuestros números · 📈 la racha · 🔍 detalle en cada partido</i>"])];
  const top = M.socTop(B.cands.filter(inDay), G, null, 10).filter(backed), prob = probOf(games, top, Math.max(5, 10 - top.length));
  out.topBets = top.concat(prob).map(c => socBet(G[c.g], c));
  out.top = [...tierTxt(`<b>⚽ Soccer · Top</b>`, top, prob, games.length ? "Ningún partido por jugar tiene un pick respaldado." : "No quedan partidos por empezar.", true), ...startedLines(started, now)].join("\n");
  for (const [lg, code] of Object.entries(LG)) {
    const gs = games.filter(g => g.lg === lg), st = started.filter(x => x.lg === lg); if (!gs.length && !st.length) continue;
    const lt = M.socTop(B.cands.filter(c => inDay(c) && G[c.g].lg === lg), G, lg, 10).filter(backed);
    const gameList = gs.map(g => {
      const m = GM[g.id], ok = B.cands.filter(c => c.g === g.id && M.socOk(c)).sort((a, b) => (!!b.p - !!a.p) || M.socScore(b) - M.socScore(a)).slice(0, 5);
      const L = [`<b>${esc(g.away.name)} @ ${esc(g.home.name)}</b>`, `${lg} · ${hora(g.date)}`, ""];
      // One pick per match: solid, or the most likely fair one, or a clear 1 Up
      // Same main pick as the app: the 🛡️ safest one first when there is one
      const gps0 = M.socGamePicks(B.cands.filter(c => c.g === g.id), m), sf = M.socSafe(B.cands.filter(c => c.g === g.id), m, g)[0];
      const gps = sf ? [{c: sf, tier: "solid"}, ...gps0.filter(x => x.c !== sf)] : gps0, extras = gps.slice(1).map(x => x.c).filter(Boolean).slice(0, 3);
      const gp = gps[0] || null, best = gp && gp.c, TIER = {solid: "✅ Pick sólido", fair: "🟡 Pick del partido", up1: "🟡 Pick del partido"};
      const upTxt = gp && gp.up1 ? `1 Up ${gp.up1.side === "H" ? g.home.abbr : g.away.abbr} · ${pct(gp.up1.pr)} · momio estimado ≈${fx(up1Price(gp.up1.pr))} (conviene desde ${fx(1 / gp.up1.pr)})` : null;
      if (gp) L.push(`🎯 <b>${TIER[gp.tier]}</b>: ${best ? `${esc(best.lbl)} · <b>${(best.est ? "≈" : "") + fx(best.p)}</b> · ${pct(best.pr)}` : esc(upTxt)}`,
        ...(gp.tier === "fair" ? ["   <i>Es lo más probable del partido; paga lo justo (la casa se queda su comisión normal), no tiene valor extra.</i>"] : gp.tier === "up1" ? ["   <i>Momio estimado: la fuente no publica el 1 Up. Si tu casa paga más que el estimado, mejor.</i>"] : []));
      else L.push("🎯 Sin pick: ninguna opción llega a 62% con un pago decente, o el modelo y la casa no coinciden.");
      if (best) L.push(...whySoc(S, g, best, m));
      const others = ok.filter(c => c !== best && c.p); if (others.length) L.push("", "<b>Otras opciones</b>", ...others.flatMap(c => [`• ${esc(c.lbl)} · ${c.p ? (c.est ? "≈" : "") + fx(c.p) : "sin momio"} · ${pct(c.pr)}`, ...whySoc(S, g, c, m).slice(0, 2)]));
      if (m) L.push("", "<b>1 Up</b> (compáralo en tu casa)", `• ${esc(g.home.abbr)}: ${pct(m.up1H)} · conviene si paga ${fx(1 / m.up1H)} o más`, `• ${esc(g.away.abbr)}: ${pct(m.up1A)} · conviene si paga ${fx(1 / m.up1A)} o más`);
      const L0 = g.lines || {}; if (L0.mlHome) L.push("", `1X2: ${g.home.abbr} ${fx(L0.mlHome)} · empate ${fx(L0.draw)} · ${g.away.abbr} ${fx(L0.mlAway)}${L0.total ? ` · goles ${L0.total}` : ""}`);
      { const sty = styleLine(S, g); if (sty) L.push("", esc(sty)); }
      if (g.xi) L.push(`📋 Alineaciones confirmadas: ${["h", "a"].filter(k => g.xi[k]).map(k => { const t = g[k === "h" ? "home" : "away"].abbr, m = g.xi[k].miss; return m.length ? `${t} sin ${m.length} titular${m.length > 1 ? "es" : ""} habitual${m.length > 1 ? "es" : ""} (${esc(m.join(", "))})` : `${t} con su once habitual`; }).join("; ")}. Ya entra en el modelo.`);
      else if (g.rot) L.push(`⚠️ ${["h", "a"].filter(k => g.rot[k]).map(k => `${g[k === "h" ? "home" : "away"].abbr} ${g.rot[k].next != null ? `juega Champions en ${g.rot[k].next} días (posible rotación)` : "viene de jugar Champions"}`).join("; ")}. Revisa alineaciones con ↻ Actualizar en la app antes de apostar.`);
      const S1 = [`<b>${esc(g.away.abbr)} @ ${esc(g.home.abbr)}</b> · ${lg} · ${hora(g.date)}`, ""];
      const line = (c, lbl, price) => { const br = brief(S, g, c, m); return [`${br.b} <b>${esc(lbl.replace(" tiros a puerta", " a puerta").replace("Ambos anotan: Sí", "Ambos anotan"))}</b> · ${price} · ${pct(c.pr)}`, `   ↳ ${esc(br.t)}`]; };
      if (best) S1.push(...line(best, best.lbl, (best.est ? "≈" : "") + fx(best.p)));
      else if (gp && gp.up1) { const ab = gp.up1.side === "H" ? g.home.abbr : g.away.abbr; S1.push(...line({k: "up1", side: gp.up1.side, pr: gp.up1.pr}, `1 Up ${ab}`, `≈${fx(up1Price(gp.up1.pr))}`)); }
      else S1.push("Sin pick: nada llega a 62% con un pago decente.");
      if (extras.length) S1.push("", ...extras.flatMap(c => line(c, c.lbl, fx(c.p))));
      if (m && !(gp && gp.up1)) { const s1 = m.up1H >= m.up1A ? "H" : "A", p1 = s1 === "H" ? m.up1H : m.up1A; if (p1 >= 0.6) S1.push("", `<i>1 Up ${esc(s1 === "H" ? g.home.abbr : g.away.abbr)}: ${pct(p1)} · ≈${fx(up1Price(p1))}</i>`); }
      if (g.xi) { const miss = ["h", "a"].filter(k => g.xi[k] && g.xi[k].miss.length).map(k => { const x = g.xi[k], real = x.miss.length - (x.depth || 0); return `${g[k === "h" ? "home" : "away"].abbr} ${x.miss.length} cambios${x.depth ? ` (${x.depth} de rotación normal${real > 0 ? `, ${real} de suplentes` : ""})` : ""}`; }); S1.push(`📋 ${miss.length ? miss.join(" · ") : "Onces habituales"}`); }
      else if (g.rot) S1.push("⚠️ Posible rotación: revisa alineaciones");
      { const bl = bestLine(g); if (bl) L.push(bl); }
      const meta = S.meta || {}, reg = ab => ((meta[ab] || {}).reg || []).map(x => [x[0], x[1]]);
      const sb = [...new Set([...(best ? [best] : []), ...extras, ...ok.filter(c => c.p)])].map(c => socBet(g, c));
      return {id: g.id, d: g.date, solid: !!gp, tl: L.join("\n"), bets: sb, cmp: [...sb, ...(m ? [up1Bet(g, "H", m.up1H), up1Bet(g, "A", m.up1A)] : [])], b: `${g.away.abbr} @ ${g.home.abbr} · ${new Date(g.date).toLocaleString("es-MX", {weekday: "short", hour: "numeric", minute: "2-digit", timeZone: TZ})}`, t: S1.join("\n"),
        chk: {sp: "soc", slug: g.slug, h: g.home.abbr, a: g.away.abbr, pick: best ? {lbl: best.lbl, team: best.team || (best.side === "H" || best.side === "1X" ? "H" : best.side === "A" || best.side === "X2" ? "A" : null)} : null, xi: {h: reg(g.home.abbr), a: reg(g.away.abbr)}, lineups: !!g.xi}};
    });
    const lp = probOf(gs, lt, Math.max(5, 10 - lt.length));
    out.leagues.push({code, lg, topBets: lt.concat(lp).map(c => socBet(G[c.g], c)), top: [...tierTxt(`<b>⚽ ${lg} · mejores picks</b>`, lt, lp, gs.length ? "Ningún partido por jugar tiene un pick respaldado." : "No quedan partidos por empezar."), ...startedLines(st, now)].join("\n"), games: gameList, started: st.length});
  }
  out.teams = games.map(g => ({names: [g.home.abbr, g.home.name, g.away.abbr, g.away.name], key: `soc:g:${g.id}`, b: `${g.away.abbr} @ ${g.home.abbr}`}));
  return out;
}

// Record per sport, split by kind of pick: last graded day, last 7 days and everything kept
function record(R) {
  const days = (R.days || []).filter(d => d.items.some(x => x.hit === 0 || x.hit === 1)); if (!days.length) return "Todavía no hay resultados calificados.";
  const NAME = {NBA: "🏀 NBA", NFL: "🏈 NFL", SOC: "⚽ Soccer"}, SK = {"1x2": "resultado", dc: "doble oport.", dc1h: "doble oport. 1T", hc: "handicap", tot: "goles", btts: "ambos anotan", cor: "corners", tt: "goles por equipo"};
  const kind = x => x.kind === "prop" ? "Props de jugadores" : x.kind === "game" ? (x.bet === "sp" ? "Spread" : x.bet === "tot" ? "Total (over/under)" : "ML") : (s => s[0].toUpperCase() + s.slice(1))(SK[x.k] || "otros");
  const fmt = arr => { const d = arr.filter(x => x.hit === 0 || x.hit === 1), w = d.filter(x => x.hit).length, u = d.reduce((s, x) => s + (x.hit ? (x.p || 1.91) - 1 : -1), 0); return {d, w, u, txt: `${w}/${d.length}`}; };
  const block = (title, items) => {
    const L = [`<b>${title}</b>`]; let any = false;
    for (const sp of ["NBA", "NFL", "SOC"]) {
      const it = items.filter(x => x.sport === sp), t = fmt(it); if (!t.d.length) continue; any = true;
      const by = {}; t.d.forEach(x => (by[kind(x)] = by[kind(x)] || []).push(x));
      const ORDER = ["Props de jugadores", "Spread", "ML", "Total (over/under)"], rank = k => ORDER.includes(k) ? ORDER.indexOf(k) : 3;
      L.push(`${NAME[sp]} <b>${t.txt}</b> · ${t.u >= 0 ? "+" : ""}${t.u.toFixed(1)} u`);
      Object.entries(by).sort((a, b) => rank(a[0]) - rank(b[0]) || b[1].length - a[1].length).forEach(([k, a]) => L.push(`   ${k} ${fmt(a).txt}`));
      L.push("");
    }
    const all = fmt(items); if (any) L.push(`<i>Todo junto: ${all.txt} · ${all.u >= 0 ? "+" : ""}${all.u.toFixed(1)} u</i>`);
    return any ? L.join("\n") : null;
  };
  const day = days[0], when = d => new Date(d + "T12:00:00").toLocaleDateString("es-MX", {day: "numeric", month: "short"});
  const flat = ds => ds.flatMap(d => d.items), last7 = days.filter(d => (new Date(day.date) - new Date(d.date)) / 864e5 < 7), oldest = days[days.length - 1].date;
  const safeAll = flat(days).filter(x => x.safe), sf = fmt(safeAll);
  return ["<b>📊 Cómo nos fue</b>", ...(sf.d.length ? ["", `<b>🛡️ Más seguros: ${sf.txt}</b> · ${sf.u >= 0 ? "+" : ""}${sf.u.toFixed(1)} u <i>(desde que existe la sección)</i>`] : []), "", block(`Último día (${when(day.date)})`, day.items), "", block("Últimos 7 días", flat(last7)), ...(days.length > last7.length ? ["", block(`Desde el ${when(oldest)}`, flat(days))] : []),
    "", "<i>u = unidades: 1 por pick con el momio de DraftKings.</i>"].filter(x => x != null).join("\n");
}

// Soccer record by league (last 7 days and everything), each with its markets
function recordSoc(R) {
  const days = (R.days || []).filter(d => d.items.some(x => x.sport === "SOC" && (x.hit === 0 || x.hit === 1))); if (!days.length) return "Todavía no hay resultados de soccer calificados.";
  const FLAG = {"Liga MX": "🇲🇽", "La Liga": "🇪🇸", Premier: "🏴", Bundesliga: "🇩🇪", "Serie A": "🇮🇹", "Ligue 1": "🇫🇷", Champions: "⭐", Europa: "🟠"};
  const SK = {"1x2": "Resultado", dc: "Doble oport.", dc1h: "Doble oport. 1T", hc: "Handicap", tot: "Goles", btts: "Ambos anotan", cor: "Corners", tt: "Goles por equipo"};
  const fmt = arr => { const w = arr.filter(x => x.hit).length, u = arr.reduce((s, x) => s + (x.hit ? (x.p || 1.91) - 1 : -1), 0); return {w, n: arr.length, u}; };
  const block = (title, items) => {
    const L = [`<b>${title}</b>`], by = {}; items.forEach(x => (by[x.lg || "Otra"] = by[x.lg || "Otra"] || []).push(x));
    for (const [lg, a] of Object.entries(by).sort((p, q) => q[1].length - p[1].length)) {
      const t = fmt(a); L.push(`${FLAG[lg] || "⚽"} ${lg} <b>${t.w}/${t.n}</b> · ${t.u >= 0 ? "+" : ""}${t.u.toFixed(1)} u`);
      const bm = {}; a.forEach(x => (bm[SK[x.k] || "Otros"] = bm[SK[x.k] || "Otros"] || []).push(x));
      Object.entries(bm).sort((p, q) => q[1].length - p[1].length).forEach(([k, b]) => { const m = fmt(b); L.push(`   ${k} ${m.w}/${m.n}`); });
      L.push("");
    }
    return L.join("\n");
  };
  const done = x => x.sport === "SOC" && (x.hit === 0 || x.hit === 1), flat = ds => ds.flatMap(d => d.items.filter(done));
  const last7 = days.filter(d => (new Date(days[0].date) - new Date(d.date)) / 864e5 < 7), when = d => new Date(d + "T12:00:00").toLocaleDateString("es-MX", {day: "numeric", month: "short"});
  return ["<b>⚽ Soccer por liga</b>", "", block("Últimos 7 días", flat(last7)), ...(days.length > last7.length ? [block(`Desde el ${when(days[days.length - 1].date)}`, flat(days))] : []),
    "<i>Ojo: hasta el 2 de nov los picks de soccer eran del modelo anterior.</i>"].join("\n");
}

// Charts for "Cómo nos fue" (rendered by quickchart.io from the URL; Telegram downloads the image)
function charts(R) {
  const days = (R.days || []).filter(d => d.items.some(x => x.hit === 0 || x.hit === 1)).slice(0, 14).reverse(); if (!days.length) return null;
  const done = x => x.hit === 0 || x.hit === 1, items = days.flatMap(d => d.items.filter(done).map(x => ({...x, date: d.date})));
  const groups = [["NBA props", x => x.sport === "NBA" && x.kind === "prop"], ["NBA ML/spread", x => x.sport === "NBA" && x.kind === "game"], ["NFL props", x => x.sport === "NFL" && x.kind === "prop"], ["NFL ML/spread", x => x.sport === "NFL" && x.kind === "game"], ["Soccer", x => x.sport === "SOC"]]
    .map(([n, f]) => { const a = items.filter(f), w = a.filter(x => x.hit).length; return {n, a, w}; }).filter(g => g.a.length);
  const url = (c, w = 640, h = 380) => `https://quickchart.io/chart?w=${w}&h=${h}&bkg=white&c=${encodeURIComponent(JSON.stringify(c))}`;
  const bar = {type: "horizontalBar", data: {labels: groups.map(g => `${g.n} (${g.w}/${g.a.length})`), datasets: [{data: groups.map(g => Math.round(g.w / g.a.length * 100)),
    backgroundColor: groups.map(g => g.w / g.a.length >= 0.55 ? "#2e9e5b" : g.w / g.a.length >= 0.5 ? "#e0a020" : "#d9534f")}]},
    options: {layout: {padding: {right: 40}}, legend: {display: false}, title: {display: true, text: `% de acierto · últimos ${days.length} días`, fontSize: 16},
      scales: {xAxes: [{ticks: {min: 0, max: 100, callback: "(v) => v + '%'"}}]}, plugins: {datalabels: {anchor: "end", align: "end", color: "#333", formatter: "(v) => v + '%'"}}}};
  const SP = [["NBA", "#d9561a"], ["NFL", "#2f6fb3"], ["SOC", "#2e9e5b"]], lbl = days.map(d => new Date(d.date + "T12:00:00").toLocaleDateString("es-MX", {day: "numeric", month: "short"}));
  const line = {type: "line", data: {labels: lbl, datasets: SP.filter(([sp]) => items.some(x => x.sport === sp)).map(([sp, col]) => { let acc = 0;
    return {label: sp === "SOC" ? "Soccer" : sp, fill: false, lineTension: 0, pointRadius: 4, borderColor: col, backgroundColor: col, data: days.map(d => { d.items.filter(x => x.sport === sp && done(x)).forEach(x => acc += x.hit ? (x.p || 1.91) - 1 : -1); return +acc.toFixed(2); })}; })},
    options: {plugins: {datalabels: {display: false}}, title: {display: true, text: "Unidades acumuladas (1 u por pick)", fontSize: 16}, scales: {yAxes: [{ticks: {callback: "(v) => (v > 0 ? '+' : '') + v + ' u'"}}]}}};
  // Functions as strings are evaluated by quickchart
  const fix = s => s.replace(/"\((v)\) => ([^"]*)"/g, (m, a, b) => `(v) => ${b.replace(/\\'/g, "'")}`);
  return [url(bar).replace(/c=.*/, m => "c=" + encodeURIComponent(fix(JSON.stringify(bar)))), url(line).replace(/c=.*/, m => "c=" + encodeURIComponent(fix(JSON.stringify(line))))];
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

// Soccer split by day (today first); today's lists keep the picks already started, with their status
function socDays(S, now, snap) {
  const d0 = dlocMx(now.toISOString()), keys = [...new Set(S.games.filter(g => new Date(g.date) > now && new Date(g.date) - now < 4 * 864e5).map(g => dlocMx(g.date)))].sort();
  if (!keys.includes(d0)) keys.unshift(d0);
  const started = ((snap && snap.items) || []).filter(x => x.sport === "SOC" && new Date(x.d) <= now);
  const lbl = k => { const n = Math.round((new Date(k + "T12:00:00Z") - new Date(d0 + "T12:00:00Z")) / 864e5); return n === 0 ? "Hoy" : n === 1 ? "Mañana" : new Date(k + "T12:00:00Z").toLocaleDateString("es-MX", {weekday: "long", day: "numeric", timeZone: "UTC"}); };
  const days = keys.map(k => { const s = soccer(S, now, 96, k, k === d0 ? started : []); return s ? {key: k, lbl: lbl(k), ...s} : null; }).filter(Boolean);
  return days.length ? {days, teams: days.flatMap(d => d.teams || [])} : null;
}

// Today's picks including the ones already started, with their status
function today(snap, now) {
  const it = (snap && snap.items) || []; if (!it.length) return "Todavía no hay picks de hoy.";
  const NAME = {NBA: "🏀 NBA", NFL: "🏈 NFL", SOC: "⚽ Soccer"}, st = x => x.res ? (x.res.hit === 1 ? "✅" : x.res.hit === 0 ? "❌" : "➖") : new Date(x.d) > now ? "🔜" : now - new Date(x.d) < 3.5 * 36e5 ? "⏳" : "🕓";
  const L = ["<b>📋 Picks de hoy</b>", "<i>🔜 por empezar · ⏳ en juego · 🕓 por calificar · ✅ / ❌</i>"];
  for (const sp of ["NBA", "NFL", "SOC"]) { const a = it.filter(x => x.sport === sp).sort((x, y) => x.d < y.d ? -1 : 1); if (!a.length) continue;
    const d = a.filter(x => x.res && (x.res.hit === 0 || x.res.hit === 1)), w = d.filter(x => x.res.hit).length;
    L.push("", `<b>${NAME[sp]}</b>${d.length ? ` · van ${w} de ${d.length}` : ""}`, ...a.map(x => `${st(x)} ${esc(x.n)} · ${esc(x.lbl)} · ${x.p ? fx(x.p) : "—"}${x.res && x.res.act != null ? ` (${esc(x.res.act)})` : ` · ${hora(x.d)}`}`)); }
  return L.join("\n");
}

// 🛡️ Safest picks of the next ~30 hours (soccer + NBA), with their reasons and the best 2- and 3-leg parlays
function safeView(latest, now) {
  const soon = d => new Date(d) > now && new Date(d) - now < 30 * 36e5, list = [];
  const S = latest.soc; if (S && S.games.length) { const B = M.buildSoccer(S), GM = Object.fromEntries(B.games.map(x => [x.id, x]));
    for (const g of S.games.filter(g => soon(g.date))) for (const c of M.socSafe(B.cands.filter(c => c.g === g.id), GM[g.id], g)) {
      const w = M.socWhy(S.teams, g, c, GM[g.id]), br = brief(S, g, c, GM[g.id]);
      list.push({...c, sport: "SOC", g: g.id, d: g.date, head: `${g.lg === "Europa" ? "🟠" : g.lg === "Champions" ? "⭐" : "⚽"} ${g.away.abbr} @ ${g.home.abbr} · ${hora(g.date)}`, lbl: c.lbl, why: [br.t, w.lines.find(x => x.startsWith("Nuestro modelo"))].filter(Boolean), bet: socBet(g, c)}); } }
  const D = latest.nba; if (D && D.cands) { const G = Object.fromEntries(D.games.map(g => [g.id, g])), per = new Set();
    for (const c of M.nbaSafe(D.cands.filter(c => G[c.g] && soon(G[c.g].date)))) { if (per.has(c.aid) || per.size >= 6) continue; per.add(c.aid); const g = G[c.g];
      list.push({...c, sport: "NBA", d: g.date, head: `🏀 ${g.away.abbr} @ ${g.home.abbr} · ${hora(g.date)}`, lbl: `${c.n} ${c.s === "over" ? "Over" : "Under"} ${c.l} ${SH[c.m] || c.m}`, why: [shortProp("NBA", c, D, g, 1)[0] ? shortProp("NBA", c, D, g, 1)[0].replace(/^- /, "") : "", `Modelo ${pct(c.pm)} · casa ${pct(c.mkB)}`].filter(Boolean), bet: propBet("NBA", c, g.date)}); } }
  list.sort((a, b) => new Date(a.d) - new Date(b.d) || b.pr - a.pr);
  if (!list.length) return {txt: "<b>🛡️ Más seguros</b>\n\nAhorita ningún pick cumple las reglas estrictas (72%+, modelo y casa de acuerdo, historial completo, sin suplentes). Mejor no forzar.", bets: []};
  const L = ["<b>🛡️ Más seguros</b>", "<i>Solo mercados de bajo riesgo · 72%+ · modelo y casa de acuerdo · historial completo · sin suplentes</i>", ""];
  let last = ""; for (const c of list) { if (c.head !== last) { L.push(...(last ? [""] : []), `<b>${esc(c.head)}</b>`); last = c.head; }
    L.push(`🛡️ <b>${esc(c.lbl)}</b> · ${fx(c.p)} · ${pct(c.pr)}`, ...c.why.slice(0, 2).map(t => `   ↳ ${esc(t)}`)); }
  const par = M.safeParlays(list);
  if (par.length) L.push("", "<b>🧮 Parlays (máximo 3 patas)</b>", ...par.map(x => `${x.legs.length} patas: ${x.legs.map(c => esc(c.lbl)).join(" + ")}\n   ↳ peguen todas: <b>${pct(x.pr)}</b> · momio ~${fx(x.p)} (lo justo: ${fx(1 / x.pr)})${x.p * x.pr >= 0.97 ? "" : " · paga menos de lo que vale"}`));
  L.push("", "<i>Pagan poco: un fallo se come 3 o 4 aciertos. Sueltos o parlays cortos, monto fijo.</i>");
  return {txt: L.join("\n"), bets: list.map(c => c.bet), items: list};
}

export function botData(latest, R, now, snap) {
  const at = new Date(latest.generatedAt).toLocaleTimeString("es-MX", {hour: "numeric", minute: "2-digit", timeZone: TZ});
  BETS = {};
  const startedOf = sp => ((snap && snap.items) || []).filter(x => x.sport === sp && new Date(x.d) <= now);
  const out = {v: 3, generatedAt: latest.generatedAt, foot: `<i>Datos de las ${at} · antes de apostar dale ↻ Actualizar en la app</i>`,
    nba: players("NBA", latest.nba, now, 30, startedOf("NBA")), nfl: players("NFL", latest.nfl, now, 24 * 6, startedOf("NFL")), soc: socDays(latest.soc, now, snap), res: record(R), resd: results(R), resSoc: recordSoc(R), hoy: today(snap, now)};
  { const sv = safeView(latest, now); out.safe = sv.txt; out.safeBets = sv.bets; }
  out.bets = BETS;
  return out;
}
