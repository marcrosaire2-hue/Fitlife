import { MongoClient } from 'mongodb';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set. Copy .env.example to .env and fill in your MongoDB connection string.');
  process.exit(1);
}

export const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
await client.connect();
export const db = client.db(process.env.MONGODB_DB || 'fitpulse');

// comptes et données utilisateur
export const users = db.collection('users');
export const sessions = db.collection('sessions');          // sessions de connexion (cookie)
export const favorites = db.collection('favorites');
export const logs = db.collection('workout_logs');          // séances terminées
export const runs = db.collection('sessions_run');          // séances en cours / terminées / abandonnées
export const bookings = db.collection('bookings');
export const posts = db.collection('posts');                // résultats publiés dans la communauté
export const challenges = db.collection('challenges');      // défis créés par les utilisateurs ou l'admin
export const members = db.collection('challenge_members');  // participants aux défis
export const events = db.collection('events');              // événements à date créés par l'admin
export const eventMembers = db.collection('event_members'); // inscriptions aux événements
export const friendships = db.collection('friendships');    // connexions entre utilisateurs (demandes + amis)
export const blocks = db.collection('blocks');
export const conversations = db.collection('conversations'); // privées, groupes et chat de communauté
export const messages = db.collection('messages');
export const communities = db.collection('communities');
export const communityMembers = db.collection('community_members');
export const calls = db.collection('calls');                // appels vidéo de groupe et lives programmés
export const activities = db.collection('activities');      // marche / course : durée, distance, pas, tracé GPS
// catalogue
export const goals = db.collection('goals');
export const courses = db.collection('courses');
export const workouts = db.collection('workouts');          // exercices et objectifs intégrés au document
export const trainers = db.collection('trainers');          // coachs : vide tant que de vrais coachs ne sont pas ajoutés
export const content = db.collection('content');

await Promise.all([
  users.createIndex({ email: 1 }, { unique: true }),
  sessions.createIndex({ expires_at: 1 }),
  sessions.createIndex({ user_id: 1 }),
  favorites.createIndex({ user_id: 1, workout_id: 1 }, { unique: true }),
  logs.createIndex({ user_id: 1, done_at: -1 }),
  logs.createIndex({ session_id: 1 }, { unique: true, partialFilterExpression: { session_id: { $exists: true } } }),
  runs.createIndex({ user_id: 1, status: 1 }),
  bookings.createIndex({ user_id: 1, trainer_id: 1 }, { unique: true }),
  activities.createIndex({ user_id: 1, started_at: -1 }),
  events.createIndex({ starts_at: 1 }),
  eventMembers.createIndex({ event_id: 1, user_id: 1 }, { unique: true }),
  eventMembers.createIndex({ user_id: 1 }),
  friendships.createIndex({ pair: 1 }, { unique: true }),
  friendships.createIndex({ a: 1 }),
  friendships.createIndex({ b: 1 }),
  blocks.createIndex({ blocker: 1, blocked: 1 }, { unique: true }),
  blocks.createIndex({ blocked: 1 }),
  conversations.createIndex({ direct_key: 1 }, { unique: true, partialFilterExpression: { direct_key: { $type: 'string' } } }),
  conversations.createIndex({ members: 1, last_message_at: -1 }),
  conversations.createIndex({ community_id: 1 }),
  messages.createIndex({ conversation_id: 1, created_at: -1 }),
  messages.createIndex({ sender_id: 1 }),
  communities.createIndex({ visibility: 1, created_at: -1 }),
  communities.createIndex({ owner_id: 1 }),
  communityMembers.createIndex({ community_id: 1, user_id: 1 }, { unique: true }),
  communityMembers.createIndex({ user_id: 1, status: 1 }),
  calls.createIndex({ conversation_id: 1, created_at: -1 }),
  calls.createIndex({ community_id: 1, starts_at: 1 }),
  posts.createIndex({ created_at: -1 }),
  posts.createIndex({ activity_id: 1 }, { unique: true }),
  posts.createIndex({ user_id: 1 }),
  challenges.createIndex({ ends_at: -1 }),
  members.createIndex({ challenge_id: 1, user_id: 1 }, { unique: true }),
  members.createIndex({ user_id: 1 }),
  workouts.createIndex({ course_id: 1, position: 1 }),
]);

/* ---------- catalogue : objectifs, cours, séances (ajoutés seulement s'ils n'existent pas) ---------- */
const catalog = JSON.parse(readFileSync(join(here, 'catalog.json'), 'utf8'));
const seed = (col, docs) => docs.length && col.bulkWrite(docs.map((d) => ({ updateOne: { filter: { _id: d._id }, update: { $setOnInsert: d }, upsert: true } })));
await seed(goals, catalog.goals.map((x, i) => ({ _id: x.id, label: x.label, photo: x.photo, position: i })));
await seed(courses, catalog.courses.map((x, i) => ({ _id: x.id, name: x.name, photo: x.photo, position: i })));
await seed(workouts, catalog.workouts.map((x, i) => ({
  _id: x.id, course_id: x.course, title: x.title, minutes: x.min, kcal: x.kcal, level: x.level,
  description: x.desc || '', photo: x.photo, video: x.video, position: i, goals: x.goals,
  exercises: x.ex.map(([name, reps, seconds]) => ({ name, reps, seconds })),
})));

// contenu de la page de bienvenue : modifiable en base sans toucher au front
const WELCOME = {
  brand: 'FitLife',
  titleLines: ['Prêt', 'à bouger ?'],
  subtitle: 'Fitness & santé : atteins tes objectifs avec notre application.',
  cta: "C'est parti",
  video: 'media/videos/weights.mp4',
  poster: 'media/photos/17210041.jpg',
};
await content.updateOne({ _id: 'welcome' }, { $setOnInsert: { value: WELCOME } }, { upsert: true });

export const getContent = async (key) => (await content.findOne({ _id: key }))?.value ?? null;
