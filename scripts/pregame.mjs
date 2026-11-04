// Before-the-game check (runs every 10 min from GitHub): when a game with picks starts in 12-60 minutes,
// rebuilds everything (injuries, confirmed lineups, lines), and sends one Telegram message with the updated picks
// and what changed since the last build. Each game is announced once (data/alerted.json).
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {kv} from "./kv.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DATA = path.join(ROOT, "data");
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8")); } catch (e) { return d; } };
const now = new Date(), token = process.env.TELEGRAM_TOKEN;
const MIN = +(process.env.PRE_MIN || 12), MAX = +(process.env.PRE_MAX || 60);

const gamesOf = B => [...((B.nba && B.nba.games) || []).map(g => ({...g, sp: "🏀 NBA", k: "nba"})), ...((B.nfl && B.nfl.games) || []).map(g => ({...g, sp: "🏈 NFL", k: "nfl"})),
  ...((B.soc && (B.soc.days || [B.soc])) || []).flatMap(d => (d.leagues || []).flatMap(l => l.games.map(g => ({...g, sp: `⚽ ${l.lg}`, k: "soc"}))))];
const mins = g => (new Date(g.d) - now) / 6e4;

const alerted = read("alerted.json", {ids: {}});
const before = read("bot.json", {});
// Your settings from 🔔 Avisos in the bot: paused, or sports turned off
const chat0 = (read("telegram.json", {}) || {}).chat;
let cfg = {}; try { const K = await kv(); if (K && chat0) cfg = JSON.parse(await K.get(`cfg:${chat0}`) || "{}"); } catch (e) { console.log("pregame: sin ajustes", e.message); }
if (cfg.pause && new Date(cfg.pause) > now) { console.log("pregame: avisos en pausa hasta", cfg.pause); process.exit(0); }
const spOn = k => !cfg.sp || cfg.sp[k] !== 0;
const due = gamesOf(before).filter(g => g.d && spOn(g.k) && mins(g) >= MIN && mins(g) <= MAX && !alerted.ids[g.id]);
if (!due.length) { console.log("pregame: nada por avisar"); process.exit(0); }
console.log("pregame: revisando", due.map(g => g.b).join(", "));

// Fresh data: injuries, confirmed lineups and lines change in the last hour
if (!process.env.PRE_NOBUILD) execFileSync("node", [path.join(ROOT, "scripts/build.mjs")], {stdio: "inherit", env: {...process.env, RUN_SGO: "0"}});
const after = read("bot.json", {}), A = Object.fromEntries(gamesOf(after).map(g => [g.id, g]));

const esc = s => String(s == null ? "" : s).replace(/[&<>]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;"}[c]));
const picksOf = g => !g ? [] : g.chk && g.chk.props ? g.chk.props.map(p => `${p.n} ${p.lbl}`) : g.chk && g.chk.pick ? [g.chk.pick.lbl] : [];
const parts = [];
for (const g0 of due) {
  alerted.ids[g0.id] = now.toISOString();
  const g = A[g0.id];
  if (!g) continue; // already started or gone
  const was = new Set(picksOf(g0)), is = new Set(picksOf(g)), out = [...was].filter(x => !is.has(x)), inn = [...is].filter(x => !was.has(x));
  if (!g.solid && !g0.solid) continue; // nothing to bet on in this game, no message
  const L = [`⏰ <b>Empieza en ${Math.round(mins(g))} min</b> · ${esc(g.sp)}`];
  if (out.length || inn.length) L.push(`🔄 <b>Cambió con los datos de última hora</b>${out.length ? `\nSale: ${esc(out.join(", "))}` : ""}${inn.length ? `\nEntra: ${esc(inn.join(", "))}` : ""}`);
  else L.push("✅ Sin cambios: los picks siguen en pie con las bajas y alineaciones de última hora.");
  if (!g.solid) L.push("❌ Ya no queda ningún pick sólido en este partido. Mejor no apostarle.");
  L.push("", g.t);
  parts.push(L.join("\n"));
}

const keep = {}; for (const [id, t] of Object.entries(alerted.ids)) if (now - new Date(t) < 3 * 864e5) keep[id] = t;
fs.writeFileSync(path.join(DATA, "alerted.json"), JSON.stringify({ids: keep}));

if (!parts.length) { console.log("pregame: sin picks sólidos en esos partidos"); process.exit(0); }
const chat = (read("telegram.json", {}) || {}).chat;
if (process.env.PRE_DRY) { console.log(parts.join("\n\n— — —\n\n")); process.exit(0); }
if (!token || !chat) { console.log("pregame: falta token o chat"); process.exit(0); }
// Games grouped in messages of up to ~3800 characters, never cutting one in half
const msgs = [""]; for (const p of parts) { const cur = msgs[msgs.length - 1]; if (cur && cur.length + p.length > 3700) msgs.push(p); else msgs[msgs.length - 1] = cur ? cur + "\n\n— — —\n\n" + p : p; }
for (const m of msgs) {
  const body = {chat_id: chat, text: m.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true};
  let r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(body)});
  if (!r.ok) { body.text = body.text.replace(/<[^>]+>/g, ""); delete body.parse_mode; r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(body)}); }
  console.log("telegram", r.status);
}
