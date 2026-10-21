import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import RouteMap from '../components/RouteMap';
import { ActivityTabs, TypePhoto, dateLabel } from '../components/ActivityBits';
import Avatar from '../components/Avatar';
import { BackBtn, Empty } from '../components/ui';
import { fmtDistance, fmtDuration, fmtPace, typeOf } from '../lib/tracker';

function PostCard({ p, admin, onDelete }) {
  const a = p.activity;
  return (
    <article className="post">
      <header className="post-h">
        <Avatar name={p.author.name} src={p.author.avatar} size="sm" />
        <div><b>{p.author.name}</b><small>{typeOf(a.type)?.label ?? a.type} · {dateLabel(a.startedAt)}</small></div>
        {(p.mine || admin) && <button className="mini-btn" aria-label={p.mine ? 'Dépublier' : 'Supprimer la publication'} onClick={() => onDelete(p)}>{p.mine ? 'Dépublier' : 'Supprimer'}</button>}
      </header>
      {p.route ? <RouteMap points={p.route} label={`Parcours de ${p.author.name}`} /> : <div className="post-photo"><TypePhoto type={a.type} /></div>}
      <div className="post-stats">
        <div><b>{fmtDistance(a.distance)}</b><small>Distance</small></div>
        <div><b>{fmtDuration(a.duration)}</b><small>Durée</small></div>
        <div><b>{fmtPace(a.distance, a.duration)}</b><small>Allure /km</small></div>
      </div>
      {p.caption && <p className="post-cap">{p.caption}</p>}
    </article>
  );
}

export function Community() {
  const { notify } = useStore();
  const [posts, setPosts] = useState(null);
  const [next, setNext] = useState(null);
  const [admin, setAdmin] = useState(false);
  const [error, setError] = useState('');
  const [more, setMore] = useState(false);

  const load = useCallback(() => {
    setError('');
    api.posts().then((d) => { setPosts(d.posts); setNext(d.next); setAdmin(d.admin); }).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const loadMore = async () => {
    setMore(true);
    try { const d = await api.posts(next); setPosts((x) => [...x, ...d.posts]); setNext(d.next); } catch (e) { notify(e.message); }
    setMore(false);
  };
  const remove = async (p) => {
    if (!window.confirm(p.mine ? 'Retirer ce résultat de la communauté ?' : 'Supprimer cette publication pour tout le monde ?')) return;
    try { await api.deletePost(p.id); setPosts((x) => x.filter((y) => y.id !== p.id)); notify(p.mine ? 'Dépublié' : 'Publication supprimée'); } catch (e) { notify(e.message); }
  };

  return (
    <section className="page narrow">
      <div className="topbar"><BackBtn to="/home" /><h2>Activité</h2><span className="sp" /></div>
      <div className="px"><ActivityTabs /></div>
      {error ? (
        <div className="state-box center" role="alert"><b>Impossible de charger la communauté</b><p>{error}</p><button className="btn" onClick={load}>Réessayer</button></div>
      ) : !posts ? (
        <div className="px" aria-busy="true" aria-label="Chargement"><div className="skeleton" style={{ height: 260, borderRadius: 26 }} /></div>
      ) : (
        <div className="px feed" aria-live="polite">
          {posts.length ? posts.map((p) => <PostCard key={p.id} p={p} admin={admin} onDelete={remove} />)
            : <Empty>Rien n'est publié pour le moment.<br />Termine une activité et publie ton résultat depuis sa page.</Empty>}
          {next && <button className="btn ghost" onClick={loadMore} disabled={more}>{more ? 'Chargement…' : 'Voir plus'}</button>}
        </div>
      )}
    </section>
  );
}
