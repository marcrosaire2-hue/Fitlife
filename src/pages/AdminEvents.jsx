import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { Img } from '../components/Media';
import { Empty } from '../components/ui';
import ImageField from '../components/ImageField';
import { AdminShell } from './Admin';
import { assetUrl } from '../lib/media';
import { evDate, evTime } from './Events';

// datetime-local <-> millisecondes (heure locale)
const toInput = (t) => { if (!t) return ''; const d = new Date(t); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const fromInput = (s) => (s ? new Date(s).getTime() : null);

function EventForm({ item, onDone, onCancel }) {
  const [v, setV] = useState({
    title: item?.title ?? '', place: item?.place ?? '', description: item?.description ?? '', image: item?.image ?? '',
    startsAt: toInput(item?.startsAt ?? Date.now() + 7 * 86400000), endsAt: toInput(item?.endsAt),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await api.admin.save('events', item?.id, { ...v, startsAt: fromInput(v.startsAt), endsAt: fromInput(v.endsAt) }); onDone(); } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <form className="card admin-form" onSubmit={submit} noValidate>
      <div className="card-h"><b>{item ? "Modifier l'événement" : 'Nouvel événement'}</b></div>
      <div className="fld"><label htmlFor="e-t">Titre</label><input id="e-t" value={v.title} onChange={set('title')} maxLength={80} /></div>
      <div className="fld"><label htmlFor="e-p">Lieu</label><input id="e-p" value={v.place} onChange={set('place')} maxLength={120} placeholder="ex. Parc central" /></div>
      <div className="fld"><label htmlFor="e-d">Description</label><textarea id="e-d" value={v.description} onChange={set('description')} maxLength={1000} rows={4} /></div>
      <ImageField label="Image" value={v.image} onChange={(u) => setV((x) => ({ ...x, image: u }))} hint="Enregistrée dans Supabase" />
      <div className="two">
        <div className="fld"><label htmlFor="e-s">Début</label><input id="e-s" type="datetime-local" value={v.startsAt} onChange={set('startsAt')} /></div>
        <div className="fld"><label htmlFor="e-e">Fin (facultatif)</label><input id="e-e" type="datetime-local" value={v.endsAt} onChange={set('endsAt')} /></div>
      </div>
      {error && <div className="form-err" role="alert">{error}</div>}
      <button className="btn" type="submit" disabled={busy}>{busy ? 'Enregistrement…' : 'Publier'}</button>
      <button className="btn ghost" type="button" onClick={onCancel} disabled={busy}>Annuler</button>
    </form>
  );
}

export function AdminEvents() {
  const { notify } = useStore();
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(null);           // id de l'événement dont on affiche les inscrits
  const [people, setPeople] = useState([]);

  const load = useCallback(() => { setError(''); api.admin.events().then((d) => setList(d.events)).catch((e) => setError(e.message)); }, []);
  useEffect(load, [load]);

  const done = () => { setEditing(null); notify('Événement enregistré'); load(); };
  const remove = async (ev) => {
    if (!window.confirm(`Supprimer « ${ev.title} » et ses inscriptions ?`)) return;
    try { await api.admin.remove('events', ev.id); notify('Événement supprimé'); load(); } catch (e) { notify(e.message); }
  };
  const toggleOpen = async (ev) => {
    if (open === ev.id) { setOpen(null); return; }
    try { const d = await api.admin.participants(ev.id); setPeople(d.participants); setOpen(ev.id); } catch (e) { notify(e.message); }
  };

  return (
    <AdminShell title="Événements">
      {error ? <div className="state-box center" role="alert"><b>Impossible de charger les événements</b><p>{error}</p><button className="btn" onClick={load}>Réessayer</button></div> : !list ? (
        <div className="lst" aria-busy="true" aria-label="Chargement" style={{ marginTop: 14 }}><div className="row skeleton" /></div>
      ) : editing ? (
        <EventForm item={editing.item} onDone={done} onCancel={() => setEditing(null)} />
      ) : (
        <>
          <button className="btn" onClick={() => setEditing({ item: null })}>Créer un événement</button>
          <div className="lst grid" style={{ marginTop: 14 }}>
            {list.length ? list.map((ev) => (
              <div key={ev.id} className="adm-ev">
                <div className="row arow">
                  <div className="thumb"><Img src={assetUrl(ev.image)} /></div>
                  <div className="t"><b>{ev.title}</b><small>{evDate(ev.startsAt)} · {evTime(ev.startsAt)}{ev.place ? ` · ${ev.place}` : ''}</small><small>{ev.participants} {ev.participants === 1 ? 'inscrit' : 'inscrits'}</small></div>
                  <div className="row-actions">
                    <button className="mini-btn" onClick={() => toggleOpen(ev)}>{open === ev.id ? 'Masquer' : 'Inscrits'}</button>
                    <button className="mini-btn" onClick={() => setEditing({ item: ev })}>Modifier</button>
                    <button className="mini-btn danger-t" onClick={() => remove(ev)}>Supprimer</button>
                  </div>
                </div>
                {open === ev.id && (
                  <div className="card board">
                    {people.length ? people.map((p) => <div key={p.id} className="bk"><span>{p.name}</span><small>{p.email}</small></div>) : <p className="muted">Personne n'est encore inscrit.</p>}
                  </div>
                )}
              </div>
            )) : <Empty>Aucun événement.<br />Crée le premier rendez-vous pour les utilisateurs.</Empty>}
          </div>
        </>
      )}
    </AdminShell>
  );
}
