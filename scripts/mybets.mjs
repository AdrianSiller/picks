// Grades the bets marked in the Telegram bot (stored privately in Cloudflare KV, never in the public repo)
// and, if you turned it on in 🔔 Avisos, sends a morning summary of yesterday's bets.
import fs from "node:fs";
import path from "node:path";
import {grade} from "./results.mjs";
import {kv} from "./kv.mjs";
import {dloc} from "./lib.mjs";

const K = await kv().catch(e => { console.log("mybets:", e.message); return null; });
if (!K) { console.log("mybets: sin acceso al espacio de apuestas"); process.exit(0); }
const keys = await K.list("bet:"), now = Date.now();
const due = keys.filter(k => k.metadata && !k.metadata.res && k.metadata.d && now - new Date(k.metadata.d) > 2 * 36e5);
console.log(`mybets: ${keys.length} apuestas, ${due.length} por calificar`);
if (due.length) {
  const items = []; for (const k of due) { const v = await K.get(k.name); if (v) items.push({k, x: JSON.parse(v)}); }
  // Parlays: grade every leg; the parlay wins only if all legs hit (a void leg leaves it as ➖)
  await grade(items.flatMap(i => i.x.kind === "par" ? i.x.legs : [i.x]));
  for (const {x} of items) if (x.kind === "par") { const r = x.legs.map(l => l.res && l.res.hit); if (r.some(h => h === undefined)) continue;
    x.res = {hit: r.includes(0) ? 0 : r.every(h => h === 1) ? 1 : null, act: `${r.filter(h => h === 1).length} de ${r.length} pegaron`}; }
  let n = 0; for (const {k, x} of items) if (x.res && await K.put(k.name, x, {...k.metadata, res: x.res})) { k.metadata.res = x.res; n++; }
  console.log(`mybets: ${n} calificadas`);
}

// Morning summary (8 am or later, once a day), only for chats that turned it on
const token = process.env.TELEGRAM_TOKEN, TZ = "America/Mexico_City", today = dloc(new Date().toISOString(), TZ);
const hour = +new Date().toLocaleString("en-US", {hour: "numeric", hour12: false, timeZone: TZ});
if (token && hour >= 8) for (const c of await K.list("cfg:")) {
  const chat = c.name.slice(4), cfg = JSON.parse(await K.get(c.name) || "{}"); if (!cfg.daily || cfg.lastDaily === today) continue;
  const yest = dloc(new Date(now - 864e5).toISOString(), TZ);
  const mine = keys.filter(k => k.name.startsWith(`bet:${chat}:`) && k.metadata && k.metadata.d && dloc(k.metadata.d, TZ) === yest).map(k => k.metadata);
  cfg.lastDaily = today; await K.put(c.name, cfg);
  if (!mine.length) continue;
  const done = mine.filter(x => x.res && (x.res.hit === 0 || x.res.hit === 1)), w = done.filter(x => x.res.hit).length, u = done.reduce((s, x) => s + (x.res.hit ? x.p - 1 : -1), 0);
  const L = [`🌅 <b>Tus apuestas de ayer</b>: ${w} de ${done.length} · ${u >= 0 ? "+" : ""}${u.toFixed(2)} u`, "",
    ...mine.map(x => `${!x.res ? "⏳" : x.res.hit === null ? "➖" : x.res.hit ? "✅" : "❌"} ${x.lbl}${x.res && x.res.act ? ` (${x.res.act})` : ""} · ${(+x.p).toFixed(2)}`)];
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({chat_id: chat, text: L.join("\n"), parse_mode: "HTML"})});
  console.log("resumen diario", chat, r.status);
}
