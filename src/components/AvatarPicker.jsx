import { useRef, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { useStore } from '../store';
import { prepareImage } from '../lib/image';
import Avatar from './Avatar';

/* Choix / prise / suppression de la photo de profil (envoyée puis stockée dans Supabase par le serveur) */
export default function AvatarPicker({ onDone }) {
  const { user, setUser } = useAuth();
  const { notify } = useStore();
  const pick = useRef(null), snap = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true); setError('');
    try {
      const blob = await prepareImage(file, { size: 512, square: true });
      const d = await api.uploadAvatar(blob);
      setUser((u) => ({ ...u, avatar: d.user.avatar }));
      notify('Photo enregistrée');
      onDone?.(d.user);
    } catch (err) { setError(err.message); }
    setBusy(false);
  };
  const remove = async () => {
    setBusy(true); setError('');
    try { await api.deleteAvatar(); setUser((u) => ({ ...u, avatar: null })); notify('Photo supprimée'); } catch (err) { setError(err.message); }
    setBusy(false);
  };

  return (
    <div className="avpick">
      <Avatar name={user?.name} src={user?.avatar} size="xl" />
      <input ref={pick} type="file" accept="image/*" hidden onChange={onFile} />
      <input ref={snap} type="file" accept="image/*" capture="user" hidden onChange={onFile} />
      <div className="avpick-btns">
        <button type="button" className="btn" onClick={() => pick.current?.click()} disabled={busy}>{busy ? 'Envoi…' : user?.avatar ? 'Changer la photo' : 'Choisir une photo'}</button>
        <button type="button" className="btn ghost" onClick={() => snap.current?.click()} disabled={busy}>Prendre une photo</button>
        {user?.avatar && <button type="button" className="link-btn" onClick={remove} disabled={busy}>Supprimer ma photo</button>}
      </div>
      {error && <div className="form-err" role="alert">{error}</div>}
    </div>
  );
}
