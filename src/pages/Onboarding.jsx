import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useStore } from '../store';
import { Img } from '../components/Media';
import Icon from '../components/Icon';
import { BackBtn } from '../components/ui';

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
    if (!selected.length) return notify('Pick at least one goal');
    if (saving) return;
    setSaving(true);
    try {
      const d = await api.saveGoals(selected);
      setUser(d.user);
      dispatch({ type: 'setGoals', goals: d.selected });
      if (wasOnboarded) { notify('Goals updated'); nav(-1); } else nav('/home', { replace: true });
    } catch (e) {
      if (e.status === 401) { setUser(null); nav('/welcome', { replace: true }); return; }
      notify(e.message);
      setSaving(false);
    }
  };

  return (
    <section className="goals page narrow">
      <div className="topbar"><BackBtn /><span /><span className="sp" /></div>
      <h1 className="h1">What's your fitness goal?</h1>
      <p className="sub">{selected.length ? `${selected.length} selected` : 'Choose one or more'}</p>

      {error ? (
        <div className="state-box center" role="alert">
          <b>We couldn't load your goals</b>
          <p>{error}</p>
          <button className="btn" onClick={load}>Try again</button>
        </div>
      ) : !goals ? (
        <div className="goal-grid" aria-busy="true" aria-label="Loading goals">
          {[...Array(9)].map((_, i) => <div key={i} className="goal"><span className="c skeleton" /><i className="sk-t" /></div>)}
        </div>
      ) : (
        <div className="goal-grid" role="group" aria-label="Fitness goals">
          {goals.map((g) => {
            const on = selected.includes(g.id);
            return (
              <button key={g.id} className={'goal' + (on ? ' sel' : '')} aria-pressed={on} onClick={() => toggle(g.id)}>
                <span className="c">
                  <Img src={`${BASE}${g.photo}`} pos="center 25%" />
                  <span className="chk"><Icon n="check" /></span>
                </span>
                {g.label}
              </button>
            );
          })}
        </div>
      )}
      <div className="dock"><button className="btn" onClick={next} disabled={saving || !goals}>{saving ? 'Saving…' : wasOnboarded ? 'Save' : 'Next'}</button></div>
    </section>
  );
}
