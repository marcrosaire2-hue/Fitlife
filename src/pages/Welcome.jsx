import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useStore } from '../store';
import { Vid } from '../components/Media';
import AuthSheet from '../components/AuthSheet';
import { assetUrl } from '../lib/media';

const BASE = import.meta.env.BASE_URL;
const asset = (p) => assetUrl(p) || undefined;

export default function Welcome() {
  const nav = useNavigate();
  const { user, loading: authLoading, logout } = useAuth();
  const { dispatch, notify } = useStore();
  const [content, setContent] = useState(null);
  const [error, setError] = useState('');
  const [sheet, setSheet] = useState(null); // null | 'register' | 'login'
  const opener = useRef(null);

  const load = useCallback(() => {
    setError('');
    api.welcome().then(setContent).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const proceed = useCallback((u) => {
    if (u?.name) dispatch({ type: 'name', name: u.name });
    nav(u?.onboarded ? '/home' : '/goals', { replace: true });
  }, [dispatch, nav]);

  const openSheet = (mode) => (e) => { opener.current = e.currentTarget; setSheet(mode); };
  const closeSheet = () => { setSheet(null); setTimeout(() => opener.current?.focus(), 0); };

  const first = user?.name?.split(' ')[0];

  return (
    <section className="onb">
      <div className="onb-art">
        {content ? <Vid src={asset(content.video)} poster={asset(content.poster)} pos="center 20%" /> : <div className="art skeleton" />}
      </div>
      <div className="txt">
        <div className="brand">{content ? <>{content.brand.slice(0, 3)}<span>{content.brand.slice(3)}</span></> : <>Fit<span>Life</span></>}</div>

        {error ? (
          <div className="state-box" role="alert">
            <b>Impossible de charger la page</b>
            <p>{error}</p>
            <button className="btn" onClick={load}>Réessayer</button>
          </div>
        ) : !content ? (
          <div className="sk-lines" aria-busy="true" aria-label="Chargement"><i /><i /><i /><b /></div>
        ) : (
          <>
            <h1>{content.titleLines.map((l, i) => <span key={i}>{l}{i < content.titleLines.length - 1 && <br />}</span>)}</h1>
            <p>{content.subtitle}</p>
            {authLoading ? (
              <button className="btn" disabled>…</button>
            ) : user ? (
              <>
                <button className="btn" onClick={() => proceed(user)}>Continuer en tant que {first}</button>
                <button className="link-btn" onClick={async () => { await logout(); notify('Déconnecté'); }}>Pas {first} ? Se déconnecter</button>
              </>
            ) : (
              <>
                <button className="btn" onClick={openSheet('register')}>{content.cta}</button>
                <button className="link-btn" onClick={openSheet('login')}>J'ai déjà un compte · <u>Se connecter</u></button>
              </>
            )}
          </>
        )}
      </div>
      {sheet && <AuthSheet initialMode={sheet} onClose={closeSheet} onDone={(u) => { setSheet(null); proceed(u); }} />}
    </section>
  );
}
