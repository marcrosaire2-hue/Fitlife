import { initials } from './ActivityBits';

/* Photo de profil (Supabase) ou, à défaut, les initiales */
export default function Avatar({ name, src, size = '', className = '' }) {
  return (
    <span className={`avatar ${size} ${className}`.trim()}>
      {src ? <img src={src} alt="" draggable="false" referrerPolicy="no-referrer" /> : initials(name)}
    </span>
  );
}
