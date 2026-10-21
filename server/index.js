import express from 'express';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, getContent } from './db.js';

const PORT = Number(process.env.PORT) || 5181;
const PROD = process.env.NODE_ENV === 'production';
const COOKIE = 'fp_session';
const SESSION_MS = 30 * 24 * 3600 * 1000;
const here = dirname(fileURLToPath(import.meta.url));

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));

app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' });
  next();
});

/* ---------- utilitaires ---------- */
const sha = (s) => createHash('sha256').update(s).digest('hex');
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, onboarded: !!u.onboarded, theme: u.theme || 'lime' });

function startSession(res, userId) {
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha(token), userId, Date.now() + SESSION_MS);
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: SESSION_MS, path: '/' });
}
function currentUser(req) {
  const token = cookies(req)[COOKIE];
  if (!token) return null;
  const row = db.prepare('SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?').get(sha(token));
  if (!row) return null;
  if (row.expires_at < Date.now()) { db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token)); return null; }
  return row;
}

// origines autorisées : le même site, le serveur de dev Vite (hors production) et ALLOWED_ORIGINS (séparées par des virgules)
const ALLOWED = new Set([
  ...(PROD ? [] : ['http://localhost:5180', 'http://127.0.0.1:5180']),
  ...(process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
]);
function originAllowed(origin, host) {
  if (ALLOWED.has(origin)) return true;
  try { return new URL(origin).host === host; } catch { return false; }
}

// anti-CSRF : une requête qui modifie l'état doit venir du même site
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origin = req.headers.origin;
  if (origin && !originAllowed(origin, req.headers.host)) return res.status(403).json({ error: 'Forbidden origin' });
  if (req.method !== 'DELETE' && !req.is('application/json')) return res.status(415).json({ error: 'JSON required' });
  next();
});

// limite les essais de connexion / inscription (par IP)
const hits = new Map();
function limiter(max, windowMs) {
  return (req, res, next) => {
    const now = Date.now(), k = req.ip;
    const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) { res.set('Retry-After', Math.ceil(windowMs / 1000)); return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' }); }
    arr.push(now); hits.set(k, arr); next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < 15 * 60000)) hits.delete(k); }, 60000).unref();
const authLimit = limiter(10, 15 * 60 * 1000);

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

/* ---------- API ---------- */
app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/welcome', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.json(getContent('welcome'));
});

app.get('/api/auth/me', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const u = currentUser(req);
  res.json({ user: u ? publicUser(u) : null });
});

app.post('/api/auth/register', authLimit, async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  const fields = {};
  if (name.length < 1 || name.length > 40) fields.name = 'Enter your name (max 40 characters).';
  if (!EMAIL.test(email) || email.length > 254) fields.email = 'Enter a valid email address.';
  if (password.length < 8) fields.password = 'Use at least 8 characters.';
  else if (Buffer.byteLength(password) > 72) fields.password = 'Password is too long (max 72 bytes).';
  if (Object.keys(fields).length) return res.status(400).json({ error: 'Please fix the highlighted fields.', fields });

  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    return res.status(409).json({ error: 'An account with this email already exists.', fields: { email: 'This email is already registered. Try logging in.' } });
  }
  const hash = await bcrypt.hash(password, 10);
  const info = db.prepare('INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run(name, email, hash, Date.now());
  startSession(res, Number(info.lastInsertRowid));
  res.status(201).json({ user: { id: Number(info.lastInsertRowid), name, email, onboarded: false } });
});

app.post('/api/auth/login', authLimit, async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH); // même durée si l'email n'existe pas
  if (!user || !ok) return res.status(401).json({ error: 'Invalid email or password.' });
  startSession(res, user.id);
  res.json({ user: publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  const token = cookies(req)[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

/* ----- objectifs ----- */
function requireAuth(req, res, next) {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: 'Please log in to continue.' });
  req.user = u; next();
}
const allGoals = () => db.prepare('SELECT id, label, photo FROM goals ORDER BY position').all();
const selectedGoals = (uid) => db.prepare('SELECT goal_id FROM user_goals WHERE user_id = ?').all(uid).map((r) => r.goal_id);

app.get('/api/goals', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ goals: allGoals(), selected: selectedGoals(req.user.id), onboarded: !!req.user.onboarded });
});

