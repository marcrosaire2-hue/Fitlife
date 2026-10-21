import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useStore } from '../store';
import { on } from '../lib/realtime';
import Avatar from '../components/Avatar';
import Icon from '../components/Icon';
import { BackBtn } from '../components/ui';
import ImageField from '../components/ImageField';
import { assetUrl } from '../lib/media';

const dayLabel = (t) => new Date(t).toLocaleDateString('fr', { weekday: 'long', day: 'numeric', month: 'long' });
const hour = (t) => new Date(t).toLocaleTimeString('fr', { hour: '2-digit', minute: '2-digit' });

function CallCard({ m }) {
  const c = m.call;
  if (!c) return <div className="call-card"><b>Appel vidéo</b></div>;
  const future = c.kind === 'live' && c.startsAt > Date.now() + 600000;
  return (
    <div className="call-card">
      <div className="call-ic"><Icon n="video" /></div>
      <div className="call-t"><b>{c.title}</b><small>{c.ended ? 'Terminé' : future ? `Prévu ${new Date(c.startsAt).toLocaleString('fr', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : c.kind === 'live' ? 'Live en cours' : 'Appel en cours'}</small></div>
      {!c.ended && <Link to={`/social/call/${c.id}`} className="book on">{future ? 'Voir' : 'Rejoindre'}</Link>}
    </div>
  );
}

export default function Chat() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const { notify } = useStore();
  const [conv, setConv] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [more, setMore] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  const [info, setInfo] = useState(false);
  const [friends, setFriends] = useState([]);
  const listRef = useRef(null), stick = useRef(true);

  const markRead = useCallback(() => { api.social.read(id).then(() => window.dispatchEvent(new Event('fitlife:read'))).catch(() => {}); }, [id]);

  const load = useCallback(() => {
    setError('');
    Promise.all([api.social.conversation(id), api.social.messages(id)])
      .then(([c, m]) => { setConv(c.conversation); setMsgs(m.messages); setMore(m.hasMore); stick.current = true; markRead(); })
      .catch((e) => (e.status === 404 ? setMissing(true) : setError(e.message)));
  }, [id, markRead]);
  useEffect(() => { setConv(null); setMsgs([]); load(); }, [load]);

  // messages instantanés
  useEffect(() => {
    const offMsg = on('message', (e) => {
      if (e.conversationId !== id) return;
      setMsgs((cur) => (cur.some((x) => x.id === e.message.id) ? cur : [...cur, e.message]));
      markRead();
    });
    const offOpen = on('open', () => { api.social.messages(id).then((m) => setMsgs(m.messages)).catch(() => {}); });   // rattrapage après une coupure
    return () => { offMsg(); offOpen(); };
  }, [id, markRead]);

  // défilement : en bas pour les nouveaux messages (sauf si on lit l'historique)
  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [msgs]);
  const onScroll = () => { const el = listRef.current; if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; };

  const older = async () => {
    const el = listRef.current, prev = el.scrollHeight;
    try { const m = await api.social.messages(id, msgs[0]?.createdAt); stick.current = false; setMsgs((cur) => [...m.messages, ...cur]); setMore(m.hasMore); requestAnimationFrame(() => { el.scrollTop = el.scrollHeight - prev; }); } catch (e) { notify(e.message); }
  };

  const submit = async (e) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try { const d = await api.social.send(id, t); setText(''); stick.current = true; setMsgs((cur) => (cur.some((x) => x.id === d.message.id) ? cur : [...cur, d.message])); } catch (err) { notify(err.message); }
    setSending(false);
  };
  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) submit(e); };

  const startCall = async () => {
    try { const d = await api.social.startCall(id, { kind: 'call' }); nav(`/social/call/${d.call.id}`); } catch (e) { notify(e.message); }
  };
  const openInfo = async () => {
    setInfo((v) => !v);
    if (conv?.type === 'group') api.social.friends().then((d) => setFriends(d.friends.filter((f) => !conv.members.some((m) => m.id === f.id)))).catch(() => {});
  };
  const leave = async () => {
    if (!window.confirm('Quitter ce groupe ?')) return;
    try { await api.social.leaveGroup(id); nav('/social', { replace: true }); } catch (e) { notify(e.message); }
  };
  const add = async (uid) => { try { await api.social.addToGroup(id, uid); notify('Ajouté au groupe'); load(); setFriends((f) => f.filter((x) => x.id !== uid)); } catch (e) { notify(e.message); } };

  if (missing) return <Navigate to="/social" replace />;
  if (error) return <section className="page narrow"><div className="topbar"><BackBtn to="/social" /><span /><span className="sp" /></div><div className="state-box center" role="alert"><b>Impossible de charger la conversation</b><p>{error}</p><button className="btn" onClick={load}>Réessayer</button></div></section>;

  let lastDay = '';
  return (
    <section className="chat">
      <header className="chat-h">
        <BackBtn to="/social" />
        <button className="chat-title" onClick={conv?.type !== 'direct' ? openInfo : undefined}>
          {conv ? <Avatar name={conv.name} src={conv.type === 'community' ? assetUrl(conv.avatar) : conv.avatar} size="sm" /> : <span className="avatar sm skeleton" />}
          <span><b>{conv?.name ?? '…'}</b>{conv && conv.type !== 'direct' && <small>{conv.type === 'community' ? 'Chat de la communauté' : `${conv.members.length} participants`}</small>}</span>
        </button>
        <button className="icon-btn" onClick={startCall} aria-label="Lancer un appel vidéo" disabled={!conv || conv.blocked}><Icon n="video" /></button>
      </header>

      {info && conv && (
        <div className="chat-info">
          {conv.type === 'community' ? <Link to={`/social/communities/${conv.communityId}`} className="btn ghost small">Ouvrir la communauté</Link> : (
            <>
              {conv.createdBy === user.id && (
                <ImageField label="Icône du groupe" value={conv.avatar || ''} uploader={api.uploadCommunityImage}
                  onChange={async (u) => { try { await api.social.updateGroup(id, { photo: u }); setConv((c) => ({ ...c, avatar: u || null })); notify('Icône mise à jour'); } catch (e) { notify(e.message); } }} />
              )}
              <div className="info-members">{conv.members.map((m) => <span key={m.id} className="chip small"><Avatar name={m.name} src={m.avatar} size="xs" /> {m.name}{m.id === user.id ? ' (toi)' : ''}</span>)}</div>
              {friends.length > 0 && <><small className="hint">Ajouter une connexion</small><div className="info-members">{friends.map((f) => <button key={f.id} className="chip small" onClick={() => add(f.id)}>+ {f.name}</button>)}</div></>}
              <button className="mini-btn danger-t" onClick={leave}>Quitter le groupe</button>
            </>
          )}
        </div>
      )}

      <div className="chat-list" ref={listRef} onScroll={onScroll} aria-live="polite">
        {more && <button className="link-btn" onClick={older}>Messages plus anciens</button>}
        {conv && !msgs.length && <p className="muted" style={{ textAlign: 'center', marginTop: 24 }}>Aucun message pour l'instant.<br />Dis bonjour !</p>}
        {msgs.map((m) => {
          const mine = m.senderId === user.id, day = dayLabel(m.createdAt), showDay = day !== lastDay; lastDay = day;
          return (
            <div key={m.id}>
              {showDay && <div className="day-sep">{day}</div>}
              <div className={'bubble-row' + (mine ? ' mine' : '')}>
                {!mine && conv?.type !== 'direct' && <Avatar name={m.sender.name} src={m.sender.avatar} size="xs" />}
                <div className={'bubble' + (mine ? ' mine' : '') + (m.type === 'call' ? ' call' : '')}>
                  {!mine && conv?.type !== 'direct' && <b className="who">{m.sender.name}</b>}
                  {m.type === 'call' ? <CallCard m={m} /> : <span className="txt">{m.text}</span>}
                  <small>{hour(m.createdAt)}</small>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {conv?.blocked ? <p className="chat-blocked">Tu ne peux plus échanger avec cette personne.</p> : (
        <form className="chat-form" onSubmit={submit}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} rows={1} maxLength={2000} placeholder="Écris un message…" aria-label="Message" />
          <button className="send" type="submit" disabled={sending || !text.trim()} aria-label="Envoyer"><Icon n="send" /></button>
        </form>
      )}
    </section>
  );
}
