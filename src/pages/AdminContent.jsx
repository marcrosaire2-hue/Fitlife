import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { Img } from '../components/Media';
import { Empty } from '../components/ui';
import ImageField from '../components/ImageField';
import { AdminShell } from './Admin';
import { assetUrl, videoKind } from '../lib/media';
import { levelFr } from '../lib/labels';

const KINDS = [['workouts', 'Séances'], ['courses', 'Cours'], ['goals', 'Objectifs'], ['trainers', 'Coachs']];
const LEVELS = ['Beginner', 'Intermediate', 'Advanced'];

function Field({ id, label, hint, children }) {
  return <div className="fld"><label htmlFor={id}>{label}</label>{children}{hint && <small className="hint">{hint}</small>}</div>;
}

/* ---------- formulaires ---------- */
function useForm(init) {
  const [v, setV] = useState(init);
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  return [v, set, setV];
}

function FormShell({ title, onSubmit, onCancel, busy, error, children }) {
  return (
    <form className="card admin-form" onSubmit={onSubmit} noValidate>
      <div className="card-h"><b>{title}</b></div>
      {children}
      {error && <div className="form-err" role="alert">{error}</div>}
      <button className="btn" type="submit" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
      <button className="btn ghost" type="button" onClick={onCancel} disabled={busy}>Annuler</button>
    </form>
  );
}

function SimpleForm({ kind, item, onDone, onCancel }) {
  const nameKey = kind === 'goals' ? 'label' : 'name';
  const [v, set, setV] = useForm({ [nameKey]: item?.[nameKey] ?? '', photo: item?.photo ?? '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await api.admin.save(kind, item?.id, v); onDone(); } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <FormShell title={item ? 'Modifier' : kind === 'goals' ? 'Nouvel objectif' : 'Nouveau cours'} onSubmit={submit} onCancel={onCancel} busy={busy} error={error}>
      <Field id="f-n" label="Nom"><input id="f-n" value={v[nameKey]} onChange={set(nameKey)} maxLength={60} /></Field>
      <ImageField label="Photo" value={v.photo} onChange={(u) => setV((x) => ({ ...x, photo: u }))} hint="Enregistrée dans Supabase" />
    </FormShell>
  );
}

function TrainerForm({ item, onDone, onCancel }) {
  const [v, set, setV] = useForm({ name: item?.name ?? '', bio: item?.bio ?? '', photo: item?.photo ?? '', rate: item?.rate ?? '', years: item?.years ?? '', tags: (item?.tags ?? []).join(', '), best: !!item?.best });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      await api.admin.save('trainers', item?.id, { ...v, rate: parseFloat(String(v.rate).replace(',', '.')), years: parseInt(v.years, 10), tags: v.tags.split(',').map((t) => t.trim()).filter(Boolean) });
      onDone();
    } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <FormShell title={item ? 'Modifier le coach' : 'Nouveau coach'} onSubmit={submit} onCancel={onCancel} busy={busy} error={error}>
      <Field id="t-n" label="Nom"><input id="t-n" value={v.name} onChange={set('name')} maxLength={60} /></Field>
      <Field id="t-b" label="Présentation"><textarea id="t-b" value={v.bio} onChange={set('bio')} maxLength={400} rows={3} /></Field>
      <ImageField label="Photo" value={v.photo} onChange={(u) => setV((x) => ({ ...x, photo: u }))} hint="Enregistrée dans Supabase" />
      <div className="two">
        <Field id="t-r" label="Note (0 à 5)"><input id="t-r" inputMode="decimal" value={v.rate} onChange={set('rate')} /></Field>
        <Field id="t-y" label="Années d'expérience"><input id="t-y" inputMode="numeric" value={v.years} onChange={set('years')} /></Field>
      </div>
      <Field id="t-t" label="Spécialités" hint="Séparées par des virgules (ex. Yoga, Boxe)"><input id="t-t" value={v.tags} onChange={set('tags')} /></Field>
      <label className="check"><input type="checkbox" checked={v.best} onChange={set('best')} /> Mettre en avant (badge « Recommandé »)</label>
    </FormShell>
  );
}

