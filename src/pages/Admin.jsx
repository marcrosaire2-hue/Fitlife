import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useStore } from '../store';
import RouteMap from '../components/RouteMap';
import { TypePhoto, dateLabel, timeLabel } from '../components/ActivityBits';
import Avatar from '../components/Avatar';
import { BackBtn, Empty, SearchBox } from '../components/ui';
import { fmtDistance, fmtDuration, fmtKm, fmtPace, fmtSpeed, typeOf } from '../lib/tracker';

export function AdminTabs() {
  const cls = ({ isActive }) => 'atab' + (isActive ? ' on' : '');
  return (
    <nav className="atabs admin-tabs" aria-label="Espace administrateur">
      <NavLink to="/admin" end className={cls}>Aperçu</NavLink>
      <NavLink to="/admin/users" className={cls}>Comptes</NavLink>
      <NavLink to="/admin/content" className={cls}>Contenu</NavLink>
      <NavLink to="/admin/events" className={cls}>Événements</NavLink>
    </nav>
  );
}

export function AdminShell({ title = 'Administration', back = '/home', children }) {
  return (
    <section className="page admin">
      <div className="topbar"><BackBtn to={back} /><h2>{title}</h2><span className="sp" /></div>
      <div className="px"><AdminTabs />{children}</div>
    </section>
  );
}

function ErrorBox({ title, message, onRetry }) {
  return <div className="state-box center" role="alert"><b>{title}</b><p>{message}</p><button className="btn" onClick={onRetry}>Réessayer</button></div>;
}
const frDate = (t) => new Date(t).toLocaleDateString('fr', { day: 'numeric', month: 'short', year: 'numeric' });

/* ---------------- aperçu ---------------- */
export function AdminHome() {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => { setError(''); api.admin.overview().then(setD).catch((e) => setError(e.message)); }, []);
  useEffect(load, [load]);
  const C = d?.counts;
  const cards = d ? [
    ['Comptes', C.users, '/admin/users'], ['Activités', C.activities, '/admin/users'], ['Séances', C.workouts, '/admin/content'], ['Cours', C.courses, '/admin/content'],
    ['Coachs', C.trainers, '/admin/content'], ['Événements', C.events, '/admin/events'], ['Défis', C.challenges, '/activity/challenges'], ['Publications', C.posts, '/activity/community'],
  ] : [];
  return (
    <AdminShell>
      {error ? <ErrorBox title="Impossible de charger l'aperçu" message={error} onRetry={load} /> : !d ? (
        <div aria-busy="true" aria-label="Chargement"><div className="skeleton" style={{ height: 180, borderRadius: 26 }} /></div>
      ) : (
        <>
          <div className="today atotals">
            <div><small>Distance totale</small><b>{fmtKm(d.totals.distance)}<em> km</em></b></div>
            <div><small>Temps total</small><b>{fmtDuration(d.totals.duration)}</b></div>
            <div><small>Pas</small><b>{d.totals.steps.toLocaleString('fr')}</b></div>
          </div>
          <p className="muted" style={{ textAlign: 'center' }}>Cette semaine : {d.week.users} {d.week.users === 1 ? 'nouveau compte' : 'nouveaux comptes'}, {d.week.activities} {d.week.activities === 1 ? 'activité' : 'activités'}.</p>
          <div className="admin-grid">
            {cards.map(([label, n, to]) => <Link key={label} to={to} className="stat-card"><b>{n}</b><small>{label}</small></Link>)}
          </div>
        </>
      )}
    </AdminShell>
  );
}

