import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useStore } from '../store';
import { CourseRow, Empty, Ring, SearchBox, WorkoutCard, WorkoutRow } from '../components/ui';
import Icon from '../components/Icon';
import { assetUrl } from '../lib/media';
import { TypePhoto } from '../components/ActivityBits';
import Avatar from '../components/Avatar';
import { PHOTO_SKIP_KEY } from './Photo';

const BASE = import.meta.env.BASE_URL;
const withBase = (o) => ({ ...o, photo: assetUrl(o.photo) });
const greet = () => { const h = new Date().getHours(); return h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir'; };
const skippedPhoto = () => { try { return localStorage.getItem(PHOTO_SKIP_KEY) === '1'; } catch { return false; } };
export const initials = (n) => n.split(' ').filter(Boolean).map((x) => x[0]).join('').slice(0, 2).toUpperCase() || '?';

function HomeSkeleton() {
  return (
    <div aria-busy="true" aria-label="Chargement">
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
          <span className="sel-t">››› CHOISIS TON ENTRAÎNEMENT</span>
        </div>
        <Link to="/profile" aria-label="Profil"><Avatar name={user.name} src={user.avatar} /></Link>
      </header>

      <div className="px"><SearchBox value={q} onChange={setQ} placeholder="Rechercher une séance, un niveau, un cours…" /></div>

      {error ? (
        <div className="state-box center" role="alert">
          <b>Impossible de charger ton accueil</b>
          <p>{error}</p>
          <button className="btn" onClick={load}>Réessayer</button>
        </div>
      ) : !data ? <HomeSkeleton /> : results !== null ? (
        <div className="lst grid px" style={{ marginTop: 14 }} aria-live="polite">
          {searching && !results.length ? <div className="row skeleton" /> : results.length
            ? results.map((w) => <WorkoutRow key={w.id} w={w} />)
            : <Empty>Aucune séance ne correspond à « {q.trim()} ».</Empty>}
        </div>
      ) : (
        <>
          <div className="today px">
            <Ring value={data.today.kcal} max={data.today.goal}><b>{pct}%</b></Ring>
            <div className="today-t">
              <b>Objectif du jour</b>
              <span>{data.today.kcal} / {data.today.goal} kcal</span>
              <small><Icon n="flame" /> {data.totals.streak} {data.totals.streak === 1 ? 'jour' : 'jours'} d'affilée · {data.totals.workouts} {data.totals.workouts === 1 ? 'séance' : 'séances'}</small>
            </div>
          </div>

          {!user.avatar && !skippedPhoto() && (
            <Link to="/photo" className="row act-cta px-card">
              <Avatar name={user.name} />
              <div className="t"><b>Ajoute ta photo de profil</b><small>Pour que les autres te reconnaissent</small></div>
            </Link>
          )}
          {user.admin && (
            <Link to="/admin" className="row act-cta px-card admin-link">
              <div className="t"><b>Espace administrateur</b><small>Comptes, parcours, contenu, événements</small></div>
            </Link>
          )}
          <Link to="/activity" className="row act-cta px-card">
            <div className="thumb"><TypePhoto type="run" /></div>
            <div className="t"><b>Marche ou course</b><small>Suis ton parcours, relève des défis, partage tes résultats</small></div>
          </Link>

          {data.courses.length > 0 && (
            <div className="chips px" aria-label="Cours">
              {data.courses.map((c) => <Link key={c.id} to={`/courses/${c.id}`} className="chip">{c.name}</Link>)}
            </div>
          )}

          {data.recommended.length > 0 && (
            <>
              <div className="sec px"><h3>À la une</h3></div>
              <div className="rail">{data.recommended.map((w) => <WorkoutCard key={w.id} w={withBase(w)} />)}</div>
            </>
          )}
          {!data.recommended.length && !data.courses.length && <Empty>Aucune séance n'a encore été ajoutée.<br />Reviens bientôt.</Empty>}

          <div className="home-cols">
            {data.courses.length > 0 && (
              <div>
                <div className="sec px"><h3>Cours</h3><Link to="/courses">Tout voir</Link></div>
                <div className="lst grid px">{data.courses.slice(0, 3).map((c) => <CourseRow key={c.id} c={withBase(c)} />)}</div>
              </div>
            )}

            {data.recent.length > 0 && (
              <div>
                <div className="sec px"><h3>Séances récentes</h3><Link to="/profile">Tout voir</Link></div>
                <div className="lst grid px">
                  {data.recent.map((e) => (
                    <Link to={`/workout/${e.workoutId}`} key={e.id} className="row">
                      <div className="pie" style={{ '--p': Math.round(e.pct * 100) }}><span>{Math.round(e.pct * 100)}%</span></div>
                      <div className="t"><b>{e.title}</b><small>{new Date(e.date).toLocaleDateString('fr', { month: 'short', day: 'numeric' })} · {e.kcal} kcal · {Math.max(1, Math.round(e.seconds / 60))} min</small></div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
