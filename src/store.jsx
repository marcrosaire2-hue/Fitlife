import { createContext, useContext, useEffect, useMemo, useReducer, useCallback, useState } from 'react';

const KEY = 'fitpulse.react.v1';
const initial = {
  name: '', goals: [], favs: [], history: [],
  onboarded: false, theme: 'lime', dailyGoal: 300,
};

function load() {
  try { return { ...initial, ...JSON.parse(localStorage.getItem(KEY)) }; } catch { return initial; }
}

function reducer(s, a) {
  switch (a.type) {
    case 'toggleGoal': return { ...s, goals: s.goals.includes(a.id) ? s.goals.filter((x) => x !== a.id) : [...s.goals, a.id] };
    case 'syncFavs': return { ...s, favs: [...s.favs.filter((x) => !a.off.includes(x) && !a.on.includes(x)), ...a.on] };
    case 'hydrate': return { ...s, ...a.patch };
    case 'setGoals': return { ...s, goals: a.goals, onboarded: true };
    case 'onboarded': return { ...s, onboarded: true };
    case 'toggleFav': return { ...s, favs: s.favs.includes(a.id) ? s.favs.filter((x) => x !== a.id) : [...s.favs, a.id] };
    case 'log': return { ...s, history: [...s.history, a.entry] };
    case 'name': return { ...s, name: a.name };
    case 'theme': return { ...s, theme: a.theme };
    case 'dailyGoal': return { ...s, dailyGoal: a.value };
    case 'reset': return initial;
    default: return s;
  }
}

const Ctx = createContext(null);
export function Provider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, load);
  const [toast, setToast] = useState('');
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ } }, [state]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 1800); return () => clearTimeout(t); }, [toast]);
  const notify = useCallback((m) => setToast(m + ' '), []); // espace : relance l'effet si même message
  const value = useMemo(() => ({ state, dispatch, notify, toast }), [state, notify, toast]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useStore = () => useContext(Ctx);

const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
export function useStats() {
  const { state } = useStore();
  return useMemo(() => {
    const h = state.history;
    const today = dayKey(Date.now());
    const week = [...Array(7)].map((_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (6 - i));
      const k = dayKey(d);
      return { label: d.toLocaleDateString('fr', { weekday: 'short' }).slice(0, 1), kcal: h.filter((e) => dayKey(e.date) === k).reduce((a, e) => a + e.kcal, 0), today: k === today };
    });
    let streak = 0;
    for (let i = 0; i < 365; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      if (h.some((e) => dayKey(e.date) === dayKey(d))) streak++; else if (i > 0) break;
    }
    return {
      done: h.length,
      kcal: h.reduce((a, e) => a + e.kcal, 0),
      mins: Math.round(h.reduce((a, e) => a + e.secs, 0) / 60),
      todayKcal: h.filter((e) => dayKey(e.date) === today).reduce((a, e) => a + e.kcal, 0),
      week, streak,
    };
  }, [state.history]);
}
