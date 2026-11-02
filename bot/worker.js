// Telegram bot for Picks del Día (Cloudflare Worker, free plan).
// v4 · Menus step by step: sport -> (soccer: league) -> top / game picks / everything / one game. You can also write "nba", "premier", "como nos fue".
// Setup: paste this file in a Worker, add the secret TELEGRAM_TOKEN, deploy, then open https://<your-worker>/setup once.
const DATA = "https://adriansiller.github.io/picks/data/";
const APP = "https://adriansiller.github.io/picks/";
const btn = (text, data) => ({text, callback_data: data});
const rows = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };
const HOME = {inline_keyboard: [[btn("🏀 NBA", "nba"), btn("🏈 NFL", "nfl"), btn("⚽ Soccer", "soc")], [btn("📊 Cómo nos fue", "res")]]};
const LGN = {mx: "🇲🇽 Liga MX", esp: "🇪🇸 La Liga", eng: "🏴 Premier", ger: "🇩🇪 Bundesliga", ita: "🇮🇹 Serie A", fra: "🇫🇷 Ligue 1", ucl: "⭐ Champions"};

// Free text -> menu key; null = main menu
function intent(t) {
  t = (t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (/\bnba\b|basket|basquet/.test(t)) return "nba";
  if (/\bnfl\b|americano|football/.test(t)) return "nfl";
  if (/liga ?mx|mexican/.test(t)) return "soc:mx";
  if (/la ?liga|espan/.test(t)) return "soc:esp";
  if (/premier|inglat/.test(t)) return "soc:eng";
  if (/bundes|aleman/.test(t)) return "soc:ger";
  if (/serie ?a|ital/.test(t)) return "soc:ita";
  if (/ligue|franc/.test(t)) return "soc:fra";
  if (/champions|ucl/.test(t)) return "soc:ucl";
  if (/soccer|futbol/.test(t)) return "soc";
  if (/ayer|resultado|como nos fue|como fue/.test(t)) return "res";
  return null;
}

async function secretOf(token) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("picks:" + token));
  return [...new Uint8Array(h)].slice(0, 16).map(b => b.toString(16).padStart(2, "0")).join("");
}
const tg = (env, method, body) => fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/${method}`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(body)});
const getJSON = u => fetch(u + "?t=" + Date.now(), {cf: {cacheTtl: 0}}).then(r => r.ok ? r.json() : null).catch(() => null);

// What to show for a key: {text, kb} = a menu (edits the current message), {send, after} = picks to send + the menu to show next
function view(B, key) {
  const [a, b, c] = key.split(":"), back = (to, lbl = "⬅️ Atrás") => [btn(lbl, to), btn("🏠 Inicio", "home")];
  if (key === "home") return {text: "¿De qué quieres los picks?", kb: HOME};
  if (a === "res") return {send: B.res, after: "home"};
  if (a === "nba" || a === "nfl") {
    const D = B[a], name = a === "nba" ? "🏀 NBA" : "🏈 NFL";
    if (!D) return {text: `${name}: no hay partidos próximos con picks.`, kb: HOME};
    if (!b) return {text: `${name} · ${D.games.length} partido${D.games.length > 1 ? "s" : ""}. ¿Qué quieres ver?`, kb: {inline_keyboard: [[btn("🔥 Top 10", `${a}:top`), btn("🎯 ML / spread", `${a}:ml`)], [btn("📋 Todo", `${a}:all`), btn("🔎 Un partido", `${a}:g`)], [btn("🏠 Inicio", "home")]]}};
    if (b === "top" || b === "ml" || b === "all") return {send: D[b], after: a};
    if (b === "g" && !c) return {text: `${name}: elige el partido`, kb: {inline_keyboard: [...rows(D.games.map(g => btn(g.b, `${a}:g:${g.id}`)), 2), back(a)]}};
    const g = D.games.find(x => x.id === c); return g ? {send: g.t, after: `${a}:g`, live: g.id} : {text: "Ese partido ya no está (puede que ya empezó).", kb: HOME};
  }
  if (a === "soc") {
    const S = B.soc; if (!S) return {text: "⚽ No hay partidos de soccer en los próximos 3 días.", kb: HOME};
    if (!b) return {text: "⚽ ¿Qué liga?", kb: {inline_keyboard: [[btn("🔥 Top de todas", "soc:top")], ...rows(S.leagues.map(l => btn(`${LGN[l.code] || l.lg} (${l.games.length})`, `soc:${l.code}`)), 2), [btn("🏠 Inicio", "home")]]}};
    if (b === "top") return {send: S.top, after: "soc"};
    if (b === "g") { for (const l of S.leagues) { const g = l.games.find(x => x.id === c); if (g) return {send: g.t, after: `soc:${l.code}:g`, live: g.id}; } return {text: "Ese partido ya no está (puede que ya empezó).", kb: HOME}; }
    const L = S.leagues.find(l => l.code === b); if (!L) return {text: `${LGN[b] || "Esa liga"}: no tiene partidos en los próximos 3 días.`, kb: {inline_keyboard: [back("soc")]}};
    if (!c) return {text: `${LGN[b]} · ${L.games.length} partido${L.games.length > 1 ? "s" : ""}. ¿Qué quieres ver?`, kb: {inline_keyboard: [[btn("🔥 Mejores picks", `soc:${b}:top`), btn("🔎 Un partido", `soc:${b}:g`)], back("soc")]}};
    if (c === "top") return {send: L.top, after: `soc:${b}`};
    if (c === "g") return {text: `${LGN[b]}: elige el partido`, kb: {inline_keyboard: [...rows(L.games.map(g => btn(g.b, `soc:g:${g.id}`)), 2), back(`soc:${b}`)]}};
  }
  return {text: "¿De qué quieres los picks?", kb: HOME};
}

// If Telegram rejects a message, say why in the chat instead of failing silently
async function check(env, chat, r, what) {
  if (r.ok) return true;
  let d = ""; try { d = (await r.json()).description || ""; } catch (e) {}
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({chat_id: chat, text: `⚠️ Falló ${what}: ${d || r.status}`})});
  return false;
}
async function sendLong(env, chat, text) {
  for (let i = 0; i < text.length; i += 3800) {
    const part = text.slice(i, i + 3800), r = await tg(env, "sendMessage", {chat_id: chat, text: part, parse_mode: "HTML", disable_web_page_preview: true});
    // Formatting problem: send it as plain text
    if (!r.ok) await check(env, chat, await tg(env, "sendMessage", {chat_id: chat, text: part.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")}), "el envío de picks");
  }
}

// Live check of one game straight from ESPN: injuries of the pick players, new absences, soccer lineups vs the usual eleven
const ESPN = {nba: "basketball/nba", nfl: "football/nfl"};
const BAD = new Set(["Out", "Doubtful", "Injured Reserve", "Inactive", "Suspended"]);
const allGames = B => [...((B.nba && B.nba.games) || []), ...((B.nfl && B.nfl.games) || []), ...((B.soc && B.soc.leagues) || []).flatMap(l => l.games)];
async function live(B, id) {
  const g = allGames(B).find(x => x.id === id); if (!g || !g.chk) return "Ese partido ya no está en los picks (puede que ya empezó).";
  const k = g.chk, sport = k.sp === "soc" ? `soccer/${k.slug}` : ESPN[k.sp];
  const s = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sport}/summary?event=${id}`).then(r => r.ok ? r.json() : null).catch(() => null);
  if (!s) return "No pude consultar ESPN ahorita. Intenta en un minuto o usa ↻ Actualizar en la app.";
  const st = s.header && s.header.competitions && s.header.competitions[0].status.type;
  const mins = Math.round((new Date(g.d) - Date.now()) / 6e4);
  const L = [`🔄 <b>Revisión en vivo</b> · ${k.a} @ ${k.h}`, st && st.state !== "pre" ? `⚠️ El partido ya empezó (${st.shortDetail || ""}).` : `Empieza en ${mins >= 60 ? Math.floor(mins / 60) + " h " + (mins % 60) + " min" : mins + " min"}.`, ""];
  if (k.sp !== "soc") {
    const inj = {}; for (const t of s.injuries || []) for (const x of t.injuries || []) inj[x.athlete.id] = {st: x.status, n: x.athlete.displayName, t: t.team && t.team.abbreviation};
    const bad = k.props.filter(p => inj[p.aid]);
    L.push(k.props.length ? (bad.length ? bad.map(p => `${BAD.has(inj[p.aid].st) ? "🚨" : "⚠️"} <b>${p.n}</b> aparece como <b>${inj[p.aid].st}</b>. Tu pick: ${p.lbl}.`).join("\n") : `✅ Tus ${k.props.length} props: ningún jugador aparece en el reporte de lesiones.`) : "Este partido no tiene props sólidos.");
    const known = new Set(k.outs), fresh = Object.values(inj).filter(x => BAD.has(x.st) && !known.has(x.n));
    L.push(fresh.length ? `🆕 Bajas nuevas desde la última actualización: ${fresh.map(x => `${x.n} (${x.t || "?"}, ${x.st})`).join(", ")}. Pueden cambiar minutos y volumen de sus compañeros.` : "✅ Sin bajas nuevas desde la última actualización.");
  } else {
    const ros = s.rosters || [];
    if (ros.length === 2 && ros.every(r => (r.roster || []).some(p => p.starter))) {
      const res = {};
      for (const side of ["h", "a"]) {
        const r = ros.find(x => x.homeAway === (side === "h" ? "home" : "away")); if (!r) continue;
        const ids = new Set((r.roster || []).filter(p => p.starter && p.athlete).map(p => String(p.athlete.id)));
        res[side] = (k.xi[side] || []).filter(([pid]) => !ids.has(String(pid))).map(x => x[1]);
        L.push(res[side].length ? `📋 ${k[side]} sin ${res[side].length} titular${res[side].length > 1 ? "es" : ""} habitual${res[side].length > 1 ? "es" : ""}: ${res[side].join(", ")}` : `📋 ${k[side]} con su once habitual ✅`);
      }
      if (k.pick && k.pick.team) { const side = k.pick.team === "H" ? "h" : "a", m = (res[side] || []).length;
        L.push("", m >= 3 ? `🚨 Tu pick (${k.pick.lbl}) depende de ${k[side]}, que sale sin ${m} titulares. Yo lo pensaría dos veces.` : m ? `⚠️ Tu pick (${k.pick.lbl}): a ${k[side]} le falta${m > 1 ? "n" : ""} ${m} titular${m > 1 ? "es" : ""}; revisa si son importantes.` : `✅ Tu pick (${k.pick.lbl}) sigue en pie.`); }
      if (!k.lineups) L.push("", "<i>Los picks se calcularon antes de las alineaciones; el aviso automático antes del partido ya los trae recalculados.</i>");
    } else L.push("⏳ Todavía no salen las alineaciones (suelen salir entre 1 hora y 30 min antes). Vuelve a revisar más cerca del partido.");
  }
  return L.join("\n");
}

