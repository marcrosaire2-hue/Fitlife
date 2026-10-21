import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useStore } from '../store';
import { SONGS } from '../data';
import { Img, Vid } from '../components/Media';
import Icon from '../components/Icon';
import { assetUrl, videoKind } from '../lib/media';
import { BackBtn, Ring, WorkoutRow } from '../components/ui';
import { useSyncFavs } from '../components/RequireAuth';

const BASE = import.meta.env.BASE_URL;
const withBase = (o) => ({ ...o, photo: assetUrl(o.photo) });
const pad = (n) => String(n).padStart(2, '0');

export function Session() {
  const { id } = useParams();
  const nav = useNavigate();
  const { notify } = useStore();
  const [w, setW] = useState(null);          // séance et exercices
  const [sid, setSid] = useState(null);      // identifiant de la séance côté serveur
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  const [resumed, setResumed] = useState(false);
  const [t, setT] = useState(0);             // secondes actives
  const [exIdx, setExIdx] = useState(0);
  const [inEx, setInEx] = useState(0);       // secondes dans l'exercice courant
  const [run, setRun] = useState(true);
  const [song, setSong] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const latest = useRef({ t: 0, exIdx: 0 });
  latest.current = { t, exIdx };
  const over = useRef(false);

  // charge la séance, puis démarre (ou reprend) la séance côté serveur
  const start = useCallback(() => {
    setError('');
    Promise.all([api.workout(id), api.startSession(id)])
      .then(([d, s]) => {
        setW({ ...d.workout, video: videoKind(d.workout.video) === 'file' ? assetUrl(d.workout.video) : '', photo: assetUrl(d.workout.photo) });
        setSid(s.session.id);
        setT(s.session.elapsed); setExIdx(s.session.exerciseIdx); setInEx(0);
        if (s.session.resumed) { setResumed(true); setRun(false); }
      })
      .catch((e) => (e.status === 404 ? setMissing(true) : setError(e.message)));
  }, [id]);
  useEffect(() => { over.current = false; setW(null); setSid(null); start(); }, [start]);

  // chrono
  useEffect(() => {
    if (!run || !sid) return;
    const h = setInterval(() => { setT((x) => x + 1); setInEx((x) => x + 1); }, 1000);
    return () => clearInterval(h);
  }, [run, sid]);

  // sauvegarde de la progression toutes les 10 s, à chaque pause et quand l'onglet se cache
  const save = useCallback(() => {
    if (!sid || over.current) return;
    const { t: el, exIdx: ex } = latest.current;
    api.saveProgress(sid, el, ex).catch(() => { /* tentative suivante dans 10 s */ });
  }, [sid]);
  useEffect(() => {
    if (!sid || !run) return;
    const h = setInterval(save, 10000);
    return () => clearInterval(h);
  }, [sid, run, save]);
  useEffect(() => { if (sid && !run) save(); }, [run, sid, save]);
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') save(); };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [save]);

  const finish = useCallback(async () => {
    if (over.current || !sid) return;
    over.current = true; setFinishing(true); setRun(false);
    try {
      await api.finishSession(sid, Math.max(1, latest.current.t));
      nav(`/summary/${sid}`, { replace: true });
    } catch (e) {
      over.current = false; setFinishing(false);
      notify(e.message);
    }
  }, [sid, nav, notify]);

  // passe à l'exercice suivant à la fin de son décompte ; termine à la fin du dernier
  useEffect(() => {
    if (!w || finishing) return;
    if (inEx >= w.exercises[exIdx].seconds) {
      if (exIdx < w.exercises.length - 1) { setExIdx((i) => i + 1); setInEx(0); } else finish();
    }
  }, [inEx, exIdx, w, finishing, finish]);

  const quit = async () => {
    if (t >= 5 && !window.confirm('Quitter cette séance sans l\'enregistrer ?')) return;
    over.current = true;
    if (sid) api.abandonSession(sid).catch(() => {});
    nav(-1);
  };

  if (missing) return <Navigate to="/courses" replace />;
  if (error) {
    return (
      <section className="page narrow">
        <div className="topbar"><BackBtn /><span /><span className="sp" /></div>
        <div className="state-box center" role="alert"><b>Impossible de démarrer la séance</b><p>{error}</p><button className="btn" onClick={start}>Réessayer</button></div>
      </section>
    );
  }
  if (!w) {
    return (
      <section className="sess" aria-busy="true" aria-label="Chargement"><div className="art skeleton" /><div className="shade" /></section>
    );
  }

  const exs = w.exercises;
  const e = exs[exIdx];
  const total = exs.reduce((a, x) => a + x.seconds, 0);
  const skip = () => { if (exIdx < exs.length - 1) { setExIdx(exIdx + 1); setInEx(0); } else finish(); };
  const prev = () => { setExIdx(Math.max(0, exIdx - 1)); setInEx(0); };

  return (
    <section className={'sess' + (run ? '' : ' paused')}>
      <Vid src={w.video} poster={w.photo} play={run} pos="center 30%" />
      <div className="shade" />
      <div className="top">
        <button className="icon-btn glass back" onClick={quit} aria-label="Retour"><Icon n="back" /></button>
        <div className="chev"><i /><i /></div>
        <div className="timer" role="timer" aria-label="Temps écoulé">{pad(Math.floor(t / 60))}<em>:</em>{pad(t % 60)}</div>
        <div className="name">x{e.reps} {e.name}</div>
        <div className="count">{Math.max(0, e.seconds - inEx)} s restantes · exercice {exIdx + 1}/{exs.length}</div>
        <div className="prog"><i style={{ width: `${Math.min(100, (t / total) * 100)}%` }} /></div>
        {resumed && !run && <div className="resume-note">Content de te revoir — ta séance est en pause à {pad(Math.floor(t / 60))}:{pad(t % 60)}</div>}
      </div>
      <div className="ctrls">
        <div className="big">
          <button onClick={prev} disabled={exIdx === 0 || finishing}>Précédent</button>
          <button onClick={skip} disabled={finishing}>{exIdx < exs.length - 1 ? 'Exercice suivant' : 'Dernier'}</button>
          <button className="fin" onClick={finish} disabled={finishing}>{finishing ? 'Enregistrement…' : 'Terminer'}</button>
        </div>
        <div className="bar">
          <div className="art-m"><Icon n="music" /></div>
          <div className="tt">{SONGS[song][0]}<small>{SONGS[song][1]}</small></div>
          <button className="sk" aria-label="Titre suivant" onClick={() => setSong((song + 1) % SONGS.length)}><Icon n="next" /></button>
          <button className="pp" aria-label={run ? 'Pause' : 'Reprendre'} onClick={() => setRun(!run)} disabled={finishing}><Icon n={run ? 'pause' : 'play'} /></button>
        </div>
      </div>
    </section>
  );
}

