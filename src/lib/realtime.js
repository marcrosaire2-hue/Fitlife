/* Connexion temps réel (WebSocket /ws) : messages instantanés et signalisation des appels vidéo.
   Une seule connexion pour toute l'application, avec reconnexion automatique tant que l'utilisateur est connecté. */
let ws = null, wanted = false, retry = 0, timer = null, pinger = null;
const handlers = new Map();   // type -> Set<fn>

const emit = (type, payload) => { for (const fn of handlers.get(type) ?? []) { try { fn(payload); } catch { /* un écouteur fautif ne bloque pas les autres */ } } };

function open() {
  if (ws && ws.readyState <= 1) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => { retry = 0; emit('open', {}); clearInterval(pinger); pinger = setInterval(() => send({ t: 'ping' }), 25000); };
  ws.onmessage = (e) => { try { const m = JSON.parse(e.data); emit(m.t, m); } catch { /* message illisible ignoré */ } };
  ws.onclose = () => {
    clearInterval(pinger); emit('close', {});
    if (wanted) { clearTimeout(timer); timer = setTimeout(open, Math.min(15000, 1000 * 2 ** retry++)); }
  };
}

export function connect() { wanted = true; open(); }
export function disconnect() { wanted = false; clearTimeout(timer); clearInterval(pinger); ws?.close(); ws = null; }
export const isOpen = () => ws?.readyState === 1;
export function send(obj) { if (ws?.readyState === 1) { ws.send(JSON.stringify(obj)); return true; } return false; }
/** S'abonne à un type d'événement ; retourne la fonction de désabonnement. */
export function on(type, fn) {
  if (!handlers.has(type)) handlers.set(type, new Set());
  handlers.get(type).add(fn);
  return () => handlers.get(type)?.delete(fn);
}
