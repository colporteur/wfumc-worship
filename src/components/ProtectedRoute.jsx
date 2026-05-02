import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import LoadingSpinner from './LoadingSpinner.jsx';
import { canUseWorshipApp, ROLE_LABELS } from '../lib/permissions';

// App is gated to: pastor, office_admin, music_director, worship_team.
// Other staff roles (treasurer, social_media, pianist, staff) get a
// friendly "no access" message — they have other places to work.
export default function ProtectedRoute({ children }) {
  const { loading, session, profile, signOut } = useAuth();
  const location = useLocation();

  if (loading) {
    return <LoadingSpinner label="Checking access…" />;
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!profile) {
    return <LoadingSpinner label="Loading your profile…" />;
  }

  if (!canUseWorshipApp(profile.role)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-gray-50">
        <div className="card max-w-md w-full text-center space-y-3">
          <h1 className="font-serif text-2xl text-umc-900">
            No access to Worship Planning
          </h1>
          <p className="text-sm text-gray-600">
            You're signed in as <strong>{profile.full_name}</strong>{' '}
            (<span className="text-gray-500">{ROLE_LABELS[profile.role] || profile.role}</span>).
            This app is for the worship team, music director, office admin,
            and pastor.
          </p>
          <p className="text-xs text-gray-500">
            If you should have access, ask Pastor Todd to update your role.
          </p>
          <button
            type="button"
            onClick={async () => {
              await signOut();
            }}
            className="btn-secondary text-sm"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return children;
}
