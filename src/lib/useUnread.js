import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { on } from './realtime';

/* Nombre de conversations avec des messages non lus (pastille de l'onglet Social), tenu à jour par le WebSocket */
export default function useUnread(enabled) {
  const [n, setN] = useState(0);
  const refresh = useCallback(() => { api.social.conversations().then((d) => setN(d.unread)).catch(() => {}); }, []);
  useEffect(() => {
    if (!enabled) { setN(0); return undefined; }
    refresh();
    const offs = [on('message', refresh), on('social', refresh), on('open', refresh)];
    window.addEventListener('fitlife:read', refresh);
    return () => { offs.forEach((o) => o()); window.removeEventListener('fitlife:read', refresh); };
  }, [enabled, refresh]);
  return n;
}
