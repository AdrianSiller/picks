// Cloudflare KV (the bot's private storage) from GitHub, with the API token saved as a secret
const API = "https://api.cloudflare.com/client/v4";
export async function kv() {
  const token = process.env.CLOUDFLARE_API_TOKEN; if (!token) return null;
  const cf = (path, opt = {}) => fetch(API + path, {...opt, headers: {authorization: `Bearer ${token}`, ...(opt.headers || {})}});
  const js = async (path, opt) => { const r = await cf(path, opt); const j = await r.json().catch(() => null); if (!j || !j.success) throw new Error(path + " " + JSON.stringify(j && j.errors)); return j; };
  const acc = process.env.CF_ACCOUNT_ID || (await js("/accounts")).result[0].id;
  const ns = (await js(`/accounts/${acc}/storage/kv/namespaces?per_page=100`)).result.find(n => /picks-bets/.test(n.title)); if (!ns) return null;
  const base = `/accounts/${acc}/storage/kv/namespaces/${ns.id}`;
  return {
    async list(prefix) { const out = []; let cursor = ""; do { const j = await js(`${base}/keys?prefix=${encodeURIComponent(prefix)}&limit=1000${cursor ? "&cursor=" + cursor : ""}`); out.push(...j.result); cursor = j.result_info && j.result_info.cursor; } while (cursor); return out; },
    async get(key) { const r = await cf(`${base}/values/${encodeURIComponent(key)}`); return r.ok ? r.text() : null; },
    async put(key, value, metadata) { const fd = new FormData(); fd.append("value", typeof value === "string" ? value : JSON.stringify(value)); if (metadata) fd.append("metadata", JSON.stringify(metadata)); return (await cf(`${base}/values/${encodeURIComponent(key)}`, {method: "PUT", body: fd})).ok; },
  };
}
