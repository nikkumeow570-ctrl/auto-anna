-- Created automatically by worker.js on first request. Kept here for reference
-- (you can also paste it in the D1 database Console).
CREATE TABLE IF NOT EXISTS drivers (
  kh      TEXT PRIMARY KEY,          -- sha256 of the backup key + pepper (the key itself is never stored)
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS records (
  kh   TEXT NOT NULL,
  kind TEXT NOT NULL,                -- 'trip' | 'exp' | 'settings'
  id   TEXT NOT NULL,
  u    INTEGER NOT NULL,             -- last-updated time from the phone (last write wins)
  d    INTEGER NOT NULL DEFAULT 0,   -- 1 = deleted
  data TEXT NOT NULL,                -- JSON
  srv  INTEGER NOT NULL,             -- server time of the last accepted write
  PRIMARY KEY (kh, kind, id)
);
CREATE INDEX IF NOT EXISTS idx_records_srv ON records (kh, srv);

-- Driver accounts, OTP, referrals, wallet (also created automatically by worker.js)
CREATE TABLE IF NOT EXISTS accounts (
  mobile TEXT PRIMARY KEY, name TEXT NOT NULL, auto_no TEXT, city TEXT,
  ref_code TEXT UNIQUE NOT NULL, referred_by TEXT, kh TEXT,
  consent_at INTEGER NOT NULL, created INTEGER NOT NULL, last_seen INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS otps (
  mobile TEXT PRIMARY KEY, code_h TEXT NOT NULL, exp INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0,
  last_sent INTEGER NOT NULL, win_start INTEGER NOT NULL, win_n INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (th TEXT PRIMARY KEY, mobile TEXT NOT NULL, exp INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS referrals (
  referee TEXT PRIMARY KEY, referrer_code TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
  created INTEGER NOT NULL, qualified_at INTEGER);
CREATE TABLE IF NOT EXISTS wallet (
  id INTEGER PRIMARY KEY AUTOINCREMENT, mobile TEXT NOT NULL, delta INTEGER NOT NULL,
  reason TEXT NOT NULL UNIQUE, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ipwin (k TEXT PRIMARY KEY, win_start INTEGER NOT NULL, n INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_ref_code ON referrals (referrer_code, state);
CREATE INDEX IF NOT EXISTS idx_wallet_m ON wallet (mobile);
CREATE INDEX IF NOT EXISTS idx_sess_m ON sessions (mobile);
