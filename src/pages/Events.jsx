import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useStore } from '../store';
import { Img } from '../components/Media';
import { ActivityTabs } from '../components/ActivityBits';
import { BackBtn, Empty } from '../components/ui';
import { assetUrl } from '../lib/media';

export const evDate = (t) => new Date(t).toLocaleDateString('fr', { weekday: 'long', day: 'numeric', month: 'long' });
export const evTime = (t) => new Date(t).toLocaleTimeString('fr', { hour: '2-digit', minute: '2-digit' });
const isOver = (e, now = Date.now()) => now > (e.endsAt ?? e.startsAt + 6 * 3600000);
const when = (e) => `${evDate(e.startsAt)} · ${evTime(e.startsAt)}${e.endsAt ? ` – ${evTime(e.endsAt)}` : ''}`;

function ErrorBox({ title, message, onRetry }) {
  return <div className="state-box center" role="alert"><b>{title}</b><p>{message}</p><button className="btn" onClick={onRetry}>Réessayer</button></div>;
}

/* ---------------- liste des événements ---------------- */
export function Events() {
  const { notify } = useStore();
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setError('');
    api.events().then((d) => setList(d.events)).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const toggle = async (ev, e) => {
    e.preventDefault();
    try { await (ev.joined ? api.leaveEvent(ev.id) : api.joinEvent(ev.id)); notify(ev.joined ? 'Inscription annulée' : 'Tu es inscrit'); load(); } catch (err) { notify(err.message); }
  };

  return (
    <section className="page narrow">
      <div className="topbar"><BackBtn to="/home" /><h2>Activité</h2><span className="sp" /></div>
      <div className="px"><ActivityTabs /></div>
      {error ? <ErrorBox title="Impossible de charger les événements" message={error} onRetry={load} /> : !list ? (
        <div className="px" aria-busy="true" aria-label="Chargement"><div className="skeleton" style={{ height: 220, borderRadius: 26 }} /></div>
      ) : (
        <div className="px feed">
          {list.length ? list.map((ev) => (
            <article key={ev.id} className="evcard">
              <Link to={`/activity/events/${ev.id}`} className="ev-main">
                <div className="ev-img"><Img src={assetUrl(ev.image)} />{isOver(ev) && <span className="ev-over">Terminé</span>}</div>
                <div className="ev-body">
                  <b>{ev.title}</b>
                  <small>{when(ev)}</small>
                  {ev.place && <small>📍 {ev.place}</small>}
                  <small>{ev.participants} {ev.participants === 1 ? 'inscrit' : 'inscrits'}</small>
                </div>
              </Link>
              {!isOver(ev) && <button className={'book' + (ev.joined ? ' on' : '')} onClick={(e) => toggle(ev, e)}>{ev.joined ? 'Inscrit' : "S'inscrire"}</button>}
            </article>
          )) : <Empty>Aucun événement à venir.<br />Reviens bientôt : de nouveaux rendez-vous seront publiés ici.</Empty>}
        </div>
      )}
    </section>
  );
}

/* ---------------- détail d'un événement ---------------- */
export function EventDetail() {
  const { id } = useParams();
  const { notify } = useStore();
  const [ev, setEv] = useState(null);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  const load = useCallback(() => {
    setError('');
    api.event(id).then((d) => setEv(d.event)).catch((e) => (e.status === 404 ? setMissing(true) : setError(e.message)));
  }, [id]);
  useEffect(() => { setEv(null); load(); }, [load]);

  if (missing) return <Navigate to="/activity/events" replace />;
  const toggle = async () => {
    try { await (ev.joined ? api.leaveEvent(id) : api.joinEvent(id)); notify(ev.joined ? 'Inscription annulée' : 'Tu es inscrit'); load(); } catch (e) { notify(e.message); }
  };

  return (
    <section className="page narrow">
      <div className="topbar"><BackBtn to="/activity/events" /><h2>Événement</h2><span className="sp" /></div>
      {error ? <ErrorBox title="Impossible de charger cet événement" message={error} onRetry={load} /> : !ev ? (
        <div className="px" aria-busy="true" aria-label="Chargement"><div className="skeleton" style={{ height: 200, borderRadius: 26 }} /></div>
      ) : (
        <div className="px">
          {ev.image && <div className="ev-hero"><Img src={assetUrl(ev.image)} /></div>}
          <div className="card">
            <h1 className="h1" style={{ padding: 0, margin: '0 0 6px' }}>{ev.title}</h1>
            <p className="muted">{when(ev)}{ev.place ? <><br />📍 {ev.place}</> : null}<br />{ev.participants} {ev.participants === 1 ? 'inscrit' : 'inscrits'}</p>
            {ev.description && <p className="ev-desc">{ev.description}</p>}
          </div>
          {isOver(ev) ? <p className="muted" style={{ textAlign: 'center' }}>Cet événement est terminé.</p>
            : <button className={'btn' + (ev.joined ? ' ghost' : '')} onClick={toggle}>{ev.joined ? "Annuler mon inscription" : "Je m'inscris"}</button>}
        </div>
      )}
    </section>
  );
}
