import express from 'express';
import bcrypt from 'bcryptjs';
import { ObjectId } from 'mongodb';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerSocial } from './social.js';
import { createRealtime } from './realtime.js';
import { activities, bookings, challenges, courses, db, eventMembers, events, favorites, getContent, goals, logs, members, posts, runs, sessions, trainers, users, workouts } from './db.js';

const PORT = Number(process.env.PORT) || 5181;
const PROD = process.env.NODE_ENV === 'production';
const COOKIE = 'fp_session';
const SESSION_MS = 30 * 24 * 3600 * 1000;
const here = dirname(fileURLToPath(import.meta.url));

const app = express();
app.disable('x-powered-by');
if (PROD) app.set('trust proxy', 1);          // derrière le proxy de l'hébergeur : vraie adresse IP des visiteurs (limitation des essais)
// corps JSON limités à 10 ko, sauf l'enregistrement d'une activité (tracé GPS)
const smallJson = express.json({ limit: '10kb' });
const bigJson = express.json({ limit: '400kb' });
app.use((req, res, next) => (req.method === 'POST' && req.path === '/api/activities' ? bigJson : smallJson)(req, res, next));

app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' });
  next();
});

/* ---------- utilitaires ---------- */
const sha = (s) => createHash('sha256').update(s).digest('hex');
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
// administrateurs : adresses e-mail listées dans ADMIN_EMAILS (séparées par des virgules), jamais écrites dans le code
const ADMINS = new Set((process.env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean));
const isAdmin = (u) => ADMINS.has(String(u.email).toLowerCase());
const publicUser = (u) => ({ id: String(u._id), name: u.name, email: u.email, onboarded: !!u.onboarded, theme: u.theme || 'lime', admin: isAdmin(u), avatar: u.avatar_url || null });
// Express 4 ne capte pas les erreurs des handlers async : on les transmet au gestionnaire d'erreurs
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const toId = (s) => (typeof s === 'string' && /^[0-9a-f]{24}$/i.test(s) ? new ObjectId(s) : null);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function startSession(res, userId) {
  const token = randomBytes(32).toString('hex');
  await sessions.insertOne({ _id: sha(token), user_id: userId, expires_at: Date.now() + SESSION_MS });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: SESSION_MS, path: '/' });
}
async function currentUser(req) {
  const token = cookies(req)[COOKIE];
  if (!token) return null;
  const s = await sessions.findOne({ _id: sha(token) });
  if (!s) return null;
  if (s.expires_at < Date.now()) { await sessions.deleteOne({ _id: s._id }); return null; }
  return users.findOne({ _id: s.user_id });
}

// limite le nombre de requêtes sensibles (par IP) ; chaque limiteur a son propre compteur
const limiters = [];
function limiter(max, windowMs) {
  const hits = new Map();
  limiters.push({ hits, windowMs });
  return (req, res, next) => {
    const now = Date.now(), k = req.ip;
    const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) { res.set('Retry-After', Math.ceil(windowMs / 1000)); return res.status(429).json({ error: 'Trop de tentatives. Réessaie dans quelques minutes.' }); }
    arr.push(now); hits.set(k, arr); next();
  };
}
setInterval(() => { const now = Date.now(); for (const { hits, windowMs } of limiters) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k); }, 60000).unref();
const authLimit = limiter(Number(process.env.AUTH_LIMIT_MAX) || 10, 15 * 60 * 1000);   // AUTH_LIMIT_MAX : uniquement pour les tests

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

/* ---------- API ---------- */
app.get('/api/health', ah(async (_req, res) => { await db.command({ ping: 1 }); res.json({ ok: true }); }));

app.get('/api/welcome', ah(async (_req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.json(await getContent('welcome'));
}));

app.get('/api/auth/me', ah(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const u = await currentUser(req);
  res.json({ user: u ? publicUser(u) : null });
}));

app.post('/api/auth/register', authLimit, ah(async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  const fields = {};
  if (name.length < 1 || name.length > 40) fields.name = 'Entre ton nom (40 caractères maximum).';
  if (!EMAIL.test(email) || email.length > 254) fields.email = 'Entre une adresse e-mail valide.';
  if (password.length < 8) fields.password = 'Utilise au moins 8 caractères.';
  else if (Buffer.byteLength(password) > 72) fields.password = 'Le mot de passe est trop long (72 octets maximum).';
  if (Object.keys(fields).length) return res.status(400).json({ error: 'Corrige les champs signalés.', fields });

  const taken = () => res.status(409).json({ error: 'Un compte existe déjà avec cet e-mail.', fields: { email: 'Cet e-mail est déjà inscrit. Essaie de te connecter.' } });
  if (await users.findOne({ email }, { projection: { _id: 1 } })) return taken();
  const user = { name, email, password_hash: await bcrypt.hash(password, 10), created_at: Date.now(), onboarded: false, daily_goal: 300, theme: 'lime', goals: [] };
  try { user._id = (await users.insertOne(user)).insertedId; } catch (e) { if (e.code === 11000) return taken(); throw e; }
  await startSession(res, user._id);
  res.status(201).json({ user: publicUser(user) });
}));

app.post('/api/auth/login', authLimit, ah(async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  const user = await users.findOne({ email });
  const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH); // même durée si l'email n'existe pas
  if (!user || !ok) return res.status(401).json({ error: 'E-mail ou mot de passe incorrect.' });
  await startSession(res, user._id);
  res.json({ user: publicUser(user) });
}));

app.post('/api/auth/logout', ah(async (req, res) => {
  const token = cookies(req)[COOKIE];
  if (token) await sessions.deleteOne({ _id: sha(token) });
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
}));

/* ----- objectifs ----- */
const requireAuth = ah(async (req, res, next) => {
  const u = await currentUser(req);
  if (!u) return res.status(401).json({ error: 'Connecte-toi pour continuer.' });
  req.user = u; next();
});
const allGoals = async () => (await goals.find().sort({ position: 1 }).toArray()).map((g) => ({ id: g._id, label: g.label, photo: g.photo }));

app.get('/api/goals', requireAuth, ah(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ goals: await allGoals(), selected: req.user.goals || [], onboarded: !!req.user.onboarded });
}));

app.put('/api/goals', requireAuth, ah(async (req, res) => {
  const ids = req.body?.goals;
  const known = new Set((await allGoals()).map((g) => g.id));
  // tant que le catalogue n'a aucun objectif, on laisse terminer l'accueil sans en choisir
  if (!Array.isArray(ids) || ids.length < Math.min(1, known.size) || ids.length > known.size || new Set(ids).size !== ids.length || !ids.every((i) => typeof i === 'string' && known.has(i))) {
    return res.status(400).json({ error: 'Choisis entre 1 et ' + known.size + ' objectifs valides.' });
  }
  await users.updateOne({ _id: req.user._id }, { $set: { goals: ids, onboarded: true } });
  res.json({ selected: ids, user: publicUser({ ...req.user, onboarded: true }) });
}));

/* ----- accueil, séances, favoris, historique ----- */
const THEMES = new Set(['lime', 'orange', 'cyan', 'pink']);
const favSet = async (uid) => new Set((await favorites.find({ user_id: uid }).toArray()).map((f) => f.workout_id));
const toWorkout = (w, favs) => ({ id: w._id, title: w.title, min: w.minutes, kcal: w.kcal, level: w.level, photo: w.photo, course: w.course_id, fav: favs.has(w._id) });
const tzOffset = (q) => { const n = parseInt(q, 10); return Number.isFinite(n) ? Math.max(-840, Math.min(840, n)) : 0; };
const DAY = 86400000;
const dayIndex = (t, off) => Math.floor((t - off * 60000) / DAY); // jour local du client

// objectif du jour, total de séances et série en cours, dans le fuseau du client
async function userStats(user, off) {
  const today = dayIndex(Date.now(), off), dayStart = today * DAY + off * 60000;
  const total = await logs.countDocuments({ user_id: user._id });
  const recent = await logs.find({ user_id: user._id, done_at: { $gt: Date.now() - 400 * DAY } }).project({ done_at: 1, kcal: 1 }).toArray();
  const todayKcal = recent.filter((r) => r.done_at >= dayStart && r.done_at < dayStart + DAY).reduce((a, r) => a + r.kcal, 0);
  const days = new Set(recent.map((r) => dayIndex(r.done_at, off)));
  let streak = 0; // la série tient encore si on n'a pas encore fait de séance aujourd'hui
  for (let d = days.has(today) ? today : today - 1; days.has(d); d--) streak++;
  return { today: { kcal: todayKcal, goal: user.daily_goal }, totals: { workouts: total, streak } };
}

app.get('/api/home', requireAuth, ah(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const user = req.user, off = tzOffset(req.query.tz);
  const [all, courseDocs, favs, recentLogs, stats] = await Promise.all([
    workouts.find().sort({ position: 1 }).toArray(),
    courses.find().sort({ position: 1 }).toArray(),
    favSet(user._id),
    logs.find({ user_id: user._id }).sort({ done_at: -1 }).limit(3).toArray(),
    userStats(user, off),
  ]);
  const mine = new Set(user.goals || []);
  const score = (w) => (w.goals || []).filter((g) => mine.has(g)).length;
  const recommended = [...all].sort((a, b) => score(b) - score(a) || a.position - b.position).slice(0, 6).map((w) => toWorkout(w, favs));
  const counts = {}; for (const w of all) counts[w.course_id] = (counts[w.course_id] || 0) + 1;
  const titles = new Map(all.map((w) => [w._id, w.title]));
  res.json({
    user: publicUser(user),
    settings: { dailyGoal: user.daily_goal, theme: user.theme },
    ...stats,
    recommended,
    courses: courseDocs.map((c) => ({ id: c._id, name: c.name, photo: c.photo, count: counts[c._id] || 0 })),
    recent: recentLogs.map((l) => ({ id: String(l._id), workoutId: l.workout_id, title: titles.get(l.workout_id) ?? l.workout_id, date: l.done_at, seconds: l.seconds, kcal: l.kcal, pct: l.pct })),
    favs: [...favs],
  });
}));

