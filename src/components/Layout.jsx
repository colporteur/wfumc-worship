import { Outlet, Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { ROLE_LABELS } from '../lib/permissions';
import VersionStamp from './VersionStamp.jsx';
import ScrollRestoration from './ScrollRestoration.jsx';

const NAV_ITEMS = [
  { to: '/', label: 'Forecast', end: true },
  { to: '/themes', label: 'Themes' },
  { to: '/library', label: 'Library' },
  { to: '/suggestions', label: 'Suggestions' },
  { to: '/admin-items', label: 'Admin items' },
];

export default function Layout() {
  const { profile, signOut, session } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <ScrollRestoration />
      <header className="bg-umc-900 text-white px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <Link to="/" className="font-serif text-lg leading-tight">
            WFUMC Worship Planning
          </Link>
          {session && (
            <div className="flex items-center gap-3 sm:gap-4 text-sm">
              <span className="text-umc-100 hidden sm:inline">
                {profile?.full_name}{' '}
                {profile?.role && (
                  <span className="text-umc-200">
                    ({ROLE_LABELS[profile.role] || profile.role})
                  </span>
                )}
              </span>
              <button
                onClick={handleSignOut}
                className="text-umc-100 hover:text-white underline"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
        {session && (
          <nav className="max-w-5xl mx-auto mt-2 flex gap-3 text-sm">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `pb-1 border-b-2 transition-colors ${
                    isActive
                      ? 'border-white text-white'
                      : 'border-transparent text-umc-100 hover:text-white'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6">
        <Outlet />
        <VersionStamp />
      </main>
    </div>
  );
}
