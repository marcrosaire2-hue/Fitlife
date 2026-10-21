import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const file = process.env.DB_FILE || join(here, 'data', 'fitpulse.db');
mkdirSync(dirname(file), { recursive: true });

export const db = new DatabaseSync(file);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS content (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// migration : colonne « onboarded » (objectifs déjà choisis)
if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'onboarded')) {
  db.exec('ALTER TABLE users ADD COLUMN onboarded INTEGER NOT NULL DEFAULT 0');
}
db.exec(`
  CREATE TABLE IF NOT EXISTS goals (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    photo TEXT NOT NULL,
    position INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS user_goals (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, goal_id)
  );
`);
/* ---------- catalogue (objectifs, cours, séances, coachs) ---------- */
db.exec(`
  CREATE TABLE IF NOT EXISTS courses (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, photo TEXT NOT NULL, position INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS workouts (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id),
    title TEXT NOT NULL, minutes INTEGER NOT NULL, kcal INTEGER NOT NULL, people INTEGER NOT NULL,
    level TEXT NOT NULL, description TEXT NOT NULL, photo TEXT NOT NULL, video TEXT NOT NULL, position INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS workout_goals (
    workout_id TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    PRIMARY KEY (workout_id, goal_id)
  );
  CREATE TABLE IF NOT EXISTS exercises (
    workout_id TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    position INTEGER NOT NULL, name TEXT NOT NULL, reps INTEGER NOT NULL, seconds INTEGER NOT NULL,
    PRIMARY KEY (workout_id, position)
  );
  CREATE TABLE IF NOT EXISTS trainers (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, rate REAL NOT NULL, years INTEGER NOT NULL,
    best INTEGER NOT NULL DEFAULT 0, bio TEXT NOT NULL, photo TEXT NOT NULL, position INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS trainer_tags (
    trainer_id TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE, tag TEXT NOT NULL,
    PRIMARY KEY (trainer_id, tag)
  );
  /* ---------- données des utilisateurs ---------- */
  CREATE TABLE IF NOT EXISTS favorites (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workout_id TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, workout_id)
  );
  CREATE TABLE IF NOT EXISTS workout_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workout_id TEXT NOT NULL REFERENCES workouts(id),
    done_at INTEGER NOT NULL, seconds INTEGER NOT NULL, kcal INTEGER NOT NULL, pct REAL NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_logs_user ON workout_logs(user_id, done_at);
  CREATE TABLE IF NOT EXISTS bookings (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    trainer_id TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
    day TEXT NOT NULL, slot TEXT NOT NULL,
    PRIMARY KEY (user_id, trainer_id)
  );
`);
for (const [col, ddl] of [['daily_goal', 'INTEGER NOT NULL DEFAULT 300'], ['theme', "TEXT NOT NULL DEFAULT 'lime'"]]) {
  if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} ${ddl}`);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions_run (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workout_id TEXT NOT NULL REFERENCES workouts(id),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','finished','abandoned')),
    started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    elapsed INTEGER NOT NULL DEFAULT 0, exercise_idx INTEGER NOT NULL DEFAULT 0,
    finished_at INTEGER, kcal INTEGER, pct REAL
  );
  CREATE INDEX IF NOT EXISTS idx_run_user ON sessions_run(user_id, status);
`);
if (!db.prepare('PRAGMA table_info(workout_logs)').all().some((c) => c.name === 'session_id')) {
  db.exec('ALTER TABLE workout_logs ADD COLUMN session_id INTEGER');
}

const catalog = JSON.parse(readFileSync(join(here, 'catalog.json'), 'utf8'));
db.exec('BEGIN');
try {
  const g = db.prepare('INSERT OR IGNORE INTO goals (id, label, photo, position) VALUES (?, ?, ?, ?)');
  catalog.goals.forEach((x, i) => g.run(x.id, x.label, x.photo, i));
  const c = db.prepare('INSERT OR IGNORE INTO courses (id, name, photo, position) VALUES (?, ?, ?, ?)');
  catalog.courses.forEach((x, i) => c.run(x.id, x.name, x.photo, i));
  const w = db.prepare('INSERT OR IGNORE INTO workouts (id, course_id, title, minutes, kcal, people, level, description, photo, video, position) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  const wg = db.prepare('INSERT OR IGNORE INTO workout_goals (workout_id, goal_id) VALUES (?, ?)');
  const ex = db.prepare('INSERT OR IGNORE INTO exercises (workout_id, position, name, reps, seconds) VALUES (?,?,?,?,?)');
  catalog.workouts.forEach((x, i) => {
    w.run(x.id, x.course, x.title, x.min, x.kcal, x.people, x.level, x.desc, x.photo, x.video, i);
    x.goals.forEach((gid) => wg.run(x.id, gid));
    x.ex.forEach(([n, r, s], p) => ex.run(x.id, p, n, r, s));
  });
  const t = db.prepare('INSERT OR IGNORE INTO trainers (id, name, rate, years, best, bio, photo, position) VALUES (?,?,?,?,?,?,?,?)');
  const tt = db.prepare('INSERT OR IGNORE INTO trainer_tags (trainer_id, tag) VALUES (?, ?)');
  catalog.trainers.forEach((x, i) => { t.run(x.id, x.name, x.rate, x.yrs, x.best ? 1 : 0, x.bio, x.photo, i); x.tags.forEach((tag) => tt.run(x.id, tag)); });
  db.exec('COMMIT');
} catch (e) { db.exec('ROLLBACK'); throw e; }

// contenu de la page de bienvenue : modifiable en base sans toucher au front
const WELCOME = {
  brand: 'FitLife',
  titleLines: ['Push', 'Yourself', 'Harder'],
  subtitle: 'Achieve your fitness goals with our innovative fitness app.',
  cta: 'Get started',
  video: 'media/videos/weights.mp4',
  poster: 'media/photos/17210041.jpg',
};
db.prepare('INSERT OR IGNORE INTO content (key, value) VALUES (?, ?)').run('welcome', JSON.stringify(WELCOME));
// renommage de la marque : met à jour le contenu déjà enregistré
db.prepare("UPDATE content SET value = json_set(value, '$.brand', ?) WHERE key = 'welcome' AND json_extract(value, '$.brand') = 'FitPulse'").run(WELCOME.brand);

export const getContent = (key) => {
  const row = db.prepare('SELECT value FROM content WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : null;
};
