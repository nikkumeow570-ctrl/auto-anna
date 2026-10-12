// Auto Anna sync endpoint for Cloudflare Workers + Cloudflare D1.
// Stores each driver's trips, expenses and settings in a D1 database.
// No password or token is in this file or in the app. The app only holds a random backup key.
//
// Worker settings:
//   Bindings > D1 database > variable name  DB   (your D1 database `auto-anna`)
//   Variables and Secrets > KEY_PEPPER (Secret) = long random text. Write it down and never change it.

const KEY_RE = /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/;
const KINDS = new Set(["trip", "exp", "settings"]);
const MAX_CHANGES = 200;
const PAGE = 1000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS drivers (kh TEXT PRIMARY KEY, created INTEGER NOT NULL)",
  `CREATE TABLE IF NOT EXISTS records (
     kh TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL,
     u INTEGER NOT NULL, d INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL, srv INTEGER NOT NULL,
     PRIMARY KEY (kh, kind, id))`,
  "CREATE INDEX IF NOT EXISTS idx_records_srv ON records (kh, srv)",
];
let schemaDone = false;

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (req.method !== "POST") return json({ error: "POST only" }, 405);
    try {
      if (!env.DB) throw new Error("D1 binding DB is missing");
      let body;
      try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
      body = body && typeof body === "object" ? body : {};
      const key = String(body.key || "").toUpperCase();
      if (!KEY_RE.test(key)) return json({ error: "bad key" }, 400);
      const since = Number.isFinite(Number(body.since)) ? Number(body.since) : 0;
      const changes = Array.isArray(body.changes) ? body.changes : [];
      if (changes.length > MAX_CHANGES) return json({ error: "too many changes" }, 413);

      if (!schemaDone) { await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s))); schemaDone = true; }

      const kh = await sha256Hex(key + (env.KEY_PEPPER || ""));
      const now = Date.now();
      const maxU = now + 24 * 3600 * 1000; // ignore timestamps far in the future

      const stmts = [env.DB.prepare("INSERT OR IGNORE INTO drivers (kh, created) VALUES (?, ?)").bind(kh, now)];
      for (const c of changes) {
        if (!c || !KINDS.has(c.kind)) continue;
        const id = String(c.id || "");
        const data = String(c.data || "");
        if (!id || id.length > 40 || !data || data.length > 4000) continue;
        const u = Math.min(Math.floor(Number(c.u)) || 0, maxU);
        stmts.push(
          env.DB.prepare(
            `INSERT INTO records (kh, kind, id, u, d, data, srv) VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(kh, kind, id) DO UPDATE SET u = excluded.u, d = excluded.d, data = excluded.data, srv = excluded.srv
             WHERE excluded.u > records.u`
          ).bind(kh, c.kind, id, u, c.d ? 1 : 0, data, now)
        );
      }
      await env.DB.batch(stmts); // one transaction

      const rs = await env.DB
        .prepare("SELECT kind, id, u, d, data, srv FROM records WHERE kh = ? AND srv > ? ORDER BY srv ASC LIMIT ?")
        .bind(kh, since, PAGE + 1)
        .all();
      let rows = (rs.results || []).map((r) => ({
        kind: r.kind, id: r.id, u: Number(r.u), d: Number(r.d), data: r.data, srv: Number(r.srv),
      }));
      let more = false;
      let last = since;
      if (rows.length > PAGE) {
        // Cut at a whole server-time group so no row is skipped on the next page.
        const cutoff = rows[PAGE].srv;
        rows = rows.filter((r) => r.srv < cutoff);
        more = true;
      }
      if (rows.length) last = rows[rows.length - 1].srv;
      return json({ now, changes: rows, more, last });
    } catch (e) {
      console.error(e && e.message);
      return json({ error: "server error" }, 500);
    }
  },
};
