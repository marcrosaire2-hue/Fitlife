export class ApiError extends Error {
  constructor(message, status, fields) { super(message); this.status = status; this.fields = fields || {}; }
}

async function request(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Impossible de joindre le serveur. Vérifie ta connexion et réessaie.', 0);
  }
  let data = null;
  try { data = await res.json(); } catch { /* corps vide ou non JSON */ }
  if (!res.ok) throw new ApiError(data?.error || 'Une erreur est survenue.', res.status, data?.fields);
  if (data === null) throw new ApiError("Le serveur de l'application ne répond pas correctement. Réessaie dans un instant.", 502);   // ex. API non déployée : le site reçoit une page HTML
  return data;
}

// envoi d'un fichier (image) en corps brut
async function sendBlob(path, blob) {
  let res;
  try { res = await fetch(`/api${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': blob.type }, body: blob }); }
  catch { throw new ApiError('Impossible de joindre le serveur. Vérifie ta connexion et réessaie.', 0); }
  let data = null;
  try { data = await res.json(); } catch { /* corps vide */ }
  if (!res.ok) throw new ApiError(data?.error || 'Une erreur est survenue.', res.status);
  return data;
}

export const api = {
  uploadAvatar: (blob) => sendBlob('/profile/avatar', blob),
  deleteAvatar: () => request('/profile/avatar', { method: 'DELETE' }),
  uploadImage: (blob) => sendBlob('/admin/uploads', blob),
  uploadCommunityImage: (blob) => sendBlob('/uploads', blob),
  welcome: () => request('/welcome'),
  me: () => request('/auth/me'),
  register: (b) => request('/auth/register', { method: 'POST', body: b }),
  login: (b) => request('/auth/login', { method: 'POST', body: b }),
  goals: () => request('/goals'),
  saveGoals: (goals) => request('/goals', { method: 'PUT', body: { goals } }),
  home: () => request(`/home?tz=${new Date().getTimezoneOffset()}`),
  searchWorkouts: (q) => request(`/workouts?q=${encodeURIComponent(q)}`),
  setFav: (id, on) => request(`/favorites/${encodeURIComponent(id)}`, { method: on ? 'PUT' : 'DELETE', body: on ? {} : undefined }),
  startSession: (workoutId) => request('/sessions', { method: 'POST', body: { workoutId } }),
  saveProgress: (id, elapsed, exerciseIdx) => request(`/sessions/${id}/progress`, { method: 'PUT', body: { elapsed, exerciseIdx } }),
  finishSession: (id, elapsed) => request(`/sessions/${id}/finish`, { method: 'POST', body: { elapsed } }),
  abandonSession: (id) => request(`/sessions/${id}/abandon`, { method: 'POST', body: {} }),
  sessionSummary: (id) => request(`/sessions/${id}?tz=${new Date().getTimezoneOffset()}`),
  saveSettings: (s) => request('/settings', { method: 'PUT', body: s }),
  courses: (q = '') => request(`/courses?q=${encodeURIComponent(q)}`),
  course: (id, { level = 'All', sort = 'default' } = {}) => request(`/courses/${encodeURIComponent(id)}?level=${encodeURIComponent(level)}&sort=${sort}`),
  workout: (id) => request(`/workouts/${encodeURIComponent(id)}`),
  favorites: () => request('/favorites'),
  activities: () => request('/activities'),
  activity: (id) => request(`/activities/${encodeURIComponent(id)}`),
  saveActivity: (a) => request('/activities', { method: 'POST', body: a }),
  deleteActivity: (id) => request(`/activities/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  posts: (before) => request(`/posts${before ? `?before=${before}` : ''}`),
  publish: (activityId, caption, showRoute) => request('/posts', { method: 'POST', body: { activityId, caption, showRoute } }),
  deletePost: (id) => request(`/posts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  challenges: () => request('/challenges'),
  challenge: (id) => request(`/challenges/${encodeURIComponent(id)}`),
  createChallenge: (c) => request('/challenges', { method: 'POST', body: c }),
  joinChallenge: (id) => request(`/challenges/${encodeURIComponent(id)}/join`, { method: 'POST', body: {} }),
  leaveChallenge: (id) => request(`/challenges/${encodeURIComponent(id)}/join`, { method: 'DELETE' }),
  deleteChallenge: (id) => request(`/challenges/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  events: () => request('/events'),
  event: (id) => request(`/events/${encodeURIComponent(id)}`),
  joinEvent: (id) => request(`/events/${encodeURIComponent(id)}/join`, { method: 'POST', body: {} }),
  leaveEvent: (id) => request(`/events/${encodeURIComponent(id)}/join`, { method: 'DELETE' }),
  admin: {
    overview: () => request('/admin/overview'),
    users: (q = '') => request(`/admin/users?q=${encodeURIComponent(q)}`),
    user: (id) => request(`/admin/users/${encodeURIComponent(id)}`),
    activity: (id) => request(`/admin/activities/${encodeURIComponent(id)}`),
    deleteActivity: (id) => request(`/admin/activities/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    resetActivities: (userId) => request(`/admin/users/${encodeURIComponent(userId)}/activities`, { method: 'DELETE' }),
    deleteUser: (id) => request(`/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    content: () => request('/admin/content'),
    save: (kind, id, body) => request(`/admin/${kind}${id ? `/${encodeURIComponent(id)}` : ''}`, { method: id ? 'PUT' : 'POST', body }),
    remove: (kind, id) => request(`/admin/${kind}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    events: () => request('/admin/events'),
    participants: (id) => request(`/admin/events/${encodeURIComponent(id)}/participants`),
  },
  history: (kind = 'all', before) => request(`/history?kind=${kind}${before ? `&before=${before}` : ''}`),
  social: {
    people: (q = '') => request(`/people?q=${encodeURIComponent(q)}`),
    friends: () => request('/friends'),
    request: (userId) => request('/friends/request', { method: 'POST', body: { userId } }),
    accept: (userId) => request(`/friends/${userId}/accept`, { method: 'POST', body: {} }),
    removeFriend: (userId) => request(`/friends/${userId}`, { method: 'DELETE' }),
    block: (userId) => request('/blocks', { method: 'POST', body: { userId } }),
    unblock: (userId) => request(`/blocks/${userId}`, { method: 'DELETE' }),
    conversations: () => request('/conversations'),
    conversation: (id) => request(`/conversations/${id}`),
    openDirect: (userId) => request('/conversations/direct', { method: 'POST', body: { userId } }),
    createGroup: (name, memberIds, photo = '') => request('/conversations/group', { method: 'POST', body: { name, memberIds, photo } }),
    updateGroup: (id, body) => request(`/conversations/${id}`, { method: 'PUT', body }),
    addToGroup: (id, userId) => request(`/conversations/${id}/members`, { method: 'POST', body: { userId } }),
    leaveGroup: (id) => request(`/conversations/${id}/leave`, { method: 'POST', body: {} }),
    messages: (id, before) => request(`/conversations/${id}/messages${before ? `?before=${before}` : ''}`),
    send: (id, text) => request(`/conversations/${id}/messages`, { method: 'POST', body: { text } }),
    read: (id) => request(`/conversations/${id}/read`, { method: 'POST', body: {} }),
    startCall: (id, body) => request(`/conversations/${id}/calls`, { method: 'POST', body }),
    call: (id) => request(`/calls/${id}`),
    endCall: (id) => request(`/calls/${id}/end`, { method: 'POST', body: {} }),
    communities: (q = '') => request(`/communities?q=${encodeURIComponent(q)}`),
    community: (id) => request(`/communities/${id}`),
    createCommunity: (b) => request('/communities', { method: 'POST', body: b }),
    updateCommunity: (id, b) => request(`/communities/${id}`, { method: 'PUT', body: b }),
    deleteCommunity: (id) => request(`/communities/${id}`, { method: 'DELETE' }),
    joinCommunity: (id) => request(`/communities/${id}/join`, { method: 'POST', body: {} }),
    leaveCommunity: (id) => request(`/communities/${id}/leave`, { method: 'POST', body: {} }),
    invite: (id, userId) => request(`/communities/${id}/invite`, { method: 'POST', body: { userId } }),
    acceptInvite: (id) => request(`/communities/${id}/accept`, { method: 'POST', body: {} }),
    declineInvite: (id) => request(`/communities/${id}/invitation`, { method: 'DELETE' }),
    kick: (id, userId) => request(`/communities/${id}/members/${userId}`, { method: 'DELETE' }),
    setRole: (id, userId, role) => request(`/communities/${id}/members/${userId}`, { method: 'PUT', body: { role } }),
  },
  trainers: () => request('/trainers'),
  trainer: (id) => request(`/trainers/${encodeURIComponent(id)}`),
  book: (trainerId, day, slot) => request(`/bookings/${encodeURIComponent(trainerId)}`, { method: 'PUT', body: { day, slot } }),
  unbook: (trainerId) => request(`/bookings/${encodeURIComponent(trainerId)}`, { method: 'DELETE' }),
  profile: () => request(`/profile?tz=${new Date().getTimezoneOffset()}`),
  saveName: (name) => request('/profile', { method: 'PUT', body: { name } }),
  resetProgress: () => request('/profile/reset', { method: 'POST', body: {} }),
  deleteAccount: (password) => request('/profile', { method: 'DELETE', body: { password } }),
  logout: () => request('/auth/logout', { method: 'POST', body: {} }),
};
