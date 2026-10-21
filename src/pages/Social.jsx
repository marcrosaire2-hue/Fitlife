import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useStore } from '../store';
import { on } from '../lib/realtime';
import Avatar from '../components/Avatar';
import Icon from '../components/Icon';
import ImageField from '../components/ImageField';
import { SocialTabs, shortTime } from '../components/SocialBits';
import { BackBtn, Empty, SearchBox } from '../components/ui';
import { assetUrl } from '../lib/media';

function ErrorBox({ title, message, onRetry }) {
  return <div className="state-box center" role="alert"><b>{title}</b><p>{message}</p><button className="btn" onClick={onRetry}>Réessayer</button></div>;
}
function Shell({ children, title = 'Social' }) {
  return (
    <section className="page narrow">
      <div className="topbar"><BackBtn to="/home" /><h2>{title}</h2><span className="sp" /></div>
      <div className="px"><SocialTabs />{children}</div>
    </section>
  );
}

/* ---------------- Messages : liste des conversations ---------------- */
export function SocialMessages() {
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => { setError(''); api.social.conversations().then((d) => setList(d.conversations)).catch((e) => setError(e.message)); }, []);
  useEffect(() => { load(); const offs = [on('message', load), on('social', load)]; return () => offs.forEach((o) => o()); }, [load]);
  const nav = useNavigate();

  return (
    <Shell>
      <button className="btn" onClick={() => nav('/social/new-group')}><Icon n="plus" /> Nouveau groupe</button>
      {error ? <ErrorBox title="Impossible de charger les messages" message={error} onRetry={load} /> : !list ? (
        <div className="lst" aria-busy="true" aria-label="Chargement" style={{ marginTop: 14 }}><div className="row skeleton" /><div className="row skeleton" /></div>
      ) : (
        <div className="lst" style={{ marginTop: 14 }}>
          {list.length ? list.map((c) => (
            <Link key={c.id} to={`/social/chat/${c.id}`} className={'row conv' + (c.unread ? ' unread' : '')}>
              <Avatar name={c.name} src={c.type === 'community' ? assetUrl(c.avatar) : c.avatar} />
              <div className="t">
                <b>{c.name}{c.type !== 'direct' && <span className="ctype">{c.type === 'community' ? 'Communauté' : 'Groupe'}</span>}</b>
                <small className="last">{c.last ? `${c.type !== 'direct' && c.last.senderName ? c.last.senderName + ' : ' : ''}${c.last.text}` : 'Aucun message'}</small>
              </div>
              <div className="conv-meta">{c.last && <small>{shortTime(c.last.at)}</small>}{c.unread > 0 && <b className="dot">{c.unread > 9 ? '9+' : c.unread}</b>}</div>
            </Link>
          )) : <Empty>Aucune conversation.<br />Va dans « Personnes » pour te connecter à d'autres sportifs, ou rejoins une communauté.</Empty>}
        </div>
      )}
    </Shell>
  );
}

