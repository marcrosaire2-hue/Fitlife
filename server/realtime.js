// Temps réel : WebSocket (/ws) pour les messages instantanés et la signalisation des appels vidéo de groupe (WebRTC maillé).
// Les flux audio/vidéo ne passent pas par ce serveur : il ne relaie que les messages de négociation (SDP / ICE).
import { WebSocketServer } from 'ws';

export const MAX_ROOM = 6;       // participants maximum par appel (maillage : chaque participant envoie son flux à tous les autres)

export function createRealtime({ authenticate, canJoinCall, cards, allowedOrigins = [] }) {
  const conns = new Map();       // userId -> Set<ws>
  const rooms = new Map();       // callId -> Map<userId, ws>
  const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };

  const emitToUsers = (ids, payload) => {
    for (const id of ids) for (const ws of conns.get(String(id)) ?? []) send(ws, payload);
  };
  const roomUsers = (callId) => [...(rooms.get(String(callId))?.keys() ?? [])];
  const online = (userId) => (conns.get(String(userId))?.size ?? 0) > 0;

  function leaveRoom(ws) {
    const callId = ws.room;
    if (!callId) return;
    ws.room = null;
    const room = rooms.get(callId);
    if (room?.get(ws.uid) !== ws) return;
    room.delete(ws.uid);
    for (const w of room.values()) send(w, { t: 'call:left', callId, peerId: ws.uid });
    if (!room.size) rooms.delete(callId);
  }
  function endRoom(callId) {
    const room = rooms.get(String(callId));
    if (!room) return;
    for (const w of room.values()) { send(w, { t: 'call:ended', callId: String(callId) }); w.room = null; }
    rooms.delete(String(callId));
  }

  async function onMessage(ws, raw) {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;

    // anti-abus : 300 messages de contrôle / 10 s au maximum
    const now = Date.now();
    if (now - ws.win > 10000) { ws.win = now; ws.count = 0; }
    if (++ws.count > 300) return ws.close(1008, 'rate');

    if (m.t === 'ping') return send(ws, { t: 'pong' });

    if (m.t === 'call:join') {
      const callId = String(m.callId ?? '');
      const ok = await canJoinCall(ws.uid, callId);
      if (!ok?.ok) return send(ws, { t: 'call:denied', callId, reason: ok?.reason || 'denied' });
      leaveRoom(ws);
      let room = rooms.get(callId);
      if (!room) { room = new Map(); rooms.set(callId, room); }
      const previous = room.get(ws.uid);
      if (!previous && room.size >= MAX_ROOM) return send(ws, { t: 'call:full', callId, max: MAX_ROOM });
      if (previous && previous !== ws) { send(previous, { t: 'call:replaced', callId }); previous.room = null; room.delete(ws.uid); }
      const peerIds = [...room.keys()];
      const peerCards = await cards([...peerIds, ws.uid]);
      send(ws, { t: 'call:peers', callId, me: ws.uid, peers: peerIds.map((id) => peerCards.get(id)).filter(Boolean) });
      room.set(ws.uid, ws); ws.room = callId;
      for (const w of room.values()) if (w !== ws) send(w, { t: 'call:joined', callId, peer: peerCards.get(ws.uid) });
      return undefined;
    }
    if (m.t === 'call:leave') return leaveRoom(ws);

    if (m.t === 'signal') {
      const callId = String(m.callId ?? '');
      if (ws.room !== callId) return undefined;
      const target = rooms.get(callId)?.get(String(m.to ?? ''));
      if (!target) return undefined;
      send(target, { t: 'signal', callId, from: ws.uid, data: m.data });
    }
    return undefined;
  }

  function attach(server) {
    const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
    server.on('upgrade', async (req, socket, head) => {
      if (!String(req.url).startsWith('/ws')) return;                      // laisse passer les autres usages (aucun pour l'instant)
      const reject = (code) => { socket.write(`HTTP/1.1 ${code}\r\nConnection: close\r\n\r\n`); socket.destroy(); };
      try {
        // le cookie de session part automatiquement : on n'accepte que les pages de notre propre site (anti « cross-site WebSocket hijacking »)
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host && !allowedOrigins.includes(origin)) return reject('403 Forbidden');
        const user = await authenticate(req);
        if (!user) return reject('401 Unauthorized');
        wss.handleUpgrade(req, socket, head, (ws) => {
          ws.uid = String(user._id); ws.room = null; ws.win = Date.now(); ws.count = 0; ws.alive = true;
          if (!conns.has(ws.uid)) conns.set(ws.uid, new Set());
          conns.get(ws.uid).add(ws);
          ws.on('pong', () => { ws.alive = true; });
          ws.on('message', (d) => { onMessage(ws, d.toString()).catch(() => {}); });
          ws.on('close', () => { leaveRoom(ws); conns.get(ws.uid)?.delete(ws); if (!conns.get(ws.uid)?.size) conns.delete(ws.uid); });
          ws.on('error', () => {});
          send(ws, { t: 'ready', me: ws.uid });
        });
      } catch { reject('400 Bad Request'); }
    });
    // connexions mortes : ping toutes les 30 s
    setInterval(() => {
      for (const set of conns.values()) for (const ws of set) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; ws.ping(); }
    }, 30000).unref();
  }

  return { attach, emitToUsers, roomUsers, endRoom, online };
}
