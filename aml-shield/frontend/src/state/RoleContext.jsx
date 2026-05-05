import { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../api/client.js';

const RoleContext = createContext(null);

const USER_KEY = 'aml_shield_user';
const LEGACY_ANALYST_KEY = 'aml_active_analyst';

function readUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_e) {
    return null;
  }
}

function roleFromPathname(pathname) {
  if (pathname.startsWith('/employee')) return 'employee';
  return 'manager';
}

export function RoleProvider({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const role = roleFromPathname(location.pathname);

  // The logged-in user is the source of truth — driven by Login + Topbar sign-out.
  const [currentUser, setCurrentUser] = useState(() => readUser());
  const [analysts, setAnalysts] = useState([]);            // string[] of names
  const [analystProfiles, setAnalystProfiles] = useState({}); // { [name]: { role, team, level } }

  // Keep state in sync with localStorage when login/logout happens or
  // when another tab updates it.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === USER_KEY) setCurrentUser(readUser());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Re-read user on every navigation (covers login → manager/employee transitions
  // and sign-out → /login transitions in this same tab).
  useEffect(() => {
    setCurrentUser(readUser());
  }, [location.pathname]);

  // Pull analyst profiles list (for L1/L2 levels and team labels — used by
  // the sidebar/topbar/UI bits that haven't moved to the per-user model yet).
  useEffect(() => {
    api.get('/users')
      .then((r) => {
        const profiles = {};
        const names = [];
        for (const u of r.data || []) {
          if (!u.role) continue;
          const isAnalyst = /AML\s+Analyst/i.test(u.role) || /^analyst_(l1|l2)$/i.test(u.role);
          if (!isAnalyst) continue;
          const level = /L2|_l2/i.test(u.role) ? 'L2' : 'L1';
          profiles[u.name] = { role: u.role, team: u.team, level };
          names.push(u.name);
        }
        names.sort();
        setAnalystProfiles(profiles);
        setAnalysts(names);
      })
      .catch(() => {});
  }, []);

  const setRole = useCallback((next) => {
    if (next === 'manager') navigate('/manager/dashboard');
    else if (next === 'employee') navigate('/employee/dashboard');
  }, [navigate]);

  // The logged-in analyst's name drives all employee-scoped queries.
  const currentAnalyst = currentUser?.name || null;
  const currentAnalystLevel = currentAnalyst && analystProfiles[currentAnalyst]?.level;
  const isL2 = currentAnalystLevel === 'L2';
  const isL1 = currentAnalystLevel === 'L1';

  // Kept as a no-op so legacy callers from before the login system don't
  // explode. The active analyst is now driven by which user is logged in.
  const setCurrentAnalyst = useCallback(() => {}, []);

  const signOut = useCallback(() => {
    try { localStorage.removeItem(USER_KEY); } catch (_e) { /* ignore */ }
    try { localStorage.removeItem(LEGACY_ANALYST_KEY); } catch (_e) { /* ignore */ }
    setCurrentUser(null);
    navigate('/login', { replace: true });
  }, [navigate]);

  const value = useMemo(
    () => ({
      role,
      setRole,
      currentUser,
      currentAnalyst,
      setCurrentAnalyst,
      signOut,
      analysts,
      analystProfiles,
      currentAnalystLevel,
      isL1,
      isL2,
      isManager: role === 'manager',
      isEmployee: role === 'employee',
      scopeParam: role === 'employee' && currentAnalyst ? { assigned_to: currentAnalyst } : {}
    }),
    [role, setRole, currentUser, currentAnalyst, setCurrentAnalyst, signOut,
     analysts, analystProfiles, currentAnalystLevel, isL1, isL2]
  );

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole() {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error('useRole must be used inside RoleProvider');
  return ctx;
}
