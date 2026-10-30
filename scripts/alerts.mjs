// Telegram: morning digest and live alerts for today's picks. (first run sends a test message)
//   node scripts/alerts.mjs digest   -> top picks of the day + yesterday's results
//   node scripts/alerts.mjs watch    -> injuries / pulled props / line moves on today's picks since the last check
// Needs TELEGRAM_TOKEN. The chat id is taken from the first message sent to the bot and saved in data/telegram.json.
import fs from "node:fs";
import path from "node:path";
import {J, pool, dloc} from "./lib.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DATA = path.join(ROOT, "data"), APP = "https://adriansiller.github.io/picks/";
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8")); } catch (e) { return d; } };
const write = (f, v) => fs.writeFileSync(path.join(DATA, f), JSON.stringify(v));
const token = process.env.TELEGRAM_TOKEN, mode = process.argv[2] || "digest";
const STATE = process.env.WATCH_STATE || path.join(DATA, "watch.json");
const esc = s => String(s == null ? "" : s).replace(/[&<>]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;"}[c]));
const fx = x => x ? (+x).toFixed(2) : "—";

async function chatId() {
  if (process.env.TELEGRAM_CHAT) return process.env.TELEGRAM_CHAT;
  const saved = read("telegram.json", {}); if (saved.chat) return saved.chat;
  const r = await J(`https://api.telegram.org/bot${token}/getUpdates`);
  if (!r) { const me = await J(`https://api.telegram.org/bot${token}/getMe`); console.log(me ? `Bot @${me.result.username} OK, pero sin mensajes` : "Telegram rechazó el token (revisa que esté completo)"); return null; }
  console.log(`getUpdates: ${r.result.length} mensajes`);
  const m = r && r.result && r.result.reverse().find(u => u.message && u.message.chat);
  if (!m) return null;
  write("telegram.json", {chat: m.message.chat.id});
  return m.message.chat.id;
}
async function send(text) {
  const chat = await chatId(); if (!chat) { console.log("Telegram: nadie le ha escrito al bot todavía"); return false; }
  for (let i = 0; i < text.length; i += 3800) {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {method: "POST", headers: {"content-type": "application/json"},
      body: JSON.stringify({chat_id: chat, text: text.slice(i, i + 3800), parse_mode: "HTML", disable_web_page_preview: true})});
    if (!r.ok) { console.log("Telegram error", r.status, await r.text()); return false; }
  }
  return true;
}

function digest() {
  const today = dloc(new Date().toISOString(), "America/Mexico_City"), snap = read(`snap/${today}.json`, {items: []}), res = read("results.json", {days: []});
  const NAME = {NBA: "🏀 NBA", NFL: "🏈 NFL", SOC: "⚽ Soccer"}, lines = [`<b>Picks del día</b> · ${new Date().toLocaleDateString("es-MX", {weekday: "long", day: "numeric", month: "short", timeZone: "America/Mexico_City"})}`];
  for (const sp of ["NBA", "NFL", "SOC"]) {
    const it = snap.items.filter(x => x.sport === sp && !(sp === "SOC" && x.why === "game")); if (!it.length) continue;
    lines.push("", `<b>${NAME[sp]}</b>`);
    it.filter(x => x.kind !== "game").slice(0, 6).forEach((x, i) => lines.push(`${i + 1}. ${esc(x.n)}${x.t ? ` (${esc(x.t)})` : ""} · ${esc(x.lbl)} · <b>${fx(x.p)}</b>`));
    it.filter(x => x.kind === "game").forEach(x => lines.push(`🎯 ${esc(x.n)}: ${esc(x.lbl)} · <b>${fx(x.p)}</b>`));
  }
  // Yesterday's record per sport
  const y = res.days.find(d => d.date < today && d.items.some(x => x.hit === 0 || x.hit === 1));
  if (y) { const parts = ["NBA", "NFL", "SOC"].map(sp => { const done = y.items.filter(x => x.sport === sp && (x.hit === 0 || x.hit === 1)); if (!done.length) return null;
    const w = done.filter(x => x.hit).length, u = done.reduce((s, x) => s + (x.hit ? (x.p || 1.91) - 1 : -1), 0); return `${NAME[sp]} ${w}/${done.length} (${u >= 0 ? "+" : ""}${u.toFixed(1)} u)`; }).filter(Boolean);
    if (parts.length) lines.push("", `<b>Ayer</b>: ${parts.join(" · ")}`); }
  if (lines.length === 1) lines.push("", "Hoy no hay partidos con picks.");
  lines.push("", `Antes de apostar dale ↻ Actualizar en la app: ${APP}`);
  return lines.join("\n");
}

