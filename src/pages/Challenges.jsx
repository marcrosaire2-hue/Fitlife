import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useStore } from '../store';
import { ActivityTabs, dateLabel } from '../components/ActivityBits';
import Avatar from '../components/Avatar';
import { BackBtn, Empty } from '../components/ui';
import { ACTIVITY_TYPES, fmtKm } from '../lib/tracker';

const METRICS = [
  { id: 'distance', label: 'Distance (km)', unit: 'km' },
  { id: 'duration', label: 'Durée (minutes)', unit: 'min' },
  { id: 'steps', label: 'Pas', unit: 'pas' },
  { id: 'count', label: "Nombre d'activités", unit: 'activités' },
];
const typeLabel = (t) => (t === 'any' ? 'Toute activité' : ACTIVITY_TYPES.find((x) => x.id === t)?.label ?? t);

// valeurs stockées en m / s / pas / nombre ; affichage lisible
export function fmtValue(metric, v) {
  if (metric === 'distance') return `${fmtKm(v)} km`;
  if (metric === 'duration') return v >= 3600 ? `${(v / 3600).toFixed(1).replace('.', ',')} h` : `${Math.round(v / 60)} min`;
  if (metric === 'steps') return `${Math.round(v).toLocaleString('fr')} pas`;
  return `${v} ${v === 1 ? 'activité' : 'activités'}`;
}
const STATUS = { active: 'En cours', upcoming: 'À venir', ended: 'Terminé' };

function Progress({ c }) {
  const pct = Math.min(100, Math.round((c.progress / c.target) * 100));
  return (
    <div className="prog-wrap">
      <div className="prog-bar" role="progressbar" aria-valuenow={pct} aria-valuemin="0" aria-valuemax="100"><i style={{ width: `${pct}%` }} /></div>
      <small>{fmtValue(c.metric, Math.min(c.progress, c.target))} / {fmtValue(c.metric, c.target)} · {pct}%</small>
    </div>
  );
}

function ErrorBox({ title, message, onRetry }) {
  return <div className="state-box center" role="alert"><b>{title}</b><p>{message}</p><button className="btn" onClick={onRetry}>Réessayer</button></div>;
}

/* ---------------- liste ---------------- */
export function Challenges() {
  const nav = useNavigate();
  const { notify } = useStore();
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setError('');
    api.challenges().then((d) => setList(d.challenges)).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const toggle = async (e, c) => {
    e.preventDefault();
    try { await (c.joined ? api.leaveChallenge(c.id) : api.joinChallenge(c.id)); notify(c.joined ? 'Tu as quitté le défi' : 'Tu participes au défi'); load(); } catch (err) { notify(err.message); }
  };

  return (
    <section className="page narrow">
      <div className="topbar"><BackBtn to="/home" /><h2>Activité</h2><span className="sp" /></div>
      <div className="px">
        <ActivityTabs />
        <button className="btn" onClick={() => nav('/activity/challenges/new')}>Créer un défi</button>
      </div>
      {error ? <ErrorBox title="Impossible de charger les défis" message={error} onRetry={load} /> : !list ? (
        <div className="lst px" aria-busy="true" aria-label="Chargement" style={{ marginTop: 14 }}><div className="row skeleton" /><div className="row skeleton" /></div>
      ) : (
        <div className="lst px" style={{ marginTop: 14 }}>
          {list.length ? list.map((c) => (
            <div key={c.id} className="chcard">
              <Link to={`/activity/challenges/${c.id}`} className="ch-main">
              <div className="ch-top">
                {c.official && <span className="best">Officiel</span>}
                <span className={'ch-status ' + c.status}>{STATUS[c.status]}</span>
              </div>
              <b>{c.title}</b>
              <small>{typeLabel(c.type)} · objectif {fmtValue(c.metric, c.target)} · jusqu'au {dateLabel(c.endsAt)}</small>
              {c.joined ? <Progress c={c} /> : <small className="ch-meta">{c.participants} {c.participants === 1 ? 'participant' : 'participants'}</small>}
              </Link>
              {c.status !== 'ended' && <button className={'book' + (c.joined ? ' on' : '')} onClick={(e) => toggle(e, c)}>{c.joined ? 'Inscrit' : 'Rejoindre'}</button>}
            </div>
          )) : <Empty>Aucun défi pour le moment.<br />Crée le premier et invite tes amis.</Empty>}
        </div>
      )}
    </section>
  );
}

