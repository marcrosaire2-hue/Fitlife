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
    throw new ApiError('Cannot reach the server. Check your connection and try again.', 0);
  }
  let data = null;
  try { data = await res.json(); } catch { /* corps vide ou non JSON */ }
  if (!res.ok) throw new ApiError(data?.error || 'Something went wrong.', res.status, data?.fields);
  return data;
}

export const api = {
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
  profile: () => request(`/profile?tz=${new Date().getTimezoneOffset()}`),
  saveName: (name) => request('/profile', { method: 'PUT', body: { name } }),
  resetProgress: () => request('/profile/reset', { method: 'POST', body: {} }),
  deleteAccount: (password) => request('/profile', { method: 'DELETE', body: { password } }),
  logout: () => request('/auth/logout', { method: 'POST', body: {} }),
};