app.get('/api/workouts', requireAuth, ah(async (req, res) => {
  const q = String(req.query.q ?? '').trim().slice(0, 60);
  const re = new RegExp(escapeRe(q), 'i');
  const courseIds = (await courses.find({ name: re }).project({ _id: 1 }).toArray()).map((c) => c._id);
  const [rows, favs] = await Promise.all([
    workouts.find({ $or: [{ title: re }, { level: re }, { course_id: { $in: courseIds } }] }).sort({ position: 1 }).toArray(),
    favSet(req.user._id),
  ]);
  res.json({ workouts: rows.map((w) => toWorkout(w, favs)) });
}));

app.get('/api/workouts/:id', requireAuth, ah(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const uid = req.user._id;
  const w = await workouts.findOne({ _id: req.params.id });
  if (!w) return res.status(404).json({ error: 'Séance introuvable.' });
  const [course, relatedRows, favs, doneRows] = await Promise.all([
    courses.findOne({ _id: w.course_id }),
    workouts.find({ course_id: w.course_id, _id: { $ne: w._id } }).sort({ position: 1 }).limit(2).toArray(),
    favSet(uid),
    logs.find({ user_id: uid, workout_id: w._id }).project({ done_at: 1 }).toArray(),
  ]);
  res.json({
    workout: { id: w._id, title: w.title, min: w.minutes, kcal: w.kcal, level: w.level, desc: w.description, photo: w.photo, video: w.video,
      course: { id: w.course_id, name: course?.name ?? '' }, fav: favs.has(w._id), exercises: w.exercises },
    related: relatedRows.map((r) => toWorkout(r, favs)),
    mine: { count: doneRows.length, last: doneRows.length ? Math.max(...doneRows.map((r) => r.done_at)) : null },
  });
}));

const workoutExists = async (id) => !!(await workouts.findOne({ _id: String(id) }, { projection: { _id: 1 } }));
const favList = async (uid) => [...(await favSet(uid))];
app.put('/api/favorites/:id', requireAuth, ah(async (req, res) => {
  if (!(await workoutExists(req.params.id))) return res.status(404).json({ error: 'Séance introuvable.' });
  await favorites.updateOne({ user_id: req.user._id, workout_id: req.params.id }, { $setOnInsert: { created_at: Date.now() } }, { upsert: true });
  res.json({ favs: await favList(req.user._id) });
}));
app.delete('/api/favorites/:id', requireAuth, ah(async (req, res) => {
  await favorites.deleteOne({ user_id: req.user._id, workout_id: req.params.id });
  res.json({ favs: await favList(req.user._id) });
}));

/* ----- séance en cours : démarrage, progression, fin, abandon, résumé ----- */
const MAX_SECONDS = 4 * 3600;
const RESUME_WINDOW = 30 * 60 * 1000;
const ownRun = async (req) => {
  const id = toId(req.params.id);
  return id ? runs.findOne({ _id: id, user_id: req.user._id }) : null;
};
const runJson = (r) => ({ id: String(r._id), workoutId: r.workout_id, status: r.status, elapsed: r.elapsed, exerciseIdx: r.exercise_idx });
// le temps déclaré ne peut pas dépasser le temps réellement écoulé depuis le début
const capElapsed = (run, claimed) => Math.max(0, Math.min(claimed, MAX_SECONDS, Math.ceil((Date.now() - run.started_at) / 1000) + 5));
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

app.post('/api/sessions', requireAuth, ah(async (req, res) => {
  const wid = String(req.body?.workoutId ?? '');
  if (!(await workoutExists(wid))) return res.status(404).json({ error: 'Séance introuvable.' });
  const now = Date.now(), uid = req.user._id;
  const open = await runs.find({ user_id: uid, status: 'active' }).sort({ updated_at: -1 }).toArray();
  const resumable = open.find((r) => r.workout_id === wid && now - r.updated_at < RESUME_WINDOW);
  const stale = open.filter((r) => r !== resumable).map((r) => r._id);
  if (stale.length) await runs.updateMany({ _id: { $in: stale } }, { $set: { status: 'abandoned' } });
  if (resumable) return res.json({ session: { ...runJson(resumable), resumed: resumable.elapsed > 0 } });
  const run = { user_id: uid, workout_id: wid, status: 'active', started_at: now, updated_at: now, elapsed: 0, exercise_idx: 0 };
  run._id = (await runs.insertOne(run)).insertedId;
  res.status(201).json({ session: { ...runJson(run), resumed: false } });
}));

app.put('/api/sessions/:id/progress', requireAuth, ah(async (req, res) => {
  const run = await ownRun(req);
  if (!run) return res.status(404).json({ error: 'Séance en cours introuvable.' });
  if (run.status !== 'active') return res.status(409).json({ error: 'Cette séance est déjà terminée.' });
  const { elapsed, exerciseIdx } = req.body ?? {};
  const w = await workouts.findOne({ _id: run.workout_id }, { projection: { exercises: 1 } });
  if (!isInt(elapsed, 0, MAX_SECONDS) || !isInt(exerciseIdx, 0, (w?.exercises.length ?? 1) - 1)) return res.status(400).json({ error: 'Progression invalide.' });
  await runs.updateOne({ _id: run._id }, { $set: { elapsed: Math.max(run.elapsed, capElapsed(run, elapsed)), exercise_idx: exerciseIdx, updated_at: Date.now() } });
  res.json({ ok: true });
}));

app.post('/api/sessions/:id/finish', requireAuth, ah(async (req, res) => {
  const run = await ownRun(req);
  if (!run) return res.status(404).json({ error: 'Séance en cours introuvable.' });
  if (run.status === 'finished') return res.json({ sessionId: String(run._id) }); // appel répété : rien de plus à faire
  if (run.status !== 'active') return res.status(409).json({ error: 'Cette séance a été abandonnée.' });
  const claimed = req.body?.elapsed;
  if (!isInt(claimed, 1, MAX_SECONDS)) return res.status(400).json({ error: 'Durée invalide.' });
  const secs = Math.max(1, Math.max(run.elapsed, capElapsed(run, claimed)));
  const w = await workouts.findOne({ _id: run.workout_id });
  const total = Math.max(1, w.exercises.reduce((a, e) => a + e.seconds, 0));
  const pct = Math.min(1, secs / total);
  const kcal = Math.max(5, Math.round(w.kcal * Math.max(pct, 0.12)));
  const now = Date.now();
  // le journal est écrit une seule fois par séance (index unique sur session_id), même si l'appel est répété
  await logs.updateOne({ session_id: run._id }, { $setOnInsert: { user_id: req.user._id, workout_id: run.workout_id, done_at: now, seconds: secs, kcal, pct, session_id: run._id } }, { upsert: true });
  await runs.updateOne({ _id: run._id, status: 'active' }, { $set: { status: 'finished', elapsed: secs, finished_at: now, kcal, pct, updated_at: now } });
  res.json({ sessionId: String(run._id) });
}));

app.post('/api/sessions/:id/abandon', requireAuth, ah(async (req, res) => {
  const run = await ownRun(req);
  if (!run) return res.status(404).json({ error: 'Séance en cours introuvable.' });
  if (run.status === 'active') await runs.updateOne({ _id: run._id }, { $set: { status: 'abandoned', updated_at: Date.now() } });
  res.json({ ok: true });
}));

app.get('/api/sessions/:id', requireAuth, ah(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const run = await ownRun(req);
  if (!run || run.status !== 'finished') return res.status(404).json({ error: 'Séance en cours introuvable.' });
  const uid = req.user._id;
  const w = await workouts.findOne({ _id: run.workout_id });
  const [course, bestRow, timesDone, others, favs, stats] = await Promise.all([
    courses.findOne({ _id: w.course_id }),
    logs.find({ user_id: uid, workout_id: run.workout_id, session_id: { $ne: run._id } }).sort({ kcal: -1 }).limit(1).toArray(),
    logs.countDocuments({ user_id: uid, workout_id: run.workout_id }),
    workouts.find({ _id: { $ne: w._id } }).sort({ position: 1 }).toArray(),
    favSet(uid),
    userStats(req.user, tzOffset(req.query.tz)),
  ]);
  const best = bestRow[0]?.kcal ?? null;
  const next = [...others].sort((a, b) => (b.course_id === w.course_id) - (a.course_id === w.course_id) || a.position - b.position).slice(0, 2).map((r) => toWorkout(r, favs));
  res.json({
    session: {
      id: String(run._id), seconds: run.elapsed, kcal: run.kcal, pct: run.pct, finishedAt: run.finished_at,
      workout: { id: w._id, title: w.title, photo: w.photo, course: { id: w.course_id, name: course?.name ?? '' } },
      timesDone, newBest: best == null || run.kcal > best,
    },
    ...stats,
    next,
  });
}));

