-- Avvalgi bo‘sh jadvallar o‘rniga server.js dagi tuzilmaga mos jadvallar
DROP TABLE IF EXISTS xp_log;
DROP TABLE IF EXISTS attendance;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  telegram_id TEXT PRIMARY KEY,
  username TEXT,
  profile_json TEXT,
  state_json TEXT,
  role TEXT NOT NULL DEFAULT 'learner',
  mod_expires INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT,
  action TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
