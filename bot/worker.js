// Telegram bot for Picks del Día (Cloudflare Worker, free plan).
// Menus step by step: sport -> (soccer: league) -> top / game picks / everything / one game. You can also write "nba", "premier", "como nos fue".
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
    const g = D.games.find(x => x.id === c); return g ? {send: g.t, after: `${a}:g`} : {text: "Ese partido ya no está (puede que ya empezó).", kb: HOME};
  }
  if (a === "soc") {
    const S = B.soc; if (!S) return {text: "⚽ No hay partidos de soccer en los próximos 3 días.", kb: HOME};
    if (!b) return {text: "⚽ ¿Qué liga?", kb: {inline_keyboard: [[btn("🔥 Top de todas", "soc:top")], ...rows(S.leagues.map(l => btn(`${LGN[l.code] || l.lg} (${l.games.length})`, `soc:${l.code}`)), 2), [btn("🏠 Inicio", "home")]]}};
    if (b === "top") return {send: S.top, after: "soc"};
    if (b === "g") { for (const l of S.leagues) { const g = l.games.find(x => x.id === c); if (g) return {send: g.t, after: `soc:${l.code}:g`}; } return {text: "Ese partido ya no está (puede que ya empezó).", kb: HOME}; }
    const L = S.leagues.find(l => l.code === b); if (!L) return {text: `${LGN[b] || "Esa liga"}: no tiene partidos en los próximos 3 días.`, kb: {inline_keyboard: [back("soc")]}};
    if (!c) return {text: `${LGN[b]} · ${L.games.length} partido${L.games.length > 1 ? "s" : ""}. ¿Qué quieres ver?`, kb: {inline_keyboard: [[btn("🔥 Mejores picks", `soc:${b}:top`), btn("🔎 Un partido", `soc:${b}:g`)], back("soc")]}};
    if (c === "top") return {send: L.top, after: `soc:${b}`};
    if (c === "g") return {text: `${LGN[b]}: elige el partido`, kb: {inline_keyboard: [...rows(L.games.map(g => btn(g.b, `soc:g:${g.id}`)), 2), back(`soc:${b}`)]}};
  }
  return {text: "¿De qué quieres los picks?", kb: HOME};
}

async function sendLong(env, chat, text) {
  for (let i = 0; i < text.length; i += 3800) await tg(env, "sendMessage", {chat_id: chat, text: text.slice(i, i + 3800), parse_mode: "HTML", disable_web_page_preview: true});
}

async function handle(env, chat, key, editId) {
  const B = await getJSON(DATA + "bot.json");
  if (!B || B.v !== 2) return tg(env, "sendMessage", {chat_id: chat, text: `No pude leer los picks ahorita. Ábrelos en la app: ${APP}`});
  const v = view(B, key || "home");
  if (v.send) {
    await sendLong(env, chat, v.send + "\n\n" + B.foot);
    const next = view(B, v.after);
    return tg(env, "sendMessage", {chat_id: chat, text: next.text ? `¿Algo más? ${next.text}` : "¿Algo más?", reply_markup: next.kb || HOME});
  }
  // Menus replace the previous menu message so the chat doesn't fill up
  if (editId) { const r = await tg(env, "editMessageText", {chat_id: chat, message_id: editId, text: v.text, reply_markup: v.kb}); if (r.ok) return r; }
  return tg(env, "sendMessage", {chat_id: chat, text: v.text, reply_markup: v.kb});
}

export default {
  async fetch(req, env) {
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
    if (cb) { await tg(env, "answerCallbackQuery", {callback_query_id: cb.id}); await handle(env, chat, cb.data, cb.message.message_id); }
    else await handle(env, chat, intent(msg.text));
    return new Response("ok");
  },
};
