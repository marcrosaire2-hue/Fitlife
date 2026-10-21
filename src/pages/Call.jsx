import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useStore } from '../store';
import { isOpen, on, send } from '../lib/realtime';
import Avatar from '../components/Avatar';
import Icon from '../components/Icon';

/* Appel vidéo de groupe (WebRTC maillé, 6 participants au maximum).
   Les flux audio/vidéo vont directement d'un participant à l'autre ; le serveur ne relaie que la négociation. */

function Tile({ stream, name, avatar, muted = false, off = false, mirror = false }) {
  const ref = useCallback((el) => { if (el && el.srcObject !== stream) el.srcObject = stream || null; }, [stream]);
  const hasVideo = !!stream?.getVideoTracks().some((t) => t.readyState === 'live');
  return (
    <div className="tile">
      {stream && <video ref={ref} autoPlay playsInline muted={muted} className={mirror ? 'mirror' : ''} style={{ opacity: hasVideo && !off ? 1 : 0 }} />}
      {(!stream || !hasVideo || off) && <div className="tile-ph"><Avatar name={name} src={avatar} size="xl" /></div>}
      <span className="tile-name">{name}</span>
    </div>
  );
}

const DENIED = {
  not_found: "Tu n'as pas accès à cet appel.", ended: 'Cet appel est terminé.', not_started: "Ce live n'a pas encore commencé.",
};

