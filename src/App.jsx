import { useEffect } from 'react';
import { connect, disconnect } from './lib/realtime';
import useUnread from './lib/useUnread';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { THEMES } from './data';
import { useStore } from './store';
import { useAuth } from './auth';
import Icon from './components/Icon';
import { Goals } from './pages/Onboarding';
import Welcome from './pages/Welcome';
import RequireAuth, { RequireAdmin } from './components/RequireAuth';
import Home from './pages/Home';
import { CourseDetail, Courses } from './pages/Courses';
import { Workout } from './pages/Workout';
import { Session, Summary } from './pages/Session';
import { TrainerProfile, Trainers } from './pages/Trainers';
import { Favorites, Profile } from './pages/Account';
import { Activity, ActivityDetail, ActivityLive } from './pages/Activity';
import { Community } from './pages/Community';
import Photo from './pages/Photo';
import History from './pages/History';
import Chat from './pages/Chat';
import Call from './pages/Call';
import CommunityPage, { CommunityNew } from './pages/CommunityPage';
import { NewGroup, SocialCommunities, SocialMessages, SocialPeople } from './pages/Social';
import { EventDetail, Events } from './pages/Events';
import { AdminActivity, AdminHome, AdminUserDetail, AdminUsers } from './pages/Admin';
import { AdminContent } from './pages/AdminContent';
import { AdminEvents } from './pages/AdminEvents';
import { ChallengeDetail, ChallengeNew, Challenges } from './pages/Challenges';

const NAV = [
  ['/home', 'home', 'Accueil'], ['/activity', 'route', 'Activité'], ['/social', 'chat', 'Social'], ['/courses', 'book', 'Cours'], ['/trainers', 'users', 'Coachs'],
  ['/favorites', 'heart', 'Favoris'], ['/profile', 'user', 'Profil'],
];
const BARE = ['/welcome', '/goals', '/photo', '/social/chat', '/social/call', '/session', '/summary', '/activity/live'];

function Nav({ unread }) {
  return (
    <nav className="tabbar" aria-label="Principal">
      {NAV.map(([to, ic, label]) => (
        <NavLink key={to} to={to} className={({ isActive }) => 'tab' + (isActive ? ' on' : '')} aria-label={label}>
          <Icon n={ic} />{ic === 'chat' && unread > 0 && <b className="badge" aria-label={`${unread} non lu${unread > 1 ? 's' : ''}`}>{unread > 9 ? '9+' : unread}</b>}
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
  const unread = useUnread(!!user?.onboarded);
  useEffect(() => { if (user) connect(); else disconnect(); }, [user?.id]);

  useEffect(() => { document.documentElement.style.setProperty('--lime', THEMES[user?.theme || state.theme] || THEMES.lime); }, [user?.theme, state.theme]);
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

  return (
    <div className={'app' + (bare ? ' bare' : '')}>
      <main className="main" key={pathname}>
        <Routes>
          <Route path="/" element={authLoading ? null : <Navigate to={user ? (user.onboarded ? '/home' : '/goals') : '/welcome'} replace />} />
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/goals" element={<Goals />} />
          <Route path="/photo" element={<Photo />} />
          <Route path="/home" element={<Home />} />
          <Route path="/courses" element={<RequireAuth><Courses /></RequireAuth>} />
          <Route path="/courses/:id" element={<RequireAuth><CourseDetail /></RequireAuth>} />
          <Route path="/workout/:id" element={<RequireAuth><Workout /></RequireAuth>} />
          <Route path="/session/:id" element={<RequireAuth><Session /></RequireAuth>} />
          <Route path="/summary/:id" element={<RequireAuth><Summary /></RequireAuth>} />
          <Route path="/history" element={<RequireAuth><History /></RequireAuth>} />
          <Route path="/social" element={<RequireAuth><SocialMessages /></RequireAuth>} />
          <Route path="/social/people" element={<RequireAuth><SocialPeople /></RequireAuth>} />
          <Route path="/social/communities" element={<RequireAuth><SocialCommunities /></RequireAuth>} />
          <Route path="/social/communities/new" element={<RequireAuth><CommunityNew /></RequireAuth>} />
          <Route path="/social/communities/:id" element={<RequireAuth><CommunityPage /></RequireAuth>} />
          <Route path="/social/new-group" element={<RequireAuth><NewGroup /></RequireAuth>} />
          <Route path="/social/chat/:id" element={<RequireAuth><Chat /></RequireAuth>} />
          <Route path="/social/call/:id" element={<RequireAuth><Call /></RequireAuth>} />
          <Route path="/activity" element={<RequireAuth><Activity /></RequireAuth>} />
          <Route path="/activity/events" element={<RequireAuth><Events /></RequireAuth>} />
          <Route path="/activity/events/:id" element={<RequireAuth><EventDetail /></RequireAuth>} />
          <Route path="/admin" element={<RequireAdmin><AdminHome /></RequireAdmin>} />
          <Route path="/admin/users" element={<RequireAdmin><AdminUsers /></RequireAdmin>} />
          <Route path="/admin/users/:id" element={<RequireAdmin><AdminUserDetail /></RequireAdmin>} />
          <Route path="/admin/activities/:id" element={<RequireAdmin><AdminActivity /></RequireAdmin>} />
          <Route path="/admin/content" element={<RequireAdmin><AdminContent /></RequireAdmin>} />
          <Route path="/admin/events" element={<RequireAdmin><AdminEvents /></RequireAdmin>} />
          <Route path="/activity/community" element={<RequireAuth><Community /></RequireAuth>} />
          <Route path="/activity/challenges" element={<RequireAuth><Challenges /></RequireAuth>} />
          <Route path="/activity/challenges/new" element={<RequireAuth><ChallengeNew /></RequireAuth>} />
          <Route path="/activity/challenges/:id" element={<RequireAuth><ChallengeDetail /></RequireAuth>} />
          <Route path="/activity/live/:type" element={<RequireAuth><ActivityLive /></RequireAuth>} />
          <Route path="/activity/:id" element={<RequireAuth><ActivityDetail /></RequireAuth>} />
          <Route path="/trainers" element={<RequireAuth><Trainers /></RequireAuth>} />
          <Route path="/trainers/:id" element={<RequireAuth><TrainerProfile /></RequireAuth>} />
          <Route path="/favorites" element={<RequireAuth><Favorites /></RequireAuth>} />
          <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {!bare && <Nav unread={unread} />}
      <div className={'toast' + (toast ? ' show' : '')} role="status">{toast}</div>
    </div>
  );
}