/* ----- favoris (liste), profil, statistiques, suppression ----- */
app.get('/api/favorites', requireAuth, ah(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const favDocs = await favorites.find({ user_id: req.user._id }).sort({ created_at: -1 }).toArray();
  const byId = new Map((await workouts.find({ _id: { $in: favDocs.map((f) => f.workout_id) } }).toArray()).map((w) => [w._id, w]));
  const favs = new Set(favDocs.map((f) => f.workout_id));
  res.json({ workouts: favDocs.map((f) => byId.get(f.workout_id)).filter(Boolean).map((w) => toWorkout(w, favs)) });
}));

app.get('/api/profile', requireAuth, ah(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const user = req.user, uid = user._id, off = tzOffset(req.query.tz), today = dayIndex(Date.now(), off);
  const [totalsRow, base, weekRows, goalDocs, recentLogs, bookingDocs, workoutDocs] = await Promise.all([
    logs.aggregate([{ $match: { user_id: uid } }, { $group: { _id: null, n: { $sum: 1 }, kcal: { $sum: '$kcal' }, secs: { $sum: '$seconds' } } }]).toArray(),
    userStats(user, off),
    logs.find({ user_id: uid, done_at: { $gte: (today - 6) * DAY + off * 60000 } }).project({ done_at: 1, kcal: 1 }).toArray(),
    goals.find({ _id: { $in: user.goals || [] } }).sort({ position: 1 }).toArray(),
    logs.find({ user_id: uid }).sort({ done_at: -1 }).limit(10).toArray(),
    bookings.find({ user_id: uid }).sort({ day: 1, slot: 1 }).toArray(),
    workouts.find().project({ title: 1 }).toArray(),
  ]);
  const totals = totalsRow[0] ?? { n: 0, kcal: 0, secs: 0 };

  // 7 derniers jours (jour local du client), du plus ancien au plus récent
  const perDay = new Map();
  for (const r of weekRows) { const k = dayIndex(r.done_at, off); perDay.set(k, (perDay.get(k) || 0) + r.kcal); }
  const week = [...Array(7)].map((_, i) => {
    const d = today - 6 + i;
    return { label: new Date(d * DAY + 12 * 3600000).toLocaleDateString('fr', { weekday: 'short', timeZone: 'UTC' }).slice(0, 1), kcal: perDay.get(d) || 0, today: d === today };
  });

  const titles = new Map(workoutDocs.map((w) => [w._id, w.title]));
  const trainerNames = new Map((await trainers.find({ _id: { $in: bookingDocs.map((b) => b.trainer_id) } }).toArray()).map((t) => [t._id, t.name]));
  res.json({
    user: publicUser(user),
    settings: { dailyGoal: user.daily_goal, theme: user.theme },
    stats: { workouts: totals.n, kcal: totals.kcal, minutes: Math.round(totals.secs / 60), streak: base.totals.streak },
    week,
    goals: goalDocs.map((g) => ({ id: g._id, label: g.label })),
    recent: recentLogs.map((l) => ({ id: String(l._id), workoutId: l.workout_id, title: titles.get(l.workout_id) ?? l.workout_id, date: l.done_at, seconds: l.seconds, kcal: l.kcal, pct: l.pct })),
    bookings: bookingDocs.filter((b) => trainerNames.has(b.trainer_id)).map((b) => ({ trainerId: b.trainer_id, name: trainerNames.get(b.trainer_id), day: b.day, slot: b.slot })),
  });
}));

app.put('/api/profile', requireAuth, ah(async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (name.length < 1 || name.length > 40) return res.status(400).json({ error: 'Entre ton nom (40 caractères maximum).', fields: { name: 'Entre ton nom (40 caractères maximum).' } });
  await users.updateOne({ _id: req.user._id }, { $set: { name } });
  res.json({ user: publicUser({ ...req.user, name }) });
}));

// efface la progression (séances, historique, favoris) mais garde le compte, les objectifs et les réglages
app.post('/api/profile/reset', requireAuth, ah(async (req, res) => {
  const uid = req.user._id;
  await Promise.all([logs.deleteMany({ user_id: uid }), runs.deleteMany({ user_id: uid }), favorites.deleteMany({ user_id: uid }), activities.deleteMany({ user_id: uid }), posts.deleteMany({ user_id: uid })]);
  res.json({ ok: true });
}));

// suppression du compte : le mot de passe est redemandé
app.delete('/api/profile', requireAuth, authLimit, ah(async (req, res) => {
  const password = String(req.body?.password ?? '');
  const ok = await bcrypt.compare(password, req.user.password_hash);
  if (!ok) return res.status(403).json({ error: 'Mot de passe incorrect.', fields: { password: 'Mot de passe incorrect.' } });
  await purgeUser(req.user._id);
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
}));

app.put('/api/settings', requireAuth, ah(async (req, res) => {
  const { dailyGoal, theme } = req.body ?? {};
  if (dailyGoal !== undefined && !(Number.isInteger(dailyGoal) && dailyGoal >= 100 && dailyGoal <= 800)) return res.status(400).json({ error: 'L\'objectif quotidien doit être compris entre 100 et 800 kcal.' });
  if (theme !== undefined && !THEMES.has(theme)) return res.status(400).json({ error: 'Thème inconnu.' });
  const set = {};
  if (dailyGoal !== undefined) set.daily_goal = dailyGoal;
  if (theme !== undefined) set.theme = theme;
  if (Object.keys(set).length) await users.updateOne({ _id: req.user._id }, { $set: set });
  const u = await users.findOne({ _id: req.user._id });
  res.json({ settings: { dailyGoal: u.daily_goal, theme: u.theme } });
}));

/* ----- photo de profil : stockée dans Supabase Storage (bucket public), jamais sur ce serveur ----- */
const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || '';            // clé « service_role » : uniquement côté serveur, jamais envoyée au navigateur
const SB_BUCKET = process.env.SUPABASE_BUCKET || 'fitlife';          // un seul bucket public : avatars/, content/, media/
const sbReady = () => !!(SB_URL && SB_KEY);
// nouvelles clés (sb_secret_…) : en-tête apikey seul ; anciennes clés service_role (JWT) : apikey + Authorization
const sbHeaders = (extra = {}) => ({ apikey: SB_KEY, ...(SB_KEY.startsWith('sb_') ? {} : { Authorization: `Bearer ${SB_KEY}` }), ...extra });
const sbPublicUrl = (path) => `${SB_URL}/storage/v1/object/public/${SB_BUCKET}/${path}`;
let sbBucketOk = false;
async function sbEnsureBucket() {
  if (sbBucketOk) return;
  const r = await fetch(`${SB_URL}/storage/v1/bucket`, {
    method: 'POST', headers: sbHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ id: SB_BUCKET, name: SB_BUCKET, public: true, file_size_limit: 5 * 1024 * 1024, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'] }),
  });
  if (r.ok) { sbBucketOk = true; return; }
  if (/already exists|Duplicate/i.test(await r.text())) { sbBucketOk = true; return; }
  throw new Error(`Supabase: impossible de préparer le bucket (${r.status})`);
}
async function sbUpload(path, buf, mime) {
  await sbEnsureBucket();
  const r = await fetch(`${SB_URL}/storage/v1/object/${SB_BUCKET}/${path}`, { method: 'POST', headers: sbHeaders({ 'Content-Type': mime, 'Cache-Control': '3600', 'x-upsert': 'false' }), body: buf });
  if (!r.ok) throw new Error(`Supabase: envoi refusé (${r.status})`);
}
const sbRemove = (path) => (sbReady() && path
  ? fetch(`${SB_URL}/storage/v1/object/${SB_BUCKET}`, { method: 'DELETE', headers: sbHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ prefixes: [path] }) }).catch(() => {})
  : Promise.resolve());

// chemin de l'objet d'après son adresse publique (null si l'image n'est pas dans notre bucket)
const sbPathOf = (url) => { const pre = sbPublicUrl(''); return typeof url === 'string' && sbReady() && url.startsWith(pre) ? url.slice(pre.length) : null; };
// supprime du stockage l'image d'un document quand elle est remplacée (next ≠ ancienne valeur) ou que le document est supprimé (next = null)
const dropOld = async (col, id, field, next) => { const d = await col.findOne({ _id: id }, { projection: { [field]: 1 } }); const old = d?.[field]; if (old && old !== next) await sbRemove(sbPathOf(old)); };

// type réel du fichier d'après ses premiers octets (on ne se fie pas à l'en-tête envoyé par le client)
function sniffImage(b) {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return ['image/jpeg', 'jpg'];
  if (b.length > 12 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ['image/png', 'png'];
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return ['image/webp', 'webp'];
  return null;
}
const avatarLimit = limiter(20, 3600 * 1000);
const rawImage = express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '2mb' });

app.post('/api/profile/avatar', requireAuth, avatarLimit, rawImage, ah(async (req, res) => {
  if (!sbReady()) return res.status(503).json({ error: "Le stockage des photos n'est pas configuré sur ce serveur." });
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: 'Envoie une image (JPEG, PNG ou WebP, 2 Mo maximum).' });
  const kind = sniffImage(buf);
  if (!kind) return res.status(400).json({ error: 'Ce fichier n\'est pas une image JPEG, PNG ou WebP.' });
  const path = `avatars/${req.user._id}/${Date.now()}-${randomBytes(4).toString('hex')}.${kind[1]}`;
  try { await sbUpload(path, buf, kind[0]); } catch (e) { console.error(e.message); return res.status(502).json({ error: 'Impossible d\'enregistrer la photo pour le moment. Réessaie.' }); }
  const url = sbPublicUrl(path), old = req.user.avatar_path;
  await users.updateOne({ _id: req.user._id }, { $set: { avatar_url: url, avatar_path: path } });
  await sbRemove(old);                                                            // l'ancienne photo est supprimée du stockage
  res.json({ user: publicUser({ ...req.user, avatar_url: url }) });
}));

