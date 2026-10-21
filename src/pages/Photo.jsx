import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import AvatarPicker from '../components/AvatarPicker';

export const PHOTO_SKIP_KEY = 'fitlife.photo.skip';

/* Étape proposée après l'inscription : ajouter sa photo de profil (facultatif) */
export default function Photo() {
  const nav = useNavigate();
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/welcome" replace />;
  const skip = () => { try { localStorage.setItem(PHOTO_SKIP_KEY, '1'); } catch { /* ignoré */ } nav('/home', { replace: true }); };
  return (
    <section className="page narrow photo-step">
      <h1 className="h1" style={{ textAlign: 'center' }}>Ajoute ta photo de profil</h1>
      <p className="sub" style={{ textAlign: 'center', padding: '4px 24px 18px' }}>Elle sera visible par les autres utilisateurs dans la communauté et les classements. Tu pourras la changer à tout moment.</p>
      <AvatarPicker />
      <div className="px" style={{ marginTop: 18 }}>
        {user.avatar ? <button className="btn" onClick={() => nav('/home', { replace: true })}>Continuer</button>
          : <button className="link-btn" onClick={skip}>Plus tard</button>}
      </div>
    </section>
  );
}
