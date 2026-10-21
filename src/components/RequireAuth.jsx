import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { useStore } from '../store';

/* Réserve une page aux comptes connectés qui ont choisi leurs objectifs. */
export default function RequireAuth({ children, fallback = null }) {
  const { user, loading } = useAuth();
  if (loading) return fallback;
  if (!user) return <Navigate to="/welcome" replace />;
  if (!user.onboarded) return <Navigate to="/goals" replace />;
  return children;
}

/* Aligne les favoris locaux sur les marqueurs `fav` renvoyés par le serveur. */
export function useSyncFavs(workouts) {
  const { dispatch } = useStore();
  useEffect(() => {
    if (!workouts?.length) return;
    dispatch({ type: 'syncFavs', on: workouts.filter((w) => w.fav).map((w) => w.id), off: workouts.filter((w) => !w.fav).map((w) => w.id) });
  }, [workouts, dispatch]);
}