app.put('/api/goals', requireAuth, (req, res) => {
  const ids = req.body?.goals;
  const known = new Set(allGoals().map((g) => g.id));
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > known.size || new Set(ids).size !== ids.length || !ids.every((i) => typeof i === 'string' && known.has(i))) {
    return res.status(400).json({ error: 'Pick between 1 and ' + known.size + ' valid goals.' });
  }
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM user_goals WHERE user_id = ?').run(req.user.id);
    const ins = db.prepare('INSERT INTO user_goals (user_id, goal_id) VALUES (?, ?)');
    ids.forEach((g) => ins.run(req.user.id, g));
    db.prepare('UPDATE users SET onboarded = 1 WHERE id = ?').run(req.user.id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  res.json({ selected: ids, user: publicUser({ ...req.user, onboarded: 1 }) });
});

/* ----- accueil, séances, favoris, historique ----- */
const THEMES = new Set(['lime', 'orange', 'cyan', 'pink']);
const WORKOUT_COLS = `w.id, w.title, w.minutes AS min, w.kcal, w.level, w.photo, w.course_id AS course,
  EXISTS (SELECT 1 FROM favorites f WHERE f.workout_id = w.id AND f.user_id = @uid) AS fav`;
const toWorkout = (r) => ({ id: r.id, title: r.title, min: r.min, kcal: r.kcal, level: r.level, photo: r.photo, course: r.course, fav: !!r.fav });
const tzOffset = (q) => { const n = parseInt(q, 10); return Number.isFinite(n) ? Math.max(-840, Math.min(840, n)) : 0; };
const DAY = 86400000;
const dayIndex = (t, off) => Math.floor((t - off * 60000) / DAY); // jour local du client

// objectif du jour, total de séances et série en cours, dans le fuseau du client
function userStats(user, off) {
  const uid = user.id, today = dayIndex(Date.now(), off), dayStart = today * DAY + off * 60000;
  const total = db.prepare('SELECT COUNT(*) AS n FROM workout_logs WHERE user_id = ?').get(uid).n;
  const todayKcal = db.prepare('SELECT COALESCE(SUM(kcal), 0) AS k FROM workout_logs WHERE user_id = ? AND done_at >= ? AND done_at < ?').get(uid, dayStart, dayStart + DAY).k;
  const days = new Set(db.prepare('SELECT done_at FROM workout_logs WHERE user_id = ? AND done_at > ?').all(uid, Date.now() - 400 * DAY).map((r) => dayIndex(r.done_at, off)));
  let streak = 0; // la série tient encore si on n'a pas encore fait de séance aujourd'hui
  for (let d = days.has(today) ? today : today - 1; days.has(d); d--) streak++;
  return { today: { kcal: todayKcal, goal: user.daily_goal }, totals: { workouts: total, streak } };
}

app.get('/api/home', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const uid = req.user.id, off = tzOffset(req.query.tz);

  const recommended = db.prepare(`SELECT ${WORKOUT_COLS.replace('@uid', '?')},
      (SELECT COUNT(*) FROM workout_goals wg JOIN user_goals ug ON ug.goal_id = wg.goal_id AND ug.user_id = ? WHERE wg.workout_id = w.id) AS score
    FROM workouts w ORDER BY score DESC, w.position LIMIT 6`).all(uid, uid).map(toWorkout);

  const courses = db.prepare(`SELECT c.id, c.name, c.photo, (SELECT COUNT(*) FROM workouts w WHERE w.course_id = c.id) AS count
    FROM courses c ORDER BY c.position`).all();

  const recent = db.prepare(`SELECT l.id, l.workout_id AS workoutId, w.title, l.done_at AS date, l.seconds, l.kcal, l.pct
    FROM workout_logs l JOIN workouts w ON w.id = l.workout_id WHERE l.user_id = ? ORDER BY l.done_at DESC LIMIT 3`).all(uid);

  const favs = db.prepare('SELECT workout_id FROM favorites WHERE user_id = ?').all(uid).map((r) => r.workout_id);
  res.json({
    user: publicUser(req.user),
    settings: { dailyGoal: req.user.daily_goal, theme: req.user.theme },
    ...userStats(req.user, off),
    recommended, courses, recent, favs,
  });
});

