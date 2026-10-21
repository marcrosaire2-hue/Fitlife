import { useEffect } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { THEMES } from './data';
import { useStore } from './store';
import { useAuth } from './auth';
import Icon from './components/Icon';
import { Goals } from './pages/Onboarding';
import Welcome from './pages/Welcome';
import RequireAuth from './components/RequireAuth';
import Home from './pages/Home';
import { CourseDetail, Courses } from './pages/Courses';
import { Workout } from './pages/Workout';
import { Session, Summary } from './pages/Session';
import { TrainerProfile, Trainers } from './pages/Trainers';
import { Favorites, Profile } from './pages/Account';

const NAV = [
  ['/home', 'home', 'Home'], ['/courses', 'book', 'Courses'], ['/trainers', 'users', 'Trainers'],
  ['/favorites', 'heart', 'Favourites'], ['/profile', 'user', 'Profile'],
];
const BARE = ['/welcome', '/goals', '/session', '/summary'];

function Nav({ side }) {
  return (
    <nav className={side ? 'side' : 'tabbar'} aria-label="Main">
      {side && <div className="logo">Fit<span>Life</span></div>}
      {NAV.map(([to, ic, label]) => (
        <NavLink key={to} to={to} className={({ isActive }) => 'tab' + (isActive ? ' on' : '')} aria-label={label}>
          <Icon n={ic} />{side && <span>{label}</span>}
        </NavLink>
      ))}
    </nav>
  );
}

export default function App() {
  const { state, toast } = useStore();
  const { user, loading: authLoading } = useAuth();
  const { pathname } = useLocation();
  const bare = BARE.some((p) => pathname.startsWith(p));

  useEffect(() => { document.documentElement.style.setProperty('--lime', THEMES[user?.theme || state.theme] || THEMES.lime); }, [user?.theme, state.theme]);
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

  return (
    <div className={'app' + (bare ? ' bare' : '')}>
      {!bare && <Nav side />}
      <main className="main" key={pathname}>
        <Routes>
          <Route path="/" element={authLoading ? null : <Navigate to={user ? (user.onboarded ? '/home' : '/goals') : '/welcome'} replace />} />
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/goals" element={<Goals />} />
          <Route path="/home" element={<Home />} />
          <Route path="/courses" element={<RequireAuth><Courses /></RequireAuth>} />
          <Route path="/courses/:id" element={<RequireAuth><CourseDetail /></RequireAuth>} />
          <Route path="/workout/:id" element={<RequireAuth><Workout /></RequireAuth>} />
          <Route path="/session/:id" element={<RequireAuth><Session /></RequireAuth>} />
          <Route path="/summary/:id" element={<RequireAuth><Summary /></RequireAuth>} />
          <Route path="/trainers" element={<Trainers />} />
          <Route path="/trainers/:id" element={<TrainerProfile />} />
          <Route path="/favorites" element={<RequireAuth><Favorites /></RequireAuth>} />
          <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {!bare && <Nav />}
      <div className={'toast' + (toast ? ' show' : '')} role="status">{toast}</div>
    </div>
  );
}
