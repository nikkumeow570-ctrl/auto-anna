// Auto Anna server for Cloudflare Workers + Cloudflare D1.
//   POST /            cloud backup sync (trips, expenses, settings)   [unchanged, old apps keep working]
//   POST /otp/send    send a 6-digit code to the driver's WhatsApp (or SMS) through MSG91
//   POST /otp/verify  check the code, create the driver account, referral and session
//   POST /me          account, referral code, wallet
//   POST /me/link     tie the account to the backup key (so referral trips can be counted)
//   POST /me/update   change name, auto number, city
//   POST /me/logout   end this session
//   POST /me/delete   erase the account and its backup (the driver's right to delete)
//   POST /admin/stats and /admin/export   for you only (header x-admin-key)
//
// Worker settings:
//   Bindings > D1 database > variable name  DB   (your D1 database `auto-anna`)
//   Secrets:   KEY_PEPPER (never change it), ADMIN_KEY, MSG91_AUTHKEY
//   Variables: OTP_PROVIDER = whatsapp | sms | dev      (dev sends nothing; see OTP_DEV)
//              MSG91_NUMBER, MSG91_TEMPLATE, MSG91_NAMESPACE, MSG91_LANG   (WhatsApp)
//              MSG91_SMS_TEMPLATE, MSG91_SMS_VAR                          (SMS)
//              OTP_DEV = 1 returns the code in the reply. For testing ONLY.
//              OTP_DAILY_CAP (default 3000), REF_MIN_TRIPS (3), REF_MIN_DAYS (3), REF_REWARD (10)

const KEY_RE = /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/;
const KINDS = new Set(["trip", "exp", "settings"]);
const MAX_CHANGES = 200;
const PAGE = 1000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-admin-key",
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