app.delete('/api/profile/avatar', requireAuth, ah(async (req, res) => {
  await users.updateOne({ _id: req.user._id }, { $unset: { avatar_url: '', avatar_path: '' } });
  await sbRemove(req.user.avatar_path);
  res.json({ user: publicUser({ ...req.user, avatar_url: null }) });
}));

/* ----- activités : marche, randonnée, footing, course (durée, distance GPS, pas, tracé) ----- */
const ACTIVITY_TYPES = { walk: 3, hike: 3, jog: 6, run: 12 };      // vitesse plausible maximale (m/s)
const MAX_ROUTE_POINTS = 1500;
const activityJson = (a) => ({ id: String(a._id), type: a.type, startedAt: a.started_at, duration: a.duration, distance: a.distance, steps: a.steps, stepsEstimated: !!a.steps_estimated });

app.post('/api/activities', requireAuth, ah(async (req, res) => {
  const b = req.body ?? {};
  const bad = (m) => res.status(400).json({ error: m });
  if (!Object.hasOwn(ACTIVITY_TYPES, b.type)) return bad('Type d\'activité inconnu.');
  if (!isInt(b.duration, 10, 24 * 3600)) return bad('Durée invalide.');
  if (!Number.isFinite(b.distance) || b.distance < 0 || b.distance > ACTIVITY_TYPES[b.type] * b.duration * 1.2 + 50) return bad('Distance invalide.');
  if (!isInt(b.steps, 0, b.duration * 4)) return bad('Nombre de pas invalide.');
  const now = Date.now();
  if (!Number.isFinite(b.startedAt) || b.startedAt > now + 5 * 60000 || b.startedAt < now - 3 * DAY - b.duration * 1000) return bad('Heure de début invalide.');
  const route = b.route;
  if (!Array.isArray(route) || route.length > MAX_ROUTE_POINTS) return bad('Parcours invalide.');
  for (const p of route) {
    if (!Array.isArray(p) || p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]) > 90 || Math.abs(p[1]) > 180) return bad('Parcours invalide.');
  }
  const doc = {
    user_id: req.user._id, type: b.type, started_at: Math.round(b.startedAt), duration: b.duration,
    distance: Math.round(b.distance), steps: b.steps, steps_estimated: !!b.stepsEstimated,
    route: route.map((p) => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6]), created_at: now,
  };
  doc._id = (await activities.insertOne(doc)).insertedId;
  res.status(201).json({ activity: activityJson(doc) });
}));

app.get('/api/activities', requireAuth, ah(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const rows = await activities.find({ user_id: req.user._id }).project({ route: 0 }).sort({ started_at: -1 }).limit(100).toArray();
  const totals = rows.reduce((t, a) => ({ count: t.count + 1, distance: t.distance + a.distance, duration: t.duration + a.duration, steps: t.steps + a.steps }), { count: 0, distance: 0, duration: 0, steps: 0 });
  res.json({ activities: rows.map(activityJson), totals });
}));

app.get('/api/activities/:id', requireAuth, ah(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const id = toId(req.params.id);
  const a = id && await activities.findOne({ _id: id, user_id: req.user._id });
  if (!a) return res.status(404).json({ error: 'Activité introuvable.' });
  const post = await posts.findOne({ activity_id: a._id }, { projection: { _id: 1 } });
  res.json({ activity: { ...activityJson(a), route: a.route, post: post ? { id: String(post._id) } : null } });
}));

app.delete('/api/activities/:id', requireAuth, ah(async (req, res) => {
  const id = toId(req.params.id);
  if (id && (await activities.deleteOne({ _id: id, user_id: req.user._id })).deletedCount) await posts.deleteMany({ activity_id: id });
  res.json({ ok: true });
}));

/* ----- communauté : publier son résultat ----- */
const PRIVACY_TRIM = 200;                               // m masqués au début et à la fin d'un tracé publié (domicile, travail…)
const distM = (a, b) => {
  const r = (d) => (d * Math.PI) / 180, h = Math.sin(r(b[0] - a[0]) / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(r(b[1] - a[1]) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
};
function trimRoute(route) {
  let from = 0, acc = 0;
  while (from < route.length - 1 && acc < PRIVACY_TRIM) { acc += distM(route[from], route[from + 1]); from++; }
  let to = route.length - 1; acc = 0;
  while (to > from && acc < PRIVACY_TRIM) { acc += distM(route[to], route[to - 1]); to--; }
  const out = route.slice(from, to + 1);
  return out.length >= 2 ? out : [];
}
const postJson = (p, uid, info) => ({
  id: String(p._id), author: { id: String(p.user_id), name: info.get(String(p.user_id))?.name ?? 'Sportif', avatar: info.get(String(p.user_id))?.avatar ?? null }, mine: String(p.user_id) === String(uid),
  caption: p.caption, createdAt: p.created_at, activity: p.activity, route: p.route?.length ? p.route : null,
});
const userInfo = async (ids) => new Map((await users.find({ _id: { $in: ids } }).project({ name: 1, avatar_url: 1 }).toArray()).map((u) => [String(u._id), { name: u.name, avatar: u.avatar_url || null }]));
const nameMap = async (ids) => new Map((await users.find({ _id: { $in: ids } }).project({ name: 1 }).toArray()).map((u) => [String(u._id), u.name]));

app.post('/api/posts', requireAuth, ah(async (req, res) => {
  const activityId = toId(req.body?.activityId);
  const caption = String(req.body?.caption ?? '').trim();
  if (caption.length > 280) return res.status(400).json({ error: 'La légende doit faire 280 caractères au maximum.' });
  const a = activityId && await activities.findOne({ _id: activityId, user_id: req.user._id });
  if (!a) return res.status(404).json({ error: 'Activité introuvable.' });
  const route = req.body?.showRoute === true ? trimRoute(a.route || []) : [];
  const doc = {
    user_id: req.user._id, activity_id: a._id, caption, created_at: Date.now(), route,
    activity: { type: a.type, startedAt: a.started_at, duration: a.duration, distance: a.distance, steps: a.steps, stepsEstimated: !!a.steps_estimated },
  };
  try { doc._id = (await posts.insertOne(doc)).insertedId; } catch (e) { if (e.code === 11000) return res.status(409).json({ error: 'Cette activité est déjà publiée.' }); throw e; }
  res.status(201).json({ post: postJson(doc, req.user._id, new Map([[String(req.user._id), { name: req.user.name, avatar: req.user.avatar_url || null }]])) });
}));

app.get('/api/posts', requireAuth, ah(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const before = Number(req.query.before);
  const rows = await posts.find(Number.isFinite(before) ? { created_at: { $lt: before } } : {}).sort({ created_at: -1 }).limit(21).toArray();
  const page = rows.slice(0, 20);
  const info = await userInfo([...new Set(page.map((p) => p.user_id))]);
  res.json({ posts: page.map((p) => postJson(p, req.user._id, info)), next: rows.length > 20 ? page[page.length - 1].created_at : null, admin: isAdmin(req.user) });
}));

app.delete('/api/posts/:id', requireAuth, ah(async (req, res) => {
  const id = toId(req.params.id);
  if (id) await posts.deleteOne(isAdmin(req.user) ? { _id: id } : { _id: id, user_id: req.user._id });
  res.json({ ok: true });
}));

/* ----- défis (utilisateurs et admin) ----- */
const CH_TYPES = new Set(['any', ...Object.keys(ACTIVITY_TYPES)]);
const CH_METRICS = { distance: [100, 1e6], duration: [60, 3.6e6], steps: [100, 1e7], count: [1, 1000] };   // bornes de la cible (m, s, pas, activités)
const FIELD = { distance: 'distance', duration: 'duration', steps: 'steps', count: 'count' };
const chStatus = (c, now) => (now < c.starts_at ? 'upcoming' : now > c.ends_at ? 'ended' : 'active');
const chJson = (c, extra = {}) => ({
  id: String(c._id), title: c.title, description: c.description, type: c.type, metric: c.metric, target: c.target,
  startsAt: c.starts_at, endsAt: c.ends_at, official: !!c.official, creator: { id: String(c.created_by), name: c.creator_name }, status: chStatus(c, Date.now()), ...extra,
});
// progression de chaque participant : activités du bon type réalisées pendant la période du défi
async function progressFor(c, userIds) {
  const match = { user_id: { $in: userIds }, started_at: { $gte: c.starts_at, $lte: c.ends_at }, ...(c.type === 'any' ? {} : { type: c.type }) };
  const rows = await activities.aggregate([{ $match: match }, { $group: { _id: '$user_id', distance: { $sum: '$distance' }, duration: { $sum: '$duration' }, steps: { $sum: '$steps' }, count: { $sum: 1 } } }]).toArray();
  return new Map(rows.map((r) => [String(r._id), r[FIELD[c.metric]]]));
}
const chLimit = limiter(20, 3600 * 1000);

app.post('/api/challenges', requireAuth, chLimit, ah(async (req, res) => {
  const b = req.body ?? {};
  const bad = (m) => res.status(400).json({ error: m });
  const title = String(b.title ?? '').trim(), description = String(b.description ?? '').trim();
  if (title.length < 3 || title.length > 60) return bad('Donne un titre à ton défi (3 à 60 caractères).');
  if (description.length > 300) return bad('La description doit faire 300 caractères au maximum.');
  if (!CH_TYPES.has(b.type)) return bad('Type d\'activité inconnu.');
  if (!Object.hasOwn(CH_METRICS, b.metric)) return bad('Type d\'objectif inconnu.');
  const [lo, hi] = CH_METRICS[b.metric];
  if (!Number.isFinite(b.target) || b.target < lo || b.target > hi) return bad('La cible est hors limites pour ce type d\'objectif.');
  const now = Date.now();
  if (!Number.isFinite(b.startsAt) || !Number.isFinite(b.endsAt)) return bad('Choisis une date de début et une date de fin.');
  if (b.endsAt <= now) return bad('La date de fin doit être dans le futur.');
  if (b.endsAt <= b.startsAt) return bad('La date de fin doit être après la date de début.');
  if (b.startsAt > now + 366 * DAY || b.endsAt - b.startsAt > 366 * DAY) return bad('Un défi dure un an au maximum et commence dans l\'année.');
  const official = b.official === true && isAdmin(req.user);
  if (b.official === true && !official) return res.status(403).json({ error: 'Seul un administrateur peut créer un défi officiel.' });
  const doc = { title, description, type: b.type, metric: b.metric, target: Math.round(b.target), starts_at: Math.round(b.startsAt), ends_at: Math.round(b.endsAt), created_by: req.user._id, creator_name: req.user.name, official, created_at: now };
  doc._id = (await challenges.insertOne(doc)).insertedId;
  await members.insertOne({ challenge_id: doc._id, user_id: req.user._id, joined_at: now });   // le créateur participe d'office
  res.status(201).json({ challenge: chJson(doc, { joined: true, progress: 0, participants: 1, mine: true }) });
}));

app.get('/api/challenges', requireAuth, ah(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const uid = req.user._id, now = Date.now();
  const list = await challenges.find({ ends_at: { $gt: now - 30 * DAY } }).sort({ official: -1, ends_at: 1 }).limit(100).toArray();   // en cours, à venir, et terminés depuis moins de 30 jours
  const ids = list.map((c) => c._id);
  const [counts, mine] = await Promise.all([
    members.aggregate([{ $match: { challenge_id: { $in: ids } } }, { $group: { _id: '$challenge_id', n: { $sum: 1 } } }]).toArray(),
    members.find({ user_id: uid, challenge_id: { $in: ids } }).toArray(),
  ]);
  const nBy = new Map(counts.map((r) => [String(r._id), r.n])), joined = new Set(mine.map((m) => String(m.challenge_id)));
  const out = [];
  for (const c of list) {
    const isIn = joined.has(String(c._id));
    const progress = isIn ? (await progressFor(c, [uid])).get(String(uid)) ?? 0 : 0;
    out.push(chJson(c, { joined: isIn, progress, participants: nBy.get(String(c._id)) ?? 0, mine: String(c.created_by) === String(uid) }));
  }
  res.json({ challenges: out });
}));

