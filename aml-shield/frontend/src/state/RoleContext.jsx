import { createContext, useContext, useEffect, useState, useMemo } from 'react';
import api from '../api/client.js';

const RoleContext = createContext(null);

const STORAGE_KEY = 'amlShield.roleState.v1';

export function RoleProvider({ children }) {
  const [role, setRole] = useState('manager');
  const [currentAnalyst, setCurrentAnalyst] = useState(null);
  const [analysts, setAnalysts] = useState([]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved) {
        if (saved.role) setRole(saved.role);
        if (saved.currentAnalyst) setCurrentAnalyst(saved.currentAnalyst);
      }
    } catch (_e) { /* ignore */ }
  }, []);

  useEffect(() => {
    api.get('/alerts/analysts')
      .then(r => {
        const names = r.data.map(a => a.analyst);
        setAnalysts(names);
        setCurrentAnalyst(prev => prev && names.includes(prev) ? prev : names[0] || null);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ role, currentAnalyst }));
  }, [role, currentAnalyst]);

  const value = useMemo(() => ({
    role,
    setRole,
    currentAnalyst,
    setCurrentAnalyst,
    analysts,
    isManager: role === 'manager',
    isEmployee: role === 'employee',
    scopeParam: role === 'employee' && currentAnalyst ? { assigned_to: currentAnalyst } : {},
  }), [role, currentAnalyst, analysts]);

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole() {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error('useRole must be used inside RoleProvider');
  return ctx;
}