app.get('/api/workouts', requireAuth, (req, res) => {
  const q = String(req.query.q ?? '').trim().slice(0, 60).toLowerCase();
  const like = '%' + q.replace(/[!%_]/g, (c) => '!' + c) + '%'; // « ! » sert de caractère d'échappement LIKE
  const rows = db.prepare(`SELECT ${WORKOUT_COLS.replace('@uid', '?')} FROM workouts w JOIN courses c ON c.id = w.course_id
    WHERE lower(w.title) LIKE ? ESCAPE '!' OR lower(w.level) LIKE ? ESCAPE '!' OR lower(c.name) LIKE ? ESCAPE '!' ORDER BY w.position`)
    .all(req.user.id, like, like, like);
  res.json({ workouts: rows.map(toWorkout) });
});

app.get('/api/workouts/:id', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const uid = req.user.id;
  const w = db.prepare(`SELECT w.id, w.title, w.minutes AS min, w.kcal, w.people, w.level, w.description AS desc, w.photo, w.video,
      c.id AS courseId, c.name AS courseName,
      EXISTS (SELECT 1 FROM favorites f WHERE f.workout_id = w.id AND f.user_id = ?) AS fav
    FROM workouts w JOIN courses c ON c.id = w.course_id WHERE w.id = ?`).get(uid, req.params.id);
  if (!w) return res.status(404).json({ error: 'Workout not found.' });
  const exercises = db.prepare('SELECT name, reps, seconds FROM exercises WHERE workout_id = ? ORDER BY position').all(w.id);
  const related = db.prepare(`SELECT ${WORKOUT_COLS.replace('@uid', '?')} FROM workouts w WHERE w.course_id = ? AND w.id != ? ORDER BY w.position LIMIT 2`)
    .all(uid, w.courseId, w.id).map(toWorkout);
  const mine = db.prepare('SELECT COUNT(*) AS n, MAX(done_at) AS last FROM workout_logs WHERE user_id = ? AND workout_id = ?').get(uid, w.id);
  res.json({
    workout: { id: w.id, title: w.title, min: w.min, kcal: w.kcal, people: w.people, level: w.level, desc: w.desc, photo: w.photo, video: w.video,
      course: { id: w.courseId, name: w.courseName }, fav: !!w.fav, exercises },
    related,
    mine: { count: mine.n, last: mine.last },
  });
});

const workoutExists = (id) => !!db.prepare('SELECT 1 FROM workouts WHERE id = ?').get(String(id));
const favList = (uid) => db.prepare('SELECT workout_id FROM favorites WHERE user_id = ?').all(uid).map((r) => r.workout_id);
app.put('/api/favorites/:id', requireAuth, (req, res) => {
  if (!workoutExists(req.params.id)) return res.status(404).json({ error: 'Workout not found.' });
  db.prepare('INSERT OR IGNORE INTO favorites (user_id, workout_id, created_at) VALUES (?, ?, ?)').run(req.user.id, req.params.id, Date.now());
  res.json({ favs: favList(req.user.id) });
});
app.delete('/api/favorites/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM favorites WHERE user_id = ? AND workout_id = ?').run(req.user.id, req.params.id);
  res.json({ favs: favList(req.user.id) });
});

/* ----- séance en cours : démarrage, progression, fin, abandon, résumé ----- */
const MAX_SECONDS = 4 * 3600;
const RESUME_WINDOW = 30 * 60 * 1000;
const workoutTotal = (id) => db.prepare('SELECT COALESCE(SUM(seconds), 1) AS s FROM exercises WHERE workout_id = ?').get(id).s;
const exerciseCount = (id) => db.prepare('SELECT COUNT(*) AS n FROM exercises WHERE workout_id = ?').get(id).n;
const ownRun = (req) => {
  const id = Number(req.params.id);
  return Number.isInteger(id) ? db.prepare('SELECT * FROM sessions_run WHERE id = ? AND user_id = ?').get(id, req.user.id) : undefined;
};
const runJson = (r) => ({ id: r.id, workoutId: r.workout_id, status: r.status, elapsed: r.elapsed, exerciseIdx: r.exercise_idx });
// le temps déclaré ne peut pas dépasser le temps réellement écoulé depuis le début
const capElapsed = (run, claimed) => Math.max(0, Math.min(claimed, MAX_SECONDS, Math.ceil((Date.now() - run.started_at) / 1000) + 5));
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

