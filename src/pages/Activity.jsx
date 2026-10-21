import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useStore } from '../store';
import Icon from '../components/Icon';
import RouteMap from '../components/RouteMap';
import { BackBtn, Empty } from '../components/ui';
import { ActivityTabs, TypePhoto, dateLabel, timeLabel } from '../components/ActivityBits';
import {
  ACTIVITY_TYPES, StepCounter, evaluateFix, fmtDistance, fmtDuration, fmtKm, fmtPace, fmtSpeed, simplify, typeOf,
} from '../lib/tracker';


function ErrorBox({ title, message, onRetry }) {
  return <div className="state-box center" role="alert"><b>{title}</b><p>{message}</p><button className="btn" onClick={onRetry}>Réessayer</button></div>;
}

/* ---------------- Accueil des activités : choix du type, totaux, historique ---------------- */
export function Activity() {
  const nav = useNavigate();
  const [type, setType] = useState('walk');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setError('');
    api.activities().then(setData).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  return (
    <section className="page">
      <div className="topbar"><BackBtn /><h2>Activité</h2><span className="sp" /></div>
      <div className="px">
        <ActivityTabs />
        <div className="atypes" role="radiogroup" aria-label="Type d'activité">
          {ACTIVITY_TYPES.map((t) => (
            <button key={t.id} role="radio" aria-checked={type === t.id} className={'atype' + (type === t.id ? ' on' : '')} onClick={() => setType(t.id)}>
              <TypePhoto type={t.id} /><span className="shade" /><b>{t.label}</b>
            </button>
          ))}
        </div>
        <button className="btn" onClick={() => nav(`/activity/live/${type}`)}><Icon n="pin" /> Démarrer : {typeOf(type).label.toLowerCase()}</button>
        <p className="muted gps-note">La distance et le parcours utilisent la localisation de ton téléphone pendant l'activité ; rien n'est enregistré avant d'appuyer sur démarrer. La carte est chargée depuis OpenStreetMap.</p>
      </div>

      {error ? <ErrorBox title="Impossible de charger tes activités" message={error} onRetry={load} /> : !data ? (
        <div className="lst px" aria-busy="true" aria-label="Chargement"><div className="row skeleton" /><div className="row skeleton" /></div>
      ) : (
        <>
          {data.totals.count > 0 && (
            <div className="today px atotals">
              <div><small>Distance</small><b>{fmtKm(data.totals.distance)}<em> km</em></b></div>
              <div><small>Durée</small><b>{fmtDuration(data.totals.duration)}</b></div>
              <div><small>Pas</small><b>{data.totals.steps.toLocaleString('fr')}</b></div>
            </div>
          )}
          <Link to="/history" className="row act-cta px-card">
            <div className="thumb ico"><Icon n="clock" /></div>
            <div className="t"><b>Mon historique</b><small>Toutes mes activités, séances, défis et événements</small></div>
          </Link>
        </>
      )}
    </section>
  );
}

/* ---------------- Suivi en direct : chrono, distance GPS, pas, tracé ---------------- */
const GPS_TEXT = {
  idle: 'GPS éteint', searching: 'Recherche du GPS…', good: 'Signal GPS bon', weak: 'Signal GPS faible',
  denied: 'Localisation refusée', unavailable: 'Localisation indisponible',
};

