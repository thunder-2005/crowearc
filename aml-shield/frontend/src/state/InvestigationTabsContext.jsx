import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const InvestigationTabsContext = createContext(null);
const STORAGE_KEY = 'amlShield.investigationTabs.v1';

export function InvestigationTabsProvider({ children }) {
  const [tabs, setTabs] = useState([]);
  const [activeId, setActiveId] = useState(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
      if (saved) {
        setTabs(saved.tabs || []);
        setActiveId(saved.activeId || null);
      }
    } catch (_e) { /* ignore */ }
  }, []);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs, activeId }));
  }, [tabs, activeId]);

  const openTab = (alert) => {
    setTabs(prev => {
      if (prev.some(t => t.alert_id === alert.alert_id)) return prev;
      return [...prev, {
        alert_id: alert.alert_id,
        customer_id: alert.customer_id,
        customer_name: alert.customer_name,
        scenario: alert.scenario,
        priority: alert.priority
      }];
    });
    setActiveId(alert.alert_id);
  };

  const closeTab = (alertId) => {
    setTabs(prev => {
      const next = prev.filter(t => t.alert_id !== alertId);
      if (activeId === alertId) {
        setActiveId(next.length ? next[next.length - 1].alert_id : null);
      }
      return next;
    });
  };

  const value = useMemo(() => ({
    tabs,
    activeId,
    setActiveId,
    openTab,
    closeTab
  }), [tabs, activeId]);

  return <InvestigationTabsContext.Provider value={value}>{children}</InvestigationTabsContext.Provider>;
}

export function useInvestigationTabs() {
  const ctx = useContext(InvestigationTabsContext);
  if (!ctx) throw new Error('useInvestigationTabs must be used inside InvestigationTabsProvider');
  return ctx;
}