app.post('/api/sessions', requireAuth, (req, res) => {
  const wid = String(req.body?.workoutId ?? '');
  if (!workoutExists(wid)) return res.status(404).json({ error: 'Workout not found.' });
  const now = Date.now(), uid = req.user.id;
  const open = db.prepare("SELECT * FROM sessions_run WHERE user_id = ? AND status = 'active' ORDER BY updated_at DESC").all(uid);
  const resumable = open.find((r) => r.workout_id === wid && now - r.updated_at < RESUME_WINDOW);
  for (const r of open) if (r !== resumable) db.prepare("UPDATE sessions_run SET status = 'abandoned' WHERE id = ?").run(r.id);
  if (resumable) return res.json({ session: { ...runJson(resumable), resumed: resumable.elapsed > 0 } });
  const info = db.prepare('INSERT INTO sessions_run (user_id, workout_id, started_at, updated_at) VALUES (?, ?, ?, ?)').run(uid, wid, now, now);
  res.status(201).json({ session: { id: Number(info.lastInsertRowid), workoutId: wid, status: 'active', elapsed: 0, exerciseIdx: 0, resumed: false } });
});

app.put('/api/sessions/:id/progress', requireAuth, (req, res) => {
  const run = ownRun(req);
  if (!run) return res.status(404).json({ error: 'Session not found.' });
  if (run.status !== 'active') return res.status(409).json({ error: 'This session is already over.' });
  const { elapsed, exerciseIdx } = req.body ?? {};
  if (!isInt(elapsed, 0, MAX_SECONDS) || !isInt(exerciseIdx, 0, exerciseCount(run.workout_id) - 1)) return res.status(400).json({ error: 'Invalid progress.' });
  db.prepare('UPDATE sessions_run SET elapsed = ?, exercise_idx = ?, updated_at = ? WHERE id = ?')
    .run(Math.max(run.elapsed, capElapsed(run, elapsed)), exerciseIdx, Date.now(), run.id);
  res.json({ ok: true });
});

