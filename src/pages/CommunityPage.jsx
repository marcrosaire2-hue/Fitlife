import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useStore } from '../store';
import Avatar from '../components/Avatar';
import Icon from '../components/Icon';
import ImageField from '../components/ImageField';
import { BackBtn, Empty, SearchBox } from '../components/ui';
import { assetUrl } from '../lib/media';

const ROLE = { owner: 'Créateur', admin: 'Admin', member: '' };
const liveWhen = (t) => new Date(t).toLocaleString('fr', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const toInput = (t) => { const d = new Date(t), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

/* ---------------- création / modification ---------------- */
function CommunityForm({ item, onDone, onCancel }) {
  const { notify } = useStore();
  const nav = useNavigate();
  const [v, setV] = useState({ name: item?.name ?? '', description: item?.description ?? '', visibility: item?.visibility ?? 'public', photo: item?.photo ?? '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      if (item) { await api.social.updateCommunity(item.id, v); notify('Communauté mise à jour'); onDone(); }
      else { const d = await api.social.createCommunity(v); notify('Communauté créée'); nav(`/social/communities/${d.id}`, { replace: true }); }
    } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <form className="card admin-form" onSubmit={submit} noValidate>
      <div className="card-h"><b>{item ? 'Modifier la communauté' : 'Nouvelle communauté'}</b></div>
      <div className="fld"><label htmlFor="c-n">Nom</label><input id="c-n" value={v.name} onChange={set('name')} maxLength={50} placeholder="ex. Coureurs du dimanche" /></div>
      <div className="fld"><label htmlFor="c-d">Description</label><textarea id="c-d" value={v.description} onChange={set('description')} maxLength={300} rows={3} /></div>
      <div className="fld"><label htmlFor="c-v">Visibilité</label>
        <select id="c-v" value={v.visibility} onChange={set('visibility')}>
          <option value="public">Publique : tout le monde peut la trouver et la rejoindre</option>
          <option value="private">Privée : sur invitation uniquement</option>
        </select></div>
      <ImageField label="Image (facultatif)" value={v.photo} onChange={(u) => setV((x) => ({ ...x, photo: u }))} uploader={api.uploadCommunityImage} hint="Enregistrée dans Supabase" />
      {error && <div className="form-err" role="alert">{error}</div>}
      <button className="btn" type="submit" disabled={busy}>{busy ? 'Enregistrement…' : item ? 'Enregistrer' : 'Créer la communauté'}</button>
      <button className="btn ghost" type="button" onClick={onCancel || (() => nav('/social/communities'))} disabled={busy}>Annuler</button>
    </form>
  );
}

export function CommunityNew() {
  return (
    <section className="page narrow">
      <div className="topbar"><BackBtn to="/social/communities" /><h2>Communauté</h2><span className="sp" /></div>
      <div className="px"><CommunityForm /></div>
    </section>
  );
}

/* ---------------- page d'une communauté ---------------- */
export default function CommunityPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const { notify } = useStore();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [panel, setPanel] = useState('');                  // '' | 'live' | 'invite'
  const [live, setLive] = useState({ title: '', startsAt: toInput(Date.now() + 3600000) });
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError('');
    api.social.community(id).then(setD).catch((e) => (e.status === 404 ? setMissing(true) : setError(e.message)));
  }, [id]);
  useEffect(() => { setD(null); load(); }, [load]);
  useEffect(() => {
    if (panel !== 'invite') return undefined;
    const h = setTimeout(() => api.social.people(q.trim()).then((r) => setFound(r.people)).catch(() => {}), 250);
    return () => clearTimeout(h);
  }, [panel, q]);

  if (missing) return <Navigate to="/social/communities" replace />;
  if (error) return <section className="page narrow"><div className="topbar"><BackBtn to="/social/communities" /><span /><span className="sp" /></div><div className="state-box center" role="alert"><b>Impossible de charger la communauté</b><p>{error}</p><button className="btn" onClick={load}>Réessayer</button></div></section>;
  if (!d) return <section className="page narrow" aria-busy="true" aria-label="Chargement"><div className="topbar"><BackBtn to="/social/communities" /><span /><span className="sp" /></div><div className="px"><div className="skeleton" style={{ height: 200, borderRadius: 26 }} /></div></section>;

  const c = d.community, active = c.status === 'active', owner = c.role === 'owner';
  const act = async (fn, msg, after) => { setBusy(true); try { await fn(); if (msg) notify(msg); if (after) after(); else load(); } catch (e) { notify(e.message); } setBusy(false); };
  const call = () => act(async () => { const r = await api.social.startCall(d.conversationId, { kind: 'call', title: `Appel : ${c.name}` }); nav(`/social/call/${r.call.id}`); }, null, () => {});
  const schedule = (e) => {
    e.preventDefault();
    act(() => api.social.startCall(d.conversationId, { kind: 'live', title: live.title.trim() || `Live : ${c.name}`, startsAt: new Date(live.startsAt).getTime() }), 'Live programmé', () => { setPanel(''); load(); });
  };
  const remove = () => { if (window.confirm('Supprimer cette communauté, son chat et ses lives pour tout le monde ?')) act(() => api.social.deleteCommunity(id), 'Communauté supprimée', () => nav('/social/communities', { replace: true })); };
  const leave = () => { if (window.confirm('Quitter cette communauté ?')) act(() => api.social.leaveCommunity(id), 'Tu as quitté la communauté', () => nav('/social/communities', { replace: true })); };

  return (
    <section className="page narrow">
      <div className="topbar"><BackBtn to="/social/communities" /><h2>Communauté</h2><span className="sp" /></div>
      <div className="px">
        {editing ? <CommunityForm item={c} onDone={() => { setEditing(false); load(); }} onCancel={() => setEditing(false)} /> : (
          <>
            <div className="card comm-head">
              <Avatar name={c.name} src={assetUrl(c.photo)} size="xl" />
              <h1 className="h1" style={{ padding: 0 }}>{c.name}</h1>
              <p className="muted">{c.visibility === 'private' ? 'Communauté privée' : 'Communauté publique'} · {c.members} {c.members === 1 ? 'membre' : 'membres'}</p>
              {c.description && <p className="ev-desc" style={{ textAlign: 'center' }}>{c.description}</p>}
            </div>

            {c.status === 'invited' && <div className="card"><p className="muted">Tu es invité à rejoindre cette communauté.</p><div className="two"><button className="btn" disabled={busy} onClick={() => act(() => api.social.acceptInvite(id), 'Tu as rejoint la communauté')}>Accepter</button><button className="btn ghost" disabled={busy} onClick={() => act(() => api.social.declineInvite(id), 'Invitation refusée', () => nav('/social/communities', { replace: true }))}>Refuser</button></div></div>}
            {!c.status && c.visibility === 'public' && <button className="btn" disabled={busy} onClick={() => act(() => api.social.joinCommunity(id), 'Tu as rejoint la communauté')}>Rejoindre la communauté</button>}

            {active && (
              <div className="comm-actions">
                <Link to={`/social/chat/${d.conversationId}`} className="btn"><Icon n="chat" /> Ouvrir le chat</Link>
                <button className="btn ghost" onClick={call} disabled={busy}><Icon n="video" /> Appel vidéo de groupe</button>
              </div>
            )}

            {active && (
              <>
                <div className="sec" style={{ padding: '18px 0 8px' }}><h3>Lives et appels</h3>{d.canManage && <button className="mini-btn" onClick={() => setPanel(panel === 'live' ? '' : 'live')}>{panel === 'live' ? 'Fermer' : 'Programmer un live'}</button>}</div>
                {panel === 'live' && (
                  <form className="card admin-form" onSubmit={schedule}>
                    <div className="fld"><label htmlFor="l-t">Titre</label><input id="l-t" value={live.title} onChange={(e) => setLive((x) => ({ ...x, title: e.target.value }))} maxLength={80} placeholder="ex. Séance de renforcement en direct" /></div>
                    <div className="fld"><label htmlFor="l-s">Date et heure</label><input id="l-s" type="datetime-local" value={live.startsAt} onChange={(e) => setLive((x) => ({ ...x, startsAt: e.target.value }))} /></div>
                    <p className="muted">Les membres sont prévenus dans le chat de la communauté et peuvent rejoindre le live 10 minutes avant l'heure (6 participants au maximum en vidéo).</p>
                    <button className="btn" type="submit" disabled={busy}>Programmer</button>
                  </form>
                )}
                <div className="lst">
                  {d.lives.length ? d.lives.map((l) => (
                    <div key={l.id} className="row arow">
                      <div className="call-ic"><Icon n="video" /></div>
                      <div className="t"><b>{l.title}</b><small>{l.live ? (l.kind === 'live' ? 'Live en cours' : 'Appel en cours') : liveWhen(l.startsAt)}</small></div>
                      <Link to={`/social/call/${l.id}`} className={'book' + (l.live ? ' on' : '')}>{l.live ? 'Rejoindre' : 'Voir'}</Link>
                    </div>
                  )) : <Empty>Aucun live programmé.</Empty>}
                </div>
              </>
            )}

            <div className="sec" style={{ padding: '18px 0 8px' }}><h3>Membres</h3>{d.canManage && <button className="mini-btn" onClick={() => setPanel(panel === 'invite' ? '' : 'invite')}>{panel === 'invite' ? 'Fermer' : 'Inviter'}</button>}</div>
            {panel === 'invite' && (
              <div className="card">
                <SearchBox value={q} onChange={setQ} placeholder="Chercher une personne à inviter" />
                <div className="lst" style={{ marginTop: 10 }}>
                  {found.filter((p) => !d.members.some((m) => m.id === p.id)).slice(0, 8).map((p) => (
                    <div key={p.id} className="row person"><Avatar name={p.name} src={p.avatar} /><div className="t"><b>{p.name}</b></div><button className="book" onClick={() => act(() => api.social.invite(id, p.id), `Invitation envoyée à ${p.name}`, () => {})}>Inviter</button></div>
                  ))}
                </div>
              </div>
            )}
            <div className="lst">
              {d.members.map((m) => (
                <div key={m.id} className="row person">
                  <Avatar name={m.name} src={m.avatar} />
                  <div className="t"><b>{m.name}{m.id === user.id ? ' (toi)' : ''}{ROLE[m.role] && <span className="ctype">{ROLE[m.role]}</span>}</b></div>
                  {d.canManage && m.role !== 'owner' && m.id !== user.id && (
                    <div className="row-actions">
                      {owner && <button className="mini-btn" onClick={() => act(() => api.social.setRole(id, m.id, m.role === 'admin' ? 'member' : 'admin'))}>{m.role === 'admin' ? 'Rétrograder' : 'Nommer admin'}</button>}
                      <button className="mini-btn danger-t" onClick={() => window.confirm(`Retirer ${m.name} ?`) && act(() => api.social.kick(id, m.id), 'Membre retiré')}>Retirer</button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="admin-actions">
              {owner && <button className="btn ghost" onClick={() => setEditing(true)}>Modifier la communauté</button>}
              {active && !owner && <button className="btn ghost" onClick={leave} disabled={busy}>Quitter la communauté</button>}
              {d.canDelete && <button className="btn ghost danger" onClick={remove} disabled={busy}>Supprimer la communauté</button>}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
