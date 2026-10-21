import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { Vid } from '../components/Media';
import Icon from '../components/Icon';
import { assetUrl, embedUrl, videoKind } from '../lib/media';
import { levelFr } from '../lib/labels';
import { BackBtn, Fav, WorkoutRow } from '../components/ui';
import { useSyncFavs } from '../components/RequireAuth';

const BASE = import.meta.env.BASE_URL;
const withBase = (o) => ({ ...o, photo: assetUrl(o.photo) });

export function Workout() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);

  const load = useCallback(() => {
    setError('');
    api.workout(id)
      .then((d) => setData({
        w: { ...withBase(d.workout), video: videoKind(d.workout.video) === 'file' ? assetUrl(d.workout.video) : '', embed: embedUrl(d.workout.video) },
        related: d.related.map(withBase),
        mine: d.mine,
      }))
      .catch((e) => (e.status === 404 ? setMissing(true) : setError(e.message)));
  }, [id]);
  useEffect(() => { setData(null); load(); }, [load]);
  useSyncFavs(data ? [data.w, ...data.related] : null);

  if (missing) return <Navigate to="/courses" replace />;
  if (error) {
    return (
      <section className="page narrow">
        <div className="topbar"><BackBtn /><span /><span className="sp" /></div>
        <div className="state-box center" role="alert"><b>Impossible de charger cette séance</b><p>{error}</p><button className="btn" onClick={load}>Réessayer</button></div>
      </section>
    );
  }
  if (!data) {
    return (
      <section className="page detail" aria-busy="true" aria-label="Chargement">
        <div className="det-hero"><div className="art skeleton" /><div className="tb"><BackBtn glass /></div></div>
        <div className="det"><i className="sk-t" style={{ width: 160, height: 12 }} /><i className="sk-t" style={{ width: 260, height: 34, margin: '12px 0' }} /><i className="sk-t" style={{ width: '100%', height: 70 }} /></div>
      </section>
    );
  }
  const { w, related, mine } = data;
  return (
    <section className="page detail">
      <div className="det-hero">
        <Vid src={w.video} poster={w.photo} pos="center 25%" />
        <div className="shade" />
        <div className="tb"><BackBtn glass /><Fav id={w.id} className="glass" /></div>
        <Link to={`/session/${w.id}`} className="play" aria-label="Lancer"><Icon n="play" /></Link>
      </div>
      <div className="det">
        <small className="crumb">{w.course.name} · {levelFr(w.level)}</small>
        <h1>{w.title}</h1>
        {w.desc && <p>{w.desc}</p>}
        <div className="pills">
          <div className="pill"><i><Icon n="clock" /></i><div><small>Durée</small><b>{w.min} min</b></div></div>
          <div className="pill"><i><Icon n="fire" /></i><div><small>Dépense</small><b>{w.kcal} kcal</b></div></div>
        </div>
        {w.embed && (
          <div className="player">
            <iframe src={w.embed} title="Vidéo de la séance" loading="lazy" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"
              allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" />
          </div>
        )}
        {mine.count > 0 && (
          <p className="done-note"><Icon n="check" /> Tu as déjà fait cette séance {mine.count} fois · dernière fois le {new Date(mine.last).toLocaleDateString('fr', { month: 'short', day: 'numeric' })}</p>
        )}
        <h3 className="h3">Exercices</h3>
        <div className="ex">{w.exercises.map((e, i) => <div key={e.name}><em>{i + 1}</em>{e.name}<span>x{e.reps}</span></div>)}</div>
        <Link to={`/session/${w.id}`} className="btn">C'est parti</Link>
        {related.length > 0 && (
          <>
            <h3 className="h3" style={{ marginTop: 26 }}>Plus dans {w.course.name}</h3>
            <div className="lst grid">{related.map((r) => <WorkoutRow key={r.id} w={r} />)}</div>
          </>
        )}
      </div>
    </section>
  );
}
