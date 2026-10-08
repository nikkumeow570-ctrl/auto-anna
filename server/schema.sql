-- Created automatically by api/sync.js on first request. Kept here for reference.
CREATE TABLE IF NOT EXISTS drivers (
  kh      TEXT PRIMARY KEY,          -- sha256 of the backup key (the key itself is never stored)
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
