import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api';

const Ctx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api.me().then((d) => alive && setUser(d.user)).catch(() => {}).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  const register = useCallback(async (b) => { const d = await api.register(b); setUser(d.user); return d.user; }, []);
  const login = useCallback(async (b) => { const d = await api.login(b); setUser(d.user); return d.user; }, []);
  const logout = useCallback(async () => { try { await api.logout(); } finally { setUser(null); } }, []);

  const value = useMemo(() => ({ user, loading, register, login, logout, setUser }), [user, loading, register, login, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);
