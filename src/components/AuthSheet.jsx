import { useEffect, useId, useRef, useState } from 'react';
import { useAuth } from '../auth';
import Icon from './Icon';

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

function validate(mode, v) {
  const f = {};
  if (mode === 'register' && (!v.name.trim() || v.name.trim().length > 40)) f.name = 'Entre ton nom (40 caractères maximum).';
  if (!EMAIL.test(v.email.trim())) f.email = 'Entre une adresse e-mail valide.';
  if (mode === 'register' ? v.password.length < 8 : !v.password) f.password = mode === 'register' ? 'Utilise au moins 8 caractères.' : 'Entre ton mot de passe.';
  return f;
}

function Field({ id, label, error, children }) {
  return (
    <div className={'fld' + (error ? ' bad' : '')}>
      <label htmlFor={id}>{label}</label>
      {children}
      {error && <small id={id + '-e'} role="alert">{error}</small>}
    </div>
  );
}

export default function AuthSheet({ initialMode, onClose, onDone }) {
  const { register, login } = useAuth();
  const uid = useId();
  const [mode, setMode] = useState(initialMode);
  const [v, setV] = useState({ name: '', email: '', password: '' });
  const [errs, setErrs] = useState({});
  const [formErr, setFormErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const box = useRef(null);
  const set = (k) => (e) => { setV({ ...v, [k]: e.target.value }); if (errs[k]) setErrs({ ...errs, [k]: undefined }); };

  // focus, Échap, verrouillage du défilement, piège à focus
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onClose();
      if (e.key === 'Tab' && box.current) {
        const els = [...box.current.querySelectorAll('button,input,[href]')].filter((x) => !x.disabled);
        if (!els.length) return;
        const a = els[0], z = els[els.length - 1];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
        else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; document.removeEventListener('keydown', onKey); };
  }, [busy, onClose]);
  useEffect(() => { box.current?.querySelector('input')?.focus(); }, [mode]);

  const switchMode = (m) => { setMode(m); setErrs({}); setFormErr(''); };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const f = validate(mode, v);
    setErrs(f); setFormErr('');
    if (Object.keys(f).length) { box.current?.querySelector('.bad input')?.focus(); return; }
    setBusy(true);
    try {
      const u = mode === 'register'
        ? await register({ name: v.name.trim(), email: v.email.trim(), password: v.password })
        : await login({ email: v.email.trim(), password: v.password });
      onDone(u);
    } catch (err) {
      setErrs(err.fields || {});
      setFormErr(err.fields && Object.keys(err.fields).length ? '' : err.message);
      setBusy(false);
      requestAnimationFrame(() => box.current?.querySelector('.bad input')?.focus());
    }
  };

  const reg = mode === 'register';
  return (
    <div className="sheet-wrap" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={uid + 't'} ref={box}>
        <div className="grab" aria-hidden="true" />
        <button className="x" aria-label="Fermer" onClick={onClose} disabled={busy}><Icon n="close" /></button>
        <h2 id={uid + 't'}>{reg ? 'Crée ton compte' : 'Content de te revoir'}</h2>
        <p className="s-sub">{reg ? 'Commence ton parcours forme en moins d\'une minute.' : 'Connecte-toi pour reprendre là où tu t\'es arrêté.'}</p>

        <div className="seg" role="tablist">
          <button role="tab" aria-selected={reg} className={reg ? 'on' : ''} onClick={() => switchMode('register')} type="button">Inscription</button>
          <button role="tab" aria-selected={!reg} className={!reg ? 'on' : ''} onClick={() => switchMode('login')} type="button">Connexion</button>
        </div>

        <form onSubmit={submit} noValidate>
          {reg && (
            <Field id={uid + 'n'} label="Nom" error={errs.name}>
              <input id={uid + 'n'} value={v.name} onChange={set('name')} autoComplete="name" maxLength={40} aria-invalid={!!errs.name} aria-describedby={errs.name ? uid + 'n-e' : undefined} placeholder="Ton nom" />
            </Field>
          )}
          <Field id={uid + 'm'} label="E-mail" error={errs.email}>
            <input id={uid + 'm'} type="email" value={v.email} onChange={set('email')} autoComplete="email" inputMode="email" aria-invalid={!!errs.email} aria-describedby={errs.email ? uid + 'm-e' : undefined} placeholder="toi@exemple.com" />
          </Field>
          <Field id={uid + 'p'} label="Mot de passe" error={errs.password}>
            <div className="pw">
              <input id={uid + 'p'} type={show ? 'text' : 'password'} value={v.password} onChange={set('password')} autoComplete={reg ? 'new-password' : 'current-password'} aria-invalid={!!errs.password} aria-describedby={errs.password ? uid + 'p-e' : undefined} placeholder={reg ? 'Au moins 8 caractères' : 'Ton mot de passe'} />
              <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'} aria-pressed={show}>{show ? 'Masquer' : 'Afficher'}</button>
            </div>
          </Field>
          {formErr && <div className="form-err" role="alert">{formErr}</div>}
          <button className="btn" type="submit" disabled={busy}>{busy ? 'Patiente…' : reg ? 'Créer mon compte' : 'Me connecter'}</button>
        </form>
      </div>
    </div>
  );
}
