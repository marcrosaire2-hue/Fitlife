import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { TypePhoto } from '../components/ActivityBits';
import Icon from '../components/Icon';
import { BackBtn, Empty } from '../components/ui';
import { fmtDistance, fmtDuration, fmtPace, typeOf } from '../lib/tracker';

const KINDS = [['all', 'Tout'], ['activity', 'Activités'], ['workout', 'Séances'], ['post', 'Publications'], ['challenge', 'Défis'], ['event', 'Événements']];
const monthLabel = (t) => new Date(t).toLocaleDateString('fr', { month: 'long', year: 'numeric' });
const when = (t) => new Date(t).toLocaleDateString('fr', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + new Date(t).toLocaleTimeString('fr', { hour: '2-digit', minute: '2-digit' });
const CH_STATUS = { active: 'en cours', upcoming: 'à venir', ended: 'terminé' };

function Item({ it }) {
  if (it.kind === 'activity') {
    return (
      <Link to={`/activity/${it.id}`} className="row">
        <div className="thumb"><TypePhoto type={it.type} /></div>
        <div className="t"><b>{typeOf(it.type)?.label ?? it.type} · {fmtDistance(it.distance)}</b><small>{when(it.at)} · {fmtDuration(it.duration)} · {fmtPace(it.distance, it.duration)}/km</small></div>
      </Link>
    );
  }
  if (it.kind === 'workout') {
    return (
      <Link to={`/workout/${it.workoutId}`} className="row">
        <div className="thumb ico"><Icon n="check" /></div>
        <div className="t"><b>Séance terminée : {it.title}</b><small>{when(it.at)} · {it.kcal} kcal · {Math.max(1, Math.round(it.duration / 60))} min · {Math.round(it.pct * 100)} %</small></div>
      </Link>
    );
  }
  if (it.kind === 'post') {
    return (
      <Link to="/activity/community" className="row">
        <div className="thumb ico"><Icon n="send" /></div>
        <div className="t"><b>Publié dans la communauté</b><small>{when(it.at)} · {typeOf(it.type)?.label ?? it.type} · {fmtDistance(it.distance)}{it.caption ? ` · « ${it.caption} »` : ''}</small></div>
      </Link>
    );
  }
  if (it.kind === 'challenge') {
    return (
      <Link to={`/activity/challenges/${it.id}`} className="row">
        <div className="thumb ico"><Icon n="trophy" /></div>
        <div className="t"><b>Défi : {it.title}</b><small>Rejoint le {when(it.at)} · {CH_STATUS[it.status]}</small></div>
      </Link>
    );
  }
  return (
    <Link to={`/activity/events/${it.id}`} className="row">
      <div className="thumb ico"><Icon n="pin" /></div>
      <div className="t"><b>Événement : {it.title}</b><small>Inscrit le {when(it.at)} · prévu le {new Date(it.startsAt).toLocaleDateString('fr', { day: 'numeric', month: 'long' })}</small></div>
    </Link>
  );
}

/* Page « Historique » : tout ce que l'utilisateur a fait, à part de la page Activité */
export default function History() {
  const [kind, setKind] = useState('all');
  const [items, setItems] = useState(null);
  const [next, setNext] = useState(null);
  const [error, setError] = useState('');
  const [more, setMore] = useState(false);

  const load = useCallback(() => {
    setError(''); setItems(null);
    api.history(kind).then((d) => { setItems(d.items); setNext(d.next); }).catch((e) => setError(e.message));
  }, [kind]);
  useEffect(load, [load]);

  const loadMore = async () => {
    setMore(true);
    try { const d = await api.history(kind, next); setItems((x) => [...x, ...d.items]); setNext(d.next); } catch (e) { setError(e.message); }
    setMore(false);
  };

  let lastMonth = '';
  return (
    <section className="page narrow">
      <div className="topbar"><BackBtn to="/profile" /><h2>Historique</h2><span className="sp" /></div>
      <div className="chips px" role="tablist" aria-label="Filtrer l'historique">
        {KINDS.map(([k, l]) => <button key={k} role="tab" aria-selected={kind === k} className={'chip' + (kind === k ? ' on' : '')} onClick={() => setKind(k)}>{l}</button>)}
      </div>
      {error ? <div className="state-box center" role="alert"><b>Impossible de charger l'historique</b><p>{error}</p><button className="btn" onClick={load}>Réessayer</button></div> : !items ? (
        <div className="lst px" aria-busy="true" aria-label="Chargement" style={{ marginTop: 14 }}><div className="row skeleton" /><div className="row skeleton" /></div>
      ) : (
        <div className="px" style={{ marginTop: 8 }}>
          {items.length ? items.map((it) => {
            const m = monthLabel(it.at), head = m !== lastMonth; lastMonth = m;
            return (
              <div key={`${it.kind}-${it.id}-${it.at}`}>
                {head && <div className="sec" style={{ padding: '16px 0 8px' }}><h3 style={{ textTransform: 'capitalize' }}>{m}</h3></div>}
                <div className="lst" style={{ marginBottom: 8 }}><Item it={it} /></div>
              </div>
            );
          }) : <Empty>Rien dans l'historique pour le moment.<br />Tes activités, séances, publications, défis et événements apparaîtront ici.</Empty>}
          {next && <button className="btn ghost" onClick={loadMore} disabled={more}>{more ? 'Chargement…' : 'Voir plus'}</button>}
        </div>
      )}
    </section>
  );
}
