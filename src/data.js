const BASE = import.meta.env.BASE_URL;
export const photo = (id) => `${BASE}media/photos/${id}.jpg`;
export const video = (n) => `${BASE}media/videos/${n}.mp4`;
const withPhoto = (arr, map) => arr.map((x) => ({ ...x, photo: photo(map[x.id]) }));

export const GOALS = withPhoto([
  { id: 'lose', label: 'Lose Weight', crop: 'torso', hue: 95 },
  { id: 'muscle', label: 'Build Muscle', crop: 'arms', hue: 20 },
  { id: 'fit', label: 'Get Fit', crop: 'full', hue: 200 },
  { id: 'legs', label: 'Build Legs', crop: 'legs', hue: 150 },
  { id: 'arms', label: 'Strong Arms', crop: 'arms', hue: 330 },
  { id: 'back', label: 'Back', crop: 'torso', hue: 260 },
  { id: 'cardio', label: 'Cardio Boost', crop: 'full', hue: 10 },
  { id: 'hustle', label: 'Muscle Hustle', crop: 'arms', hue: 120 },
  { id: 'sprint', label: 'Shred Sprint', crop: 'legs', hue: 280 },
], { lose: 3775526, muscle: 17210041, fit: 3888405, legs: 11757388, arms: 9644820, back: 6295974, cardio: 8611942, hustle: 8874355, sprint: 37718409 });

export const COURSES = withPhoto([
  { id: 'strength', name: 'Strength', hue: 95, pose: 'squat' },
  { id: 'mobility', name: 'Mobility', hue: 175, pose: 'stretch' },
  { id: 'yoga', name: 'Yoga', hue: 270, pose: 'warrior' },
  { id: 'defense', name: 'Self Defense', hue: 15, pose: 'boxing' },
  { id: 'improve', name: 'Self Improvement', hue: 205, pose: 'meditate' },
], { strength: 17210041, mobility: 7900680, yoga: 15641820, defense: 8611942, improve: 13865894 });

const LOREM =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Praesent id tellus ac nulla tempor ultrices. Nulla vitae mattis massa, ac sagittis erat. Sed posuere elementum quam, quis vulputate dolor ultrices et.';

const WM = {
  squats: [17559311, 'weights'], pushup: [4047105, 'back'], core: [39219676, 'stretch'], flow: [4587350, 'stretch'],
  stretch: [8038623, 'stretch'], sun: [8033077, 'yoga'], vinyasa: [3822454, 'yoga'], boxing: [31403621, 'boxing-woman'],
  kick: [13808098, 'boxing-man'], run: [10157895, 'run'], mind: [13865894, 'meditate'], focus: [5201529, 'meditate'],
};