app.get('/api/challenges/:id', requireAuth, ah(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const id = toId(req.params.id);
  const c = id && await challenges.findOne({ _id: id });
  if (!c) return res.status(404).json({ error: 'Défi introuvable.' });
  const mem = await members.find({ challenge_id: c._id }).toArray();
  const uids = mem.map((m) => m.user_id);
  const [prog, info] = await Promise.all([progressFor(c, uids), userInfo(uids)]);
  const board = uids.map((u) => ({ id: String(u), name: info.get(String(u))?.name ?? 'Sportif', avatar: info.get(String(u))?.avatar ?? null, value: prog.get(String(u)) ?? 0, me: String(u) === String(req.user._id) }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  board.forEach((r, i) => { r.rank = i + 1; r.done = r.value >= c.target; });
  const me = board.find((r) => r.me);
  const mineC = String(c.created_by) === String(req.user._id);
  res.json({ challenge: chJson(c, { joined: !!me, progress: me?.value ?? 0, participants: board.length, mine: mineC, canDelete: mineC || isAdmin(req.user) }), leaderboard: board.slice(0, 20), me: me ?? null });
}));

app.post('/api/challenges/:id/join', requireAuth, ah(async (req, res) => {
  const id = toId(req.params.id);
  const c = id && await challenges.findOne({ _id: id });
  if (!c) return res.status(404).json({ error: 'Défi introuvable.' });
  if (Date.now() > c.ends_at) return res.status(409).json({ error: 'Ce défi est terminé.' });
  await members.updateOne({ challenge_id: c._id, user_id: req.user._id }, { $setOnInsert: { joined_at: Date.now() } }, { upsert: true });
  res.json({ ok: true });
}));

app.delete('/api/challenges/:id/join', requireAuth, ah(async (req, res) => {
  const id = toId(req.params.id);
  if (id) await members.deleteOne({ challenge_id: id, user_id: req.user._id });
  res.json({ ok: true });
}));

app.delete('/api/challenges/:id', requireAuth, ah(async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.json({ ok: true });
  const c = await challenges.findOne({ _id: id });
  if (!c) return res.json({ ok: true });
  if (String(c.created_by) !== String(req.user._id) && !isAdmin(req.user)) return res.status(403).json({ error: 'Seuls le créateur ou un administrateur peuvent supprimer ce défi.' });
  await Promise.all([challenges.deleteOne({ _id: id }), members.deleteMany({ challenge_id: id })]);
  res.json({ ok: true });
}));

/* ----- événements à date (publics en lecture, gérés par l'admin) ----- */
const evJson = (e, extra = {}) => ({
  id: String(e._id), title: e.title, description: e.description, place: e.place, image: e.image, startsAt: e.starts_at, endsAt: e.ends_at ?? null, ...extra,
});
const evCounts = async (ids) => new Map((await eventMembers.aggregate([{ $match: { event_id: { $in: ids } } }, { $group: { _id: '$event_id', n: { $sum: 1 } } }]).toArray()).map((r) => [String(r._id), r.n]));

app.get('/api/events', requireAuth, ah(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const list = await events.find({ starts_at: { $gt: Date.now() - 7 * DAY } }).sort({ starts_at: 1 }).limit(100).toArray();
  const ids = list.map((e) => e._id);
  const [counts, mine] = await Promise.all([evCounts(ids), eventMembers.find({ user_id: req.user._id, event_id: { $in: ids } }).toArray()]);
  const joined = new Set(mine.map((m) => String(m.event_id)));
  res.json({ events: list.map((e) => evJson(e, { participants: counts.get(String(e._id)) ?? 0, joined: joined.has(String(e._id)) })) });
}));

app.get('/api/events/:id', requireAuth, ah(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const id = toId(req.params.id);
  const e = id && await events.findOne({ _id: id });
  if (!e) return res.status(404).json({ error: 'Événement introuvable.' });
  const [counts, mine] = await Promise.all([evCounts([e._id]), eventMembers.findOne({ event_id: e._id, user_id: req.user._id })]);
  res.json({ event: evJson(e, { participants: counts.get(String(e._id)) ?? 0, joined: !!mine }) });
}));

app.post('/api/events/:id/join', requireAuth, ah(async (req, res) => {
  const id = toId(req.params.id);
  const e = id && await events.findOne({ _id: id });
  if (!e) return res.status(404).json({ error: 'Événement introuvable.' });
  if (Date.now() > (e.ends_at ?? e.starts_at + 6 * 3600000)) return res.status(409).json({ error: 'Cet événement est terminé.' });
  await eventMembers.updateOne({ event_id: e._id, user_id: req.user._id }, { $setOnInsert: { joined_at: Date.now() } }, { upsert: true });
  res.json({ ok: true });
}));

app.delete('/api/events/:id/join', requireAuth, ah(async (req, res) => {
  const id = toId(req.params.id);
  if (id) await eventMembers.deleteOne({ event_id: id, user_id: req.user._id });
  res.json({ ok: true });
}));

/* ======================= ESPACE ADMINISTRATEUR ======================= */
const requireAdmin = [requireAuth, (req, res, next) => (isAdmin(req.user) ? next() : res.status(403).json({ error: 'Réservé aux administrateurs.' }))];

const adminRaw = express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '6mb' });
const uploadLimit = limiter(120, 3600 * 1000);
app.post('/api/admin/uploads', requireAdmin, uploadLimit, adminRaw, ah(async (req, res) => {
  if (!sbReady()) return res.status(503).json({ error: "Le stockage des images n'est pas configuré sur ce serveur." });
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: 'Envoie une image (JPEG, PNG ou WebP, 5 Mo maximum).' });
  const kind = sniffImage(buf);
  if (!kind) return res.status(400).json({ error: "Ce fichier n'est pas une image JPEG, PNG ou WebP." });
  const path = `content/${Date.now()}-${randomBytes(5).toString('hex')}.${kind[1]}`;
  try { await sbUpload(path, buf, kind[0]); } catch (e) { console.error(e.message); return res.status(502).json({ error: "Impossible d'enregistrer l'image pour le moment. Réessaie." }); }
  res.status(201).json({ url: sbPublicUrl(path) });
}));

