// Telegram bot for Picks del Día (Cloudflare Worker, free plan).
// v7 · Menus step by step: sport -> (soccer: league) -> top / game picks / everything / one game. You can also write "nba", "premier", "como nos fue".
// Setup: paste this file in a Worker, add the secret TELEGRAM_TOKEN, deploy, then open https://<your-worker>/setup once.
const DATA = "https://adriansiller.github.io/picks/data/";
const APP = "https://adriansiller.github.io/picks/";
const btn = (text, data) => ({text, callback_data: data});
const rows = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };
const HOME = {inline_keyboard: [[btn("🏀 NBA", "nba"), btn("🏈 NFL", "nfl"), btn("⚽ Soccer", "soc")], [btn("📊 Cómo nos fue", "res"), btn("🧾 Mis apuestas", "mine")], [btn("📋 Picks de hoy", "hoy"), btn("🔎 Buscar", "find")], [btn("🔔 Avisos", "av")]]};
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
  if (/mis apuestas|apuestas|aposte/.test(t)) return "mine";
  if (/picks de hoy|de hoy|hoy/.test(t)) return "hoy";
  if (/ayer|resultado|como nos fue|como fue/.test(t)) return "res";
  return null;
}

async function secretOf(token) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("picks:" + token));
  return [...new Uint8Array(h)].slice(0, 16).map(b => b.toString(16).padStart(2, "0")).join("");
}
const tg = (env, method, body) => fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/${method}`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(body)});
const getJSON = u => fetch(u + "?t=" + Date.now(), {cf: {cacheTtl: 0}}).then(r => r.ok ? r.json() : null).catch(() => null);

// Several games at once: the selection travels in the button as a bitmask (base 36) plus a tag of the data version,
// so a tap on an old menu after the list changed asks to choose again instead of showing the wrong games
const ver = B => (Math.floor(new Date(B.generatedAt).getTime() / 6e4) % 46656).toString(36);
function multi(B, list, base, back, mask, title) {
  const m = parseInt(mask || "0", 36) || 0, sel = list.filter((g, i) => m & (1 << i)), v = ver(B);
  const kb = rows(list.map((g, i) => btn(`${m & (1 << i) ? "✅ " : ""}${g.b}`, `${base}:m:${(m ^ (1 << i)).toString(36)}:${v}`)), 2);
  kb.push(sel.length ? [btn(`👀 Ver ${sel.length} seleccionado${sel.length > 1 ? "s" : ""}`, `${base}:mv:${m.toString(36)}:${v}`)] : []);
  kb.push([btn("⬅️ Atrás", back), btn("🏠 Inicio", "home")]);
  return {text: `${title}: toca los partidos que quieras (se marcan con ✅) y luego "Ver".`, kb: {inline_keyboard: kb.filter(r => r.length)}};
}
function picked(B, list, mask, tag) {
  if (tag !== ver(B)) return null;
  const m = parseInt(mask || "0", 36) || 0; return list.filter((g, i) => m & (1 << i));
}

// What to show for a key: {text, kb} = a menu (edits the current message), {send, after} = picks to send + the menu to show next
function view(B, key) {
  const [a, b, c] = key.split(":"), back = (to, lbl = "⬅️ Atrás") => [btn(lbl, to), btn("🏠 Inicio", "home")];
  if (key === "home") return {text: "¿De qué quieres los picks?", kb: HOME};
  if (key === "hoy") return {send: B.hoy || "Todavía no hay picks de hoy.", after: "home"};
  if (key === "find") return {text: "🔎 Escríbeme el nombre de un jugador o equipo (ej. Doncic, Lakers, Real Madrid, América).", kb: {inline_keyboard: [[btn("🏠 Inicio", "home")]]}};
  if (a === "pl") { const p = ((B[b] || {}).find || []).find(x => x.aid === c); return p ? {send: p.txt, after: "home", bets: p.refs, cmp: p.refs} : {text: "Ese jugador ya no tiene props en la lista.", kb: HOME}; }
  if (key === "res:menu") return {text: "¿Quieres ver más detalle?", kb: {inline_keyboard: [[btn("📋 Ver los picks del último día", "res:d")], ...(B.resSoc ? [[btn("⚽ Soccer por liga", "res:s")]] : []), ...HOME.inline_keyboard]}};
  if (a === "res" && b === "d") return {send: B.resd, after: "res:menu"};
  if (a === "res" && b === "s") return {send: B.resSoc, after: "res:menu"};
  if (a === "res") return B.resd ? {send: B.res, after: "res:menu"} : {send: B.res, after: "home"};

  if (a === "nba" || a === "nfl") {
    const D = B[a], name = a === "nba" ? "🏀 NBA" : "🏈 NFL";
    if (!D) return {text: `${name}: no hay partidos próximos con picks.`, kb: HOME};
    if (!b) return {text: `${name} · ${D.games.length} partido${D.games.length > 1 ? "s" : ""}. ¿Qué quieres ver?`, kb: {inline_keyboard: [[btn("🔥 Top 10", `${a}:top`), btn("🎯 ML / spread", `${a}:ml`)], [btn("📋 Todo", `${a}:all`), btn("🔎 Un partido", `${a}:g`)], [btn("☑️ Varios partidos", `${a}:m:0:${ver(B)}`)], [btn("🏠 Inicio", "home")]]}};
    if (b === "top" || b === "ml" || b === "all") return {send: D[b], after: a, bets: (D.bets || {})[b], cmp: (D.bets || {})[b]};
    if (b === "m") return multi(B, D.games, a, a, c, name);
    if (b === "mv") { const sel = picked(B, D.games, c, key.split(":")[3]); if (!sel) return {text: "La lista de partidos se actualizó; elige otra vez.", kb: {inline_keyboard: [[btn("☑️ Varios partidos", `${a}:m:0:${ver(B)}`)], [btn("🏠 Inicio", "home")]]}};
      return {sendMany: sel.map(g => g.t), after: a, liveMany: sel.map(g => g.id), bets: sel.flatMap(g => g.bets || []), cmp: sel.flatMap(g => g.bets || [])}; }
    if (b === "g" && !c) return {text: `${name}: elige el partido`, kb: {inline_keyboard: [...rows(D.games.map(g => btn(g.b, `${a}:g:${g.id}`)), 2), back(a)]}};
    const g = D.games.find(x => x.id === c); return g ? {send: g.t, after: `${a}:g`, live: g.id, bets: g.bets, cmp: g.bets} : {text: "Ese partido ya no está (puede que ya empezó).", kb: HOME};
  }
  if (a === "soc" || a.startsWith("soc@")) {
    // Soccer by day: "soc" = today (or the first day with matches), "soc@N" = another day; only when asked
    const SD = B.soc; if (!SD) return {text: "⚽ No hay partidos de soccer en los próximos días.", kb: HOME};
    const days = SD.days || [{...SD, lbl: "Próximos días"}], di = Math.min(+(a.split("@")[1] || 0), days.length - 1), S = days[di], base = di ? `soc@${di}` : "soc";
    const dayRow = days.length > 1 ? [days.map((d, k) => k === di ? null : btn(`📅 ${d.lbl}`, k ? `soc@${k}` : "soc")).filter(Boolean)] : [];
    if (b === "g") { for (const d of days) for (const l of d.leagues) { const g = l.games.find(x => x.id === c); if (g) return {send: g.t, after: `${base}:${l.code}:g`, live: g.id, bets: g.bets, cmp: g.cmp || g.bets}; } return {text: "Ese partido ya no está (puede que ya empezó).", kb: HOME}; }
    if (!b) return {text: `⚽ ${S.lbl}: ¿qué liga?`, kb: {inline_keyboard: [[btn(`🔥 Top de ${S.lbl.toLowerCase()}`, `${base}:top`)], ...rows(S.leagues.map(l => btn(`${LGN[l.code] || l.lg} (${l.games.length}${l.started ? ` + ${l.started} jugados` : ""})`, `${base}:${l.code}`)), 2), ...dayRow, [btn("🏠 Inicio", "home")]]}};
    if (b === "top") return {send: S.top, after: base, bets: S.topBets, cmp: S.topBets};
    const L = S.leagues.find(l => l.code === b); if (!L) return {text: `${LGN[b] || "Esa liga"}: no tiene partidos ${S.lbl.toLowerCase()}.`, kb: {inline_keyboard: [...dayRow, back(base)]}};
    if (!c) return {text: `${LGN[b]} · ${S.lbl} · ${L.games.length} por jugar${L.started ? `, ${L.started} ya empezaron` : ""}. ¿Qué quieres ver?`, kb: {inline_keyboard: [[btn("🔥 Picks", `${base}:${b}:top`), ...(L.games.length ? [btn("🔎 Un partido", `${base}:${b}:g`)] : [])], ...(L.games.length > 1 ? [[btn("☑️ Varios partidos", `${base}:${b}:m:0:${ver(B)}`)]] : []),
      ...(days.length > 1 ? [days.map((dd, k) => k !== di && dd.leagues.some(l => l.code === b) ? btn(`📅 ${dd.lbl}`, `${k ? `soc@${k}` : "soc"}:${b}`) : null).filter(Boolean)].filter(r => r.length) : []), back(base)]}};
    if (c === "top") return {send: L.top, after: `${base}:${b}`, bets: L.topBets, cmp: L.topBets};
    const [, , , d, e] = key.split(":");
    if (c === "m") return multi(B, L.games, `${base}:${b}`, `${base}:${b}`, d, LGN[b] || L.lg);
    if (c === "mv") { const sel = picked(B, L.games, d, e); if (!sel) return {text: "La lista de partidos se actualizó; elige otra vez.", kb: {inline_keyboard: [[btn("☑️ Varios partidos", `${base}:${b}:m:0:${ver(B)}`)], back(base)]}};
      return {sendMany: sel.map(g => g.t), after: `${base}:${b}`, liveMany: sel.map(g => g.id), bets: sel.flatMap(g => g.bets || []), cmp: sel.flatMap(g => g.cmp || g.bets || [])}; }
    if (c === "g") return {text: `${LGN[b]} · ${S.lbl}: elige el partido`, kb: {inline_keyboard: [...rows(L.games.map(g => btn(g.b, `soc:g:${g.id}`)), 2), back(`${base}:${b}`)]}};
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
  // Split between lines (never inside one, so the formatting tags stay whole)
  const parts = [""]; for (const line of String(text).split("\n")) { const cur = parts[parts.length - 1]; if (cur.length + line.length + 1 > 3800 && cur) parts.push(line); else parts[parts.length - 1] = cur ? cur + "\n" + line : line; }
  for (const part0 of parts) {
    const part = part0.slice(0, 4000), r = await tg(env, "sendMessage", {chat_id: chat, text: part, parse_mode: "HTML", disable_web_page_preview: true});
    // Formatting problem: send it as plain text
    if (!r.ok) await check(env, chat, await tg(env, "sendMessage", {chat_id: chat, text: part.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")}), "el envío de picks");
  }
}

// Live check of one game straight from ESPN: injuries of the pick players, new absences, soccer lineups vs the usual eleven
const ESPN = {nba: "basketball/nba", nfl: "football/nfl"};
const BAD = new Set(["Out", "Doubtful", "Injured Reserve", "Inactive", "Suspended"]);
const allGames = B => [...((B.nba && B.nba.games) || []), ...((B.nfl && B.nfl.games) || []), ...((B.soc && (B.soc.days || [B.soc])) || []).flatMap(d => (d.leagues || []).flatMap(l => l.games))];
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

/* ---------- my bets (Cloudflare KV, private) ---------- */
const fx = x => x ? (+x).toFixed(2) : "—";
// Decimal (1.51) or American (-150 / +120) odds -> decimal
function parseOdds(t) {
  const s = String(t || "").trim().replace(",", "."); if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return null; const v = parseFloat(s);
  if (/^[+-]/.test(s) || Math.abs(v) >= 100) { if (Math.abs(v) < 100) return null; return +(v > 0 ? 1 + v / 100 : 1 + 100 / -v).toFixed(3); }
  return v > 1 && v < 100 ? v : null;
}
const betRows = (B, refs) => (refs || []).filter(r => B.bets && B.bets[r] && !B.bets[r].nomark).map(r => [btn(`📝 ${B.bets[r].b}`, `b:${r}`)]);
async function myBets(env, chat) {
  const out = []; let cursor;
  do { const r = await env.BETS.list({prefix: `bet:${chat}:`, cursor}); out.push(...r.keys); cursor = r.list_complete ? null : r.cursor; } while (cursor);
  return out.map(k => ({id: k.name.split(":")[2], ...(k.metadata || {})}));
}
function mineText(list) {
  const day = d => new Date(d).toLocaleString("es-MX", {weekday: "short", day: "numeric", month: "short", timeZone: "America/Mexico_City"});
  const pend = list.filter(x => !x.res), done = list.filter(x => x.res).sort((a, b) => a.id < b.id ? 1 : -1);
  const tally = arr => { const d = arr.filter(x => x.res.hit === 0 || x.res.hit === 1), w = d.filter(x => x.res.hit).length, u = d.reduce((s, x) => s + (x.res.hit ? x.p - 1 : -1), 0); return `${w} de ${d.length} · ${u >= 0 ? "+" : ""}${u.toFixed(2)} u`; };
  const wk = done.filter(x => Date.now() - new Date(x.d) < 7 * 864e5);
  const L = ["<b>🧾 Mis apuestas</b>"];
  if (done.length) L.push("", `<b>Últimos 7 días:</b> ${wk.length ? tally(wk) : "nada calificado"}`, `<b>Total:</b> ${tally(done)}`, "<i>(1 unidad por apuesta, con el momio que me diste)</i>");
  L.push("", pend.length ? `<b>⏳ Pendientes (${pend.length})</b>` : "Sin apuestas pendientes.", ...pend.map(x => `• ${x.lbl} · ${fx(x.p)} · ${day(x.d)}`));
  if (done.length) L.push("", "<b>Calificadas</b>", ...done.slice(0, 15).map(x => `${x.res.hit === null ? "➖" : x.res.hit ? "✅" : "❌"} ${x.lbl}${x.res.act ? ` (${x.res.act})` : ""} · ${fx(x.p)}`));
  L.push("", "<i>Se califican solas cuando termina el partido (puede tardar hasta unas horas).</i>");
  return L.join("\n");
}
async function betAction(env, chat, key, editId, B) {
  if (!env.BETS) return tg(env, "sendMessage", {chat_id: chat, text: "Mis apuestas todavía no está activo.", reply_markup: HOME});
  const [op, arg] = [key.split(":")[0], key.slice(key.indexOf(":") + 1)];
  if (op === "bm") { const v = view(B, arg), rowsB = betRows(B, v.bets);
    const kb = {inline_keyboard: [...rowsB, [btn("🏠 Inicio", "home")]]}, text = rowsB.length ? "¿Cuál apostaste? Toca el pick:" : "No hay picks para marcar aquí.";
    if (editId) { const r = await tg(env, "editMessageText", {chat_id: chat, message_id: editId, text, reply_markup: kb}); if (r.ok) return; }
    return tg(env, "sendMessage", {chat_id: chat, text, reply_markup: kb}); }
  if (op === "b") { const x = B.bets && B.bets[arg]; if (!x) return tg(env, "sendMessage", {chat_id: chat, text: "Ese pick ya no está en la lista (puede que cambió con la última actualización).", reply_markup: HOME});
    const id = Date.now().toString(36), k = `bet:${chat}:${id}`;
    await env.BETS.put(k, JSON.stringify({...x, ref: arg, at: new Date().toISOString(), pb: x.p}), {metadata: {lbl: x.lbl, p: x.p, d: x.d}});
    await setAwait(env, chat, {t: "bet", id});
    const started = new Date(x.d) < new Date() ? "\n⚠️ Ese partido ya empezó; la anoto igual." : "";
    return tg(env, "sendMessage", {chat_id: chat, text: `📝 Anotada: ${x.lbl}${started}\n\n¿A qué momio te la dieron? Escríbelo (ej. 1.51 o -150).`, reply_markup: {inline_keyboard: [[btn(`Mismo momio (${fx(x.p)})`, `bk:${id}`), btn("❌ Cancelar", `bx:${id}`)]]}}); }
  if (op === "bk") { await env.BETS.delete(`await:${chat}`); return tg(env, "sendMessage", {chat_id: chat, text: "Listo ✅ quedó anotada.", reply_markup: HOME}); }
  if (op === "bx" || op === "bd") { await env.BETS.delete(`bet:${chat}:${arg}`); if (op === "bx") await env.BETS.delete(`await:${chat}`);
    return tg(env, "sendMessage", {chat_id: chat, text: "🗑️ Apuesta borrada.", reply_markup: HOME}); }
  if (op === "mine") { const list = await myBets(env, chat);
    const kb = {inline_keyboard: [...(list.length ? [[btn("🗑️ Borrar una", "bdl:")]] : []), [btn("🏠 Inicio", "home")]]};
    await sendLong(env, chat, mineText(list)); return tg(env, "sendMessage", {chat_id: chat, text: "¿Algo más?", reply_markup: kb}); }
  if (op === "bdl") { const list = (await myBets(env, chat)).sort((a, b) => a.id < b.id ? 1 : -1).slice(0, 12);
    return tg(env, "sendMessage", {chat_id: chat, text: "¿Cuál borro?", reply_markup: {inline_keyboard: [...list.map(x => [btn(`🗑️ ${x.lbl.slice(0, 40)}`, `bd:${x.id}`)]), [btn("🏠 Inicio", "home")]]}}); }
}
/* ---------- search ---------- */
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const ICON = {nba: "🏀", nfl: "🏈", soc: "⚽"};
function search(B, q) {
  const qt = norm(q).split(" ").filter(w => w.length >= 2); if (!qt.length) return [];
  const fits = name => { const nt = norm(name).split(" "); return qt.every(w => nt.some(t => t.startsWith(w))); };
  const out = [];
  for (const sp of ["nba", "nfl"]) for (const p of ((B[sp] || {}).find || [])) if (fits(p.n)) out.push({key: `pl:${sp}:${p.aid}`, b: `${ICON[sp]} ${p.n} (${p.t})`});
  for (const sp of ["nba", "nfl", "soc"]) for (const t of ((B[sp] || {}).teams || [])) if (t.names.some(fits) && !out.some(o => o.key === t.key)) out.push({key: t.key, b: `${ICON[sp]} ${t.b}`});
  return out.slice(0, 10);
}

/* ---------- compare a price / check a parlay ---------- */
async function getAwait(env, chat) { const v = await env.BETS.get(`await:${chat}`); if (!v) return null; try { const j = JSON.parse(v); return typeof j === "object" ? j : {t: "bet", id: v}; } catch (e) { return {t: "bet", id: v}; } }
const setAwait = (env, chat, o) => env.BETS.put(`await:${chat}`, JSON.stringify(o), {expirationTtl: 900});
function verdict(pr, p) {
  const ev = pr * p, fair = 1 / pr;
  const v = ev >= 1.03 ? "✅ <b>Conviene</b>: paga más de lo que vale" : ev >= 0.98 ? "➖ <b>Precio justo</b>: paga más o menos lo que vale" : "⚠️ <b>Está caro</b>: paga menos de lo que vale";
  return `${v}\nEstimamos ${Math.round(pr * 100)}%, así que conviene desde <b>${fx(fair)}</b>. A ${fx(p)}, por cada 100 que metes recuperas ~${Math.round(ev * 100)} a la larga.`;
}
const picksOf = (B, key) => { const v = view(B, key); return (v.cmp || v.bets || []).filter(r => B.bets && B.bets[r] && B.bets[r].pr); };
async function toolAction(env, chat, key, editId, B) {
  const op = key.split(":")[0], rest = key.slice(op.length + 1);
  const edit = async (text, kb) => { if (editId) { const r = await tg(env, "editMessageText", {chat_id: chat, message_id: editId, text, reply_markup: kb, parse_mode: "HTML"}); if (r.ok) return; } return tg(env, "sendMessage", {chat_id: chat, text, reply_markup: kb, parse_mode: "HTML"}); };
  if (op === "cm") { const refs = picksOf(B, rest);
    return edit(refs.length ? "💲 ¿Qué pick quieres comparar con el momio de tu casa?" : "No hay picks para comparar aquí.", {inline_keyboard: [...refs.map(r => [btn(`💲 ${B.bets[r].b}`, `c:${r}`)]), [btn("🏠 Inicio", "home")]]}); }
  if (op === "c") { const x = B.bets[rest]; if (!x) return tg(env, "sendMessage", {chat_id: chat, text: "Ese pick ya no está en la lista.", reply_markup: HOME});
    await setAwait(env, chat, {t: "cmp", pr: x.pr, lbl: x.lbl});
    return tg(env, "sendMessage", {chat_id: chat, parse_mode: "HTML", text: `💲 <b>${x.lbl}</b>\nEstimamos ${Math.round(x.pr * 100)}%: conviene si tu casa paga <b>${fx(1 / x.pr)}</b> o más${x.p ? ` (DraftKings: ${fx(x.p)})` : ""}.\n\n¿Cuánto te paga tu casa? Escríbelo (ej. 1.59 o -150).`}); }
  if (op === "pa" || op === "pc") { const i = rest.lastIndexOf(":"), vkey = rest.slice(0, i), mask = parseInt(rest.slice(i + 1) || "0", 36) || 0, refs = picksOf(B, vkey).slice(0, 20);
    const sel = refs.filter((r, k) => mask & (1 << k));
    if (op === "pa") { const kb = [...refs.map((r, k) => [btn(`${mask & (1 << k) ? "✅ " : ""}${B.bets[r].b}`, `pa:${vkey}:${(mask ^ (1 << k)).toString(36)}`)])];
      if (sel.length >= 2) kb.push([btn(`🧮 Calcular parlay de ${sel.length}`, `pc:${vkey}:${mask.toString(36)}`)]); kb.push([btn("🏠 Inicio", "home")]);
      return edit("🧮 Toca los picks de tu parlay (se marcan con ✅) y luego Calcular.", {inline_keyboard: kb}); }
    const xs = sel.map(r => B.bets[r]), pr = xs.reduce((s, x) => s * x.pr, 1), dk = xs.every(x => x.p) ? xs.reduce((s, x) => s * x.p, 1) : null;
    const same = new Set(xs.map(x => x.g)).size < xs.length;
    await setAwait(env, chat, {t: "par", pr, lbl: `Parlay de ${xs.length}`});
    return tg(env, "sendMessage", {chat_id: chat, parse_mode: "HTML", text: [`🧮 <b>Parlay de ${xs.length}</b>`, ...xs.map(x => `• ${x.lbl} · ${Math.round(x.pr * 100)}%`), "",
      `Probabilidad de que peguen todos: <b>${Math.round(pr * 100)}%</b> (más o menos 1 de cada ${Math.max(1, Math.round(1 / pr))}).`, `Conviene si el momio combinado es <b>${fx(1 / pr)}</b> o más${dk ? ` (con los momios de DraftKings daría ${fx(dk)})` : ""}.`,
      ...(same ? ["⚠️ Hay dos picks del mismo partido: pueden estar ligados y la probabilidad real cambia."] : []), "", "¿Qué momio combinado te da tu casa? Escríbelo."].join("\n")}); }
}

/* ---------- alerts settings (read by the before-the-game check in GitHub) ---------- */
async function getCfg(env, chat) { try { return JSON.parse(await env.BETS.get(`cfg:${chat}`) || "{}"); } catch (e) { return {}; } }
function avMenu(cfg) {
  const sp = cfg.sp || {nba: 1, nfl: 1, soc: 1}, paused = cfg.pause && new Date(cfg.pause) > new Date();
  const until = paused ? new Date(cfg.pause).toLocaleString("es-MX", {weekday: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Mexico_City"}) : "";
  return {text: `🔔 Avisos antes del partido: ${paused ? `en pausa hasta ${until}` : "activos"}\nDeportes: ${["nba", "nfl", "soc"].filter(k => sp[k] !== 0).map(k => ({nba: "NBA", nfl: "NFL", soc: "Soccer"})[k]).join(", ") || "ninguno"}\nResumen de mis apuestas en la mañana: ${cfg.daily ? "sí" : "no"}`,
    kb: {inline_keyboard: [paused ? [btn("▶️ Reanudar avisos", "av:on")] : [btn("⏸️ Pausar hoy", "av:p1"), btn("⏸️ Pausar 3 días", "av:p3")],
      ["nba", "nfl", "soc"].map(k => btn(`${sp[k] !== 0 ? "✅" : "⬜"} ${({nba: "NBA", nfl: "NFL", soc: "Soccer"})[k]}`, `av:t:${k}`)),
      [btn(`🌅 Resumen diario: ${cfg.daily ? "quitar" : "activar"}`, "av:d")], [btn("🏠 Inicio", "home")]]}};
}
async function avAction(env, chat, key, editId) {
  const cfg = await getCfg(env, chat), [, op, k] = key.split(":");
  if (op === "p1" || op === "p3") { const d = new Date(Date.now() - 6 * 36e5); d.setUTCHours(0, 0, 0, 0); cfg.pause = new Date(d.getTime() + (op === "p1" ? 1 : 3) * 864e5 + 6 * 36e5 + 5 * 36e5).toISOString(); }
  if (op === "on") cfg.pause = null;
  if (op === "t") { cfg.sp = cfg.sp || {nba: 1, nfl: 1, soc: 1}; cfg.sp[k] = cfg.sp[k] === 0 ? 1 : 0; }
  if (op === "d") cfg.daily = cfg.daily ? 0 : 1;
  if (op) await env.BETS.put(`cfg:${chat}`, JSON.stringify(cfg));
  const m = avMenu(cfg);
  if (editId) { const r = await tg(env, "editMessageText", {chat_id: chat, message_id: editId, text: m.text, reply_markup: m.kb}); if (r.ok) return; }
  return tg(env, "sendMessage", {chat_id: chat, text: m.text, reply_markup: m.kb});
}

// A number typed right after marking a bet, comparing a pick or checking a parlay = the price your book gave
async function oddsReply(env, chat, text) {
  if (!env.BETS) return false; const w = await getAwait(env, chat); if (!w) return false;
  const p = parseOdds(text); if (!p) return false;
  if (w.t === "cmp" || w.t === "par") { await tg(env, "sendMessage", {chat_id: chat, parse_mode: "HTML", text: `<b>${w.lbl}</b> a ${fx(p)}\n${verdict(w.pr, p)}\n\n<i>Si otra casa te da otro momio, escríbelo y lo comparo.</i>`, reply_markup: HOME}); return true; }
  const id = w.id, k = `bet:${chat}:${id}`, r = await env.BETS.getWithMetadata(k); if (!r || !r.value) return false;
  const v = JSON.parse(r.value); v.p = p; await env.BETS.put(k, JSON.stringify(v), {metadata: {...(r.metadata || {}), p}});
  await env.BETS.delete(`await:${chat}`);
  await tg(env, "sendMessage", {chat_id: chat, text: `Listo ✅ ${v.lbl} a ${fx(p)}.${v.pb && p < v.pb - 0.02 ? ` Ojo: DraftKings la pagaba a ${fx(v.pb)}.` : ""}`, reply_markup: HOME});
  return true;
}

// Buttons under every list of picks: mark a bet, compare a price, check a parlay
function tools(env, B, v, key) {
  if (!env.BETS || !key || key.length > 50) return [];
  const marks = (v.bets || []).filter(r => B.bets && B.bets[r] && !B.bets[r].nomark), cmp = (v.cmp || v.bets || []).filter(r => B.bets && B.bets[r] && B.bets[r].pr);
  const row1 = [...(marks.length ? [btn("📝 Marcar lo que aposté", `bm:${key}`)] : []), ...(cmp.length ? [btn("💲 Comparar momio", `cm:${key}`)] : [])];
  return [...(row1.length ? [row1] : []), ...(cmp.length >= 2 ? [[btn("🧮 Revisar un parlay", `pa:${key}:0`)]] : [])];
}

async function handle(env, chat, key, editId) {
  const B = await getJSON(DATA + "bot.json");
  if (!B || !(B.v >= 2)) return tg(env, "sendMessage", {chat_id: chat, text: `No pude leer los picks ahorita. Ábrelos en la app: ${APP}`});
  if (key && /^(bm|b|bk|bx|bd|bdl):|^mine$/.test(key)) return betAction(env, chat, key === "mine" ? "mine:" : key, editId, B);
  if (key && /^(cm|c|pa|pc):/.test(key)) return env.BETS ? toolAction(env, chat, key, editId, B) : tg(env, "sendMessage", {chat_id: chat, text: "No disponible todavía.", reply_markup: HOME});
  if (key && /^av(:|$)/.test(key)) return env.BETS ? avAction(env, chat, key, editId) : tg(env, "sendMessage", {chat_id: chat, text: "No disponible todavía.", reply_markup: HOME});
  if (key && key.startsWith("q:")) { const res = search(B, key.slice(2));
    if (res.length === 1) return handle(env, chat, res[0].key);
    if (res.length) return tg(env, "sendMessage", {chat_id: chat, text: "Encontré varios, ¿cuál?", reply_markup: {inline_keyboard: [...res.map(r => [btn(r.b, r.key)]), [btn("🏠 Inicio", "home")]]}});
    return tg(env, "sendMessage", {chat_id: chat, text: `No encontré "${key.slice(2)}" en los picks de hoy. Prueba con el apellido o el nombre del equipo.`, reply_markup: HOME}); }
  if (key && key.startsWith("dt:")) { const g = allGames(B).find(x => x.id === key.slice(3));
    await sendLong(env, chat, g ? (g.tl || g.t) : "Ese partido ya no está en la lista.");
    return tg(env, "sendMessage", {chat_id: chat, text: "¿Algo más?", reply_markup: HOME}); }
  if (key && key.startsWith("chk:")) {
    for (const id of key.slice(4).split(",")) await sendLong(env, chat, await live(B, id));
    return check(env, chat, await tg(env, "sendMessage", {chat_id: chat, text: "¿Algo más?", reply_markup: {inline_keyboard: [[btn("🔄 Volver a revisar", key)], ...HOME.inline_keyboard]}}), "el menú");
  }
  const v = view(B, key || "home");
  if (v.sendMany) {
    // Each game in its own message so long selections never get cut in half
    for (const t of v.sendMany) await sendLong(env, chat, t);
    await sendLong(env, chat, B.foot);
    const next = view(B, v.after), kb = next.kb || HOME, ids = v.liveMany.join(",");
    const keyb = {inline_keyboard: [...(ids.length + 4 <= 64 ? [[btn(`🔄 Revisar en vivo ${v.liveMany.length > 1 ? "los " + v.liveMany.length : ""}`.trim(), `chk:${ids}`)]] : []),
      ...tools(env, B, v, key), ...kb.inline_keyboard]};
    return check(env, chat, await tg(env, "sendMessage", {chat_id: chat, text: next.text ? `¿Algo más? ${next.text}` : "¿Algo más?", reply_markup: keyb}), "el menú");
  }
  if (v.send) {
    // Charts first (if the chart service fails, the text still goes)
    if (v.imgs && v.imgs.length) { const r = await tg(env, "sendMediaGroup", {chat_id: chat, media: v.imgs.map(u => ({type: "photo", media: u}))}); if (!r.ok) for (const u of v.imgs) await tg(env, "sendPhoto", {chat_id: chat, photo: u}); }
    await sendLong(env, chat, v.send + "\n\n" + B.foot);
    const next = view(B, v.after), kb = next.kb || HOME;
    const keyb = {inline_keyboard: [...(v.live && B.v >= 3 ? [[btn("🔍 Más detalle", `dt:${v.live}`), btn("🔄 Revisar en vivo", `chk:${v.live}`)]] : []),
      ...tools(env, B, v, key), ...kb.inline_keyboard]};
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
    // Data relay for the daily build (some stats sites block GitHub's servers): only these hosts, only with the build's key
    if (url.pathname === "/fx") {
      if (req.headers.get("x-key") !== secret) return new Response("no", {status: 403});
      const t = new URL(url.searchParams.get("u") || "");
      if (!["understat.com", "www.fotmob.com", "fbref.com"].includes(t.hostname)) return new Response("host", {status: 400});
      const r = await fetch(t.toString(), {headers: {"user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36", "accept": "text/html,application/json,*/*", "x-requested-with": url.searchParams.get("x") ? "XMLHttpRequest" : ""}});
      return new Response(r.body, {status: r.status, headers: {"content-type": r.headers.get("content-type") || "text/plain"}});
    }
    if (url.pathname !== "/hook" || req.method !== "POST") return new Response("Picks bot");
    if (req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== secret) return new Response("no", {status: 403});
    const u = await req.json(), msg = u.message, cb = u.callback_query;
    const chat = msg ? msg.chat.id : cb && cb.message.chat.id; if (!chat) return new Response("ok");
    // Only the owner's chat (saved by the daily build) gets answers
    const owner = await getJSON(DATA + "telegram.json"), own = owner && owner.chat ? String(owner.chat) : null, isOwner = !own || own === String(chat);
    // Other people: only with the owner's OK. A newcomer's first message asks the owner (once a day) with ✅ / ❌ buttons
    if (!isOwner) {
      const ok = env.BETS && await env.BETS.get(`allow:${chat}`);
      if (!ok) {
        if (msg && env.BETS && !(await env.BETS.get(`req:${chat}`))) {
          const f = msg.from || {}, who = [f.first_name, f.last_name].filter(Boolean).join(" ") + (f.username ? ` (@${f.username})` : "");
          await env.BETS.put(`req:${chat}`, who || String(chat), {expirationTtl: 86400});
          await tg(env, "sendMessage", {chat_id: own, text: `🔑 ${who || "Alguien"} quiere usar el bot.`, reply_markup: {inline_keyboard: [[{text: "✅ Dar acceso", callback_data: `acc:${chat}`}, {text: "❌ No", callback_data: `den:${chat}`}]]}});
          await tg(env, "sendMessage", {chat_id: chat, text: "Este bot es privado. Ya le avisé al dueño; en cuanto te dé acceso te escribo por aquí."});
        }
        return new Response("ok");
      }
    }
    // Owner: approve / refuse requests, list and remove people
    if (isOwner && cb && /^(acc|den|rmu):/.test(cb.data)) {
      const [op, id] = cb.data.split(":");
      await tg(env, "answerCallbackQuery", {callback_query_id: cb.id});
      const who = (await env.BETS.get(`req:${id}`)) || (await env.BETS.get(`allow:${id}`)) || id;
      if (op === "acc") { await env.BETS.put(`allow:${id}`, who); await tg(env, "sendMessage", {chat_id: id, text: "✅ Ya tienes acceso. Escribe \"picks\" para empezar."}); await tg(env, "sendMessage", {chat_id: chat, text: `Listo: ${who} ya puede usar el bot.`}); }
      if (op === "den") await tg(env, "sendMessage", {chat_id: chat, text: `${who} no tendrá acceso.`});
      if (op === "rmu") { await env.BETS.delete(`allow:${id}`); await tg(env, "sendMessage", {chat_id: chat, text: `${who} ya no tiene acceso.`}); }
      return new Response("ok");
    }
    if (isOwner && msg && /^\/?usuarios$/i.test((msg.text || "").trim())) {
      const r = await env.BETS.list({prefix: "allow:"}), rows = await Promise.all(r.keys.map(async k => [k.name.slice(6), await env.BETS.get(k.name)]));
      await tg(env, "sendMessage", {chat_id: chat, text: rows.length ? "👥 Tienen acceso (toca para quitarlo):" : "Nadie más tiene acceso todavía. Cuando alguien le escriba al bot, te llega un aviso para aprobarlo.",
        reply_markup: rows.length ? {inline_keyboard: rows.map(([id, n]) => [{text: `❌ ${n}`, callback_data: `rmu:${id}`}])} : undefined});
      return new Response("ok");
    }
    // Answer Telegram right away (if it gets an error it retries the same tap and holds back the next ones); the work runs after
    const work = (async () => {
      try {
        if (cb) { await tg(env, "answerCallbackQuery", {callback_query_id: cb.id, text: cb.data.startsWith("chk:") ? "Revisando en ESPN…" : undefined}); await handle(env, chat, cb.data, cb.message && cb.message.message_id); }
        else if (!(await oddsReply(env, chat, msg.text))) { const it = intent(msg.text), t = norm(msg.text);
          // Not a menu word and not a greeting: try it as a player or team name
          await handle(env, chat, it || (t.length >= 3 && !/\b(pick|picks|hola|menu|inicio|dame|gracias|buen|buenas|ayuda|que onda|hey)\b/.test(t) ? "q:" + msg.text.slice(0, 40) : null)); }
      } catch (e) { try { await tg(env, "sendMessage", {chat_id: chat, text: "⚠️ Error del bot: " + (e && e.message || e)}); } catch (e2) {} }
    })();
    if (ctx && ctx.waitUntil) ctx.waitUntil(work); else await work;
    return new Response("ok");
  },
};