/* ---------------- Personnes : recherche, connexions, demandes ---------------- */
export function SocialPeople() {
  const { notify } = useStore();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [people, setPeople] = useState(null);
  const [fr, setFr] = useState(null);
  const [error, setError] = useState('');
  const stamp = useRef(0);

  const loadPeople = useCallback((query) => {
    const n = ++stamp.current;
    api.social.people(query.trim()).then((d) => { if (n === stamp.current) setPeople(d.people); }).catch((e) => { if (n === stamp.current) setError(e.message); });
  }, []);
  const loadFriends = useCallback(() => { api.social.friends().then(setFr).catch((e) => setError(e.message)); }, []);
  const reload = useCallback(() => { loadPeople(q); loadFriends(); }, [q, loadPeople, loadFriends]);

  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; loadPeople(''); loadFriends(); return undefined; }
    const h = setTimeout(() => loadPeople(q), 250);
    return () => clearTimeout(h);
  }, [q, loadPeople, loadFriends]);
  useEffect(() => on('social', () => { loadFriends(); loadPeople(q); }), [q, loadPeople, loadFriends]);

  const act = async (fn, msg) => { try { await fn(); if (msg) notify(msg); reload(); } catch (e) { notify(e.message); } };
  const write = async (id) => { try { const d = await api.social.openDirect(id); nav(`/social/chat/${d.id}`); } catch (e) { notify(e.message); } };

  const Actions = ({ p }) => {
    if (p.relation === 'friend') return <><button className="book on" onClick={() => write(p.id)}>Écrire</button><button className="mini-btn" onClick={() => window.confirm(`Retirer ${p.name} de tes connexions ?`) && act(() => api.social.removeFriend(p.id), 'Connexion retirée')}>Retirer</button></>;
    if (p.relation === 'sent') return <button className="book" onClick={() => act(() => api.social.removeFriend(p.id), 'Demande annulée')}>Envoyée ✕</button>;
    if (p.relation === 'received') return <><button className="book on" onClick={() => act(() => api.social.accept(p.id), 'Vous êtes connectés')}>Accepter</button><button className="mini-btn" onClick={() => act(() => api.social.removeFriend(p.id))}>Refuser</button></>;
    if (p.relation === 'blocked') return <button className="book" onClick={() => act(() => api.social.unblock(p.id), 'Personne débloquée')}>Débloquer</button>;
    return <><button className="book" onClick={() => act(() => api.social.request(p.id), 'Demande envoyée')}>Se connecter</button><button className="mini-btn" onClick={() => write(p.id)}>Écrire</button></>;
  };
  const Person = ({ p }) => (
    <div className="row person">
      <Avatar name={p.name} src={p.avatar} />
      <div className="t"><b>{p.name}</b></div>
      <div className="row-actions"><Actions p={p} /></div>
    </div>
  );

  return (
    <Shell>
      <SearchBox value={q} onChange={setQ} placeholder="Rechercher un sportif par son nom" />
      {error ? <ErrorBox title="Impossible de charger les personnes" message={error} onRetry={() => { setError(''); reload(); }} /> : (
        <>
          {fr?.received.length > 0 && (
            <>
              <div className="sec" style={{ padding: '16px 0 8px' }}><h3>Demandes reçues</h3></div>
              <div className="lst">{fr.received.map((p) => <Person key={p.id} p={{ ...p, relation: 'received' }} />)}</div>
            </>
          )}
          {!q && fr?.friends.length > 0 && (
            <>
              <div className="sec" style={{ padding: '16px 0 8px' }}><h3>Mes connexions</h3><small>{fr.friends.length}</small></div>
              <div className="lst">{fr.friends.map((p) => <Person key={p.id} p={{ ...p, relation: 'friend' }} />)}</div>
            </>
          )}
          <div className="sec" style={{ padding: '16px 0 8px' }}><h3>{q ? 'Résultats' : 'À découvrir'}</h3></div>
          {!people ? <div className="lst" aria-busy="true" aria-label="Chargement"><div className="row skeleton" /></div> : (
            <div className="lst">
              {people.filter((p) => q || p.relation === 'none' || p.relation === 'sent').length ? people.filter((p) => q || p.relation === 'none' || p.relation === 'sent').map((p) => <Person key={p.id} p={p} />)
                : <Empty>{q ? 'Personne ne correspond à cette recherche.' : 'Personne de nouveau à découvrir pour le moment.'}</Empty>}
            </div>
          )}
        </>
      )}
    </Shell>
  );
}

/* ---------------- Communautés ---------------- */
function CommRow({ c, onJoin }) {
  return (
    <div className="row arow comm">
      <Link to={`/social/communities/${c.id}`} className="arow-main">
        <Avatar name={c.name} src={assetUrl(c.photo)} />
        <div className="t"><b>{c.name}{c.visibility === 'private' && <span className="ctype">Privée</span>}</b><small>{c.members} {c.members === 1 ? 'membre' : 'membres'}{c.description ? ` · ${c.description}` : ''}</small></div>
      </Link>
      {onJoin}
    </div>
  );
}

