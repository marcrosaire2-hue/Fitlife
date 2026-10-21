import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useStore } from '../store';
import { Img } from '../components/Media';
import Icon from '../components/Icon';
import { assetUrl } from '../lib/media';
import { BackBtn, Empty, SearchBox } from '../components/ui';

const BASE = import.meta.env.BASE_URL;
const withBase = (o) => ({ ...o, photo: assetUrl(o.photo) });

function ErrorBox({ title, message, onRetry }) {
  return <div className="state-box center" role="alert"><b>{title}</b><p>{message}</p><button className="btn" onClick={onRetry}>Réessayer</button></div>;
}

export function Trainers() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('All');

  const load = useCallback(() => {
    setError('');
    api.trainers().then((d) => setData({ ...d, trainers: d.trainers.map(withBase) })).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const list = useMemo(() => (data?.trainers ?? []).filter((t) =>
    (tag === 'All' || t.tags.includes(tag)) && t.name.toLowerCase().includes(q.trim().toLowerCase())), [data, q, tag]);

  return (
    <section className="page">
      <div className="topbar"><BackBtn /><h2>Coachs</h2><span className="sp" /></div>
      <div className="px"><SearchBox value={q} onChange={setQ} placeholder="Rechercher un coach" /></div>
      {error ? <ErrorBox title="Impossible de charger les coachs" message={error} onRetry={load} /> : !data ? (
        <div className="lst grid px" aria-busy="true" aria-label="Chargement" style={{ marginTop: 14 }}>{[0, 1, 2].map((i) => <div key={i} className="row skeleton" />)}</div>
      ) : (
        <>
          <div className="chips px">{['All', ...data.tags].map((t) => <button key={t} className={'chip' + (tag === t ? ' on' : '')} onClick={() => setTag(t)}>{t === 'All' ? 'Tous' : t}</button>)}</div>
          <div className="lst grid px">
            {list.length ? list.map((t) => (
              <Link to={`/trainers/${t.id}`} key={t.id} className="trow">
                <Img src={t.photo} className="av" pos="center 25%" />
                <div className="t">
                  <b>{t.name}{t.best && <span className="best">Recommandé</span>}</b>
                  <div className="m"><em>★ {t.rate.toFixed(1)}</em><span>Expérience : {t.yrs} ans</span></div>
                  <div className="tags">{t.tags.map((g) => <i key={g}>{g.toUpperCase()}</i>)}</div>
                </div>
                <span className={'book' + (t.booking ? ' on' : '')}>{t.booking ? t.booking.slot : 'Réserver'}</span>
              </Link>
            )) : <Empty>{data.trainers.length ? 'Aucun coach ne correspond à ta recherche.' : 'Aucun coach disponible pour le moment.'}</Empty>}
          </div>
        </>
      )}
    </section>
  );
}

// jours en date locale du client (et non en UTC), pour que « Today » soit bien aujourd'hui
const dateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const days = () => [...Array(6)].map((_, i) => {
  const d = new Date(); d.setDate(d.getDate() + i);
  return { key: dateKey(d), dow: i === 0 ? "Aujourd'hui" : d.toLocaleDateString('fr', { weekday: 'short' }), num: d.getDate() };
});

export function TrainerProfile() {
  const { id } = useParams();
  const { notify } = useStore();
  const [data, setData] = useState(null);       // { trainer, slots }
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  const [day, setDay] = useState(days()[0].key);
  const [slot, setSlot] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError('');
    api.trainer(id)
      .then((d) => {
        setData({ trainer: withBase(d.trainer), slots: d.slots });
        if (d.trainer.booking) { setDay(d.trainer.booking.day); setSlot(d.trainer.booking.slot); }
      })
      .catch((e) => (e.status === 404 ? setMissing(true) : setError(e.message)));
  }, [id]);
  useEffect(() => { setData(null); load(); }, [load]);

  if (missing) return <Navigate to="/trainers" replace />;
  if (error) return <section className="page narrow"><div className="topbar"><BackBtn /><h2>Coachs</h2><span className="sp" /></div><ErrorBox title="Impossible de charger ce coach" message={error} onRetry={load} /></section>;
  if (!data) return <section className="page narrow" aria-busy="true" aria-label="Chargement"><div className="topbar"><BackBtn /><h2>Coachs</h2><span className="sp" /></div><div className="lst px"><div className="row skeleton" /></div></section>;

  const { trainer: t, slots } = data;
  const existing = t.booking;
  const D = days();
  // les créneaux passés d'aujourd'hui sont désactivés
  const now = new Date(); const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const past = (s) => day === D[0].key && s <= hhmm;

  const book = async () => {
    if (!slot) return notify('Choisis un créneau');
    if (busy) return;
    setBusy(true);
    try {
      const r = await api.book(id, day, slot);
      setData((x) => ({ ...x, trainer: { ...x.trainer, booking: r.booking } }));
      notify(`Réservé avec ${t.name.split(' ')[0]} · ${slot}`);
    } catch (e) { notify(e.message); }
    setBusy(false);
  };
  const cancel = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.unbook(id);
      setData((x) => ({ ...x, trainer: { ...x.trainer, booking: null } }));
      setSlot(''); notify('Réservation annulée');
    } catch (e) { notify(e.message); }
    setBusy(false);
  };

  return (
    <section className="page narrow">
      <div className="topbar"><BackBtn /><h2>Coachs</h2><span className="sp" /></div>
      <div className="tp">
        <Img src={t.photo} className="big-av" pos="center 25%" />
        <h1 className="h1">{t.name}</h1>
        <div className="m"><em><Icon n="star" /> {t.rate.toFixed(1)}</em><span>{t.yrs} ans d'expérience</span></div>
        <div className="tags center">{t.tags.map((g) => <i key={g}>{g.toUpperCase()}</i>)}</div>
        <p className="bio">{t.bio}</p>
      </div>
      <h3 className="h3 px">Choisis un jour</h3>
      <div className="chips px days">{D.map((d) => (
        <button key={d.key} className={'day' + (day === d.key ? ' on' : '')} onClick={() => { setDay(d.key); setSlot(''); }}><small>{d.dow}</small><b>{d.num}</b></button>
      ))}</div>
      <h3 className="h3 px">Heure</h3>
      <div className="slots px">{slots.map((s) => (
        <button key={s} disabled={past(s)} className={'chip' + (slot === s ? ' on' : '')} onClick={() => setSlot(s)}>{s}</button>
      ))}</div>
      <div className="px" style={{ marginTop: 22, display: 'grid', gap: 10 }}>
        <button className="btn" onClick={book} disabled={busy}>{existing ? 'Modifier la réservation' : 'Réserver la séance'}</button>
        {existing && <button className="btn ghost" onClick={cancel} disabled={busy}>Annuler la réservation</button>}
      </div>
    </section>
  );
}
