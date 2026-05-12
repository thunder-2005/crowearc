import { Navigate } from 'react-router-dom';

const USER_KEY = 'aml_shield_user';

function readUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_e) {
    return null;
  }
}

function landingFor(role) {
  if (role === 'compliance_manager' || role === 'bsa_officer') return '/manager/dashboard';
  return '/employee/dashboard';
}

/**
 * Wrap a route element. If no user is logged in → redirect to /login.
 * If a user IS logged in but their role is not in `allowedRoles` →
 * redirect them to the dashboard that matches their role.
 */
export default function ProtectedRoute({ allowedRoles, children }) {
  const user = readUser();
  if (!user) return <Navigate to="/login" replace />;

  if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
    return <Navigate to={landingFor(user.role)} replace />;
  }
  return children;
}

// Helper used by `/` to send a returning user straight to the right place.
export function RootRedirect() {
  const user = readUser();
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={landingFor(user.role)} replace />;
}