export function Summary() {
  const { id } = useParams();
  const nav = useNavigate();
  const { notify } = useStore();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);

  const load = useCallback(() => {
    setError('');
    api.sessionSummary(id)
      .then((r) => setD({ ...r, next: r.next.map(withBase), session: { ...r.session, workout: withBase(r.session.workout) } }))
      .catch((e) => (e.status === 404 ? setMissing(true) : setError(e.message)));
  }, [id]);
  useEffect(() => { setD(null); load(); }, [load]);
  useSyncFavs(d?.next);

  if (missing) return <Navigate to="/home" replace />;
  if (error) return <section className="page narrow summary"><div className="state-box center" role="alert"><b>Impossible de charger tes résultats</b><p>{error}</p><button className="btn" onClick={load}>Réessayer</button></div></section>;
  if (!d) return <section className="page narrow summary" aria-busy="true" aria-label="Chargement"><div className="trophy skeleton" /></section>;

  const { session: s, today, totals, next } = d;
  const mins = Math.max(1, Math.round(s.seconds / 60));
  const goalPct = Math.min(100, Math.round((today.kcal / today.goal) * 100));
  const share = async () => {
    const text = `Je viens de terminer ${s.workout.title} sur FitLife : ${s.kcal} kcal en ${mins} min !`;
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); notify('Copié dans le presse-papiers'); }
    } catch { /* partage annulé */ }
  };

  return (
    <section className="page narrow summary">
      <div className="trophy"><Icon n="check" /></div>
      <h1 className="h1">Félicitations !</h1>
      <p className="sub">{s.workout.title}{s.newBest && s.timesDone > 1 ? ' · nouveau record personnel 🎉' : ''}</p>
      <div className="stats">
        <div><b>{s.kcal}</b><small>kcal brûlées</small></div>
        <div><b>{mins}</b><small>Minutes</small></div>
        <div><b>{Math.round(s.pct * 100)}%</b><small>Réalisé</small></div>
      </div>
      <div className="today sum-today">
        <Ring value={today.kcal} max={today.goal}><b>{goalPct}%</b></Ring>
        <div className="today-t">
          <b>Objectif du jour</b>
          <span>{today.kcal} / {today.goal} kcal</span>
          <small><Icon n="flame" /> {totals.streak} {totals.streak === 1 ? 'jour' : 'jours'} d'affilée · {totals.workouts} {totals.workouts === 1 ? 'séance' : 'séances'}</small>
        </div>
      </div>
      <button className="btn" onClick={() => nav('/home', { replace: true })}>Terminer</button>
      <button className="btn ghost" onClick={share}>Partager mon résultat</button>
      {next.length > 0 && (
        <>
          <h3 className="h3 left">À suivre</h3>
          <div className="lst grid left">{next.map((r) => <WorkoutRow key={r.id} w={r} />)}</div>
        </>
      )}
    </section>
  );
}
