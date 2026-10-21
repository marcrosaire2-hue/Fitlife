import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useStore } from '../store';
import { Img } from '../components/Media';
import Icon from '../components/Icon';
import { assetUrl } from '../lib/media';
import { BackBtn, Empty } from '../components/ui';

const BASE = import.meta.env.BASE_URL;

export function Goals() {
  const nav = useNavigate();
  const { user, loading: authLoading, setUser } = useAuth();
  const { dispatch, notify } = useStore();
  const [goals, setGoals] = useState(null);      // options venues du serveur
  const [selected, setSelected] = useState([]);
  const [wasOnboarded, setWasOnboarded] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setError('');
    api.goals()
      .then((d) => { setGoals(d.goals); setSelected(d.selected); setWasOnboarded(d.onboarded); })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => { if (user) load(); }, [user, load]);

  if (authLoading) return <section className="goals page narrow"><div className="goal-grid">{[...Array(9)].map((_, i) => <div key={i} className="goal"><span className="c skeleton" /></div>)}</div></section>;
  if (!user) return <Navigate to="/welcome" replace />;

  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const next = async () => {
    if (goals?.length && !selected.length) return notify('Choisis au moins un objectif');
    if (saving) return;
    setSaving(true);
    try {
      const d = await api.saveGoals(selected);
      setUser(d.user);
      dispatch({ type: 'setGoals', goals: d.selected });
      if (wasOnboarded) { notify('Objectifs mis à jour'); nav(-1); } else nav(user?.avatar ? '/home' : '/photo', { replace: true });
    } catch (e) {
      if (e.status === 401) { setUser(null); nav('/welcome', { replace: true }); return; }
      notify(e.message);
      setSaving(false);
    }
  };

  return (
    <section className="goals page narrow">
      <div className="topbar"><BackBtn /><span /><span className="sp" /></div>
      <h1 className="h1">Quel est ton objectif ?</h1>
      <p className="sub">{goals && !goals.length ? 'Aucun objectif disponible pour le moment' : selected.length ? `${selected.length} sélectionné${selected.length > 1 ? 's' : ''}` : 'Choisis un ou plusieurs objectifs'}</p>

      {error ? (
        <div className="state-box center" role="alert">
          <b>Impossible de charger tes objectifs</b>
          <p>{error}</p>
          <button className="btn" onClick={load}>Réessayer</button>
        </div>
      ) : !goals ? (
        <div className="goal-grid" aria-busy="true" aria-label="Chargement des objectifs">
          {[...Array(9)].map((_, i) => <div key={i} className="goal"><span className="c skeleton" /><i className="sk-t" /></div>)}
        </div>
      ) : !goals.length ? (
        <Empty>Aucun objectif n'a encore été ajouté.</Empty>
      ) : (
        <div className="goal-grid" role="group" aria-label="Objectifs">
          {goals.map((g) => {
            const on = selected.includes(g.id);
            return (
              <button key={g.id} className={'goal' + (on ? ' sel' : '')} aria-pressed={on} onClick={() => toggle(g.id)}>
                <span className="c">
                  <Img src={assetUrl(g.photo)} pos="center 25%" />
                  <span className="chk"><Icon n="check" /></span>
                </span>
                {g.label}
              </button>
            );
          })}
        </div>
      )}
      <div className="dock"><button className="btn" onClick={next} disabled={saving || !goals}>{saving ? 'Enregistrement…' : wasOnboarded ? 'Enregistrer' : 'Suivant'}</button></div>
    </section>
  );
}