/* ---------------- détail et classement ---------------- */
export function ChallengeDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { notify } = useStore();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  const load = useCallback(() => {
    setError('');
    api.challenge(id).then(setD).catch((e) => (e.status === 404 ? setMissing(true) : setError(e.message)));
  }, [id]);
  useEffect(() => { setD(null); load(); }, [load]);

  if (missing) return <Navigate to="/activity/challenges" replace />;
  const c = d?.challenge;
  const toggle = async () => {
    try { await (c.joined ? api.leaveChallenge(id) : api.joinChallenge(id)); notify(c.joined ? 'Tu as quitté le défi' : 'Tu participes au défi'); load(); } catch (e) { notify(e.message); }
  };
  const remove = async () => {
    if (!window.confirm('Supprimer ce défi pour tout le monde ?')) return;
    try { await api.deleteChallenge(id); notify('Défi supprimé'); nav('/activity/challenges', { replace: true }); } catch (e) { notify(e.message); }
  };

  return (
    <section className="page narrow">
      <div className="topbar"><BackBtn to="/activity/challenges" /><h2>Défi</h2><span className="sp" /></div>
      {error ? <ErrorBox title="Impossible de charger ce défi" message={error} onRetry={load} /> : !d ? (
        <div className="px" aria-busy="true" aria-label="Chargement"><div className="skeleton" style={{ height: 160, borderRadius: 26 }} /></div>
      ) : (
        <div className="px">
          <div className="card">
            <div className="ch-top">{c.official && <span className="best">Officiel</span>}<span className={'ch-status ' + c.status}>{STATUS[c.status]}</span></div>
            <h1 className="h1" style={{ padding: 0, margin: '6px 0' }}>{c.title}</h1>
            {c.description && <p className="muted">{c.description}</p>}
            <p className="muted">{typeLabel(c.type)} · objectif {fmtValue(c.metric, c.target)}<br />{dateLabel(c.startsAt)} → {dateLabel(c.endsAt)} · par {c.creator.name}</p>
            {c.joined && <Progress c={c} />}
          </div>
          {c.status !== 'ended' && <button className={'btn' + (c.joined ? ' ghost' : '')} onClick={toggle}>{c.joined ? 'Quitter le défi' : 'Rejoindre le défi'}</button>}
          <p className="muted" style={{ marginTop: 10 }}>Les activités que tu enregistres pendant le défi comptent automatiquement.</p>

          <div className="sec" style={{ padding: '14px 0 8px' }}><h3>Classement</h3><small>{c.participants} {c.participants === 1 ? 'participant' : 'participants'}</small></div>
          <div className="card board">
            {d.leaderboard.length ? d.leaderboard.map((r) => (
              <div key={r.id} className={'bk board-row' + (r.me ? ' me' : '')}>
                <span className="rank">{r.rank}</span>
                <Avatar name={r.name} src={r.avatar} size="xs" />
                <span className="who-n">{r.name}{r.me ? ' (toi)' : ''}</span>
                <small>{fmtValue(c.metric, r.value)}{r.done ? ' ✓' : ''}</small>
              </div>
            )) : <p className="muted">Personne n'a encore rejoint ce défi.</p>}
          </div>
          {c.canDelete && <button className="btn ghost danger" onClick={remove}>Supprimer ce défi</button>}
        </div>
      )}
    </section>
  );
}

/* ---------------- création ---------------- */
const dayInput = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const startOf = (s) => new Date(`${s}T00:00:00`).getTime();
const endOf = (s) => new Date(`${s}T23:59:59`).getTime();

export function ChallengeNew() {
  const nav = useNavigate();
  const { user } = useAuth();
  const { notify } = useStore();
  const [v, setV] = useState({ title: '', description: '', type: 'any', metric: 'distance', target: '', start: dayInput(Date.now()), end: dayInput(Date.now() + 7 * 86400000), official: false });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const unit = METRICS.find((m) => m.id === v.metric).unit;

  const submit = async (e) => {
    e.preventDefault();
    const n = parseFloat(String(v.target).replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) { setErr('Entre un objectif supérieur à zéro.'); return; }
    const target = v.metric === 'distance' ? n * 1000 : v.metric === 'duration' ? n * 60 : n;       // km → m, min → s
    setBusy(true); setErr('');
    try {
      const r = await api.createChallenge({
        title: v.title, description: v.description, type: v.type, metric: v.metric, target,
        startsAt: startOf(v.start), endsAt: endOf(v.end), official: user?.admin ? v.official : undefined,
      });
      notify('Défi créé');
      nav(`/activity/challenges/${r.challenge.id}`, { replace: true });
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };

  return (
    <section className="page narrow">
      <div className="topbar"><BackBtn to="/activity/challenges" /><h2>Nouveau défi</h2><span className="sp" /></div>
      <form className="px" onSubmit={submit} noValidate>
        <div className="fld"><label htmlFor="c-t">Titre</label><input id="c-t" value={v.title} onChange={set('title')} maxLength={60} placeholder="ex. 50 km en un mois" /></div>
        <div className="fld"><label htmlFor="c-d">Description (facultatif)</label><textarea id="c-d" value={v.description} onChange={set('description')} maxLength={300} rows={3} /></div>
        <div className="fld"><label htmlFor="c-ty">Activité</label>
          <select id="c-ty" value={v.type} onChange={set('type')}><option value="any">Toute activité</option>{ACTIVITY_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></div>
        <div className="fld"><label htmlFor="c-m">Objectif</label>
          <select id="c-m" value={v.metric} onChange={set('metric')}>{METRICS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></div>
        <div className="fld"><label htmlFor="c-g">Cible ({unit})</label><input id="c-g" inputMode="decimal" value={v.target} onChange={set('target')} placeholder="0" /></div>
        <div className="two">
          <div className="fld"><label htmlFor="c-s">Début</label><input id="c-s" type="date" value={v.start} onChange={set('start')} /></div>
          <div className="fld"><label htmlFor="c-e">Fin</label><input id="c-e" type="date" value={v.end} min={v.start} onChange={set('end')} /></div>
        </div>
        {user?.admin && <label className="check"><input type="checkbox" checked={v.official} onChange={set('official')} /> Défi officiel (affiché en premier, avec un badge)</label>}
        {err && <div className="form-err" role="alert">{err}</div>}
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Création…' : 'Créer le défi'}</button>
      </form>
    </section>
  );
}
