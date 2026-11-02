// Grades the bets marked in the Telegram bot (stored privately in Cloudflare KV, never in the public repo).
// Runs after each build and every 10 minutes; only touches bets whose game should be over.
import {grade} from "./results.mjs";

const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) { console.log("mybets: sin CLOUDFLARE_API_TOKEN"); process.exit(0); }
const API = "https://api.cloudflare.com/client/v4";
const cf = async (path, opt = {}) => { const r = await fetch(API + path, {...opt, headers: {authorization: `Bearer ${token}`, ...(opt.headers || {})}}); return r; };
const js = async (path, opt) => { const r = await cf(path, opt); const j = await r.json().catch(() => null); if (!j || !j.success) throw new Error(path + " " + JSON.stringify(j && j.errors)); return j; };

const acc = process.env.CF_ACCOUNT_ID || (await js("/accounts")).result[0].id;
const ns = (await js(`/accounts/${acc}/storage/kv/namespaces?per_page=100`)).result.find(n => /picks-bets/.test(n.title));
if (!ns) { console.log("mybets: todavía no existe el espacio de apuestas"); process.exit(0); }
const base = `/accounts/${acc}/storage/kv/namespaces/${ns.id}`;
const keys = []; let cursor = "";
do { const j = await js(`${base}/keys?prefix=bet:&limit=1000${cursor ? "&cursor=" + cursor : ""}`); keys.push(...j.result); cursor = j.result_info && j.result_info.cursor; } while (cursor);
const now = Date.now(), due = keys.filter(k => k.metadata && !k.metadata.res && k.metadata.d && now - new Date(k.metadata.d) > 2 * 36e5);
console.log(`mybets: ${keys.length} apuestas, ${due.length} por calificar`);
if (!due.length) process.exit(0);
const items = [];
for (const k of due) { const r = await cf(`${base}/values/${encodeURIComponent(k.name)}`); if (r.ok) items.push({k, x: await r.json()}); }
await grade(items.map(i => i.x));
let n = 0;
for (const {k, x} of items) {
  if (!x.res) continue;
  const fd = new FormData(); fd.append("value", JSON.stringify(x)); fd.append("metadata", JSON.stringify({...k.metadata, res: x.res}));
  const r = await cf(`${base}/values/${encodeURIComponent(k.name)}`, {method: "PUT", body: fd}); if (r.ok) n++;
}
console.log(`mybets: ${n} calificadas`);
