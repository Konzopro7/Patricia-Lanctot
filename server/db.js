import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const file = resolve(process.env.DB_FILE || 'server/data/site.sqlite');
mkdirSync(dirname(file), { recursive: true });
export const db = new DatabaseSync(file, { timeout: 5000 });
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  role TEXT NOT NULL CHECK(role IN ('OWNER','ADMIN','STAFF','VIEWER')),
  password_hash TEXT,
  invite_hash TEXT UNIQUE,
  invite_expires INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  duration INTEGER NOT NULL DEFAULT 30 CHECK(duration IN (15,30,45,60)),
  buffer INTEGER NOT NULL DEFAULT 0 CHECK(buffer BETWEEN 0 AND 60),
  timezone TEXT NOT NULL DEFAULT 'America/Toronto'
);
INSERT OR IGNORE INTO settings(id) VALUES(1);
CREATE TABLE IF NOT EXISTS availability (
  id TEXT PRIMARY KEY,
  weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
  start_min INTEGER NOT NULL CHECK(start_min BETWEEN 0 AND 1439),
  end_min INTEGER NOT NULL CHECK(end_min BETWEEN 1 AND 1440),
  CHECK(start_min < end_min)
);
CREATE TABLE IF NOT EXISTS exceptions (
  id TEXT PRIMARY KEY,
  start_utc INTEGER NOT NULL,
  end_utc INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('BLOCK','OPEN')),
  note TEXT NOT NULL DEFAULT '',
  CHECK(start_utc < end_utc)
);
CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  service TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  start_min INTEGER NOT NULL,
  start_utc INTEGER NOT NULL,
  end_utc INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PENDING','CONFIRMED','REJECTED','CANCELLED','COMPLETED')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK(start_utc < end_utc)
);
CREATE INDEX IF NOT EXISTS appointments_range ON appointments(start_utc,end_utc,status);
CREATE INDEX IF NOT EXISTS appointments_date ON appointments(date,status);
CREATE TABLE IF NOT EXISTS notification_outbox (
  id TEXT PRIMARY KEY,
  appointment_id TEXT REFERENCES appointments(id),
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS request_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS appointment_no_overlap_insert
BEFORE INSERT ON appointments
WHEN NEW.status IN ('PENDING','CONFIRMED')
AND EXISTS (
  SELECT 1 FROM appointments a WHERE a.status IN ('PENDING','CONFIRMED')
  AND a.start_utc < NEW.end_utc AND NEW.start_utc < a.end_utc
)
BEGIN SELECT RAISE(ABORT,'SLOT_OCCUPIED'); END;
CREATE TRIGGER IF NOT EXISTS appointment_no_overlap_update
BEFORE UPDATE OF start_utc,end_utc,status ON appointments
WHEN NEW.status IN ('PENDING','CONFIRMED')
AND EXISTS (
  SELECT 1 FROM appointments a WHERE a.id <> NEW.id
  AND a.status IN ('PENDING','CONFIRMED')
  AND a.start_utc < NEW.end_utc AND NEW.start_utc < a.end_utc
)
BEGIN SELECT RAISE(ABORT,'SLOT_OCCUPIED'); END;
`);

const outboxColumns=new Set(db.prepare('PRAGMA table_info(notification_outbox)').all().map(row=>row.name));
for (const [name,definition] of [
  ['attempts','INTEGER NOT NULL DEFAULT 0'],
  ['next_attempt','INTEGER NOT NULL DEFAULT 0'],
  ['locked_until','INTEGER NOT NULL DEFAULT 0'],
  ['last_error',"TEXT NOT NULL DEFAULT ''"]
]) if (!outboxColumns.has(name)) db.exec(`ALTER TABLE notification_outbox ADD COLUMN ${name} ${definition}`);

export function transaction(work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