/* ---------------- comptes ---------------- */
export function AdminUsers() {
  const [q, setQ] = useState('');
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const stamp = useRef(0);
  const load = useCallback((query) => {
    const n = ++stamp.current;
    setError('');
    api.admin.users(query.trim()).then((r) => { if (n === stamp.current) setD(r); }).catch((e) => { if (n === stamp.current) setError(e.message); });
  }, []);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; load(''); return undefined; }
    const h = setTimeout(() => load(q), 250);
    return () => clearTimeout(h);
  }, [q, load]);

  return (
    <AdminShell title="Comptes">
      <SearchBox value={q} onChange={setQ} placeholder="Rechercher un nom ou un e-mail" />
      {error ? <ErrorBox title="Impossible de charger les comptes" message={error} onRetry={() => load(q)} /> : !d ? (
        <div className="lst" aria-busy="true" aria-label="Chargement" style={{ marginTop: 14 }}><div className="row skeleton" /><div className="row skeleton" /></div>
      ) : (
        <>
          <p className="muted" style={{ margin: '12px 2px 8px' }}>{d.users.length} {d.users.length === 1 ? 'compte affiché' : 'comptes affichés'} sur {d.total}</p>
          <div className="lst grid">
            {d.users.length ? d.users.map((u) => (
              <Link key={u.id} to={`/admin/users/${u.id}`} className="row">
                <Avatar name={u.name} src={u.avatar} size="sm" />
                <div className="t">
                  <b>{u.name}{u.admin && <span className="best" style={{ marginLeft: 6 }}>Admin</span>}</b>
                  <small>{u.email}</small>
                  <small>{u.activities} {u.activities === 1 ? 'activité' : 'activités'} · {fmtKm(u.distance)} km · inscrit le {frDate(u.createdAt)}</small>
                </div>
              </Link>
            )) : <Empty>Aucun compte ne correspond.</Empty>}
          </div>
        </>
      )}
    </AdminShell>
  );
}

/* ---------------- un compte : statistiques, activités, parcours ---------------- */
export function AdminUserDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { notify } = useStore();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  const load = useCallback(() => {
    setError('');
    api.admin.user(id).then(setD).catch((e) => (e.status === 404 ? setMissing(true) : setError(e.message)));
  }, [id]);
  useEffect(() => { setD(null); load(); }, [load]);

  if (missing) return <Navigate to="/admin/users" replace />;
  const u = d?.user;
  const reset = async () => {
    if (!window.confirm(`Remettre à zéro les activités de ${u.name} (${u.activities}) ? Cette action est définitive.`)) return;
    try { await api.admin.resetActivities(id); notify('Activités supprimées'); load(); } catch (e) { notify(e.message); }
  };
  const removeActivity = async (a) => {
    if (!window.confirm('Supprimer cette activité ?')) return;
    try { await api.admin.deleteActivity(a.id); notify('Activité supprimée'); load(); } catch (e) { notify(e.message); }
  };
  const removeUser = async () => {
    if (!window.confirm(`Supprimer définitivement le compte de ${u.name} et toutes ses données ?`)) return;
    try { await api.admin.deleteUser(id); notify('Compte supprimé'); nav('/admin/users', { replace: true }); } catch (e) { notify(e.message); }
  };

  return (
    <AdminShell title="Compte" back="/admin/users">
      {error ? <ErrorBox title="Impossible de charger ce compte" message={error} onRetry={load} /> : !d ? (
        <div aria-busy="true" aria-label="Chargement"><div className="skeleton" style={{ height: 160, borderRadius: 26 }} /></div>
      ) : (
        <>
          <div className="card">
            <div className="post-h">
              <Avatar name={u.name} src={u.avatar} size="sm" />
              <div><b>{u.name}{u.admin && <span className="best" style={{ marginLeft: 6 }}>Admin</span>}</b><small>{u.email}</small></div>
            </div>
            <p className="muted" style={{ marginTop: 10 }}>
              Inscrit le {frDate(u.createdAt)} · {d.challenges} {d.challenges === 1 ? 'défi' : 'défis'} · {d.events} {d.events === 1 ? 'événement' : 'événements'} · {d.posts} {d.posts === 1 ? 'publication' : 'publications'}
              {d.goals.length > 0 && <><br />Objectifs : {d.goals.join(', ')}</>}
            </p>
          </div>
          <div className="stats">
            <div><b>{u.activities}</b><small>Activités</small></div>
            <div><b>{fmtKm(u.distance)}</b><small>km</small></div>
            <div><b>{fmtDuration(u.duration)}</b><small>Temps</small></div>
            <div><b>{u.steps.toLocaleString('fr')}</b><small>Pas</small></div>
            <div><b>{u.workouts}</b><small>Séances</small></div>
          </div>

          <div className="sec" style={{ padding: '14px 0 8px' }}><h3>Activités et parcours</h3><small>{d.activities.length} dernières</small></div>
          <div className="lst grid">
            {d.activities.length ? d.activities.map((a) => (
              <div key={a.id} className="row arow">
                <Link to={`/admin/activities/${a.id}`} className="arow-main">
                  <div className="thumb"><TypePhoto type={a.type} /></div>
                  <div className="t"><b>{typeOf(a.type)?.label ?? a.type} · {fmtDistance(a.distance)}</b><small>{dateLabel(a.startedAt)} · {fmtDuration(a.duration)} · {fmtPace(a.distance, a.duration)}/km</small></div>
                </Link>
                <button className="mini-btn" aria-label="Supprimer cette activité" onClick={() => removeActivity(a)}>Supprimer</button>
              </div>
            )) : <Empty>Aucune activité enregistrée.</Empty>}
          </div>

          <div className="admin-actions">
            {u.activities > 0 && <button className="btn ghost" onClick={reset}>Remettre à zéro les activités</button>}
            {!u.admin && <button className="btn ghost danger" onClick={removeUser}>Supprimer ce compte</button>}
          </div>
        </>
      )}
    </AdminShell>
  );
}