async function syncHandler(body, env) {
    try {
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
}

/* ============================ driver accounts ============================ */
const ACC_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS accounts (
     mobile TEXT PRIMARY KEY, name TEXT NOT NULL, auto_no TEXT, city TEXT,
     ref_code TEXT UNIQUE NOT NULL, referred_by TEXT, kh TEXT,
     consent_at INTEGER NOT NULL, created INTEGER NOT NULL, last_seen INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS otps (
     mobile TEXT PRIMARY KEY, code_h TEXT NOT NULL, exp INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0,
     last_sent INTEGER NOT NULL, win_start INTEGER NOT NULL, win_n INTEGER NOT NULL)`,
  "CREATE TABLE IF NOT EXISTS sessions (th TEXT PRIMARY KEY, mobile TEXT NOT NULL, exp INTEGER NOT NULL)",
  `CREATE TABLE IF NOT EXISTS referrals (
     referee TEXT PRIMARY KEY, referrer_code TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
     created INTEGER NOT NULL, qualified_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS wallet (
     id INTEGER PRIMARY KEY AUTOINCREMENT, mobile TEXT NOT NULL, delta INTEGER NOT NULL,
     reason TEXT NOT NULL UNIQUE, created INTEGER NOT NULL)`,
  "CREATE TABLE IF NOT EXISTS ipwin (k TEXT PRIMARY KEY, win_start INTEGER NOT NULL, n INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_ref_code ON referrals (referrer_code, state)",
  "CREATE INDEX IF NOT EXISTS idx_wallet_m ON wallet (mobile)",
  "CREATE INDEX IF NOT EXISTS idx_sess_m ON sessions (mobile)",
];
let accSchemaDone = false;
const HOUR = 3600 * 1000, DAY = 24 * HOUR;
const OTP_TTL = 5 * 60 * 1000, OTP_TRIES = 5, OTP_GAP = 30 * 1000, OTP_PER_HOUR = 5, IP_PER_HOUR = 20;
const SESSION_TTL = 365 * DAY;
const REF_ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const REF_TARGET = 5;

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };
const cleanText = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

function normMobile(v) {
  let d = String(v || "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : "";
}
function randHex(bytes) {
  const a = new Uint8Array(bytes); crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function randCode6() {
  const a = new Uint32Array(1); crypto.getRandomValues(a);
  return String(a[0] % 1000000).padStart(6, "0");
}
function randRef() {
  const a = new Uint8Array(6); crypto.getRandomValues(a);
  return "AA" + [...a].map((b) => REF_ALPHA[b % REF_ALPHA.length]).join("");
}
const tsEq = (a, b) => { // constant-time compare for equal-length hex strings
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
};

async function ensureAcc(env) {
  if (!accSchemaDone) { await env.DB.batch(ACC_SCHEMA.map((s) => env.DB.prepare(s))); accSchemaDone = true; }
}

/* -------- sending the code through MSG91 -------- */
async function sendWhatsapp(env, mobile, code) {
  if (!env.MSG91_AUTHKEY || !env.MSG91_NUMBER || !env.MSG91_TEMPLATE) throw new Error("MSG91 WhatsApp settings missing");
  const r = await fetch("https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/", {
    method: "POST",
    headers: { "Content-Type": "application/json", authkey: env.MSG91_AUTHKEY },
    body: JSON.stringify({
      integrated_number: env.MSG91_NUMBER,
      content_type: "template",
      payload: {
        messaging_product: "whatsapp",
        type: "template",
        template: {
          name: env.MSG91_TEMPLATE,
          language: { code: env.MSG91_LANG || "en", policy: "deterministic" },
          namespace: env.MSG91_NAMESPACE || "",
          to_and_components: [{
            to: ["91" + mobile],
            components: {
              body_1: { type: "text", value: code },
              button_1: { subtype: "url", type: "text", value: code },
            },
          }],
        },
      },
    }),
  });
  let j = null; try { j = await r.json(); } catch { /* ignore */ }
  if (!r.ok || (j && (j.status === "fail" || j.hasError === true))) throw new Error("MSG91 whatsapp " + r.status + " " + JSON.stringify(j).slice(0, 200));
}
async function sendSms(env, mobile, code) {
  if (!env.MSG91_AUTHKEY || !env.MSG91_SMS_TEMPLATE) throw new Error("MSG91 SMS settings missing");
  const rec = { mobiles: "91" + mobile }; rec[env.MSG91_SMS_VAR || "OTP"] = code;
  const r = await fetch("https://control.msg91.com/api/v5/flow/", {
    method: "POST",
    headers: { "Content-Type": "application/json", authkey: env.MSG91_AUTHKEY },
    body: JSON.stringify({ template_id: env.MSG91_SMS_TEMPLATE, short_url: "0", realTimeResponse: "1", recipients: [rec] }),
  });
  let j = null; try { j = await r.json(); } catch { /* ignore */ }
  if (!r.ok || (j && j.type === "error")) throw new Error("MSG91 sms " + r.status + " " + JSON.stringify(j).slice(0, 200));
}

async function bump(env, k, windowMs, now) { // fixed-window counter; returns the new count
  const row = await env.DB.prepare("SELECT win_start, n FROM ipwin WHERE k = ?").bind(k).first();
  if (!row || now - Number(row.win_start) > windowMs) {
    await env.DB.prepare("INSERT INTO ipwin (k, win_start, n) VALUES (?, ?, 1) ON CONFLICT(k) DO UPDATE SET win_start = excluded.win_start, n = 1").bind(k, now).run();
    return 1;
  }
  await env.DB.prepare("UPDATE ipwin SET n = n + 1 WHERE k = ?").bind(k).run();
  return Number(row.n) + 1;
}

async function otpSend(body, env, req) {
  const mobile = normMobile(body.mobile);
  if (!mobile) return json({ error: "bad mobile" }, 400);
  const provider = String(env.OTP_PROVIDER || "dev");
  if (provider === "dev" && env.OTP_DEV !== "1") return json({ error: "otp not configured" }, 503);
  const now = Date.now();
  // Housekeeping: IP counters are kept for at most 2 days (the privacy policy says so). Old codes and sessions go too.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM ipwin WHERE win_start < ?").bind(now - 2 * DAY),
    env.DB.prepare("DELETE FROM otps WHERE exp < ?").bind(now - DAY),
    env.DB.prepare("DELETE FROM sessions WHERE exp < ?").bind(now),
  ]);

  const ip = req.headers.get("CF-Connecting-IP") || "?";
  if ((await bump(env, "ip:" + ip, HOUR, now)) > IP_PER_HOUR) return json({ error: "too many" }, 429);
  const dayKey = "day:" + new Date(now).toISOString().slice(0, 10);
  if ((await bump(env, dayKey, DAY, now)) > num(env.OTP_DAILY_CAP, 3000)) return json({ error: "busy" }, 429);

  const row = await env.DB.prepare("SELECT last_sent, win_start, win_n FROM otps WHERE mobile = ?").bind(mobile).first();
  let winStart = now, winN = 0;
  if (row) {
    const gap = now - Number(row.last_sent);
    if (gap < OTP_GAP) return json({ error: "wait", wait: Math.ceil((OTP_GAP - gap) / 1000) }, 429);
    if (now - Number(row.win_start) <= HOUR) { winStart = Number(row.win_start); winN = Number(row.win_n); }
    if (winN >= OTP_PER_HOUR) return json({ error: "too many" }, 429);
  }
  const code = randCode6();
  const codeH = await sha256Hex(code + ":" + mobile + ":" + (env.KEY_PEPPER || ""));
  await env.DB.prepare(
    `INSERT INTO otps (mobile, code_h, exp, tries, last_sent, win_start, win_n) VALUES (?, ?, ?, 0, ?, ?, ?)
     ON CONFLICT(mobile) DO UPDATE SET code_h = excluded.code_h, exp = excluded.exp, tries = 0,
       last_sent = excluded.last_sent, win_start = excluded.win_start, win_n = excluded.win_n`
  ).bind(mobile, codeH, now + OTP_TTL, now, winStart, winN + 1).run();

  const out = { ok: true, ttl: OTP_TTL / 1000 };
  if (provider === "dev") out.dev_code = code;
  else {
    try { if (provider === "sms") await sendSms(env, mobile, code); else await sendWhatsapp(env, mobile, code); }
    catch (e) {
      console.error(e && e.message);
      await env.DB.prepare("UPDATE otps SET exp = 0 WHERE mobile = ?").bind(mobile).run();
      return json({ error: "send failed" }, 502);
    }
  }
  return json(out);
}

/* -------- account, sessions, wallet -------- */
async function balanceOf(env, mobile) {
  const r = await env.DB.prepare("SELECT COALESCE(SUM(delta), 0) AS b FROM wallet WHERE mobile = ?").bind(mobile).first();
  return Number((r && r.b) || 0);
}
async function qualifyPending(env, code, mobile, now) {
  const minDays = num(env.REF_MIN_DAYS, 3), minTrips = num(env.REF_MIN_TRIPS, 3), reward = num(env.REF_REWARD, 10);
  const rs = await env.DB.prepare(
    `SELECT r.referee, a.kh, a.created FROM referrals r JOIN accounts a ON a.mobile = r.referee
     WHERE r.referrer_code = ? AND r.state = 'pending'`
  ).bind(code).all();
  for (const r of rs.results || []) {
    if (!r.kh || now - Number(r.created) < minDays * DAY) continue;
    const c = await env.DB.prepare("SELECT COUNT(*) AS n FROM records WHERE kh = ? AND kind = 'trip' AND d = 0").bind(r.kh).first();
    if (Number((c && c.n) || 0) < minTrips) continue;
    const q = await env.DB.prepare("SELECT COUNT(*) AS n FROM referrals WHERE referrer_code = ? AND state = 'qualified' AND qualified_at > ?").bind(code, now - 30 * DAY).first();
    if (Number((q && q.n) || 0) >= 50) continue; // monthly cap per driver
    await env.DB.batch([
      env.DB.prepare("UPDATE referrals SET state = 'qualified', qualified_at = ? WHERE referee = ? AND state = 'pending'").bind(now, r.referee),
      env.DB.prepare("INSERT OR IGNORE INTO wallet (mobile, delta, reason, created) VALUES (?, ?, ?, ?)").bind(mobile, reward, "ref:" + r.referee, now),
    ]);
  }
}
async function mePayload(env, acc, now) {
  await qualifyPending(env, acc.ref_code, acc.mobile, now);
  const bal = await balanceOf(env, acc.mobile);
  const st = await env.DB.prepare(
    "SELECT state, COUNT(*) AS n FROM referrals WHERE referrer_code = ? GROUP BY state"
  ).bind(acc.ref_code).all();
  const by = {}; for (const r of st.results || []) by[r.state] = Number(r.n);
  return {
    mobile: acc.mobile, name: acc.name, auto_no: acc.auto_no || "", city: acc.city || "",
    ref_code: acc.ref_code, linked: !!acc.kh,
    wallet: bal, reward: num(env.REF_REWARD, 10),
    refs: { qualified: by.qualified || 0, pending: by.pending || 0, target: REF_TARGET },
  };
}
async function newSession(env, mobile, now) {
  const token = randHex(32);
  await env.DB.prepare("INSERT INTO sessions (th, mobile, exp) VALUES (?, ?, ?)").bind(await sha256Hex(token), mobile, now + SESSION_TTL).run();
  return token;
}
async function authed(body, env, now) {
  const token = String(body.token || "");
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const s = await env.DB.prepare("SELECT mobile, exp FROM sessions WHERE th = ?").bind(await sha256Hex(token)).first();
  if (!s || Number(s.exp) < now) return null;
  const acc = await env.DB.prepare("SELECT * FROM accounts WHERE mobile = ?").bind(s.mobile).first();
  return acc || null;
}

async function otpVerify(body, env) {
  const mobile = normMobile(body.mobile);
  const code = String(body.code || "").replace(/\D/g, "");
  if (!mobile || code.length !== 6) return json({ error: "bad input" }, 400);
  const now = Date.now();
  const row = await env.DB.prepare("SELECT code_h, exp, tries FROM otps WHERE mobile = ?").bind(mobile).first();
  if (!row || Number(row.exp) < now) return json({ error: "expired" }, 400);
  if (Number(row.tries) >= OTP_TRIES) return json({ error: "locked" }, 429);
  const h = await sha256Hex(code + ":" + mobile + ":" + (env.KEY_PEPPER || ""));
  if (!tsEq(h, String(row.code_h))) {
    await env.DB.prepare("UPDATE otps SET tries = tries + 1 WHERE mobile = ?").bind(mobile).run();
    return json({ error: "wrong code", left: Math.max(0, OTP_TRIES - Number(row.tries) - 1) }, 400);
  }

  let acc = await env.DB.prepare("SELECT * FROM accounts WHERE mobile = ?").bind(mobile).first();
  let isNew = false;
  if (!acc) {
    const name = cleanText(body.name, 40);
    if (body.consent !== true) return json({ error: "consent needed" }, 400);
    if (name.length < 2) return json({ error: "name needed" }, 400);
    let ref = String(body.ref || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    let referrer = null;
    if (ref) referrer = await env.DB.prepare("SELECT mobile, ref_code FROM accounts WHERE ref_code = ?").bind(ref).first();
    let myRef = "";
    for (let i = 0; i < 8 && !myRef; i++) {
      const c = randRef();
      const hit = await env.DB.prepare("SELECT 1 AS x FROM accounts WHERE ref_code = ?").bind(c).first();
      if (!hit) myRef = c;
    }
    if (!myRef) return json({ error: "server error" }, 500);
    const stm = [env.DB.prepare(
      "INSERT INTO accounts (mobile, name, auto_no, city, ref_code, referred_by, consent_at, created, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(mobile, name, cleanText(body.auto_no, 14).toUpperCase(), cleanText(body.city, 40), myRef, referrer ? referrer.ref_code : null, now, now, now)];
    if (referrer && referrer.mobile !== mobile) {
      stm.push(env.DB.prepare("INSERT OR IGNORE INTO referrals (referee, referrer_code, state, created) VALUES (?, ?, 'pending', ?)").bind(mobile, referrer.ref_code, now));
    }
    await env.DB.batch(stm);
    acc = await env.DB.prepare("SELECT * FROM accounts WHERE mobile = ?").bind(mobile).first();
    isNew = true;
  } else {
    await env.DB.prepare("UPDATE accounts SET last_seen = ? WHERE mobile = ?").bind(now, mobile).run();
  }
  await env.DB.prepare("DELETE FROM otps WHERE mobile = ?").bind(mobile).run();
  const token = await newSession(env, mobile, now);
  return json({ ok: true, token, isNew, me: await mePayload(env, acc, now) });
}

async function meHandlers(path, body, env) {
  const now = Date.now();
  const acc = await authed(body, env, now);
  if (!acc) return json({ error: "not signed in" }, 401);
  if (path === "/me") {
    await env.DB.prepare("UPDATE accounts SET last_seen = ? WHERE mobile = ?").bind(now, acc.mobile).run();
    return json({ ok: true, me: await mePayload(env, acc, now) });
  }
  if (path === "/me/link") {
    const key = String(body.key || "").toUpperCase();
    if (!KEY_RE.test(key)) return json({ error: "bad key" }, 400);
    const kh = await sha256Hex(key + (env.KEY_PEPPER || ""));
    await env.DB.prepare("UPDATE accounts SET kh = ? WHERE mobile = ?").bind(kh, acc.mobile).run();
    return json({ ok: true });
  }
  if (path === "/me/update") {
    const name = cleanText(body.name, 40) || acc.name;
    await env.DB.prepare("UPDATE accounts SET name = ?, auto_no = ?, city = ? WHERE mobile = ?")
      .bind(name, cleanText(body.auto_no, 14).toUpperCase(), cleanText(body.city, 40), acc.mobile).run();
    return json({ ok: true });
  }
  if (path === "/me/logout") {
    await env.DB.prepare("DELETE FROM sessions WHERE th = ?").bind(await sha256Hex(String(body.token))).run();
    return json({ ok: true });
  }
  if (path === "/me/delete") {
    const stm = [
      env.DB.prepare("DELETE FROM sessions WHERE mobile = ?").bind(acc.mobile),
      env.DB.prepare("DELETE FROM otps WHERE mobile = ?").bind(acc.mobile),
      env.DB.prepare("DELETE FROM wallet WHERE mobile = ?").bind(acc.mobile),
      env.DB.prepare("DELETE FROM referrals WHERE referee = ?").bind(acc.mobile),
      env.DB.prepare("DELETE FROM accounts WHERE mobile = ?").bind(acc.mobile),
    ];
    if (acc.kh) { stm.push(env.DB.prepare("DELETE FROM records WHERE kh = ?").bind(acc.kh)); stm.push(env.DB.prepare("DELETE FROM drivers WHERE kh = ?").bind(acc.kh)); }
    await env.DB.batch(stm);
    return json({ ok: true });
  }
  return json({ error: "not found" }, 404);
}

async function adminHandlers(path, body, env, req) {
  const given = String(req.headers.get("x-admin-key") || "");
  const want = String(env.ADMIN_KEY || "");
  if (!want || want.length < 16 || !tsEq(await sha256Hex(given), await sha256Hex(want))) return json({ error: "no" }, 403);
  const now = Date.now();
  if (path === "/admin/stats") {
    const one = async (q, ...a) => Number(((await env.DB.prepare(q).bind(...a).first()) || {}).n || 0);
    return json({
      drivers: await one("SELECT COUNT(*) AS n FROM accounts"),
      new_7d: await one("SELECT COUNT(*) AS n FROM accounts WHERE created > ?", now - 7 * DAY),
      active_7d: await one("SELECT COUNT(*) AS n FROM accounts WHERE last_seen > ?", now - 7 * DAY),
      with_backup: await one("SELECT COUNT(*) AS n FROM accounts WHERE kh IS NOT NULL"),
      referred: await one("SELECT COUNT(*) AS n FROM accounts WHERE referred_by IS NOT NULL"),
      refs_qualified: await one("SELECT COUNT(*) AS n FROM referrals WHERE state = 'qualified'"),
      wallet_total: await one("SELECT COALESCE(SUM(delta),0) AS n FROM wallet"),
    });
  }
  if (path === "/admin/export") {
    const rs = await env.DB.prepare("SELECT mobile, name, auto_no, city, ref_code, referred_by, created, last_seen FROM accounts ORDER BY created DESC LIMIT 20000").all();
    if (body.format === "csv") {
      const esc = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
      const head = "mobile,name,auto_no,city,ref_code,referred_by,created,last_seen";
      const lines = (rs.results || []).map((r) => [r.mobile, r.name, r.auto_no, r.city, r.ref_code, r.referred_by, new Date(Number(r.created)).toISOString(), new Date(Number(r.last_seen)).toISOString()].map(esc).join(","));
      return new Response(head + "\n" + lines.join("\n") + "\n", { status: 200, headers: { ...CORS, "Content-Type": "text/csv; charset=utf-8" } });
    }
    return json({ drivers: rs.results || [] });
  }
  return json({ error: "not found" }, 404);
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
      const path = new URL(req.url).pathname.replace(/\/+$/, "") || "/";
      if (path === "/") return syncHandler(body, env);
      await ensureAcc(env);
      if (path === "/otp/send") return otpSend(body, env, req);
      if (path === "/otp/verify") return otpVerify(body, env);
      if (path.startsWith("/me")) return meHandlers(path, body, env);
      if (path.startsWith("/admin/")) return adminHandlers(path, body, env, req);
      return json({ error: "not found" }, 404);
    } catch (e) {
      console.error(e && e.message);
      return json({ error: "server error" }, 500);
    }
  },
};
