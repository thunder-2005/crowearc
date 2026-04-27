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
  const [analysts, setAnalysts] = useState([]);

  // Pull analyst names once at mount
  useEffect(() => {
    api.get('/alerts/analysts')
      .then(r => {
        const names = r.data.map(a => a.analyst);
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

  const value = useMemo(() => ({
    role,
    setRole,
    currentAnalyst,
    setCurrentAnalyst,
    analysts,
    isManager: role === 'manager',
    isEmployee: role === 'employee',
    scopeParam: role === 'employee' && currentAnalyst ? { assigned_to: currentAnalyst } : {},
  }), [role, setRole, currentAnalyst, setCurrentAnalyst, analysts]);

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole() {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error('useRole must be used inside RoleProvider');
  return ctx;
}
