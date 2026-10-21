import { NavLink } from 'react-router-dom';

/* Onglets de la section Social */
export function SocialTabs() {
  const cls = ({ isActive }) => 'atab' + (isActive ? ' on' : '');
  return (
    <nav className="atabs social-tabs" aria-label="Sections Social">
      <NavLink to="/social" end className={cls}>Messages</NavLink>
      <NavLink to="/social/people" className={cls}>Personnes</NavLink>
      <NavLink to="/social/communities" className={cls}>Communautés</NavLink>
    </nav>
  );
}

export const shortTime = (t) => {
  const d = new Date(t), n = new Date();
  if (d.toDateString() === n.toDateString()) return d.toLocaleTimeString('fr', { hour: '2-digit', minute: '2-digit' });
  if (n - d < 6 * 86400000) return d.toLocaleDateString('fr', { weekday: 'short' });
  return d.toLocaleDateString('fr', { day: 'numeric', month: 'short' });
};