export function ActivityLive() {
  const { type } = useParams();
  const nav = useNavigate();
  const { notify } = useStore();
  const info = typeOf(type);

  const [phase, setPhase] = useState('ready');        // ready | running | paused | saving | failed
  const [gps, setGps] = useState('idle');
  const [secs, setSecs] = useState(0);
  const [distance, setDistance] = useState(0);
  const [steps, setSteps] = useState(0);
  const [sensorSteps, setSensorSteps] = useState(false);
  const [route, setRoute] = useState([]);
  const [error, setError] = useState('');

  // état « vivant » hors rendu : les callbacks GPS/mouvement s'y appuient
  const r = useRef({
    phase: 'ready', startedAt: 0, accMs: 0, resumeAt: 0, last: null, distance: 0, route: [], watch: null, steps: new StepCounter(),
    wake: null, tick: null, onMotion: null,
  });
  r.current.phase = phase;

  const activeMs = () => r.current.accMs + (r.current.resumeAt ? Date.now() - r.current.resumeAt : 0);

  const stopSensors = useCallback(() => {
    const s = r.current;
    if (s.watch != null) { navigator.geolocation.clearWatch(s.watch); s.watch = null; }
    if (s.onMotion) { window.removeEventListener('devicemotion', s.onMotion); s.onMotion = null; }
    if (s.wake) { s.wake.release?.().catch(() => {}); s.wake = null; }
    clearInterval(s.tick); s.tick = null;
  }, []);
  useEffect(() => stopSensors, [stopSensors]);

  // empêche de quitter l'onglet par mégarde pendant une activité
  useEffect(() => {
    if (phase !== 'running' && phase !== 'paused') return undefined;
    const h = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [phase]);

  const onFix = useCallback((pos) => {
    const s = r.current;
    const c = pos.coords;
    const fix = { lat: c.latitude, lon: c.longitude, t: pos.timestamp || Date.now(), acc: c.accuracy ?? 999 };
    setGps(fix.acc <= 20 ? 'good' : 'weak');
    if (s.phase !== 'running') return;
    const res = evaluateFix(s.last, fix, type);
    if (!res.ok) return;
    s.last = fix;
    s.distance += res.d;
    s.route.push([fix.lat, fix.lon]);
    setDistance(s.distance);
    setRoute(s.route.slice());
  }, [type]);

  const startGps = useCallback(() => {
    const s = r.current;
    if (!('geolocation' in navigator)) { setGps('unavailable'); return false; }
    setGps('searching');
    s.watch = navigator.geolocation.watchPosition(onFix, (e) => setGps(e.code === 1 ? 'denied' : 'weak'), { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
    return true;
  }, [onFix]);

  const start = async () => {
    const s = r.current;
    setError('');
    // iOS : l'accès aux capteurs de mouvement se demande dans le geste de l'utilisateur
    try { if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') await DeviceMotionEvent.requestPermission(); } catch { /* pas de capteur : pas estimés */ }
    s.onMotion = (e) => {
      const a = e.accelerationIncludingGravity;
      if (!a || s.phase !== 'running') return;
      const before = s.steps.count;
      s.steps.push(a.x ?? 0, a.y ?? 0, a.z ?? 0, Date.now());
      if (s.steps.count !== before) setSteps(s.steps.count);
      if (s.steps.events === 25) setSensorSteps(true);
    };
    window.addEventListener('devicemotion', s.onMotion);
    startGps();
    try { s.wake = await navigator.wakeLock?.request('screen'); } catch { /* écran non verrouillable */ }
    s.startedAt = Date.now(); s.accMs = 0; s.resumeAt = s.startedAt; s.last = null;
    s.tick = setInterval(() => setSecs(Math.floor(activeMs() / 1000)), 500);
    setPhase('running');
  };

  const pause = () => { const s = r.current; s.accMs = activeMs(); s.resumeAt = 0; setPhase('paused'); };
  const resume = () => { const s = r.current; s.resumeAt = Date.now(); s.last = null; setPhase('running'); };   // pas de ligne droite sur la pause

  // sans capteur de mouvement, les pas sont estimés à partir de la distance
  const estimated = !sensorSteps;
  const shownSteps = estimated ? Math.round(distance / info.stride) : steps;

  const save = async () => {
    const s = r.current;
    const duration = Math.floor(activeMs() / 1000);
    const body = {
      type, startedAt: s.startedAt, duration, distance: Math.round(s.distance), steps: shownSteps, stepsEstimated: estimated,
      route: simplify(s.route, 800).map((p) => [p[0], p[1]]),
    };
    setPhase('saving'); setError('');
    try {
      const d = await api.saveActivity(body);
      notify('Activité enregistrée');
      nav(`/activity/${d.activity.id}`, { replace: true });
    } catch (e) { setError(e.message); setPhase('failed'); }
  };

  const stop = () => {
    const s = r.current;
    if (phase === 'running') { s.accMs = activeMs(); s.resumeAt = 0; }
    stopSensors();
    if (Math.floor(s.accMs / 1000) < 10) { notify('Trop court pour être enregistré'); nav('/activity', { replace: true }); return; }
    save();
  };

  const leave = () => {
    if ((phase === 'running' || phase === 'paused' || phase === 'failed') && secs >= 5 && !window.confirm('Quitter cette activité sans l\'enregistrer ?')) return;
    stopSensors(); nav('/activity', { replace: true });
  };

  if (!info) return <Navigate to="/activity" replace />;
  const gpsBad = gps === 'denied' || gps === 'unavailable';
  const live = phase === 'running' || phase === 'paused' || phase === 'saving' || phase === 'failed';

  return (
    <section className="live">
      <div className="live-top">
        <button className="icon-btn glass" onClick={leave} aria-label="Retour"><Icon n="back" /></button>
        <b>{info.label}</b>
        <span className={'gps ' + gps} role="status">{GPS_TEXT[gps]}</span>
      </div>

      {!live ? (
        <div className="live-ready">
          <div className="trophy"><Icon n="pin" /></div>
          <h1 className="h1">Prêt à partir ?</h1>
          <p className="sub">Autorise la localisation quand ton téléphone te le demande et garde l'écran allumé. La distance et le parcours viennent du GPS, les pas du capteur de mouvement.</p>
          <button className="btn" onClick={start}>Démarrer : {info.label.toLowerCase()}</button>
        </div>
      ) : (
        <>
          <div className="live-timer" role="timer" aria-label="Temps écoulé">{fmtDuration(secs)}</div>
          <div className="live-dist"><b>{fmtKm(distance)}</b><span>km</span></div>
          <div className="live-stats">
            <div><b>{fmtPace(distance, secs)}</b><small>Allure /km</small></div>
            <div><b>{fmtSpeed(distance, secs)}</b><small>Vitesse km/h</small></div>
            <div><b>{estimated && shownSteps > 0 ? '≈' : ''}{shownSteps}</b><small>Pas</small></div>
          </div>
          {gpsBad && <div className="form-err" role="alert">{gps === 'denied' ? 'La localisation est bloquée pour ce site. Autorise-la dans les réglages du navigateur pour mesurer la distance.' : 'Cet appareil ou cette connexion ne peut pas fournir la localisation. Le GPS exige HTTPS (ou localhost).'}</div>}
          {phase === 'failed' && <div className="form-err" role="alert">{error} Ton activité est toujours là : réessaie de l'enregistrer.</div>}
          <RouteMap points={route} live />
          <div className="live-ctrl">
            {phase === 'running' && <button className="btn ghost" onClick={pause}><Icon n="pause" /> Pause</button>}
            {phase === 'paused' && <button className="btn ghost" onClick={resume}><Icon n="play" /> Reprendre</button>}
            {phase === 'failed' ? <button className="btn" onClick={save}>Réessayer d'enregistrer</button>
              : <button className="btn" onClick={stop} disabled={phase === 'saving'}>{phase === 'saving' ? 'Enregistrement…' : 'Terminer'}</button>}
          </div>
        </>
      )}
    </section>
  );
}

/* ---------------- Détail d'une activité : stats et tracé ---------------- */
export function ActivityDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { notify } = useStore();
  const [a, setA] = useState(null);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  const [caption, setCaption] = useState('');
  const [showRoute, setShowRoute] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    setError('');
    api.activity(id).then((d) => setA(d.activity)).catch((e) => (e.status === 404 ? setMissing(true) : setError(e.message)));
  }, [id]);
  useEffect(() => { setA(null); load(); }, [load]);

  if (missing) return <Navigate to="/activity" replace />;
  const publish = async () => {
    setBusy(true);
    try { const r = await api.publish(id, caption.trim(), showRoute); setA((x) => ({ ...x, post: { id: r.post.id } })); notify('Publié dans la communauté'); } catch (e) { notify(e.message); }
    setBusy(false);
  };
  const unpublish = async () => {
    setBusy(true);
    try { await api.deletePost(a.post.id); setA((x) => ({ ...x, post: null })); notify('Retiré de la communauté'); } catch (e) { notify(e.message); }
    setBusy(false);
  };
  const share = async () => {
    const t = typeOf(a.type)?.label.toLowerCase();
    const text = `Je viens de faire une activité (${t}) : ${fmtDistance(a.distance)} en ${fmtDuration(a.duration)} (${fmtPace(a.distance, a.duration)}/km) sur FitLife !`;
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); notify('Copié dans le presse-papiers'); }
    } catch { /* partage annulé */ }
  };
  const remove = async () => {
    if (!window.confirm('Supprimer cette activité et son parcours ?')) return;
    try { await api.deleteActivity(id); notify('Activité supprimée'); nav('/activity', { replace: true }); } catch (e) { notify(e.message); }
  };

  return (
    <section className="page narrow">
      <div className="topbar"><BackBtn to="/activity" /><h2>{a ? typeOf(a.type)?.label : 'Activité'}</h2><span className="sp" /></div>
      {error ? <ErrorBox title="Impossible de charger cette activité" message={error} onRetry={load} /> : !a ? (
        <div className="px" aria-busy="true" aria-label="Chargement"><div className="skeleton" style={{ height: 220, borderRadius: 24 }} /></div>
      ) : (
        <div className="px">
          <p className="sub adate">{dateLabel(a.startedAt)} · {timeLabel(a.startedAt)}</p>
          <div className="card routecard"><RouteMap points={a.route} /></div>
          <div className="stats">
            <div><b>{fmtKm(a.distance)}</b><small>Kilomètres</small></div>
            <div><b>{fmtDuration(a.duration)}</b><small>Durée</small></div>
            <div><b>{fmtPace(a.distance, a.duration)}</b><small>Allure /km</small></div>
            <div><b>{fmtSpeed(a.distance, a.duration)}</b><small>Vitesse km/h</small></div>
            <div><b>{a.stepsEstimated && a.steps > 0 ? '≈' : ''}{a.steps}</b><small>Pas</small></div>
          </div>
          {a.stepsEstimated && a.steps > 0 && <p className="muted">Les pas sont estimés à partir de la distance, car aucun capteur de mouvement n'était disponible.</p>}
          <div className="card publish">
            <div className="card-h"><b>{a.post ? 'Publié dans la communauté' : 'Publie ton résultat'}</b></div>
            {a.post ? (
              <>
                <p className="muted">Tous les utilisateurs de FitLife peuvent voir ce résultat.</p>
                <button className="btn ghost" onClick={unpublish} disabled={busy}>Retirer de la communauté</button>
              </>
            ) : (
              <>
                <div className="fld"><label htmlFor="pc">Légende (facultatif)</label><textarea id="pc" value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={280} rows={2} placeholder="Comment ça s'est passé ?" /></div>
                <label className="check"><input type="checkbox" checked={showRoute} onChange={(e) => setShowRoute(e.target.checked)} disabled={!a.route?.length} /> Afficher mon parcours (les 200 premiers et derniers mètres restent masqués)</label>
                <p className="muted">Ton nom, ta distance, ton temps et ton allure seront visibles par tous. Ton parcours reste privé, sauf si tu coches la case.</p>
                <button className="btn" onClick={publish} disabled={busy}>{busy ? 'Publication…' : 'Publier'}</button>
              </>
            )}
            <button className="btn ghost" onClick={share}>Partager…</button>
          </div>
          <button className="btn ghost danger" onClick={remove}>Supprimer cette activité</button>
        </div>
      )}
    </section>
  );
}