// image envoyée par un utilisateur connecté (ex. image d'une communauté), stockée dans Supabase
const userRaw = express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '3mb' });
const userUploadLimit = limiter(30, 3600 * 1000);
app.post('/api/uploads', requireAuth, userUploadLimit, userRaw, ah(async (req, res) => {
  if (!sbReady()) return res.status(503).json({ error: "Le stockage des images n'est pas configuré sur ce serveur." });
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: 'Envoie une image (JPEG, PNG ou WebP, 3 Mo maximum).' });
  const kind = sniffImage(buf);
  if (!kind) return res.status(400).json({ error: "Ce fichier n'est pas une image JPEG, PNG ou WebP." });
  const path = `communities/${req.user._id}/${Date.now()}-${randomBytes(4).toString('hex')}.${kind[1]}`;
  try { await sbUpload(path, buf, kind[0]); } catch (e) { console.error(e.message); return res.status(502).json({ error: "Impossible d'enregistrer l'image pour le moment. Réessaie." }); }
  res.status(201).json({ url: sbPublicUrl(path) });
}));

// textes et liens saisis par l'admin : bornes strictes, liens limités à http(s) ou à un chemin media/ du site
const cleanStr = (v, min, max) => { const s = String(v ?? '').trim(); return s.length >= min && s.length <= max ? s : null; };
const cleanUrl = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return '';
  return s.length <= 500 && (/^https?:\/\/[^\s]+$/i.test(s) || /^media\/[\w./-]+$/.test(s)) ? s : null;
};
const slug = (s) => (s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item') + '-' + randomBytes(2).toString('hex');
const intIn = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);

// suppression complète d'un compte et de toutes ses données
async function purgeUser(uid) {
  await social.purgeUserSocial(uid);
  const gone = await users.findOne({ _id: uid }, { projection: { avatar_path: 1 } });
  await sbRemove(gone?.avatar_path);
  await Promise.all([logs.deleteMany({ user_id: uid }), runs.deleteMany({ user_id: uid }), favorites.deleteMany({ user_id: uid }),
    bookings.deleteMany({ user_id: uid }), activities.deleteMany({ user_id: uid }), posts.deleteMany({ user_id: uid }),
    members.deleteMany({ user_id: uid }), eventMembers.deleteMany({ user_id: uid }), sessions.deleteMany({ user_id: uid })]);
  const mine = (await challenges.find({ created_by: uid }).project({ _id: 1 }).toArray()).map((c) => c._id);
  if (mine.length) await Promise.all([members.deleteMany({ challenge_id: { $in: mine } }), challenges.deleteMany({ _id: { $in: mine } })]);
  await users.deleteOne({ _id: uid });
}

/* ----- tableau de bord ----- */
app.get('/api/admin/overview', requireAdmin, ah(async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  const [u, a, p, c, e, w, co, t, g] = await Promise.all([users, activities, posts, challenges, events, workouts, courses, trainers, goals].map((col) => col.countDocuments()));
  const tot = (await activities.aggregate([{ $group: { _id: null, distance: { $sum: '$distance' }, duration: { $sum: '$duration' }, steps: { $sum: '$steps' } } }]).toArray())[0] ?? { distance: 0, duration: 0, steps: 0 };
  const since = Date.now() - 7 * DAY;
  const [newUsers, newActs] = await Promise.all([users.countDocuments({ created_at: { $gt: since } }), activities.countDocuments({ started_at: { $gt: since } })]);
  res.json({ counts: { users: u, activities: a, posts: p, challenges: c, events: e, workouts: w, courses: co, trainers: t, goals: g }, totals: { distance: tot.distance, duration: tot.duration, steps: tot.steps }, week: { users: newUsers, activities: newActs } });
}));

/* ----- comptes et parcours ----- */
const userStatsMap = async (ids) => {
  const [acts, wk] = await Promise.all([
    activities.aggregate([{ $match: { user_id: { $in: ids } } }, { $group: { _id: '$user_id', count: { $sum: 1 }, distance: { $sum: '$distance' }, duration: { $sum: '$duration' }, steps: { $sum: '$steps' }, last: { $max: '$started_at' } } }]).toArray(),
    logs.aggregate([{ $match: { user_id: { $in: ids } } }, { $group: { _id: '$user_id', n: { $sum: 1 } } }]).toArray(),
  ]);
  const a = new Map(acts.map((r) => [String(r._id), r])), w = new Map(wk.map((r) => [String(r._id), r.n]));
  return (id) => { const r = a.get(String(id)); return { activities: r?.count ?? 0, distance: r?.distance ?? 0, duration: r?.duration ?? 0, steps: r?.steps ?? 0, lastActivity: r?.last ?? null, workouts: w.get(String(id)) ?? 0 }; };
};
const adminUserJson = (u, st) => ({ id: String(u._id), name: u.name, email: u.email, avatar: u.avatar_url || null, createdAt: u.created_at, admin: isAdmin(u), onboarded: !!u.onboarded, ...st(u._id) });

app.get('/api/admin/users', requireAdmin, ah(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const q = String(req.query.q ?? '').trim().slice(0, 60);
  const re = new RegExp(escapeRe(q), 'i');
  const list = await users.find(q ? { $or: [{ name: re }, { email: re }] } : {}).sort({ created_at: -1 }).limit(300).toArray();
  const st = await userStatsMap(list.map((u) => u._id));
  res.json({ users: list.map((u) => adminUserJson(u, st)), total: await users.countDocuments() });
}));

app.get('/api/admin/users/:id', requireAdmin, ah(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const id = toId(req.params.id);
  const u = id && await users.findOne({ _id: id });
  if (!u) return res.status(404).json({ error: 'Compte introuvable.' });
  const [st, acts, goalDocs, chCount, evCount, postCount] = await Promise.all([
    userStatsMap([u._id]),
    activities.find({ user_id: u._id }).project({ route: 0 }).sort({ started_at: -1 }).limit(200).toArray(),
    goals.find({ _id: { $in: u.goals || [] } }).toArray(),
    members.countDocuments({ user_id: u._id }), eventMembers.countDocuments({ user_id: u._id }), posts.countDocuments({ user_id: u._id }),
  ]);
  res.json({
    user: adminUserJson(u, st), goals: goalDocs.map((g) => g.label), challenges: chCount, events: evCount, posts: postCount,
    activities: acts.map((a) => ({ ...activityJson(a), hasRoute: true })),
  });
}));

app.get('/api/admin/activities/:id', requireAdmin, ah(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const id = toId(req.params.id);
  const a = id && await activities.findOne({ _id: id });
  if (!a) return res.status(404).json({ error: 'Activité introuvable.' });
  const u = await users.findOne({ _id: a.user_id }, { projection: { name: 1, email: 1 } });
  res.json({ activity: { ...activityJson(a), route: a.route }, user: u ? { id: String(u._id), name: u.name, email: u.email } : null });
}));

app.delete('/api/admin/activities/:id', requireAdmin, ah(async (req, res) => {
  const id = toId(req.params.id);
  if (id && (await activities.deleteOne({ _id: id })).deletedCount) await posts.deleteMany({ activity_id: id });
  res.json({ ok: true });
}));

// remet à zéro le nombre d'activités d'un utilisateur
app.delete('/api/admin/users/:id/activities', requireAdmin, ah(async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Compte introuvable.' });
  await Promise.all([activities.deleteMany({ user_id: id }), posts.deleteMany({ user_id: id })]);
  res.json({ ok: true });
}));

app.delete('/api/admin/users/:id', requireAdmin, ah(async (req, res) => {
  const id = toId(req.params.id);
  const u = id && await users.findOne({ _id: id });
  if (!u) return res.status(404).json({ error: 'Compte introuvable.' });
  if (isAdmin(u)) return res.status(409).json({ error: 'Un compte administrateur ne peut pas être supprimé ici.' });
  await purgeUser(u._id);
  res.json({ ok: true });
}));

/* ----- contenu : objectifs, cours, séances (avec vidéo), coachs ----- */
app.get('/api/admin/content', requireAdmin, ah(async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  const [g, c, w, t] = await Promise.all([goals.find().sort({ position: 1 }).toArray(), courses.find().sort({ position: 1 }).toArray(), workouts.find().sort({ position: 1 }).toArray(), trainers.find().sort({ position: 1 }).toArray()]);
  res.json({
    goals: g.map((x) => ({ id: x._id, label: x.label, photo: x.photo })),
    courses: c.map((x) => ({ id: x._id, name: x.name, photo: x.photo })),
    workouts: w.map((x) => ({ id: x._id, courseId: x.course_id, title: x.title, minutes: x.minutes, kcal: x.kcal, level: x.level, description: x.description, photo: x.photo, video: x.video, goals: x.goals || [], exercises: x.exercises || [] })),
    trainers: t.map((x) => ({ id: x._id, name: x.name, rate: x.rate, years: x.years, best: !!x.best, bio: x.bio, photo: x.photo, tags: x.tags || [] })),
  });
}));
const nextPos = async (col) => ((await col.find().sort({ position: -1 }).limit(1).toArray())[0]?.position ?? -1) + 1;

const goalBody = (b) => {
  const label = cleanStr(b.label, 2, 40), photo = cleanUrl(b.photo);
  return label && photo !== null ? { label, photo } : null;
};
app.post('/api/admin/goals', requireAdmin, ah(async (req, res) => {
  const d = goalBody(req.body ?? {});
  if (!d) return res.status(400).json({ error: 'Nom (2 à 40 caractères) et lien de photo valides requis.' });
  const doc = { _id: slug(d.label), ...d, position: await nextPos(goals) };
  await goals.insertOne(doc); res.status(201).json({ id: doc._id });
}));
app.put('/api/admin/goals/:id', requireAdmin, ah(async (req, res) => {
  const d = goalBody(req.body ?? {});
  if (!d) return res.status(400).json({ error: 'Nom (2 à 40 caractères) et lien de photo valides requis.' });
  await dropOld(goals, req.params.id, 'photo', d.photo);
  if (!(await goals.updateOne({ _id: req.params.id }, { $set: d })).matchedCount) return res.status(404).json({ error: 'Objectif introuvable.' });
  res.json({ ok: true });
}));
app.delete('/api/admin/goals/:id', requireAdmin, ah(async (req, res) => {
  await dropOld(goals, req.params.id, 'photo', null);
  await Promise.all([goals.deleteOne({ _id: req.params.id }), workouts.updateMany({}, { $pull: { goals: req.params.id } }), users.updateMany({}, { $pull: { goals: req.params.id } })]);
  res.json({ ok: true });
}));

