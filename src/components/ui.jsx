import { Link, useNavigate } from 'react-router-dom';
import Icon from './Icon';
import { Img } from './Media';
import { useStore } from '../store';
import { api } from '../api';
import { levelFr } from '../lib/labels';

export function BackBtn({ to, glass, label = 'Retour' }) {
  const nav = useNavigate();
  return (
    <button className={'icon-btn' + (glass ? ' glass' : '')} aria-label={label} onClick={() => (to ? nav(to) : nav(-1))}>
      <Icon n="back" />
    </button>
  );
}

export function Fav({ id, className = '' }) {
  const { state, dispatch, notify } = useStore();
  const on = state.favs.includes(id);
  return (
    <button
      className={`fav ${on ? 'on' : ''} ${className}`}
      aria-pressed={on}
      aria-label={on ? 'Retirer des favoris' : 'Ajouter aux favoris'}
      onClick={(e) => {
        e.preventDefault(); e.stopPropagation();
        dispatch({ type: 'toggleFav', id });                 // mise à jour immédiate…
        notify(on ? 'Retiré des favoris' : 'Ajouté aux favoris');
        api.setFav(id, !on).catch((err) => {                 // …annulée si le serveur refuse
          dispatch({ type: 'toggleFav', id });
          notify(err.message);
        });
      }}
    >
      <Icon n="heart" />
    </button>
  );
}

const FACES = [['#ffb36b', '#e0663b'], ['#7bd0ff', '#3b79e0'], ['#ffd36b', '#d99a1e'], ['#c58bff', '#7a3bd9'], ['#8ef0b0', '#2fb56a']];
export const Faces = () => (
  <div className="faces">{FACES.map((c, i) => <i key={i} style={{ background: `linear-gradient(135deg,${c[0]},${c[1]})` }} />)}</div>
);

export function WorkoutCard({ w }) {
  return (
    <Link to={`/workout/${w.id}`} className="feat">
      <Img src={w.photo} pos="center 25%" />
      <div className="shade" />
      <h3>{w.title}</h3>
      <div className="kcal"><span>{w.kcal}<small>Kcal</small></span></div>
      <Faces />
      <Fav id={w.id} className="on-art" />
    </Link>
  );
}

export function WorkoutRow({ w }) {
  return (
    <Link to={`/workout/${w.id}`} className="row">
      <div className="thumb"><Img src={w.photo} pos="center 25%" /></div>
      <div className="t"><b>{w.title}</b><small>{w.min} min · {w.kcal} kcal · {levelFr(w.level)}</small></div>
      <Fav id={w.id} />
    </Link>
  );
}

export function CourseRow({ c }) {
  const n = c.count ?? 0;
  return (
    <Link to={`/courses/${c.id}`} className="row">
      <div className="thumb"><Img src={c.photo} pos="center 25%" /></div>
      <div className="t"><b>{c.name}</b><small>{n} {n === 1 ? 'programme' : 'programmes'} d'entraînement</small></div>
    </Link>
  );
}

export function CourseTile({ c }) {
  const n = c.count ?? 0;
  return (
    <Link to={`/courses/${c.id}`} className="xtile">
      <Img src={c.photo} pos="center 25%" />
      <div className="shade" />
      <b>{c.name}</b>
      <small>{n} {n === 1 ? 'séance' : 'séances'}</small>
    </Link>
  );
}

export function SearchBox({ value, onChange, placeholder }) {
  return (
    <label className="search">
      <Icon n="search" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      {value && <button type="button" aria-label="Effacer" onClick={() => onChange('')}><Icon n="close" /></button>}
    </label>
  );
}

export function Empty({ children }) { return <div className="empty">{children}</div>; }

export function Ring({ value, max, size = 92, children }) {
  const r = 40, c = 2 * Math.PI * r, p = Math.min(1, value / max);
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={r} className="trk" />
        <circle cx="50" cy="50" r={r} className="val" strokeDasharray={`${c * p} ${c}`} transform="rotate(-90 50 50)" />
      </svg>
      <div className="in">{children}</div>
    </div>
  );
}
