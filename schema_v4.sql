ALTER TABLE homework ADD COLUMN file_kind TEXT;
ALTER TABLE homework ADD COLUMN file_name TEXT;
ALTER TABLE homework ADD COLUMN badge TEXT;
ALTER TABLE homework ADD COLUMN badge_xp INTEGER;
CREATE TABLE IF NOT EXISTS homework_files (homework_id INTEGER PRIMARY KEY, mime TEXT, data TEXT);