const courseBody = (b) => {
  const name = cleanStr(b.name, 2, 60), photo = cleanUrl(b.photo);
  return name && photo !== null ? { name, photo } : null;
};
app.post('/api/admin/courses', requireAdmin, ah(async (req, res) => {
  const d = courseBody(req.body ?? {});
  if (!d) return res.status(400).json({ error: 'Nom (2 à 60 caractères) et lien de photo valides requis.' });
  const doc = { _id: slug(d.name), ...d, position: await nextPos(courses) };
  await courses.insertOne(doc); res.status(201).json({ id: doc._id });
}));
app.put('/api/admin/courses/:id', requireAdmin, ah(async (req, res) => {
  const d = courseBody(req.body ?? {});
  if (!d) return res.status(400).json({ error: 'Nom (2 à 60 caractères) et lien de photo valides requis.' });
  await dropOld(courses, req.params.id, 'photo', d.photo);
  if (!(await courses.updateOne({ _id: req.params.id }, { $set: d })).matchedCount) return res.status(404).json({ error: 'Cours introuvable.' });
  res.json({ ok: true });
}));
app.delete('/api/admin/courses/:id', requireAdmin, ah(async (req, res) => {
  if (await workouts.countDocuments({ course_id: req.params.id })) return res.status(409).json({ error: 'Supprime ou déplace d\'abord les séances de ce cours.' });
  await dropOld(courses, req.params.id, 'photo', null);
  await courses.deleteOne({ _id: req.params.id });
  res.json({ ok: true });
}));

const WORKOUT_LEVELS = ['Beginner', 'Intermediate', 'Advanced'];
async function workoutBody(b) {
  const title = cleanStr(b.title, 2, 80), description = String(b.description ?? '').trim().slice(0, 1000);
  const minutes = intIn(b.minutes, 1, 600), kcal = intIn(b.kcal, 1, 5000);
  const photo = cleanUrl(b.photo), video = cleanUrl(b.video);
  if (!title || minutes == null || kcal == null || photo === null || video === null || !WORKOUT_LEVELS.includes(b.level)) return { error: 'Titre, durée, calories, niveau et liens (photo, vidéo) valides requis.' };
  if (!(await courses.findOne({ _id: String(b.courseId) }, { projection: { _id: 1 } }))) return { error: 'Choisis un cours existant.' };
  const goalIds = Array.isArray(b.goals) ? [...new Set(b.goals.map(String))] : [];
  if (goalIds.length && (await goals.countDocuments({ _id: { $in: goalIds } })) !== goalIds.length) return { error: 'Objectif inconnu.' };
  const ex = Array.isArray(b.exercises) ? b.exercises : [];
  if (ex.length < 1 || ex.length > 40) return { error: 'Ajoute entre 1 et 40 exercices.' };
  const exercises = [];
  for (const e of ex) {
    const name = cleanStr(e?.name, 1, 60), reps = intIn(e?.reps, 1, 1000), seconds = intIn(e?.seconds, 5, 3600);
    if (!name || reps == null || seconds == null) return { error: 'Chaque exercice a un nom, un nombre de répétitions et une durée (5 à 3600 s).' };
    exercises.push({ name, reps, seconds });
  }
  return { doc: { course_id: String(b.courseId), title, minutes, kcal, level: b.level, description, photo, video, goals: goalIds, exercises } };
}
app.post('/api/admin/workouts', requireAdmin, ah(async (req, res) => {
  const r = await workoutBody(req.body ?? {});
  if (r.error) return res.status(400).json({ error: r.error });
  const doc = { _id: slug(r.doc.title), ...r.doc, position: await nextPos(workouts) };
  await workouts.insertOne(doc); res.status(201).json({ id: doc._id });
}));
app.put('/api/admin/workouts/:id', requireAdmin, ah(async (req, res) => {
  const r = await workoutBody(req.body ?? {});
  if (r.error) return res.status(400).json({ error: r.error });
  await dropOld(workouts, req.params.id, 'photo', r.doc.photo);
  if (!(await workouts.updateOne({ _id: req.params.id }, { $set: r.doc })).matchedCount) return res.status(404).json({ error: 'Séance introuvable.' });
  res.json({ ok: true });
}));
app.delete('/api/admin/workouts/:id', requireAdmin, ah(async (req, res) => {
  await dropOld(workouts, req.params.id, 'photo', null);
  await Promise.all([workouts.deleteOne({ _id: req.params.id }), favorites.deleteMany({ workout_id: req.params.id }), runs.deleteMany({ workout_id: req.params.id, status: 'active' })]);
  res.json({ ok: true });
}));

const trainerBody = (b) => {
  const name = cleanStr(b.name, 2, 60), bio = String(b.bio ?? '').trim().slice(0, 400), photo = cleanUrl(b.photo);
  const rate = Number(b.rate), years = intIn(b.years, 0, 60);
  const tags = Array.isArray(b.tags) ? [...new Set(b.tags.map((t) => String(t).trim()).filter((t) => t && t.length <= 24))].slice(0, 8) : [];
  if (!name || photo === null || !(rate >= 0 && rate <= 5) || years == null) return null;
  return { name, bio, photo, rate: Math.round(rate * 10) / 10, years, best: b.best === true, tags };
};
app.post('/api/admin/trainers', requireAdmin, ah(async (req, res) => {
  const d = trainerBody(req.body ?? {});
  if (!d) return res.status(400).json({ error: 'Nom, note (0 à 5), années d\'expérience et lien de photo valides requis.' });
  const doc = { _id: slug(d.name), ...d, position: await nextPos(trainers) };
  await trainers.insertOne(doc); res.status(201).json({ id: doc._id });
}));
app.put('/api/admin/trainers/:id', requireAdmin, ah(async (req, res) => {
  const d = trainerBody(req.body ?? {});
  if (!d) return res.status(400).json({ error: 'Nom, note (0 à 5), années d\'expérience et lien de photo valides requis.' });
  await dropOld(trainers, req.params.id, 'photo', d.photo);
  if (!(await trainers.updateOne({ _id: req.params.id }, { $set: d })).matchedCount) return res.status(404).json({ error: 'Coach introuvable.' });
  res.json({ ok: true });
}));
app.delete('/api/admin/trainers/:id', requireAdmin, ah(async (req, res) => {
  await dropOld(trainers, req.params.id, 'photo', null);
  await Promise.all([trainers.deleteOne({ _id: req.params.id }), bookings.deleteMany({ trainer_id: req.params.id })]);
  res.json({ ok: true });
}));

/* ----- événements (création / modification / participants) ----- */
function eventBody(b) {
  const title = cleanStr(b.title, 3, 80), place = String(b.place ?? '').trim().slice(0, 120), description = String(b.description ?? '').trim().slice(0, 1000);
  const image = cleanUrl(b.image);
  const startsAt = Number(b.startsAt), endsAt = b.endsAt == null || b.endsAt === '' ? null : Number(b.endsAt);
  if (!title || image === null || !Number.isFinite(startsAt)) return { error: 'Titre (3 à 80 caractères), date de début et lien d\'image valides requis.' };
  if (endsAt != null && (!Number.isFinite(endsAt) || endsAt <= startsAt)) return { error: 'La fin doit être après le début.' };
  if (startsAt > Date.now() + 3 * 366 * DAY) return { error: 'La date est trop lointaine.' };
  return { doc: { title, place, description, image, starts_at: Math.round(startsAt), ends_at: endsAt == null ? null : Math.round(endsAt) } };
}
app.post('/api/admin/events', requireAdmin, ah(async (req, res) => {
  const r = eventBody(req.body ?? {});
  if (r.error) return res.status(400).json({ error: r.error });
  const doc = { ...r.doc, created_by: req.user._id, created_at: Date.now() };
  doc._id = (await events.insertOne(doc)).insertedId;
  res.status(201).json({ event: evJson(doc, { participants: 0, joined: false }) });
}));
app.put('/api/admin/events/:id', requireAdmin, ah(async (req, res) => {
  const id = toId(req.params.id);
  const r = eventBody(req.body ?? {});
  if (r.error) return res.status(400).json({ error: r.error });
  if (id) await dropOld(events, id, 'image', r.doc.image);
  if (!id || !(await events.updateOne({ _id: id }, { $set: r.doc })).matchedCount) return res.status(404).json({ error: 'Événement introuvable.' });
  res.json({ ok: true });
}));
app.delete('/api/admin/events/:id', requireAdmin, ah(async (req, res) => {
  const id = toId(req.params.id);
  if (id) await dropOld(events, id, 'image', null);
  if (id) await Promise.all([events.deleteOne({ _id: id }), eventMembers.deleteMany({ event_id: id })]);
  res.json({ ok: true });
}));
app.get('/api/admin/events', requireAdmin, ah(async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  const list = await events.find().sort({ starts_at: -1 }).limit(200).toArray();
  const counts = await evCounts(list.map((e) => e._id));
  res.json({ events: list.map((e) => evJson(e, { participants: counts.get(String(e._id)) ?? 0 })) });
}));
app.get('/api/admin/events/:id/participants', requireAdmin, ah(async (req, res) => {
  const id = toId(req.params.id);
  const mem = id ? await eventMembers.find({ event_id: id }).sort({ joined_at: 1 }).toArray() : [];
  const names = await nameMap(mem.map((m) => m.user_id));
  const mails = new Map((await users.find({ _id: { $in: mem.map((m) => m.user_id) } }).project({ email: 1 }).toArray()).map((u) => [String(u._id), u.email]));
  res.json({ participants: mem.map((m) => ({ id: String(m.user_id), name: names.get(String(m.user_id)) ?? 'Sportif', email: mails.get(String(m.user_id)) ?? '', joinedAt: m.joined_at })) });
}));

