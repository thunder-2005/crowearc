import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const InvestigationTabsContext = createContext(null);
const STORAGE_KEY = 'amlShield.investigationTabs.v1';

export function InvestigationTabsProvider({ children }) {
  const [tabs, setTabs] = useState([]);
  const [activeId, setActiveId] = useState(null);
  // Monotonically-increasing counter that any consumer can depend on to
  // trigger a refetch. Bumped by callers that know an alert just changed
  // state out of band (disposition submitted, escalation completed, etc.)
  // so downstream surfaces like the NextUpFloat don't have to wait for
  // their next polling tick to drop the now-actionless alert.
  const [alertsRefreshNonce, setAlertsRefreshNonce] = useState(0);
  const signalAlertsChanged = () => setAlertsRefreshNonce(n => n + 1);

  // Customer ids the current analyst has personally dispositioned in this
  // browser session. Consumed by getNextUpAlert to suppress same-customer
  // re-surfacing — once I close one Meridian Global alert, the Next Priority
  // float won't immediately promote a sibling Meridian Global alert on the
  // same customer ("wait, didn't I just close that?"). The customer's
  // remaining alerts stay in My Alerts and still require disposition under
  // BSA; they just stop competing for the float / banner. Refresh clears
  // the set — intentional, so a fresh page load gets a fresh view.
  const [sessionResolvedCustomerIds, setSessionResolvedCustomerIds] = useState(() => new Set());
  const markCustomerResolved = (customerId) => {
    if (!customerId) return;
    setSessionResolvedCustomerIds(prev => {
      if (prev.has(customerId)) return prev;
      const next = new Set(prev);
      next.add(customerId);
      return next;
    });
  };

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

  const tabKey = (level, id) => `${level}:${id}`;

  const openTab = (alert, opts = {}) => {
    const level = opts.level || 'L1';
    // Tab key precedence: QC reviews are keyed by qc_id (so re-opening from
    // the QC list doesn't collide with an L1 tab on the same alert).
    const id = opts.qc_id || opts.l2_case_id || alert.alert_id;
    const key = tabKey(level, id);
    setTabs(prev => {
      if (prev.some(t => t.key === key)) return prev;
      return [...prev, {
        key,
        level,
        alert_id: alert.alert_id,
        l2_case_id: opts.l2_case_id || null,
        qc_id:      opts.qc_id || null,
        customer_id: alert.customer_id,
        customer_name: alert.customer_name,
        scenario: alert.scenario,
        priority: alert.priority
      }];
    });
    setActiveId(key);
  };

  const closeTab = (key) => {
    setTabs(prev => {
      const next = prev.filter(t => t.key !== key);
      if (activeId === key) {
        setActiveId(next.length ? next[next.length - 1].key : null);
      }
      return next;
    });
  };

  const value = useMemo(() => ({
    tabs,
    activeId,
    setActiveId,
    openTab,
    closeTab,
    alertsRefreshNonce,
    signalAlertsChanged,
    sessionResolvedCustomerIds,
    markCustomerResolved
  }), [tabs, activeId, alertsRefreshNonce, sessionResolvedCustomerIds]);

  return <InvestigationTabsContext.Provider value={value}>{children}</InvestigationTabsContext.Provider>;
}

export function useInvestigationTabs() {
  const ctx = useContext(InvestigationTabsContext);
  if (!ctx) throw new Error('useInvestigationTabs must be used inside InvestigationTabsProvider');
  return ctx;
}