// Live check of today's picks against ESPN
const SITE = {NBA: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba", NFL: "https://site.api.espn.com/apis/site/v2/sports/football/nfl"};
const CORE = {NBA: "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba", NFL: "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl"};
const PT = {NBA: {"Total Points": "PTS", "Total Assists": "AST", "Total Rebounds": "REB", "Total 3-Point Field Goals": "3PM"},
  NFL: {"Total Receptions": "REC", "Total Receiving Yards": "RECYDS", "Total Carries": "CAR", "Total Rushing Yards": "RUSHYDS", "Total Pass Completions": "CMP", "Total Passing Yards": "PASSYDS", "Total Rushing Plus Receiving Yards": "RRY"}};
const BAD = new Set(["Out", "Doubtful", "Injured Reserve", "Inactive", "Suspended"]);

async function watch() {
  const today = dloc(new Date().toISOString(), "America/Mexico_City"), snap = read(`snap/${today}.json`, {items: []});
  const latest = read("latest.json", {}), props = snap.items.filter(x => x.kind === "prop");
  let state = {}; try { state = JSON.parse(fs.readFileSync(STATE, "utf8")); } catch (e) {}
  if (state.date !== today) state = {date: today, seen: {}};
  const gamesOf = sp => Object.fromEntries((((latest[sp.toLowerCase()] || {}).games) || []).map(g => [g.id, g]));
  const G = {NBA: gamesOf("NBA"), NFL: gamesOf("NFL")}, alerts = [];
  const byGame = [...new Set(props.map(x => x.sport + "|" + x.g))];
  await pool(byGame, 4, async k => {
    const [sp, gid] = k.split("|"), g = G[sp][gid]; if (!g || new Date(g.date) < new Date()) return;
    const base = `${CORE[sp]}/events/${gid}/competitions/${gid}/odds`;
    const [s, pb] = await Promise.all([J(`${SITE[sp]}/summary?event=${gid}`), J(base + "/100/propBets?lang=en&region=us&limit=1000")]);
    if (!s) return;
    const inj = {}; for (const t of s.injuries || []) for (const x of t.injuries || []) inj[x.athlete.id] = x.status;
    const lines = {}; for (const it of (pb && pb.items) || []) { const nm = String((it.type || {}).name || "").replace(/\s*\(incl\. overtime\)/, ""), m = PT[sp][nm], aid = (((it.athlete || {}).$ref || "").match(/athletes\/(\d+)/) || [])[1];
      if (m && aid && !lines[aid + "|" + m]) lines[aid + "|" + m] = it.current && it.current.target ? Number(it.current.target.value) : null; }
    for (const x of props.filter(p => p.sport === sp && p.g === gid)) {
      const key = x.sport + x.aid + x.m, prev = state.seen[key] || {st: null, l: x.l, gone: false}, st = inj[x.aid] || null, l = lines[x.aid + "|" + x.m];
      if (st !== prev.st && st) alerts.push(`${BAD.has(st) ? "🚨" : "⚠️"} <b>${esc(x.n)}</b> ahora aparece como <b>${esc(st)}</b>. Tu pick: ${esc(x.lbl)}.${BAD.has(st) ? " Si ya la apostaste, revisa si la casa la anula." : ""}`);
      if (pb && l == null && !prev.gone) { alerts.push(`🚫 La casa quitó la línea de <b>${esc(x.n)}</b> (${esc(x.lbl)}). Suele pasar cuando no va a jugar.`); prev.gone = true; }
      if (l != null) { const thr = Math.max(1, Math.abs(x.l) * 0.06);
        if (Math.abs(l - prev.l) >= thr) alerts.push(`📈 <b>${esc(x.n)}</b>: la línea pasó de ${prev.l} a ${l} (${esc(x.lbl)}). ${(x.s === "over") === (l > x.l) ? "Se puso más difícil." : "Se puso más fácil."}`); prev.l = Math.abs(l - prev.l) >= thr ? l : prev.l; }
      state.seen[key] = {st, l: prev.l, gone: prev.gone};
    }
  });
  fs.writeFileSync(STATE, JSON.stringify(state));
  if (alerts.length) await send(`<b>Cambios en tus picks</b>\n\n${alerts.join("\n")}\n\n${APP}`);
  console.log(`watch: ${alerts.length} avisos`);
}

if (!token) { console.log("Sin TELEGRAM_TOKEN: no se mandan avisos"); process.exit(0); }
if (mode === "digest") console.log("digest:", await send(digest()));
else if (mode === "watch") await watch();
else if (mode === "test") console.log("test:", await send(`✅ Listo, ya estoy conectado. Te mando el top cada mañana y aviso si un pick cambia.\n${APP}`));