// ex: [name, reps, seconds]
export const WORKOUTS = [
  { id: 'squats', course: 'strength', title: 'Squats With Weight', min: 20, kcal: 95, people: 250, level: 'Intermediate', pose: 'squat', hue: 92, goals: ['legs', 'muscle', 'fit'], ex: [['Squats', 25, 30], ['Lunges', 20, 30], ['Deadlifts', 15, 30], ['Climbers', 25, 30]] },
  { id: 'pushup', course: 'strength', title: 'Push Up Power', min: 15, kcal: 80, people: 180, level: 'Beginner', pose: 'pushup', hue: 30, goals: ['arms', 'muscle', 'hustle'], ex: [['Push Ups', 20, 30], ['Dips', 15, 30], ['Planks', 30, 30], ['Burpees', 12, 30]] },
  { id: 'core', course: 'strength', title: 'Core Crusher', min: 18, kcal: 85, people: 210, level: 'Intermediate', pose: 'climber', hue: 195, goals: ['lose', 'back', 'fit'], ex: [['Crunches', 30, 30], ['Leg Raises', 20, 30], ['Climbers', 25, 30], ['Planks', 40, 30]] },
  { id: 'flow', course: 'mobility', title: 'Mobility Flow', min: 25, kcal: 70, people: 120, level: 'Beginner', pose: 'lunge', hue: 170, goals: ['fit', 'back'], ex: [['Hip Circles', 20, 30], ['Cat Cow', 15, 30], ['Lunge Twist', 12, 30], ['Shoulder Rolls', 20, 30]] },
  { id: 'stretch', course: 'mobility', title: 'Full Body Stretch', min: 15, kcal: 45, people: 140, level: 'Beginner', pose: 'stretch', hue: 215, goals: ['fit', 'back', 'legs'], ex: [['Hamstring', 30, 30], ['Quad Stretch', 30, 30], ['Child Pose', 20, 30]] },
  { id: 'sun', course: 'yoga', title: 'Sun Salutation', min: 30, kcal: 110, people: 300, level: 'Beginner', pose: 'warrior', hue: 285, goals: ['fit', 'lose'], ex: [['Mountain', 10, 30], ['Downward Dog', 12, 30], ['Warrior', 10, 30], ['Cobra', 8, 30]] },
  { id: 'vinyasa', course: 'yoga', title: 'Vinyasa Burn', min: 35, kcal: 130, people: 160, level: 'Advanced', pose: 'warrior', hue: 330, goals: ['lose', 'cardio'], ex: [['Chaturanga', 10, 30], ['Plank', 30, 30], ['Chair', 12, 30]] },
  { id: 'boxing', course: 'defense', title: 'Boxing Basics', min: 20, kcal: 150, people: 230, level: 'Intermediate', pose: 'boxing', hue: 15, goals: ['lose', 'cardio', 'sprint'], ex: [['Jabs', 40, 30], ['Hooks', 30, 30], ['Uppercuts', 30, 30], ['Shadow Box', 60, 30]] },
  { id: 'kick', course: 'defense', title: 'Kick Defense', min: 22, kcal: 140, people: 90, level: 'Advanced', pose: 'kick', hue: 350, goals: ['cardio', 'legs', 'sprint'], ex: [['Front Kick', 20, 30], ['Roundhouse', 20, 30], ['Block', 30, 30]] },
  { id: 'run', course: 'defense', title: 'Shred Sprint', min: 16, kcal: 120, people: 195, level: 'Advanced', pose: 'run', hue: 60, goals: ['sprint', 'cardio', 'lose'], ex: [['High Knees', 40, 30], ['Sprints', 10, 30], ['Skipping', 50, 30]] },
  { id: 'mind', course: 'improve', title: 'Morning Mindset', min: 10, kcal: 40, people: 410, level: 'Beginner', pose: 'meditate', hue: 200, goals: ['fit'], ex: [['Breathing', 20, 30], ['Neck Roll', 10, 30], ['Visualise', 5, 30]] },
  { id: 'focus', course: 'improve', title: 'Deep Focus', min: 12, kcal: 35, people: 270, level: 'Beginner', pose: 'meditate', hue: 245, goals: ['fit', 'back'], ex: [['Box Breath', 12, 30], ['Body Scan', 5, 30], ['Gratitude', 3, 30]] },
].map((w) => ({ ...w, desc: LOREM, photo: photo(WM[w.id][0]), video: video(WM[w.id][1]) }));

export const TRAINERS = withPhoto([
  { id: 't1', name: 'Brie Larson', rate: 4.9, yrs: 5, tags: ['Training', 'Nutrition'], best: true, skin: '#f1c9a5', hair: '#3a2a1f', style: 'long', hue: 40, bio: 'Strength coach focused on sustainable habits and clean nutrition.' },
  { id: 't2', name: 'Thomas Carter', rate: 4.8, yrs: 6, tags: ['Training', 'Yoga'], skin: '#e0ac86', hair: '#1c1c1c', style: 'short', hue: 200, bio: 'Former athlete mixing heavy lifting with mobility and yoga.' },
  { id: 't3', name: 'Carlie Edwards', rate: 4.9, yrs: 4, tags: ['Mobility', 'Nutrition'], best: true, skin: '#a9714b', hair: '#161010', style: 'bun', hue: 320, bio: 'Mobility specialist helping you move pain-free every day.' },
  { id: 't4', name: 'Eden Lloyd', rate: 4.7, yrs: 5, tags: ['Training', 'Boxing'], skin: '#f4d3b5', hair: '#8a5a2b', style: 'short', hue: 15, bio: 'Boxing and conditioning sessions that torch calories fast.' },
  { id: 't5', name: 'Jayden Lewis', rate: 4.8, yrs: 7, tags: ['Training', 'Nutrition'], skin: '#7b4a2f', hair: '#0e0e0e', style: 'bald', hue: 260, bio: 'Seven years of coaching beginners to their first 5K.' },
  { id: 't6', name: 'Sasha Harrison', rate: 4.6, yrs: 3, tags: ['Yoga', 'Mobility'], skin: '#efc19b', hair: '#d9b36a', style: 'long', hue: 150, bio: 'Calm, mindful yoga flows for body and mind.' },
], { t1: 3775526, t2: 17910791, t3: 39598425, t4: 29204802, t5: 7927246, t6: 6248741 });
export const TAG_FILTERS = ['All', 'Training', 'Nutrition', 'Yoga', 'Mobility', 'Boxing'];

export const SONGS = [
  ['Counting Stars', 'OneRepublic'],
  ['Stronger', 'Kanye West'],
  ['Eye of the Tiger', 'Survivor'],
  ['Lose Yourself', 'Eminem'],
];

export const SLOTS = ['07:00', '08:30', '10:00', '12:30', '17:00', '18:30', '20:00'];
export const THEMES = { lime: '#a6f23a', orange: '#ff8a3d', cyan: '#35d6ff', pink: '#ff4fa3' };

export const byId = (list, id) => list.find((x) => x.id === id);
