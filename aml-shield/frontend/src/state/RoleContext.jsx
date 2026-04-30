import { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../api/client.js';

const RoleContext = createContext(null);

const ANALYST_KEY = 'aml_active_analyst';

function roleFromPathname(pathname) {
  if (pathname.startsWith('/employee')) return 'employee';
  return 'manager';
}

export function RoleProvider({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const role = roleFromPathname(location.pathname);

  const [currentAnalyst, setCurrentAnalystState] = useState(() => {
    try { return localStorage.getItem(ANALYST_KEY) || null; } catch (_e) { return null; }
  });
  const [analysts, setAnalysts] = useState([]);          // string[] (names)
  const [analystProfiles, setAnalystProfiles] = useState({}); // { [name]: { role, team, level } }

  // Pull analyst profiles once at mount — gives us the L1/L2 level too
  useEffect(() => {
    api.get('/users')
      .then(r => {
        const profiles = {};
        const names = [];
        for (const u of r.data || []) {
          if (!u.role) continue;
          // Match both legacy display strings ("AML Analyst L1") and the new
          // canonical role codes ("analyst_l1" / "analyst_l2").
          const isAnalyst = /AML\s+Analyst/i.test(u.role) || /^analyst_(l1|l2)$/i.test(u.role);
          if (!isAnalyst) continue;
          const level = /L2|_l2/i.test(u.role) ? 'L2' : 'L1';
          profiles[u.name] = { role: u.role, team: u.team, level };
          names.push(u.name);
        }
        names.sort();
        setAnalystProfiles(profiles);
        setAnalysts(names);
        setCurrentAnalystState(prev => {
          if (prev && names.includes(prev)) return prev;
          const next = names[0] || null;
          if (next) try { localStorage.setItem(ANALYST_KEY, next); } catch (_e) { /* ignore */ }
          return next;
        });
      })
      .catch(() => {});
  }, []);

  const setCurrentAnalyst = useCallback((name) => {
    setCurrentAnalystState(name);
    try {
      if (name) localStorage.setItem(ANALYST_KEY, name);
      else      localStorage.removeItem(ANALYST_KEY);
    } catch (_e) { /* ignore */ }
  }, []);

  // Replaced toggle. Calling setRole now navigates to the matching URL prefix.
  const setRole = useCallback((next) => {
    if (next === 'manager') navigate('/manager/dashboard');
    else if (next === 'employee') navigate('/employee/dashboard');
  }, [navigate]);

  const currentAnalystLevel = currentAnalyst && analystProfiles[currentAnalyst]?.level;
  const isL2 = currentAnalystLevel === 'L2';
  const isL1 = currentAnalystLevel === 'L1';

  const value = useMemo(() => ({
    role,
    setRole,
    currentAnalyst,
    setCurrentAnalyst,
    analysts,
    analystProfiles,
    currentAnalystLevel,
    isL1, isL2,
    isManager: role === 'manager',
    isEmployee: role === 'employee',
    scopeParam: role === 'employee' && currentAnalyst ? { assigned_to: currentAnalyst } : {},
  }), [role, setRole, currentAnalyst, setCurrentAnalyst, analysts, analystProfiles, currentAnalystLevel]);

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole() {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error('useRole must be used inside RoleProvider');
  return ctx;
}
