import { useRef, useState } from 'react';
import { api } from '../api';
import { prepareImage } from '../lib/image';
import { Img } from './Media';
import { assetUrl } from '../lib/media';

/* Champ « image » de l'espace admin : le fichier est envoyé puis stocké dans Supabase ; la valeur est son adresse publique. */
export default function ImageField({ label, value, onChange, hint, uploader }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true); setError('');
    try { const blob = await prepareImage(file, { size: 1600 }); const d = await (uploader || api.uploadImage)(blob); onChange(d.url); } catch (err) { setError(err.message); }
    setBusy(false);
  };
  return (
    <div className="fld imgfield">
      <label>{label}</label>
      <div className="imgfield-row">
        <div className="imgfield-prev">{value ? <Img src={assetUrl(value)} /> : <span>Aucune image</span>}</div>
        <div className="imgfield-btns">
          <input ref={ref} type="file" accept="image/*" hidden onChange={onFile} />
          <button type="button" className="btn ghost small" onClick={() => ref.current?.click()} disabled={busy}>{busy ? 'Envoi…' : value ? "Changer l'image" : 'Choisir une image'}</button>
          {value && !busy && <button type="button" className="mini-btn danger-t" onClick={() => onChange('')}>Retirer</button>}
        </div>
      </div>
      {hint && <small className="hint">{hint}</small>}
      {error && <small className="hint" style={{ color: 'var(--danger)' }} role="alert">{error}</small>}
    </div>
  );
}