app.post('/api/sessions/:id/finish', requireAuth, (req, res) => {
  const run = ownRun(req);
  if (!run) return res.status(404).json({ error: 'Session not found.' });
  if (run.status === 'finished') return res.json({ sessionId: run.id }); // appel répété : rien de plus à faire
  if (run.status !== 'active') return res.status(409).json({ error: 'This session was abandoned.' });
  const claimed = req.body?.elapsed;
  if (!isInt(claimed, 1, MAX_SECONDS)) return res.status(400).json({ error: 'Invalid duration.' });
  const secs = Math.max(1, Math.max(run.elapsed, capElapsed(run, claimed)));
  const w = db.prepare('SELECT kcal FROM workouts WHERE id = ?').get(run.workout_id);
  const pct = Math.min(1, secs / workoutTotal(run.workout_id));
  const kcal = Math.max(5, Math.round(w.kcal * Math.max(pct, 0.12)));
  const now = Date.now();
  db.exec('BEGIN');
  try {
    db.prepare("UPDATE sessions_run SET status = 'finished', elapsed = ?, finished_at = ?, kcal = ?, pct = ?, updated_at = ? WHERE id = ?").run(secs, now, kcal, pct, now, run.id);
    db.prepare('INSERT INTO workout_logs (user_id, workout_id, done_at, seconds, kcal, pct, session_id) VALUES (?,?,?,?,?,?,?)').run(req.user.id, run.workout_id, now, secs, kcal, pct, run.id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  res.json({ sessionId: run.id });
});

app.post('/api/sessions/:id/abandon', requireAuth, (req, res) => {
  const run = ownRun(req);
  if (!run) return res.status(404).json({ error: 'Session not found.' });
  if (run.status === 'active') db.prepare("UPDATE sessions_run SET status = 'abandoned', updated_at = ? WHERE id = ?").run(Date.now(), run.id);
  res.json({ ok: true });
});

app.get('/api/sessions/:id', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const run = ownRun(req);
  if (!run || run.status !== 'finished') return res.status(404).json({ error: 'Session not found.' });
  const uid = req.user.id;
  const w = db.prepare(`SELECT w.id, w.title, w.photo, w.course_id AS courseId, c.name AS courseName
    FROM workouts w JOIN courses c ON c.id = w.course_id WHERE w.id = ?`).get(run.workout_id);
  const best = db.prepare('SELECT MAX(kcal) AS k FROM workout_logs WHERE user_id = ? AND workout_id = ? AND session_id != ?').get(uid, run.workout_id, run.id).k;
  const timesDone = db.prepare('SELECT COUNT(*) AS n FROM workout_logs WHERE user_id = ? AND workout_id = ?').get(uid, run.workout_id).n;
  const next = db.prepare(`SELECT ${WORKOUT_COLS.replace('@uid', '?')} FROM workouts w WHERE w.id != ? ORDER BY (w.course_id = ?) DESC, w.position LIMIT 2`)
    .all(uid, w.id, w.courseId).map(toWorkout);
  res.json({
    session: {
      id: run.id, seconds: run.elapsed, kcal: run.kcal, pct: run.pct, finishedAt: run.finished_at,
      workout: { id: w.id, title: w.title, photo: w.photo, course: { id: w.courseId, name: w.courseName } },
      timesDone, newBest: best == null || run.kcal > best,
    },
    ...userStats(req.user, tzOffset(req.query.tz)),
    next,
  });
});

/* ----- favoris (liste), profil, statistiques, suppression ----- */
app.get('/api/favorites', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const rows = db.prepare(`SELECT ${WORKOUT_COLS.replace('@uid', '?')} FROM favorites fv JOIN workouts w ON w.id = fv.workout_id
    WHERE fv.user_id = ? ORDER BY fv.created_at DESC`).all(req.user.id, req.user.id);
  res.json({ workouts: rows.map(toWorkout) });
});

app.get('/api/profile', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const uid = req.user.id, off = tzOffset(req.query.tz), today = dayIndex(Date.now(), off);
  const totals = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(kcal), 0) AS kcal, COALESCE(SUM(seconds), 0) AS secs FROM workout_logs WHERE user_id = ?').get(uid);
  const base = userStats(req.user, off);

  // 7 derniers jours (jour local du client), du plus ancien au plus récent
  const weekStart = (today - 6) * DAY + off * 60000;
  const perDay = new Map();
  for (const r of db.prepare('SELECT done_at, kcal FROM workout_logs WHERE user_id = ? AND done_at >= ?').all(uid, weekStart)) {
    const k = dayIndex(r.done_at, off);
    perDay.set(k, (perDay.get(k) || 0) + r.kcal);
  }
  const week = [...Array(7)].map((_, i) => {
    const d = today - 6 + i;
    return { label: new Date(d * DAY + 12 * 3600000).toLocaleDateString('en', { weekday: 'short', timeZone: 'UTC' }).slice(0, 1), kcal: perDay.get(d) || 0, today: d === today };
  });

  const goals = db.prepare('SELECT g.id, g.label FROM user_goals ug JOIN goals g ON g.id = ug.goal_id WHERE ug.user_id = ? ORDER BY g.position').all(uid);
  const recent = db.prepare(`SELECT l.id, l.workout_id AS workoutId, w.title, l.done_at AS date, l.seconds, l.kcal, l.pct
    FROM workout_logs l JOIN workouts w ON w.id = l.workout_id WHERE l.user_id = ? ORDER BY l.done_at DESC LIMIT 10`).all(uid);
  const bookings = db.prepare(`SELECT b.trainer_id AS trainerId, t.name, b.day, b.slot FROM bookings b JOIN trainers t ON t.id = b.trainer_id
    WHERE b.user_id = ? ORDER BY b.day, b.slot`).all(uid);
  res.json({
    user: publicUser(req.user),
    settings: { dailyGoal: req.user.daily_goal, theme: req.user.theme },
    stats: { workouts: totals.n, kcal: totals.kcal, minutes: Math.round(totals.secs / 60), streak: base.totals.streak },
    week, goals, recent, bookings,
  });
});

