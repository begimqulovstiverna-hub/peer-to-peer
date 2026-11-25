-- English Peers — D1 (SQLite) bazasi
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,                       -- Telegram ID
  username TEXT,
  full_name TEXT NOT NULL,
  nickname TEXT NOT NULL UNIQUE COLLATE NOCASE,
  group_no INTEGER NOT NULL,                    -- 101..107
  direction TEXT NOT NULL,
  level TEXT NOT NULL,                          -- A1..C2
  experiences TEXT NOT NULL DEFAULT '[]',
  xp INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'member',          -- member | moderator | super_admin
  mod_until INTEGER,                            -- vaqtinchalik moderator muddati (ms)
  notify INTEGER NOT NULL DEFAULT 1,
  green_tests INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_number INTEGER,
  topic TEXT NOT NULL,
  level TEXT,
  location TEXT,
  starts_at INTEGER NOT NULL,                   -- UTC ms
  duration_min INTEGER NOT NULL DEFAULT 80,
  speaker_id INTEGER,
  speaker_confirmed INTEGER NOT NULL DEFAULT 0,
  explanation TEXT NOT NULL DEFAULT '',
  vocab TEXT NOT NULL DEFAULT '[]',
  links TEXT NOT NULL DEFAULT '[]',
  questions TEXT NOT NULL DEFAULT '[]',
  created_by INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sched_start ON schedules(starts_at);

CREATE TABLE IF NOT EXISTS rsvps (
  schedule_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  attended TEXT,                                -- present | absent | excused
  created_at INTEGER NOT NULL,
  PRIMARY KEY (schedule_id, user_id)
);

CREATE TABLE IF NOT EXISTS xp_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL, delta INTEGER NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_xp_user ON xp_log(user_id);

CREATE TABLE IF NOT EXISTS badges (
  user_id INTEGER NOT NULL, badge_id TEXT NOT NULL, awarded_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, badge_id)
);

CREATE TABLE IF NOT EXISTS test_results (
  schedule_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
  score INTEGER NOT NULL, total INTEGER NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (schedule_id, user_id)
);

CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,                           -- homework | writing | speaking | listening
  schedule_id INTEGER,
  text TEXT, file_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending',       -- pending | reviewed
  verdict TEXT,                                 -- approved | rejected
  feedback TEXT,
  user_reply TEXT,                              -- foydalanuvchi 1 marta javob qaytaradi
  created_at INTEGER NOT NULL, reviewed_at INTEGER
);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  body TEXT NOT NULL, created_by INTEGER NOT NULL, created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL                   -- 1 haftadan so'ng yashiriladi
);

CREATE TABLE IF NOT EXISTS peer_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER NOT NULL, to_id INTEGER NOT NULL, body TEXT NOT NULL,
  reply TEXT, created_at INTEGER NOT NULL, replied_at INTEGER
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL, text TEXT NOT NULL, read INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read);

CREATE TABLE IF NOT EXISTS reminders_sent (
  schedule_id INTEGER NOT NULL, user_id INTEGER NOT NULL, window_min INTEGER NOT NULL,
  PRIMARY KEY (schedule_id, user_id, window_min)
);

CREATE TABLE IF NOT EXISTS vocab_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL, word TEXT NOT NULL, translation TEXT NOT NULL, created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS key_attempts (user_id INTEGER NOT NULL, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT NOT NULL, created_at INTEGER NOT NULL
);