/* ----- coachs et réservations ----- */
const SLOTS = ['07:00', '08:30', '10:00', '12:30', '17:00', '18:30', '20:00'];
const BOOK_DAYS = 6;                                    // aujourd'hui + 5 jours, comme l'écran de réservation
const toTrainer = (t, b) => ({
  id: t._id, name: t.name, rate: t.rate, yrs: t.years, best: !!t.best, bio: t.bio, photo: t.photo, tags: t.tags || [],
  booking: b ? { day: b.day, slot: b.slot } : null,
});
const trainerList = async (uid) => {
  const [list, mine] = await Promise.all([trainers.find().sort({ position: 1 }).toArray(), bookings.find({ user_id: uid }).toArray()]);
  const byTrainer = new Map(mine.map((b) => [b.trainer_id, b]));
  return list.map((t) => toTrainer(t, byTrainer.get(t._id)));
};

app.get('/api/trainers', requireAuth, ah(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const list = await trainerList(req.user._id);
  res.json({ trainers: list, tags: [...new Set(list.flatMap((t) => t.tags))].sort(), slots: SLOTS });
}));

app.get('/api/trainers/:id', requireAuth, ah(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const t = (await trainerList(req.user._id)).find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Coach introuvable.' });
  res.json({ trainer: t, slots: SLOTS });
}));

app.put('/api/bookings/:trainerId', requireAuth, ah(async (req, res) => {
  const { trainerId } = req.params;
  if (!(await trainers.findOne({ _id: trainerId }, { projection: { _id: 1 } }))) return res.status(404).json({ error: 'Coach introuvable.' });
  const day = String(req.body?.day ?? ''), slot = String(req.body?.slot ?? '');
  if (!SLOTS.includes(slot)) return res.status(400).json({ error: 'Choisis un créneau valide.' });
  // la date vient du fuseau du client : on tolère un jour d'écart avec la date du serveur
  const t = /^\d{4}-\d{2}-\d{2}$/.test(day) ? Date.parse(`${day}T00:00:00Z`) : NaN;
  const diff = (t - Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00Z')) / DAY;
  if (!Number.isFinite(diff) || diff < -1 || diff > BOOK_DAYS) return res.status(400).json({ error: 'Choisis un jour valide.' });
  await bookings.updateOne({ user_id: req.user._id, trainer_id: trainerId }, { $set: { day, slot } }, { upsert: true });
  res.json({ booking: { day, slot } });
}));

app.delete('/api/bookings/:trainerId', requireAuth, ah(async (req, res) => {
  await bookings.deleteOne({ user_id: req.user._id, trainer_id: req.params.trainerId });
  res.json({ booking: null });
}));

/* ----- cours ----- */
const LEVELS = new Set(['Beginner', 'Intermediate', 'Advanced']);
const SORTS = { default: { position: 1 }, kcal: { kcal: -1, position: 1 }, time: { minutes: 1, position: 1 } };

app.get('/api/courses', requireAuth, ah(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const re = new RegExp(escapeRe(String(req.query.q ?? '').trim().slice(0, 60)), 'i');
  const [docs, all] = await Promise.all([courses.find({ name: re }).sort({ position: 1 }).toArray(), workouts.find().project({ course_id: 1 }).toArray()]);
  const counts = {}; for (const w of all) counts[w.course_id] = (counts[w.course_id] || 0) + 1;
  res.json({ courses: docs.map((c) => ({ id: c._id, name: c.name, photo: c.photo, count: counts[c._id] || 0 })) });
}));

app.get('/api/courses/:id', requireAuth, ah(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const course = await courses.findOne({ _id: req.params.id });
  if (!course) return res.status(404).json({ error: 'Cours introuvable.' });
  const level = String(req.query.level ?? 'All'), sort = String(req.query.sort ?? 'default');
  if (level !== 'All' && !LEVELS.has(level)) return res.status(400).json({ error: 'Niveau inconnu.' });
  if (!Object.hasOwn(SORTS, sort)) return res.status(400).json({ error: 'Tri inconnu.' });
  const [rows, total, favs] = await Promise.all([
    workouts.find({ course_id: course._id, ...(level === 'All' ? {} : { level }) }).sort(SORTS[sort]).toArray(),
    workouts.countDocuments({ course_id: course._id }),
    favSet(req.user._id),
  ]);
  res.json({ course: { id: course._id, name: course.name, photo: course.photo }, workouts: rows.map((w) => toWorkout(w, favs)), total });
}));

/* ----- historique : tout ce que l'utilisateur a fait, sur une page à part ----- */
app.get('/api/history', requireAuth, ah(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const uid = req.user._id, kind = String(req.query.kind ?? 'all');
  const before = Number(req.query.before), lt = Number.isFinite(before) ? before : Date.now() + DAY, LIMIT = 40;
  const want = (k) => kind === 'all' || kind === k;
  const items = [];
  if (want('activity')) {
    for (const a of await activities.find({ user_id: uid, started_at: { $lt: lt } }).project({ route: 0 }).sort({ started_at: -1 }).limit(LIMIT).toArray()) items.push({ kind: 'activity', id: String(a._id), at: a.started_at, type: a.type, distance: a.distance, duration: a.duration, steps: a.steps });
  }
  if (want('workout')) {
    const rows = await logs.find({ user_id: uid, done_at: { $lt: lt } }).sort({ done_at: -1 }).limit(LIMIT).toArray();
    const titles = new Map((await workouts.find({ _id: { $in: rows.map((r) => r.workout_id) } }).project({ title: 1 }).toArray()).map((w) => [w._id, w.title]));
    for (const l of rows) items.push({ kind: 'workout', id: String(l._id), at: l.done_at, workoutId: l.workout_id, title: titles.get(l.workout_id) ?? l.workout_id, kcal: l.kcal, duration: l.seconds, pct: l.pct });
  }
  if (want('post')) {
    for (const p of await posts.find({ user_id: uid, created_at: { $lt: lt } }).sort({ created_at: -1 }).limit(LIMIT).toArray()) items.push({ kind: 'post', id: String(p._id), at: p.created_at, type: p.activity.type, distance: p.activity.distance, caption: p.caption });
  }
  if (want('challenge')) {
    const rows = await members.find({ user_id: uid, joined_at: { $lt: lt } }).sort({ joined_at: -1 }).limit(LIMIT).toArray();
    const docs = new Map((await challenges.find({ _id: { $in: rows.map((r) => r.challenge_id) } }).toArray()).map((c) => [String(c._id), c]));
    for (const r of rows) { const c = docs.get(String(r.challenge_id)); if (c) items.push({ kind: 'challenge', id: String(c._id), at: r.joined_at, title: c.title, status: chStatus(c, Date.now()) }); }
  }
  if (want('event')) {
    const rows = await eventMembers.find({ user_id: uid, joined_at: { $lt: lt } }).sort({ joined_at: -1 }).limit(LIMIT).toArray();
    const docs = new Map((await events.find({ _id: { $in: rows.map((r) => r.event_id) } }).toArray()).map((e) => [String(e._id), e]));
    for (const r of rows) { const e = docs.get(String(r.event_id)); if (e) items.push({ kind: 'event', id: String(e._id), at: r.joined_at, title: e.title, startsAt: e.starts_at }); }
  }
  items.sort((a, b) => b.at - a.at);
  const page = items.slice(0, LIMIT);
  res.json({ items: page, next: items.length > LIMIT ? page[page.length - 1].at : null });
}));

/* ----- réseau social : amis, messages, communautés, appels vidéo (WebSocket pour le temps réel) ----- */
let social;
const realtime = createRealtime({
  authenticate: (req) => currentUser(req),
  canJoinCall: (uid, callId) => social.canJoinCall(uid, callId),
  cards: (ids) => social.cardMap(ids),
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean),
});
social = registerSocial({ app, requireAuth, ah, toId, escapeRe, isAdmin, realtime, sbRemove, sbPathOf, limiter });

app.use('/api', (_req, res) => res.status(404).json({ error: 'Introuvable' }));

/* ---------- front compilé (production) ---------- */
const dist = join(here, '..', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(join(dist, 'index.html')));
}

// erreurs : jamais de détails internes au client
app.use((err, _req, res, _next) => {
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON invalide' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Fichier trop volumineux.' });
  console.error(err);
  res.status(500).json({ error: 'Une erreur est survenue. Réessaie.' });
});

setInterval(() => sessions.deleteMany({ expires_at: { $lt: Date.now() } }).catch(() => {}), 3600 * 1000).unref();
const server = app.listen(PORT, () => console.log(`FitLife API on http://localhost:${PORT}`));
realtime.attach(server);
