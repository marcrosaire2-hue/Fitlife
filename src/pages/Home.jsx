import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useStore } from '../store';
import { CourseRow, Empty, Ring, SearchBox, WorkoutCard, WorkoutRow } from '../components/ui';
import Icon from '../components/Icon';

const BASE = import.meta.env.BASE_URL;
const withBase = (o) => ({ ...o, photo: `${BASE}${o.photo}` });
const greet = () => { const h = new Date().getHours(); return h < 12 ? 'Good Morning' : h < 18 ? 'Good Afternoon' : 'Good Evening'; };
export const initials = (n) => n.split(' ').filter(Boolean).map((x) => x[0]).join('').slice(0, 2).toUpperCase() || '?';

function HomeSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="today px skeleton-card"><span className="sk-ring" /><div><i className="sk-t" style={{ width: 110 }} /><i className="sk-t" style={{ width: 150, height: 18, marginTop: 8 }} /></div></div>
      <div className="rail">{[0, 1].map((i) => <div key={i} className="feat skeleton" />)}</div>
      <div className="lst grid px" style={{ marginTop: 18 }}>{[0, 1, 2].map((i) => <div key={i} className="row skeleton" />)}</div>
    </div>
  );
}

export default function Home() {
  const { user, loading: authLoading } = useAuth();
  const { dispatch, notify } = useStore();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);   // null = pas de recherche
  const [searching, setSearching] = useState(false);
  const stamp = useRef(0);

  const load = useCallback(() => {
    setError('');
    api.home().then((d) => {
      setData(d);
      // synchronise le reste de l'app (favoris, objectif du jour, thème) avec le serveur
      dispatch({ type: 'hydrate', patch: { favs: d.favs, dailyGoal: d.settings.dailyGoal, theme: d.settings.theme } });
    }).catch((e) => setError(e.message));
  }, [dispatch]);
  useEffect(() => { if (user?.onboarded) load(); }, [user, load]);

  // recherche côté serveur, avec délai et protection contre les réponses en retard
  useEffect(() => {
    const s = q.trim();
    if (!s) { stamp.current++; setResults(null); setSearching(false); return; }
    setSearching(true);
    const id = ++stamp.current;
    const h = setTimeout(() => {
      api.searchWorkouts(s)
        .then((r) => { if (id === stamp.current) { setResults(r.workouts.map(withBase)); setSearching(false); } })
        .catch((e) => { if (id === stamp.current) { setSearching(false); notify(e.message); } });
    }, 250);
    return () => clearTimeout(h);
  }, [q, notify]);

  if (authLoading) return <section className="page"><HomeSkeleton /></section>;
  if (!user) return <Navigate to="/welcome" replace />;
  if (!user.onboarded) return <Navigate to="/goals" replace />;

  const pct = data ? Math.min(100, Math.round((data.today.kcal / data.today.goal) * 100)) : 0;

  return (
    <section className="page">
      <header className="hello">
        <div>
          <small>{greet()}</small>
          <b>{user.name}</b>
          <span className="sel-t">››› SELECT YOUR TRAINING</span>
        </div>
        <Link to="/profile" className="avatar" aria-label="Profile">{initials(user.name)}</Link>
      </header>

      <div className="px"><SearchBox value={q} onChange={setQ} placeholder="Search workouts, levels, courses…" /></div>

      {error ? (
        <div className="state-box center" role="alert">
          <b>We couldn't load your home</b>
          <p>{error}</p>
          <button className="btn" onClick={load}>Try again</button>
        </div>
      ) : !data ? <HomeSkeleton /> : results !== null ? (
        <div className="lst grid px" style={{ marginTop: 14 }} aria-live="polite">
          {searching && !results.length ? <div className="row skeleton" /> : results.length
            ? results.map((w) => <WorkoutRow key={w.id} w={w} />)
            : <Empty>No workout matches “{q.trim()}”.</Empty>}
        </div>
      ) : (
        <>
          <div className="today px">
            <Ring value={data.today.kcal} max={data.today.goal}><b>{pct}%</b></Ring>
            <div className="today-t">
              <b>Today's goal</b>
              <span>{data.today.kcal} / {data.today.goal} kcal</span>
              <small><Icon n="flame" /> {data.totals.streak} day streak · {data.totals.workouts} workouts</small>
            </div>
          </div>

          <div className="rail">{data.recommended.map((w) => <WorkoutCard key={w.id} w={withBase(w)} />)}</div>

          <div className="sec px"><h3>Courses</h3><Link to="/courses">See All</Link></div>
          <div className="lst grid px">{data.courses.slice(0, 3).map((c) => <CourseRow key={c.id} c={withBase(c)} />)}</div>

          {data.recent.length > 0 && (
            <>
              <div className="sec px"><h3>Previous Tasks</h3><Link to="/profile">View All</Link></div>
              <div className="lst grid px">
                {data.recent.map((e) => (
                  <Link to={`/workout/${e.workoutId}`} key={e.id} className="row">
                    <div className="pie" style={{ '--p': Math.round(e.pct * 100) }}><span>{Math.round(e.pct * 100)}%</span></div>
                    <div className="t"><b>{e.title}</b><small>{new Date(e.date).toLocaleDateString('en', { month: 'short', day: 'numeric' })} · {e.kcal} kcal · {Math.max(1, Math.round(e.seconds / 60))} min</small></div>
                  </Link>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
