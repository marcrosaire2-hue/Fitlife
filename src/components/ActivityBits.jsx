import { NavLink } from 'react-router-dom';
import { Img } from './Media';
import { typeOf } from '../lib/tracker';
import { assetUrl } from '../lib/media';

const BASE = import.meta.env.BASE_URL;

/* Onglets de la section Activity */
export function ActivityTabs() {
  const cls = ({ isActive }) => 'atab' + (isActive ? ' on' : '');
  return (
    <nav className="atabs" aria-label="Sections Activité">
      <NavLink to="/activity" end className={cls}>Enregistrer</NavLink>
      <NavLink to="/activity/challenges" className={cls}>Défis</NavLink>
      <NavLink to="/activity/events" className={cls}>Événements</NavLink>
      <NavLink to="/activity/community" className={cls}>Communauté</NavLink>
    </nav>
  );
}

/* Photo réaliste d'un type d'activité (marche, randonnée, footing, course) */
export function TypePhoto({ type, className = 'art' }) {
  const t = typeOf(type);
  if (!t) return null;
  return <Img src={assetUrl(t.photo)} pos={t.pos} className={className} />;
}

export const initials = (name = '') => name.split(' ').filter(Boolean).map((x) => x[0]).join('').slice(0, 2).toUpperCase() || '?';
export const dateLabel = (t) => new Date(t).toLocaleDateString('fr', { weekday: 'short', month: 'short', day: 'numeric' });
export const timeLabel = (t) => new Date(t).toLocaleTimeString('fr', { hour: '2-digit', minute: '2-digit' });