app.put('/api/profile', requireAuth, (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (name.length < 1 || name.length > 40) return res.status(400).json({ error: 'Enter your name (max 40 characters).', fields: { name: 'Enter your name (max 40 characters).' } });
  db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, req.user.id);
  res.json({ user: publicUser({ ...req.user, name }) });
});

// efface la progression (séances, historique, favoris) mais garde le compte, les objectifs et les réglages
app.post('/api/profile/reset', requireAuth, (req, res) => {
  const uid = req.user.id;
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM workout_logs WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM sessions_run WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM favorites WHERE user_id = ?').run(uid);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  res.json({ ok: true });
});

// suppression du compte : le mot de passe est redemandé
app.delete('/api/profile', requireAuth, authLimit, async (req, res) => {
  const password = String(req.body?.password ?? '');
  const ok = await bcrypt.compare(password, req.user.password_hash);
  if (!ok) return res.status(403).json({ error: 'Incorrect password.', fields: { password: 'Incorrect password.' } });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id); // cascade : objectifs, séances, favoris, sessions…
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

app.put('/api/settings', requireAuth, (req, res) => {
  const { dailyGoal, theme } = req.body ?? {};
  if (dailyGoal !== undefined && !(Number.isInteger(dailyGoal) && dailyGoal >= 100 && dailyGoal <= 800)) return res.status(400).json({ error: 'Daily goal must be between 100 and 800 kcal.' });
  if (theme !== undefined && !THEMES.has(theme)) return res.status(400).json({ error: 'Unknown theme.' });
  if (dailyGoal !== undefined) db.prepare('UPDATE users SET daily_goal = ? WHERE id = ?').run(dailyGoal, req.user.id);
  if (theme !== undefined) db.prepare('UPDATE users SET theme = ? WHERE id = ?').run(theme, req.user.id);
  const u = db.prepare('SELECT daily_goal, theme FROM users WHERE id = ?').get(req.user.id);
  res.json({ settings: { dailyGoal: u.daily_goal, theme: u.theme } });
});

/* ----- cours ----- */
const likeOf = (q) => '%' + String(q ?? '').trim().slice(0, 60).toLowerCase().replace(/[!%_]/g, (c) => '!' + c) + '%';
const LEVELS = new Set(['Beginner', 'Intermediate', 'Advanced']);
const SORTS = { default: 'w.position', kcal: 'w.kcal DESC, w.position', time: 'w.minutes ASC, w.position' };

app.get('/api/courses', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const courses = db.prepare(`SELECT c.id, c.name, c.photo, (SELECT COUNT(*) FROM workouts w WHERE w.course_id = c.id) AS count
    FROM courses c WHERE lower(c.name) LIKE ? ESCAPE '!' ORDER BY c.position`).all(likeOf(req.query.q));
  res.json({ courses });
});

app.get('/api/courses/:id', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const course = db.prepare('SELECT id, name, photo FROM courses WHERE id = ?').get(req.params.id);
  if (!course) return res.status(404).json({ error: 'Course not found.' });
  const level = String(req.query.level ?? 'All'), sort = String(req.query.sort ?? 'default');
  if (level !== 'All' && !LEVELS.has(level)) return res.status(400).json({ error: 'Unknown level.' });
  if (!Object.hasOwn(SORTS, sort)) return res.status(400).json({ error: 'Unknown sort.' });
  const rows = db.prepare(`SELECT ${WORKOUT_COLS.replace('@uid', '?')} FROM workouts w
    WHERE w.course_id = ? ${level === 'All' ? '' : 'AND w.level = ?'} ORDER BY ${SORTS[sort]}`)
    .all(...[req.user.id, course.id, ...(level === 'All' ? [] : [level])]);
  const total = db.prepare('SELECT COUNT(*) AS n FROM workouts WHERE course_id = ?').get(course.id).n;
  res.json({ course, workouts: rows.map(toWorkout), total });
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

/* ---------- front compilé (production) ---------- */
const dist = join(here, '..', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(join(dist, 'index.html')));
}

// erreurs : jamais de détails internes au client
app.use((err, _req, res, _next) => {
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()), 3600 * 1000).unref();
app.listen(PORT, () => console.log(`FitPulse API on http://localhost:${PORT}`));