export default function Call() {
  const { id } = useParams();
  const nav = useNavigate();
  const { notify } = useStore();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  const [phase, setPhase] = useState('lobby');                 // lobby | joining | live | ended
  const [notice, setNotice] = useState('');
  const [peers, setPeers] = useState({});                      // id -> { card, stream }
  const [localStream, setLocalStream] = useState(null);
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [media, setMedia] = useState('pending');               // pending | full | audio | none
  const [me, setMe] = useState(null);

  const local = useRef(null), pcs = useRef(new Map()), queued = useRef(new Map()), cards = useRef(new Map()), ice = useRef([]), joined = useRef(false);

  const loadInfo = useCallback(() => {
    setError('');
    api.social.call(id).then((d) => { setInfo(d.call); ice.current = d.iceServers; if (d.call.state === 'ended') setPhase('ended'); }).catch((e) => (e.status === 404 ? setMissing(true) : setError(e.message)));
  }, [id]);
  useEffect(() => { loadInfo(); }, [loadInfo]);
  // un live programmé : on rafraîchit l'état toutes les 20 s jusqu'au début
  useEffect(() => {
    if (info?.state !== 'scheduled') return undefined;
    const h = setInterval(loadInfo, 20000);
    return () => clearInterval(h);
  }, [info?.state, loadInfo]);

  // caméra + micro (repli : micro seul, puis réception seule)
  const getMedia = useCallback(async () => {
    if (local.current) return;
    if (!navigator.mediaDevices?.getUserMedia) { setMedia('none'); return; }
    for (const [constraints, label] of [[{ audio: true, video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } }, 'full'], [{ audio: true }, 'audio']]) {
      try { local.current = await navigator.mediaDevices.getUserMedia(constraints); setLocalStream(local.current); setMedia(label); return; } catch { /* on essaie plus simple */ }
    }
    setMedia('none');
  }, []);
  useEffect(() => { if (info && info.state === 'live') getMedia(); }, [info, getMedia]);

  const closePeer = useCallback((pid) => {
    pcs.current.get(pid)?.close(); pcs.current.delete(pid); queued.current.delete(pid);
    setPeers((p) => { const n = { ...p }; delete n[pid]; return n; });
  }, []);

  const makePc = useCallback((pid) => {
    const pc = new RTCPeerConnection({ iceServers: ice.current });
    pcs.current.set(pid, pc);
    if (local.current) local.current.getTracks().forEach((t) => pc.addTrack(t, local.current));
    else { pc.addTransceiver('audio', { direction: 'recvonly' }); pc.addTransceiver('video', { direction: 'recvonly' }); }
    pc.onicecandidate = (e) => { if (e.candidate) send({ t: 'signal', callId: id, to: pid, data: { candidate: e.candidate } }); };
    pc.ontrack = (e) => setPeers((p) => ({ ...p, [pid]: { card: cards.current.get(pid) ?? p[pid]?.card ?? { id: pid, name: 'Participant', avatar: null }, stream: e.streams[0] } }));
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') closePeer(pid); };
    return pc;
  }, [id, closePeer]);

  const flush = async (pid, pc) => { for (const c of queued.current.get(pid) ?? []) { try { await pc.addIceCandidate(c); } catch { /* candidat obsolète */ } } queued.current.delete(pid); };

  // messages temps réel de la salle
  useEffect(() => {
    const offs = [
      on('call:peers', async (m) => {
        if (m.callId !== id) return;
        setMe(m.me); joined.current = true;
        for (const p of m.peers) {
          cards.current.set(p.id, p);
          setPeers((cur) => ({ ...cur, [p.id]: { card: p, stream: cur[p.id]?.stream ?? null } }));
          const pc = makePc(p.id);                                       // celui qui arrive appelle ceux qui sont déjà là
          try { await pc.setLocalDescription(await pc.createOffer()); send({ t: 'signal', callId: id, to: p.id, data: { sdp: pc.localDescription } }); } catch { closePeer(p.id); }
        }
        setPhase('live');
      }),
      on('call:joined', (m) => {
        if (m.callId !== id || !m.peer) return;
        cards.current.set(m.peer.id, m.peer);
        setPeers((cur) => ({ ...cur, [m.peer.id]: { card: m.peer, stream: cur[m.peer.id]?.stream ?? null } }));
      }),
      on('signal', async (m) => {
        if (m.callId !== id) return;
        const pid = m.from, d = m.data || {};
        let pc = pcs.current.get(pid);
        try {
          if (d.sdp?.type === 'offer') {
            if (pc) { pc.close(); pcs.current.delete(pid); }
            pc = makePc(pid);
            await pc.setRemoteDescription(d.sdp); await flush(pid, pc);
            await pc.setLocalDescription(await pc.createAnswer());
            send({ t: 'signal', callId: id, to: pid, data: { sdp: pc.localDescription } });
          } else if (d.sdp?.type === 'answer' && pc) {
            await pc.setRemoteDescription(d.sdp); await flush(pid, pc);
          } else if (d.candidate) {
            if (pc?.remoteDescription) await pc.addIceCandidate(d.candidate);
            else queued.current.set(pid, [...(queued.current.get(pid) ?? []), d.candidate]);
          }
        } catch { /* négociation échouée : le participant sera retiré par l'état de connexion */ }
      }),
      on('call:left', (m) => { if (m.callId === id) closePeer(m.peerId); }),
      on('call:ended', (m) => { if (m.callId === id) { stopAll(); setPhase('ended'); setNotice("L'organisateur a terminé l'appel."); } }),
      on('call:full', (m) => { setPhase('lobby'); setNotice(`L'appel est complet (${m.max} participants maximum).`); }),
      on('call:denied', (m) => { setPhase('lobby'); setNotice(DENIED[m.reason] || 'Impossible de rejoindre cet appel.'); if (m.reason === 'ended') setPhase('ended'); }),
      on('call:replaced', () => { stopAll(); setPhase('ended'); setNotice('Tu as rejoint cet appel depuis un autre appareil.'); }),
      on('close', () => { if (joined.current) setNotice('Connexion perdue. Quitte l’appel et rejoins-le de nouveau.'); }),
    ];
    return () => offs.forEach((o) => o());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, makePc, closePeer]);

  function stopAll() {
    pcs.current.forEach((pc) => pc.close()); pcs.current.clear(); queued.current.clear();
    local.current?.getTracks().forEach((t) => t.stop()); local.current = null; joined.current = false;
    setPeers({}); setLocalStream(null);
  }
  useEffect(() => () => { if (joined.current) send({ t: 'call:leave' }); stopAll(); }, []);                 // quitter la page = quitter l'appel

  const join = () => {
    if (!isOpen()) { setNotice('Connexion au serveur en cours… réessaie dans un instant.'); return; }
    setNotice(''); setPhase('joining');
    send({ t: 'call:join', callId: id });
  };
  const leave = () => { send({ t: 'call:leave' }); stopAll(); nav(info?.conversationId ? `/social/chat/${info.conversationId}` : '/social', { replace: true }); };
  const endForAll = async () => { if (!window.confirm('Terminer l’appel pour tout le monde ?')) return; try { await api.social.endCall(id); } catch (e) { notify(e.message); } };
  const toggleMic = () => { const on_ = !mic; local.current?.getAudioTracks().forEach((t) => { t.enabled = on_; }); setMic(on_); };
  const toggleCam = () => { const on_ = !cam; local.current?.getVideoTracks().forEach((t) => { t.enabled = on_; }); setCam(on_); };

  if (missing) return <Navigate to="/social" replace />;
  if (error) return <section className="call-page"><div className="state-box center" role="alert"><b>Impossible de charger l'appel</b><p>{error}</p><button className="btn" onClick={loadInfo}>Réessayer</button></div></section>;
  if (!info) return <section className="call-page" aria-busy="true" aria-label="Chargement"><div className="skeleton" style={{ height: 240, borderRadius: 26 }} /></section>;

  const list = Object.values(peers);
  const secure = window.isSecureContext && !!navigator.mediaDevices;
  return (
    <section className="call-page">
      <header className="call-h">
        <div><b>{info.title}</b><small>{info.kind === 'live' ? 'Live' : 'Appel vidéo'} · organisé par {info.host?.name}</small></div>
        {phase === 'live' && <span className="gps good">{list.length + 1} {list.length === 0 ? 'participant' : 'participants'}</span>}
      </header>

      {phase === 'ended' && (
        <div className="state-box center"><b>Appel terminé</b><p>{notice || 'Cet appel est terminé.'}</p><button className="btn" onClick={() => nav(info.conversationId ? `/social/chat/${info.conversationId}` : '/social', { replace: true })}>Retour à la conversation</button></div>
      )}

      {info.state === 'scheduled' && phase !== 'ended' && (
        <div className="state-box center"><b>Ce live n'a pas encore commencé</b><p>Prévu le {new Date(info.startsAt).toLocaleString('fr', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}. Tu pourras le rejoindre 10 minutes avant.</p><button className="btn ghost" onClick={() => nav(-1)}>Retour</button></div>
      )}

      {info.state === 'live' && (phase === 'lobby' || phase === 'joining') && (
        <div className="lobby">
          <Tile stream={localStream} name="Toi" avatar={null} muted off={!cam || media !== 'full'} mirror />
          {!secure && <div className="form-err" role="alert">La caméra et le micro exigent une connexion sécurisée (HTTPS) ou localhost.</div>}
          {media === 'none' && secure && <div className="form-err" role="alert">Caméra et micro indisponibles ou refusés : tu pourras voir et entendre les autres, mais pas être vu.</div>}
          {media === 'audio' && <p className="muted" style={{ textAlign: 'center' }}>Caméra indisponible : tu rejoins avec le micro seulement.</p>}
          {notice && <div className="form-err" role="alert">{notice}</div>}
          <div className="call-ctrl">
            <button className={'cbtn' + (mic ? '' : ' off')} onClick={toggleMic} disabled={media === 'none'} aria-label={mic ? 'Couper le micro' : 'Activer le micro'}><Icon n="mic" /></button>
            <button className={'cbtn' + (cam ? '' : ' off')} onClick={toggleCam} disabled={media !== 'full'} aria-label={cam ? 'Couper la caméra' : 'Activer la caméra'}><Icon n="video" /></button>
          </div>
          <button className="btn" onClick={join} disabled={phase === 'joining' || media === 'pending'}>{phase === 'joining' ? 'Connexion…' : 'Rejoindre'}</button>
          <button className="link-btn" onClick={() => nav(-1)}>Annuler</button>
        </div>
      )}

      {phase === 'live' && (
        <>
          {notice && <div className="form-err" role="alert">{notice}</div>}
          <div className={'grid-call n' + (list.length + 1)}>
            <Tile stream={localStream} name="Toi" avatar={null} muted off={!cam || media !== 'full'} mirror />
            {list.map((p) => <Tile key={p.card.id} stream={p.stream} name={p.card.name} avatar={p.card.avatar} />)}
          </div>
          <div className="call-ctrl">
            <button className={'cbtn' + (mic ? '' : ' off')} onClick={toggleMic} disabled={media === 'none'} aria-label={mic ? 'Couper le micro' : 'Activer le micro'}><Icon n="mic" /></button>
            <button className={'cbtn' + (cam ? '' : ' off')} onClick={toggleCam} disabled={media !== 'full'} aria-label={cam ? 'Couper la caméra' : 'Activer la caméra'}><Icon n="video" /></button>
            <button className="cbtn hang" onClick={leave} aria-label="Quitter l'appel"><Icon n="hangup" /></button>
          </div>
          {info.canEnd && <button className="link-btn" onClick={endForAll}>Terminer pour tout le monde</button>}
        </>
      )}
    </section>
  );
}