async function handle(env, chat, key, editId) {
  const B = await getJSON(DATA + "bot.json");
  if (!B || !(B.v >= 2)) return tg(env, "sendMessage", {chat_id: chat, text: `No pude leer los picks ahorita. Ábrelos en la app: ${APP}`});
  if (key && key.startsWith("chk:")) {
    await sendLong(env, chat, await live(B, key.slice(4)));
    return check(env, chat, await tg(env, "sendMessage", {chat_id: chat, text: "¿Algo más?", reply_markup: {inline_keyboard: [[btn("🔄 Volver a revisar", key)], ...HOME.inline_keyboard]}}), "el menú");
  }
  const v = view(B, key || "home");
  if (v.send) {
    await sendLong(env, chat, v.send + "\n\n" + B.foot);
    const next = view(B, v.after), kb = next.kb || HOME;
    const keyb = v.live && B.v >= 3 ? {inline_keyboard: [[btn("🔄 Revisar en vivo (bajas y alineaciones)", `chk:${v.live}`)], ...kb.inline_keyboard]} : kb;
    return check(env, chat, await tg(env, "sendMessage", {chat_id: chat, text: next.text ? `¿Algo más? ${next.text}` : "¿Algo más?", reply_markup: keyb}), "el menú");
  }
  // Menus replace the previous menu message so the chat doesn't fill up
  if (editId) { const r = await tg(env, "editMessageText", {chat_id: chat, message_id: editId, text: v.text, reply_markup: v.kb}); if (r.ok) return r; }
  return check(env, chat, await tg(env, "sendMessage", {chat_id: chat, text: v.text, reply_markup: v.kb}), "el menú");
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (!env.TELEGRAM_TOKEN) return new Response("Falta el secreto TELEGRAM_TOKEN en el Worker.", {status: 500});
    const secret = await secretOf(env.TELEGRAM_TOKEN);
    if (url.pathname === "/setup") {
      const r = await tg(env, "setWebhook", {url: `${url.origin}/hook`, secret_token: secret, allowed_updates: ["message", "callback_query"]});
      const j = await r.json();
      return new Response(j.ok ? "Listo: el bot ya contesta. Escríbele \"dame los picks\" en Telegram." : "Error: " + JSON.stringify(j), {headers: {"content-type": "text/plain; charset=utf-8"}});
    }
    if (url.pathname !== "/hook" || req.method !== "POST") return new Response("Picks bot");
    if (req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== secret) return new Response("no", {status: 403});
    const u = await req.json(), msg = u.message, cb = u.callback_query;
    const chat = msg ? msg.chat.id : cb && cb.message.chat.id; if (!chat) return new Response("ok");
    // Only the owner's chat (saved by the daily build) gets answers
    const owner = await getJSON(DATA + "telegram.json");
    if (owner && owner.chat && String(owner.chat) !== String(chat)) return new Response("ok");
    // Answer Telegram right away (if it gets an error it retries the same tap and holds back the next ones); the work runs after
    const work = (async () => {
      try {
        if (cb) { await tg(env, "answerCallbackQuery", {callback_query_id: cb.id, text: cb.data.startsWith("chk:") ? "Revisando en ESPN…" : undefined}); await handle(env, chat, cb.data, cb.message && cb.message.message_id); }
        else await handle(env, chat, intent(msg.text));
      } catch (e) { try { await tg(env, "sendMessage", {chat_id: chat, text: "⚠️ Error del bot: " + (e && e.message || e)}); } catch (e2) {} }
    })();
    if (ctx && ctx.waitUntil) ctx.waitUntil(work); else await work;
    return new Response("ok");
  },
};
