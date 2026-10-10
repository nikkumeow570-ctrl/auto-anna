// Auto Anna sync endpoint for Vercel (Node). Stores each driver's trips, expenses and settings in Turso.
// The Turso token lives only in server environment variables, never in the app.
import { createClient } from "@libsql/client";
import { createHash } from "node:crypto";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const KEY_RE = /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/;
const KINDS = new Set(["trip", "exp", "settings"]);
const MAX_CHANGES = 200;
const PAGE = 1000;

let ready;
function init() {
  ready ??= db.batch(
    [
      "CREATE TABLE IF NOT EXISTS drivers (kh TEXT PRIMARY KEY, created INTEGER NOT NULL)",
      `CREATE TABLE IF NOT EXISTS records (
         kh TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL,
         u INTEGER NOT NULL, d INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL, srv INTEGER NOT NULL,
         PRIMARY KEY (kh, kind, id))`,
      "CREATE INDEX IF NOT EXISTS idx_records_srv ON records (kh, srv)",
    ],
    "write"
  ).catch((e) => { ready = undefined; throw e; });
  return ready;
}

const hashKey = (key) =>
  createHash("sha256").update(key + (process.env.KEY_PEPPER || "")).digest("hex");

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const key = String(body.key || "").toUpperCase();
    if (!KEY_RE.test(key)) return res.status(400).json({ error: "bad key" });
    const since = Number.isFinite(Number(body.since)) ? Number(body.since) : 0;
    const changes = Array.isArray(body.changes) ? body.changes : [];
    if (changes.length > MAX_CHANGES) return res.status(413).json({ error: "too many changes" });

    await init();
    const kh = hashKey(key);
    const now = Date.now();
    const maxU = now + 24 * 3600 * 1000; // ignore timestamps far in the future

    const stmts = [{ sql: "INSERT OR IGNORE INTO drivers (kh, created) VALUES (?, ?)", args: [kh, now] }];
    for (const c of changes) {
      if (!c || !KINDS.has(c.kind)) continue;
      const id = String(c.id || "");
      const data = String(c.data || "");
      if (!id || id.length > 40 || !data || data.length > 4000) continue;
      const u = Math.min(Math.floor(Number(c.u)) || 0, maxU);
      stmts.push({
        sql: `INSERT INTO records (kh, kind, id, u, d, data, srv) VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(kh, kind, id) DO UPDATE SET u = excluded.u, d = excluded.d, data = excluded.data, srv = excluded.srv
              WHERE excluded.u > records.u`,
        args: [kh, c.kind, id, u, c.d ? 1 : 0, data, now],
      });
    }
    await db.batch(stmts, "write");

    const rs = await db.execute({
      sql: "SELECT kind, id, u, d, data, srv FROM records WHERE kh = ? AND srv > ? ORDER BY srv ASC LIMIT ?",
      args: [kh, since, PAGE + 1],
    });
    let rows = rs.rows.map((r) => ({
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
    return res.status(200).json({ now, changes: rows, more, last });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "server error" });
  }
}
