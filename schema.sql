-- English Peers — to‘liq D1 / SQLite schema (peers.txt asosida)
PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS notification_log;
DROP TABLE IF EXISTS peer_feedback;
DROP TABLE IF EXISTS announcements;
DROP TABLE IF EXISTS homework_files;
DROP TABLE IF EXISTS homework;
DROP TABLE IF EXISTS vocab_entries;
DROP TABLE IF EXISTS test_attempts;
DROP TABLE IF EXISTS attendance;
DROP TABLE IF EXISTS lesson_rsvps;
DROP TABLE IF EXISTS lessons;
DROP TABLE IF EXISTS user_badges;
DROP TABLE IF EXISTS xp_log;
DROP TABLE IF EXISTS audit;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  telegram_id     TEXT PRIMARY KEY,
  username        TEXT,
  full_name       TEXT,
  group_code      TEXT,
  level           TEXT,
  experience_json TEXT,
  profile_json    TEXT,
  state_json      TEXT,
  role            TEXT NOT NULL DEFAULT 'learner',
  mod_expires     INTEGER,
  total_xp        INTEGER NOT NULL DEFAULT 0,
  streak_days     INTEGER NOT NULL DEFAULT 0,
  last_attend_date TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_users_group ON users(group_code);
CREATE INDEX idx_users_role ON users(role);

CREATE TABLE xp_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL,
  amount      INTEGER NOT NULL,
  reason      TEXT NOT NULL,
  meta_json   TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
);
CREATE INDEX idx_xp_user ON xp_log(telegram_id);

CREATE TABLE user_badges (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL,
  badge_code  TEXT NOT NULL,
  xp_awarded  INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'awarded',
  awarded_by  TEXT,
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(telegram_id, badge_code),
  FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
);

CREATE TABLE lessons (
  id              TEXT PRIMARY KEY,
  week_start      TEXT,
  lesson_number   INTEGER,
  day_name        TEXT,
  lesson_date     TEXT,
  lesson_time     TEXT DEFAULT '13:20',
  room            TEXT,
  level           TEXT,
  topic           TEXT NOT NULL,
  speaker_id      TEXT,
  speaker_name    TEXT,
  speaker_confirmed INTEGER NOT NULL DEFAULT 0,
  speaker_claimed_at TEXT,
  explanation     TEXT,
  vocab_json      TEXT,
  questions_json  TEXT,
  links_json      TEXT,
  status          TEXT NOT NULL DEFAULT 'active',
  created_by      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_lessons_date ON lessons(lesson_date);
CREATE INDEX idx_lessons_status ON lessons(status);

CREATE TABLE lesson_rsvps (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id   TEXT NOT NULL,
  telegram_id TEXT NOT NULL,
  full_name   TEXT,
  notify      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(lesson_id, telegram_id),
  FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE,
  FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
);

CREATE TABLE attendance (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id   TEXT NOT NULL,
  telegram_id TEXT NOT NULL,
  full_name   TEXT,
  status      TEXT NOT NULL DEFAULT 'absent',
  marked_by   TEXT,
  xp_delta    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(lesson_id, telegram_id),
  FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE,
  FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
);
CREATE INDEX idx_att_user ON attendance(telegram_id);

CREATE TABLE test_attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id   TEXT NOT NULL,
  telegram_id TEXT NOT NULL,
  total_q     INTEGER NOT NULL,
  correct     INTEGER NOT NULL,
  percent     INTEGER NOT NULL,
  answers_json TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE,
  FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
);

CREATE TABLE vocab_entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT,
  lesson_id   TEXT,
  word        TEXT NOT NULL,
  transcription TEXT,
  translation TEXT NOT NULL,
  example     TEXT,
  is_shared   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
);

CREATE TABLE homework (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id     TEXT,
  lesson_title  TEXT,
  telegram_id   TEXT NOT NULL,
  full_name     TEXT,
  answer_text   TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  mentor_comment TEXT,
  student_reply TEXT,
  reviewed_by   TEXT,
  reviewed_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
);

CREATE TABLE homework_files (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  homework_id INTEGER NOT NULL,
  file_type   TEXT NOT NULL,
  file_url    TEXT,
  file_name   TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (homework_id) REFERENCES homework(id) ON DELETE CASCADE
);

CREATE TABLE announcements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  author_id   TEXT,
  author_name TEXT,
  expires_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (author_id) REFERENCES users(telegram_id)
);

CREATE TABLE peer_feedback (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id       TEXT NOT NULL,
  from_name     TEXT,
  to_nickname   TEXT NOT NULL,
  to_id         TEXT,
  went_well     TEXT,
  to_improve    TEXT,
  reply_text    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (from_id) REFERENCES users(telegram_id)
);

CREATE TABLE notification_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL,
  lesson_id   TEXT,
  kind        TEXT NOT NULL,
  payload     TEXT,
  sent_at     TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
);

CREATE TABLE audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT,
  action      TEXT NOT NULL,
  meta_json   TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