function WorkoutForm({ item, courses, goals, onDone, onCancel }) {
  const [v, set, setV] = useForm({
    title: item?.title ?? '', courseId: item?.courseId ?? courses[0]?.id ?? '', level: item?.level ?? 'Beginner', minutes: item?.minutes ?? '', kcal: item?.kcal ?? '',
    description: item?.description ?? '', photo: item?.photo ?? '', video: item?.video ?? '', goals: item?.goals ?? [],
    exercises: item?.exercises?.length ? item.exercises : [{ name: '', reps: 10, seconds: 30 }],
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const setEx = (i, k, val) => setV((x) => ({ ...x, exercises: x.exercises.map((e, j) => (j === i ? { ...e, [k]: val } : e)) }));
  const toggleGoal = (id) => setV((x) => ({ ...x, goals: x.goals.includes(id) ? x.goals.filter((g) => g !== id) : [...x.goals, id] }));
  const kind = videoKind(v.video);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      await api.admin.save('workouts', item?.id, {
        ...v, minutes: parseInt(v.minutes, 10), kcal: parseInt(v.kcal, 10),
        exercises: v.exercises.map((x) => ({ name: x.name, reps: parseInt(x.reps, 10), seconds: parseInt(x.seconds, 10) })),
      });
      onDone();
    } catch (err) { setError(err.message); setBusy(false); }
  };

  if (!courses.length) return <div className="card"><p className="muted">Crée d'abord un cours : chaque séance appartient à un cours.</p><button className="btn ghost" onClick={onCancel}>Retour</button></div>;
  return (
    <FormShell title={item ? 'Modifier la séance' : 'Nouvelle séance'} onSubmit={submit} onCancel={onCancel} busy={busy} error={error}>
      <Field id="w-t" label="Titre"><input id="w-t" value={v.title} onChange={set('title')} maxLength={80} /></Field>
      <div className="two">
        <Field id="w-c" label="Cours"><select id="w-c" value={v.courseId} onChange={set('courseId')}>{courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field id="w-l" label="Niveau"><select id="w-l" value={v.level} onChange={set('level')}>{LEVELS.map((l) => <option key={l} value={l}>{levelFr(l)}</option>)}</select></Field>
      </div>
      <div className="two">
        <Field id="w-m" label="Durée (minutes)"><input id="w-m" inputMode="numeric" value={v.minutes} onChange={set('minutes')} /></Field>
        <Field id="w-k" label="Calories (kcal)"><input id="w-k" inputMode="numeric" value={v.kcal} onChange={set('kcal')} /></Field>
      </div>
      <Field id="w-d" label="Description"><textarea id="w-d" value={v.description} onChange={set('description')} maxLength={1000} rows={3} /></Field>
      <ImageField label="Photo" value={v.photo} onChange={(u) => setV((x) => ({ ...x, photo: u }))} hint="Enregistrée dans Supabase" />
      <Field id="w-v" label="Vidéo de la séance" hint="Lien YouTube, Vimeo ou fichier vidéo (.mp4)">
        <input id="w-v" value={v.video} onChange={set('video')} inputMode="url" placeholder="https://www.youtube.com/watch?v=…" />
      </Field>
      {kind && <p className="muted" style={{ margin: '-6px 0 10px' }}>Type détecté : {kind === 'file' ? 'fichier vidéo (lu en arrière-plan)' : kind === 'youtube' ? 'YouTube (lecteur intégré)' : 'Vimeo (lecteur intégré)'}.</p>}
      {goals.length > 0 && (
        <div className="fld"><label>Objectifs concernés</label>
          <div className="checks">{goals.map((g) => <label key={g.id} className="check inline"><input type="checkbox" checked={v.goals.includes(g.id)} onChange={() => toggleGoal(g.id)} /> {g.label}</label>)}</div></div>
      )}
      <div className="fld"><label>Exercices</label>
        {v.exercises.map((x, i) => (
          <div key={i} className="ex-row">
            <input aria-label={`Exercice ${i + 1}`} placeholder="Nom" value={x.name} onChange={(e) => setEx(i, 'name', e.target.value)} maxLength={60} />
            <input aria-label="Répétitions" inputMode="numeric" value={x.reps} onChange={(e) => setEx(i, 'reps', e.target.value)} title="Répétitions" />
            <input aria-label="Secondes" inputMode="numeric" value={x.seconds} onChange={(e) => setEx(i, 'seconds', e.target.value)} title="Secondes" />
            <button type="button" className="mini-btn" aria-label="Retirer l'exercice" onClick={() => setV((s) => ({ ...s, exercises: s.exercises.filter((_, j) => j !== i) }))}>✕</button>
          </div>
        ))}
        <small className="hint">Nom · répétitions · durée en secondes</small>
        <button type="button" className="btn ghost small" onClick={() => setV((s) => ({ ...s, exercises: [...s.exercises, { name: '', reps: 10, seconds: 30 }] }))}>Ajouter un exercice</button>
      </div>
    </FormShell>
  );
}

/* ---------- page ---------- */
export function AdminContent() {
  const { notify } = useStore();
  const [kind, setKind] = useState('workouts');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);   // null | { item: objet | null }

  const load = useCallback(() => { setError(''); api.admin.content().then(setData).catch((e) => setError(e.message)); }, []);
  useEffect(load, [load]);

  const done = () => { setEditing(null); notify('Enregistré'); load(); };
  const remove = async (item, label) => {
    if (!window.confirm(`Supprimer « ${label} » ?`)) return;
    try { await api.admin.remove(kind, item.id); notify('Supprimé'); load(); } catch (e) { notify(e.message); }
  };
  const label = (x) => x.title ?? x.name ?? x.label;
  const sub = (x) => {
    if (kind === 'workouts') return `${data.courses.find((c) => c.id === x.courseId)?.name ?? '—'} · ${x.minutes} min · ${x.kcal} kcal · ${levelFr(x.level)}${x.video ? ' · vidéo' : ''}`;
    if (kind === 'courses') return `${data.workouts.filter((w) => w.courseId === x.id).length} séance(s)`;
    if (kind === 'trainers') return `★ ${x.rate} · ${x.years} ans · ${x.tags.join(', ') || '—'}`;
    return '';
  };

  return (
    <AdminShell title="Contenu">
      <div className="chips" role="tablist" aria-label="Type de contenu">
        {KINDS.map(([k, l]) => <button key={k} role="tab" aria-selected={kind === k} className={'chip' + (kind === k ? ' on' : '')} onClick={() => { setKind(k); setEditing(null); }}>{l}</button>)}
      </div>
      {error ? <div className="state-box center" role="alert"><b>Impossible de charger le contenu</b><p>{error}</p><button className="btn" onClick={load}>Réessayer</button></div> : !data ? (
        <div className="lst" aria-busy="true" aria-label="Chargement" style={{ marginTop: 14 }}><div className="row skeleton" /></div>
      ) : editing ? (
        <div style={{ marginTop: 14 }}>
          {kind === 'workouts' ? <WorkoutForm item={editing.item} courses={data.courses} goals={data.goals} onDone={done} onCancel={() => setEditing(null)} />
            : kind === 'trainers' ? <TrainerForm item={editing.item} onDone={done} onCancel={() => setEditing(null)} />
            : <SimpleForm kind={kind} item={editing.item} onDone={done} onCancel={() => setEditing(null)} />}
        </div>
      ) : (
        <>
          <button className="btn" style={{ marginTop: 14 }} onClick={() => setEditing({ item: null })}>
            {kind === 'workouts' ? 'Ajouter une séance' : kind === 'courses' ? 'Ajouter un cours' : kind === 'goals' ? 'Ajouter un objectif' : 'Ajouter un coach'}
          </button>
          <div className="lst grid" style={{ marginTop: 14 }}>
            {data[kind].length ? data[kind].map((x) => (
              <div key={x.id} className="row arow">
                <div className="thumb"><Img src={assetUrl(x.photo)} /></div>
                <div className="t"><b>{label(x)}</b>{sub(x) && <small>{sub(x)}</small>}</div>
                <div className="row-actions">
                  <button className="mini-btn" onClick={() => setEditing({ item: x })}>Modifier</button>
                  <button className="mini-btn danger-t" onClick={() => remove(x, label(x))}>Supprimer</button>
                </div>
              </div>
            )) : <Empty>Rien ici pour le moment.<br />Utilise le bouton ci-dessus pour publier le premier élément.</Empty>}
          </div>
        </>
      )}
    </AdminShell>
  );
}