/* ---------------- une activité : parcours sur la carte ---------------- */
export function AdminActivity() {
  const { id } = useParams();
  const nav = useNavigate();
  const { notify } = useStore();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  const load = useCallback(() => {
    setError('');
    api.admin.activity(id).then(setD).catch((e) => (e.status === 404 ? setMissing(true) : setError(e.message)));
  }, [id]);
  useEffect(() => { setD(null); load(); }, [load]);

  if (missing) return <Navigate to="/admin/users" replace />;
  const a = d?.activity;
  const remove = async () => {
    if (!window.confirm('Supprimer cette activité ?')) return;
    try { await api.admin.deleteActivity(id); notify('Activité supprimée'); nav(d.user ? `/admin/users/${d.user.id}` : '/admin/users', { replace: true }); } catch (e) { notify(e.message); }
  };
  return (
    <AdminShell title={a ? (typeOf(a.type)?.label ?? 'Activité') : 'Activité'} back={d?.user ? `/admin/users/${d.user.id}` : '/admin/users'}>
      {error ? <ErrorBox title="Impossible de charger cette activité" message={error} onRetry={load} /> : !d ? (
        <div aria-busy="true" aria-label="Chargement"><div className="skeleton" style={{ height: 220, borderRadius: 26 }} /></div>
      ) : (
        <>
          <p className="sub adate">{d.user ? <>{d.user.name} · {d.user.email}<br /></> : null}{dateLabel(a.startedAt)} · {timeLabel(a.startedAt)}</p>
          <div className="card routecard"><RouteMap points={a.route} /></div>
          <div className="stats">
            <div><b>{fmtKm(a.distance)}</b><small>Kilomètres</small></div>
            <div><b>{fmtDuration(a.duration)}</b><small>Durée</small></div>
            <div><b>{fmtPace(a.distance, a.duration)}</b><small>Allure /km</small></div>
            <div><b>{fmtSpeed(a.distance, a.duration)}</b><small>Vitesse km/h</small></div>
            <div><b>{a.stepsEstimated && a.steps > 0 ? '≈' : ''}{a.steps}</b><small>Pas</small></div>
          </div>
          <button className="btn ghost danger" onClick={remove}>Supprimer cette activité</button>
        </>
      )}
    </AdminShell>
  );
}
