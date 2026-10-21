import { useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { SLOTS, TAG_FILTERS, TRAINERS, byId } from '../data';
import { useStore } from '../store';
import { Img } from '../components/Media';
import Icon from '../components/Icon';
import { BackBtn, Empty, SearchBox } from '../components/ui';

export function Trainers() {
  const { state } = useStore();
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('All');
  const list = useMemo(() => TRAINERS.filter((t) =>
    (tag === 'All' || t.tags.includes(tag)) && t.name.toLowerCase().includes(q.trim().toLowerCase())), [q, tag]);
  return (
    <section className="page">
      <div className="topbar"><BackBtn /><h2>Trainer</h2><span className="sp" /></div>
      <div className="px"><SearchBox value={q} onChange={setQ} placeholder="Search a trainer" /></div>
      <div className="chips px">{TAG_FILTERS.map((t) => <button key={t} className={'chip' + (tag === t ? ' on' : '')} onClick={() => setTag(t)}>{t}</button>)}</div>
      <div className="lst grid px">
        {list.length ? list.map((t) => {
          const b = state.bookings.find((x) => x.trainer === t.id);
          return (
            <Link to={`/trainers/${t.id}`} key={t.id} className="trow">
              <Img src={t.photo} className="av" pos="center 25%" />
              <div className="t">
                <b>{t.name}{t.best && <span className="best">Best Match</span>}</b>
                <div className="m"><em>★ {t.rate.toFixed(1)}</em><span>Exp: {t.yrs} years</span></div>
                <div className="tags">{t.tags.map((g) => <i key={g}>{g.toUpperCase()}</i>)}</div>
              </div>
              <span className={'book' + (b ? ' on' : '')}>{b ? b.slot : 'Book'}</span>
            </Link>
          );
        }) : <Empty>No trainer matches your search.</Empty>}
      </div>
    </section>
  );
}

const days = () => [...Array(6)].map((_, i) => {
  const d = new Date(); d.setDate(d.getDate() + i);
  return { key: d.toISOString().slice(0, 10), dow: i === 0 ? 'Today' : d.toLocaleDateString('en', { weekday: 'short' }), num: d.getDate() };
});

export function TrainerProfile() {
  const { id } = useParams();
  const t = byId(TRAINERS, id);
  const { state, dispatch, notify } = useStore();
  const existing = state.bookings.find((b) => b.trainer === id);
  const [day, setDay] = useState(existing ? existing.day : days()[0].key);
  const [slot, setSlot] = useState(existing ? existing.slot : '');
  if (!t) return <Navigate to="/trainers" replace />;
  const D = days();
  // les créneaux passés d'aujourd'hui sont désactivés
  const now = new Date(); const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const past = (s) => day === D[0].key && s <= hhmm;
  const book = () => {
    if (!slot) return notify('Pick a time slot');
    dispatch({ type: 'book', booking: { trainer: id, day, slot } });
    notify(`Booked with ${t.name.split(' ')[0]} · ${slot}`);
  };
  return (
    <section className="page narrow">
      <div className="topbar"><BackBtn /><h2>Trainer</h2><span className="sp" /></div>
      <div className="tp">
        <Img src={t.photo} className="big-av" pos="center 25%" />
        <h1 className="h1">{t.name}</h1>
        <div className="m"><em><Icon n="star" /> {t.rate.toFixed(1)}</em><span>{t.yrs} years experience</span></div>
        <div className="tags center">{t.tags.map((g) => <i key={g}>{g.toUpperCase()}</i>)}</div>
        <p className="bio">{t.bio}</p>
      </div>
      <h3 className="h3 px">Pick a day</h3>
      <div className="chips px days">{D.map((d) => (
        <button key={d.key} className={'day' + (day === d.key ? ' on' : '')} onClick={() => { setDay(d.key); setSlot(''); }}><small>{d.dow}</small><b>{d.num}</b></button>
      ))}</div>
      <h3 className="h3 px">Time</h3>
      <div className="slots px">{SLOTS.map((s) => (
        <button key={s} disabled={past(s)} className={'chip' + (slot === s ? ' on' : '')} onClick={() => setSlot(s)}>{s}</button>
      ))}</div>
      <div className="px" style={{ marginTop: 22, display: 'grid', gap: 10 }}>
        <button className="btn" onClick={book}>{existing ? 'Update booking' : 'Book session'}</button>
        {existing && <button className="btn ghost" onClick={() => { dispatch({ type: 'unbook', trainer: id }); setSlot(''); notify('Booking cancelled'); }}>Cancel booking</button>}
      </div>
    </section>
  );
}
