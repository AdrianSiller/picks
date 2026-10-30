// Telegram bot for Picks del Día (Cloudflare Worker, free plan).
// You write "dame los picks" -> it asks which sport -> you tap NBA / NFL / Soccer (or just write "nba").
// Setup: paste this file in a Worker, add the secret TELEGRAM_TOKEN, deploy, then open https://<your-worker>/setup once.
const DATA = "https://adriansiller.github.io/picks/data/";
const APP = "https://adriansiller.github.io/picks/";
const MENU = {inline_keyboard: [
  [{text: "🏀 NBA", callback_data: "nba"}, {text: "🏈 NFL", callback_data: "nfl"}, {text: "⚽ Soccer", callback_data: "soc"}],
  [{text: "📋 Todo", callback_data: "all"}, {text: "📊 Cómo nos fue", callback_data: "res"}],
]};

// What the message asks for; null means "ask which sport"
function intent(t) {
  t = (t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (/\bnba\b|basket|basquet/.test(t)) return "nba";
  if (/\bnfl\b|americano|football/.test(t)) return "nfl";
  if (/soccer|futbol|liga|champions|laliga/.test(t)) return "soc";
  if (/ayer|resultado|como nos fue|como fue/.test(t)) return "res";
  if (/\btodo|\btodos/.test(t)) return "all";
  return null;
}

async function secretOf(token) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("picks:" + token));
  return [...new Uint8Array(h)].slice(0, 16).map(b => b.toString(16).padStart(2, "0")).join("");
}
const tg = (env, method, body) => fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/${method}`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(body)});
const getJSON = u => fetch(u + "?t=" + Date.now(), {cf: {cacheTtl: 0}}).then(r => r.ok ? r.json() : null).catch(() => null);

async function reply(env, chat, what) {
  if (!what) return tg(env, "sendMessage", {chat_id: chat, text: "¿De qué los quieres?", reply_markup: MENU});
  const B = await getJSON(DATA + "bot.json");
  if (!B) return tg(env, "sendMessage", {chat_id: chat, text: `No pude leer los picks ahorita. Ábrelos en la app: ${APP}`});
  const texts = what === "all" ? [B.nba, B.nfl, B.soc] : [B[what]];
  for (const t of texts) for (let i = 0; i < t.length; i += 3800)
    await tg(env, "sendMessage", {chat_id: chat, text: t.slice(i, i + 3800), parse_mode: "HTML", disable_web_page_preview: true});
  return tg(env, "sendMessage", {chat_id: chat, text: "¿Algo más?", reply_markup: MENU});
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
    if (cb) { await tg(env, "answerCallbackQuery", {callback_query_id: cb.id}); await reply(env, chat, cb.data); }
    else await reply(env, chat, intent(msg.text));
    return new Response("ok");
  },
};