export function SocialCommunities() {
  const { notify } = useStore();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const stamp = useRef(0);
  const load = useCallback((query) => {
    const n = ++stamp.current;
    api.social.communities(query.trim()).then((r) => { if (n === stamp.current) setD(r); }).catch((e) => { if (n === stamp.current) setError(e.message); });
  }, []);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; load(''); return undefined; }
    const h = setTimeout(() => load(q), 250);
    return () => clearTimeout(h);
  }, [q, load]);
  useEffect(() => on('social', () => load(q)), [q, load]);

  const act = async (fn, msg) => { try { await fn(); notify(msg); load(q); } catch (e) { notify(e.message); } };

  return (
    <Shell>
      <button className="btn" onClick={() => nav('/social/communities/new')}><Icon n="plus" /> Créer une communauté</button>
      <div style={{ height: 12 }} />
      <SearchBox value={q} onChange={setQ} placeholder="Rechercher une communauté" />
      {error ? <ErrorBox title="Impossible de charger les communautés" message={error} onRetry={() => { setError(''); load(q); }} /> : !d ? (
        <div className="lst" aria-busy="true" aria-label="Chargement" style={{ marginTop: 14 }}><div className="row skeleton" /></div>
      ) : (
        <>
          {d.invitations.length > 0 && (
            <>
              <div className="sec" style={{ padding: '16px 0 8px' }}><h3>Invitations</h3></div>
              <div className="lst">{d.invitations.map((c) => (
                <CommRow key={c.id} c={c} onJoin={<div className="row-actions"><button className="book on" onClick={() => act(() => api.social.acceptInvite(c.id), 'Tu as rejoint la communauté')}>Accepter</button><button className="mini-btn" onClick={() => act(() => api.social.declineInvite(c.id), 'Invitation refusée')}>Refuser</button></div>} />
              ))}</div>
            </>
          )}
          {!q && (
            <>
              <div className="sec" style={{ padding: '16px 0 8px' }}><h3>Mes communautés</h3></div>
              <div className="lst">{d.mine.length ? d.mine.map((c) => <CommRow key={c.id} c={c} />) : <Empty>Tu n'es dans aucune communauté pour le moment.</Empty>}</div>
            </>
          )}
          <div className="sec" style={{ padding: '16px 0 8px' }}><h3>{q ? 'Résultats' : 'À découvrir'}</h3></div>
          <div className="lst">{d.discover.length ? d.discover.map((c) => (
            <CommRow key={c.id} c={c} onJoin={<button className="book" onClick={() => act(() => api.social.joinCommunity(c.id), 'Tu as rejoint la communauté')}>Rejoindre</button>} />
          )) : <Empty>{q ? 'Aucune communauté ne correspond.' : 'Aucune autre communauté publique pour le moment.'}</Empty>}</div>
        </>
      )}
    </Shell>
  );
}

/* ---------------- Nouveau groupe de discussion ---------------- */
export function NewGroup() {
  const { notify } = useStore();
  const nav = useNavigate();
  const [fr, setFr] = useState(null);
  const [name, setName] = useState('');
  const [photo, setPhoto] = useState('');
  const [sel, setSel] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api.social.friends().then((d) => setFr(d.friends)).catch((e) => setError(e.message)); }, []);
  const toggle = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { const d = await api.social.createGroup(name, sel, photo); notify('Groupe créé'); nav(`/social/chat/${d.id}`, { replace: true }); } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <section className="page narrow">
      <div className="topbar"><BackBtn to="/social" /><h2>Nouveau groupe</h2><span className="sp" /></div>
      <form className="px" onSubmit={submit} noValidate>
        <div className="fld"><label htmlFor="g-n">Nom du groupe</label><input id="g-n" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="ex. Team footing" /></div>
        <ImageField label="Icône du groupe (facultatif)" value={photo} onChange={setPhoto} uploader={api.uploadCommunityImage} hint="Enregistrée dans Supabase" />
        <div className="fld"><label>Participants (tes connexions)</label></div>
        {!fr ? <div className="lst"><div className="row skeleton" /></div> : fr.length ? (
          <div className="lst">{fr.map((p) => (
            <label key={p.id} className={'row person pick' + (sel.includes(p.id) ? ' on' : '')}>
              <Avatar name={p.name} src={p.avatar} /><div className="t"><b>{p.name}</b></div>
              <input type="checkbox" checked={sel.includes(p.id)} onChange={() => toggle(p.id)} />
            </label>
          ))}</div>
        ) : <Empty>Tu n'as pas encore de connexion.<br />Connecte-toi à des personnes depuis l'onglet « Personnes ».</Empty>}
        {error && <div className="form-err" role="alert" style={{ marginTop: 12 }}>{error}</div>}
        <button className="btn" type="submit" disabled={busy || !sel.length} style={{ marginTop: 14 }}>{busy ? 'Création…' : `Créer le groupe${sel.length ? ` (${sel.length + 1})` : ''}`}</button>
      </form>
    </section>
  );
}
