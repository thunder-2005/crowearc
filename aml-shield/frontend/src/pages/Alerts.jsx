import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import api from '../api/client.js';
import Badge from '../components/shared/Badge.jsx';
import { X, Clock, UserPlus, PlayCircle, AlertTriangle, ShieldCheck, ArrowUpRight, RotateCcw, FolderOpen, Zap, Search, CheckCircle2 } from 'lucide-react';
import { useRole } from '../state/RoleContext.jsx';
import { useInvestigationTabs } from '../state/InvestigationTabsContext.jsx';
import InvestigationWorkspace from '../components/investigation/InvestigationWorkspace.jsx';
import L2InvestigationWorkspace from '../components/investigation/L2InvestigationWorkspace.jsx';
import L2QueuePage from '../components/investigation/L2QueuePage.jsx';
import QcWorkspace from '../components/investigation/QcWorkspace.jsx';
import ManagerAlertsTable from '../components/alerts/ManagerAlertsTable.jsx';
import { isAlertClosed, slaSnapshot } from '../utils/alertStatus.js';
import { getNextUpAlert, hasSurfaceableAlert } from '../utils/alertScoring.js';
import OutcomeCard from '../components/shared/OutcomeCard.jsx';
import ReopenRequestModal from '../components/alerts/ReopenRequestModal.jsx';

// L1 analysts see only their own work — no Unassigned column (alerts the
// manager hasn't routed to anyone yet have no business showing up in an
// analyst's personal queue). Manager keeps the full taxonomy via the
// separate ManagerAlertsTable component.
const COLUMNS_FULL = ['Unassigned', 'Not Started', 'In Progress', 'Escalated', 'Completed'];
const COLUMNS_L1   = [              'Not Started', 'In Progress', 'Escalated', 'Completed'];
const COLUMN_ACCENT = {
  'Unassigned':       'border-t-slate-400',
  'Not Started':      'border-t-orange-400',
  'In Progress':      'border-t-blue-500',
  'Escalated':        'border-t-purple-500',
  'Completed':        'border-t-green-500'
};
const ESCALATED_STATUSES = new Set(['Escalated - L2', 'Escalated - SAR']);

// Which raw alert_status values belong in each Kanban column. Used by the
// sort/filter pipeline to re-group alerts after they've been sorted.
// 'Pending QC' lives in the Completed column visually — the L1 closed it,
// it just hasn't been finalized by L2 yet. A QC Pending badge on the card
// makes the state explicit.
const COLUMN_STATUSES = {
  'Unassigned':       ['Unassigned'],
  'Not Started':      ['Not Started'],
  'In Progress':      ['In Progress'],
  'Escalated':        ['Escalated - L2', 'Escalated - SAR'],
  'Completed':        ['Completed', 'Closed — False Positive', 'False Positive', 'Pending QC']
};

// (OPEN_STATUSES_FOR_NEXT_UP removed — the Next Up banner now uses
// the shared isActionable() / getNextUpAlert() from utils/alertScoring.js
// so the banner and the global NextUpFloat agree on what counts as
// "actionable" and never surface dispositioned / closed / SAR-linked
// alerts as the next priority.)

const SCENARIO_OPTIONS = [
  'Structuring',
  'High Risk Country',
  'Watchlist Hit',
  'Cash Intensive',
  'Rapid Movement',
  'Trade Based ML'
];

// getAlertScore moved to utils/alertScoring.js (shared with NextUpFloat and
// CompletionPrompt so the ranking math is the single source of truth).

function usd(n) { return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function usdNoCents(n) { return `$${Number(n || 0).toLocaleString('en-US')}`; }

export default function Alerts() {
  const { isManager, isEmployee, currentAnalyst, isL1, isL2 } = useRole();
  const { tabs, activeId, setActiveId, openTab, closeTab, alertsRefreshNonce, sessionResolvedCustomerIds } = useInvestigationTabs();
  const [alerts, setAlerts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState('overview');
  const [, setTick] = useState(0);

  // Sort/filter/search state — all client-side, no extra API calls.
  const [filters, setFilters] = useState({
    priority: null,        // 'High' | 'Medium' | 'Low' | null
    scenarios: [],         // multi-select
    sanctionsHit: false,
    pepCustomer: false
  });
  const [sortBy, setSortBy] = useState('sla_asc');
  const [searchText, setSearchText] = useState('');
  const searchInputRef = useRef(null);
  const [reopenFor, setReopenFor] = useState(null);  // alert object

  // L1 analysts get the personal-only Kanban (no Unassigned column, no
  // unassigned alerts in the payload). Everyone else (manager, L2 catch-all)
  // sees the full taxonomy.
  const columns = isL1 ? COLUMNS_L1 : COLUMNS_FULL;

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // Global "/" focuses search; Escape clears + blurs it. Only fires when
  // the user isn't already typing in another input/textarea.
  useEffect(() => {
    if (!isL1) return;
    const handler = (e) => {
      const target = e.target;
      const tag = target?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable;
      if (e.key === '/' && !typing) {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'Escape' && document.activeElement === searchInputRef.current) {
        setSearchText('');
        searchInputRef.current?.blur();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isL1]);

  // Always fetch the FULL institution-wide alerts list. The Kanban narrows
  // down to MY alerts client-side below; Next Priority needs the cross-
  // analyst view so its live-claim rule can suppress customers being
  // investigated by another analyst right now.
  const load = () => api.get('/alerts').then(r => setAlerts(r.data));

  // Reload when role/identity changes or when an investigation workspace
  // signals an alert just changed state (disposition submitted, etc.) so
  // the kanban + Next Up banner reflect the fresh status without waiting
  // for the next manual navigation.
  useEffect(() => { load(); }, [isEmployee, currentAnalyst, isL1, alertsRefreshNonce]);

  // Narrow the institution-wide list down to what this analyst sees in
  // their Kanban. L1: own alerts only. L2 catch-all: own + unassigned.
  // Manager uses ManagerAlertsTable instead, so we don't filter there.
  const myAlerts = useMemo(() => {
    if (!isEmployee || !currentAnalyst) return alerts;
    return alerts.filter(a => {
      if (a.assigned_to === currentAnalyst) return true;
      if (!isL1 && (a.assigned_to == null || a.assigned_to === '')) return true;
      return false;
    });
  }, [alerts, isEmployee, currentAnalyst, isL1]);

  // Apply chip filters first — filter results feed both the kanban and
  // the Next Up banner so all three reflect the same scope.
  const filteredAlerts = useMemo(() => {
    return myAlerts.filter(a => {
      if (a.linked_sar_status === 'Filed') return false;
      if (filters.priority && a.priority !== filters.priority) return false;
      if (filters.scenarios.length > 0 && !filters.scenarios.includes(a.scenario)) return false;
      if (filters.sanctionsHit && Number(a.sanctions_match) !== 1) return false;
      if (filters.pepCustomer && Number(a.pep_match) !== 1) return false;
      return true;
    });
  }, [myAlerts, filters]);

  // Sort according to the toolbar dropdown, then re-bucket into columns.
  const grouped = useMemo(() => {
    const sortFns = {
      sla_asc:        (a, b) => new Date(a.sla_deadline || 0) - new Date(b.sla_deadline || 0),
      priority_desc:  (a, b) => {
        const p = { High: 3, Medium: 2, Low: 1 };
        return (p[b.priority] || 0) - (p[a.priority] || 0);
      },
      amount_desc:    (a, b) => Number(b.amount_flagged_inr || 0) - Number(a.amount_flagged_inr || 0),
      created_desc:   (a, b) => new Date(b.created_date || 0) - new Date(a.created_date || 0),
      customer_asc:   (a, b) => (a.customer_name || '').localeCompare(b.customer_name || '')
    };
    const sortFn = sortFns[sortBy] || sortFns.sla_asc;
    const sorted = [...filteredAlerts].sort(sortFn);

    const g = Object.fromEntries(columns.map(c => [c, []]));
    for (const a of sorted) {
      let target = a.alert_status;
      if (ESCALATED_STATUSES.has(target)) target = 'Escalated';
      else if (target === 'Closed — False Positive') target = 'Completed';
      else if (target === 'False Positive')           target = 'Completed';
      else if (target === 'Pending QC')               target = 'Completed';
      const col = g[target];
      if (col) col.push(a);
    }
    return g;
  }, [filteredAlerts, sortBy, columns]);

  // Search match predicate — used to dim non-matches (not to filter them).
  const searchTrim = searchText.trim().toLowerCase();
  const matchesSearch = useCallback((a) => {
    if (!searchTrim) return true;
    const hay = `${a.alert_id || ''} ${a.customer_name || ''} ${a.scenario || ''}`.toLowerCase();
    return hay.includes(searchTrim);
  }, [searchTrim]);

  // Next Up = highest-scoring actionable alert in my filtered set, with
  // the institution-wide live-claim rule and the same-session dedupe
  // applied. Shared with NextUpFloat / CompletionPrompt so all three
  // surfaces agree on which alert is "next."
  const nextUp = useMemo(() => {
    if (!isL1) return null;
    return getNextUpAlert(filteredAlerts, null, currentAnalyst, {
      allAlerts: alerts,
      sessionResolvedCustomerIds
    });
  }, [filteredAlerts, isL1, currentAnalyst, alerts, sessionResolvedCustomerIds]);

  // Banner shows only when something is actually surfaceable — same
  // filter as the actual Next Priority pick, including the live-claim
  // and session-dedupe rules.
  const hasOpenAfterFilters = useMemo(() =>
    isL1 && hasSurfaceableAlert(filteredAlerts, currentAnalyst, {
      allAlerts: alerts,
      sessionResolvedCustomerIds
    }),
  [filteredAlerts, isL1, currentAnalyst, alerts, sessionResolvedCustomerIds]);

  const anyFilterActive = !!filters.priority
    || filters.scenarios.length > 0
    || filters.sanctionsHit
    || filters.pepCustomer;
  const clearFilters = () => setFilters({ priority: null, scenarios: [], sanctionsHit: false, pepCustomer: false });

  const updateStatus = async (alert, next) => {
    await api.patch(`/alerts/${alert.alert_id}/status`, { alert_status: next });
    await load();
    if (selected?.alert_id === alert.alert_id) setSelected({ ...alert, alert_status: next });
  };

  const assignToMe = async (alert) => {
    if (!currentAnalyst) return;
    await api.patch(`/alerts/${alert.alert_id}/assign`, { assigned_to: currentAnalyst });
    await load();
    if (selected?.alert_id === alert.alert_id) {
      setSelected({ ...alert, assigned_to: currentAnalyst, alert_status: 'Not Started' });
    }
  };

  const startInvestigation = async (alert) => {
    if (isEmployee && alert.alert_status === 'Not Started') {
      await updateStatus(alert, 'In Progress');
    }
    openTab(alert, { level: 'L1' });
    setSelected(null);
  };

  const activeTab = tabs.find(t => t.key === activeId);

  // L2 analyst gets the L2 queue/workspace tab system instead of the L1 kanban
  const showL2Page = isEmployee && isL2 && !activeTab;

  return (
    <div className="space-y-4">
      {tabs.length > 0 && (
        <TabBar
          tabs={tabs}
          activeId={activeId}
          onSelect={setActiveId}
          onClose={closeTab}
        />
      )}

      {activeTab ? (
        activeTab.level === 'L2' ? (
          <L2InvestigationWorkspace key={activeTab.key} l2CaseId={activeTab.l2_case_id} alertId={activeTab.alert_id} />
        ) : activeTab.level === 'QC' ? (
          <QcWorkspace key={activeTab.key} qcId={activeTab.qc_id} alertId={activeTab.alert_id} />
        ) : (
          <InvestigationWorkspace key={activeTab.key} alertId={activeTab.alert_id} />
        )
      ) : showL2Page ? (
        <L2QueuePage />
      ) : isManager ? (
        <ManagerAlertsTable />
      ) : isEmployee && !currentAnalyst ? (
        <MissingAnalystState />
      ) : (
        <KanbanBoard
          alerts={myAlerts}
          filteredAlerts={filteredAlerts}
          grouped={grouped}
          columns={columns}
          selected={selected}
          setSelected={setSelected}
          tab={tab}
          setTab={setTab}
          isManager={isManager}
          isEmployee={isEmployee}
          isL1={isL1}
          currentAnalyst={currentAnalyst}
          assignToMe={assignToMe}
          updateStatus={updateStatus}
          startInvestigation={startInvestigation}
          /* PR-search/filter/next-up */
          filters={filters}
          setFilters={setFilters}
          sortBy={sortBy}
          setSortBy={setSortBy}
          searchText={searchText}
          setSearchText={setSearchText}
          searchInputRef={searchInputRef}
          matchesSearch={matchesSearch}
          anyFilterActive={anyFilterActive}
          clearFilters={clearFilters}
          nextUp={nextUp}
          hasOpenAfterFilters={hasOpenAfterFilters}
          onOpenNextUp={(alert) => startInvestigation(alert)}
          requestReopen={(a) => setReopenFor(a)}
        />
      )}

      {reopenFor && (
        <ReopenRequestModal
          alert={reopenFor}
          onClose={() => setReopenFor(null)}
          onSubmitted={() => { setReopenFor(null); load(); }}
        />
      )}
    </div>
  );
}

function TabBar({ tabs, activeId, onSelect, onClose }) {
  return (
    <div className="flex items-center gap-1 border-b border-slate-200 bg-white rounded-t-lg px-2 pt-2 overflow-x-auto">
      {tabs.map(t => {
        const active = t.key === activeId;
        const isL2 = t.level === 'L2';
        const isQc = t.level === 'QC';
        const dotColor = isQc ? 'bg-amber-500' : isL2 ? 'bg-purple-500' : 'bg-blue-500';
        const activeCls = isQc
          ? 'bg-amber-50 border-amber-200 text-amber-900 font-semibold'
          : isL2
            ? 'bg-purple-50 border-purple-200 text-purple-900 font-semibold'
            : 'bg-white border-slate-200 text-navy-900 font-semibold';
        const inactiveCls = isQc
          ? 'bg-amber-100/40 border-transparent text-amber-700 hover:bg-amber-100'
          : isL2
            ? 'bg-purple-100/40 border-transparent text-purple-700 hover:bg-purple-100'
            : 'bg-slate-100 border-transparent text-slate-500 hover:bg-slate-200 hover:text-navy-900';
        return (
          <div
            key={t.key}
            onClick={() => onSelect(t.key)}
            className={`cursor-pointer flex items-center gap-2 px-3 py-2 rounded-t-md text-xs border-t border-l border-r transition ${
              active ? activeCls : inactiveCls
            }`}
          >
            <span className={`inline-block w-2 h-2 rounded-full ${dotColor}`} />
            {isL2 && <span className="text-[10px] font-bold text-purple-700">L2 —</span>}
            {isQc && <span className="text-[10px] font-bold text-amber-700">QC —</span>}
            <span className="font-mono">{isQc ? (t.qc_id || t.alert_id) : isL2 ? (t.l2_case_id || t.alert_id) : t.alert_id}</span>
            <span className="text-slate-400">·</span>
            <span className="truncate max-w-[140px]">{t.customer_name}</span>
            <button
              onClick={(e) => { e.stopPropagation(); onClose(t.key); }}
              className="ml-1 p-0.5 rounded hover:bg-slate-300"
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// "Next Up" sticky banner — picks the highest-scoring open alert for the
// L1 analyst and pins it above the kanban. Single action: Open Alert.
// (Skip / dismiss removed — the banner is informational; if the analyst
// doesn't want to act they can simply ignore it.)
function NextUpBanner({ alert, onOpen }) {
  // No open alerts in scope (e.g. all caught up after filters).
  if (!alert) {
    return (
      <div
        className="bg-green-50 rounded-md flex items-center gap-2 text-sm text-green-800"
        style={{ borderLeft: '4px solid #16A34A', padding: '10px 14px', position: 'sticky', top: 0, zIndex: 30 }}
      >
        <CheckCircle2 size={16} className="text-green-600 shrink-0" />
        <span className="font-medium">All caught up — no alerts to prioritize</span>
      </div>
    );
  }

  // Urgency colour band.
  const now = Date.now();
  const deadline = alert.sla_deadline ? new Date(alert.sla_deadline).getTime() : null;
  const hoursLeft = deadline ? (deadline - now) / 3600000 : Infinity;
  let borderColor, sla, slaCls;
  if (hoursLeft <= 24) {
    borderColor = '#DC2626';
    slaCls = 'text-red-700 font-semibold';
    sla = hoursLeft < 0
      ? `Breached ${Math.round(Math.abs(hoursLeft))}h ago`
      : hoursLeft < 1
        ? `Breaching now`
        : `Breaching in ${Math.round(hoursLeft)}h`;
  } else if (hoursLeft <= 48) {
    borderColor = '#F59E0B';
    slaCls = 'text-amber-700 font-medium';
    sla = `Due in ${Math.round(hoursLeft / 24)} day${Math.round(hoursLeft / 24) === 1 ? '' : 's'}`;
  } else {
    borderColor = '#2563EB';
    slaCls = 'text-blue-700';
    sla = `${Math.round(hoursLeft / 24)} days remaining`;
  }

  const isHighRisk = alert.customer_risk_rating === 'Very High' || alert.customer_risk_rating === 'High';
  const isPep = Number(alert.pep_match) === 1;
  const isSanctions = Number(alert.sanctions_match) === 1;

  return (
    <div
      className="bg-white rounded-md flex items-center gap-3 flex-wrap"
      style={{ borderLeft: `4px solid ${borderColor}`, padding: '10px 14px', position: 'sticky', top: 0, zIndex: 30, boxShadow: '0 1px 3px rgba(15, 23, 42, 0.06)' }}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <Zap size={14} className="text-amber-500 shrink-0" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 shrink-0">Next up</span>
        <span className="font-mono text-xs text-navy-900 font-medium shrink-0">{alert.alert_id}</span>
        <span className="text-slate-400 shrink-0">·</span>
        <span className="text-sm text-slate-800 truncate">{alert.customer_name}</span>
        <div className="flex items-center gap-1 shrink-0">
          {isHighRisk && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-700">
              {alert.customer_risk_rating} Risk
            </span>
          )}
          {isPep && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-100 text-purple-700">
              PEP
            </span>
          )}
          {isSanctions && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-700">
              Sanctions
            </span>
          )}
        </div>
        <span className="text-slate-400 shrink-0">·</span>
        <span className="text-xs text-slate-600 shrink-0">{alert.scenario}</span>
        <span className="text-slate-400 shrink-0">·</span>
        <span className="text-xs text-slate-700 font-medium tabular-nums shrink-0">
          {usdNoCents(alert.amount_flagged_inr)}
        </span>
      </div>

      <div className={`inline-flex items-center gap-1 text-xs ${slaCls} shrink-0`}>
        <Clock size={12} />
        <span>{sla}</span>
      </div>

      <button
        type="button"
        onClick={() => onOpen(alert)}
        className="inline-flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded px-3 py-1.5 shrink-0"
      >
        <PlayCircle size={12} />
        Open Alert
      </button>
    </div>
  );
}

// Toolbar above the kanban — filter chips, sort dropdown, search input.
// All state lives on the parent so the same filters drive the kanban,
// Next Up banner, and column counts.
function Toolbar({
  filters, setFilters, sortBy, setSortBy,
  searchText, setSearchText, searchInputRef,
  anyFilterActive, clearFilters
}) {
  const setPriority = (p) => setFilters(f => ({ ...f, priority: f.priority === p ? null : p }));
  const toggleScenario = (s) => setFilters(f => ({
    ...f,
    scenarios: f.scenarios.includes(s) ? f.scenarios.filter(x => x !== s) : [...f.scenarios, s]
  }));
  const toggleFlag = (key) => setFilters(f => ({ ...f, [key]: !f[key] }));

  return (
    <div className="bg-white border border-slate-200 rounded-md px-3 py-2 flex items-center gap-3 flex-wrap">
      {/* Priority group — single-select */}
      <div className="flex items-center gap-1">
        <span className="text-[10px] uppercase tracking-wide text-slate-500 mr-1">Priority</span>
        {['High', 'Medium', 'Low'].map(p => {
          const active = filters.priority === p;
          return (
            <Chip key={p} active={active} onClick={() => setPriority(p)} tone={p === 'High' ? 'red' : p === 'Medium' ? 'amber' : 'slate'}>
              {p}
              {active && <X size={10} />}
            </Chip>
          );
        })}
      </div>

      <span className="text-slate-200">|</span>

      {/* Scenario group — multi-select */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[10px] uppercase tracking-wide text-slate-500 mr-1">Scenario</span>
        {SCENARIO_OPTIONS.map(s => {
          const active = filters.scenarios.includes(s);
          return (
            <Chip key={s} active={active} onClick={() => toggleScenario(s)}>
              {s}
              {active && <X size={10} />}
            </Chip>
          );
        })}
      </div>

      <span className="text-slate-200">|</span>

      {/* Special flags — multi-select. Prior SAR chip omitted: the alert
          payload has no field for "customer has prior SAR" today. */}
      <div className="flex items-center gap-1">
        <Chip active={filters.sanctionsHit} onClick={() => toggleFlag('sanctionsHit')} tone="red">
          <AlertTriangle size={10} />
          Sanctions
          {filters.sanctionsHit && <X size={10} />}
        </Chip>
        <Chip active={filters.pepCustomer} onClick={() => toggleFlag('pepCustomer')} tone="purple">
          PEP
          {filters.pepCustomer && <X size={10} />}
        </Chip>
      </div>

      <div className="flex-1" />

      {/* Sort by */}
      <label className="text-xs text-slate-600 inline-flex items-center gap-1.5">
        Sort by
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value)}
          className="border border-slate-200 rounded text-xs px-2 py-1 bg-white"
        >
          <option value="sla_asc">SLA (soonest first)</option>
          <option value="priority_desc">Priority (highest first)</option>
          <option value="amount_desc">Amount (largest first)</option>
          <option value="created_desc">Created (newest first)</option>
          <option value="customer_asc">Customer Name (A-Z)</option>
        </select>
      </label>

      {/* Search */}
      <div className="relative">
        <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          ref={searchInputRef}
          type="text"
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          placeholder="Search alerts… (/)"
          className="border border-slate-200 rounded text-xs pl-7 pr-7 py-1 w-56 focus:outline-none focus:border-blue-500"
        />
        {searchText && (
          <button
            type="button"
            onClick={() => setSearchText('')}
            className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-700"
            aria-label="Clear search"
          >
            <X size={11} />
          </button>
        )}
      </div>

      {anyFilterActive && (
        <button
          type="button"
          onClick={clearFilters}
          className="text-[11px] text-blue-600 hover:text-blue-800 font-medium"
        >
          Clear all filters
        </button>
      )}
    </div>
  );
}

// Chip — small toggleable pill used by Toolbar.
function Chip({ active, onClick, tone, children }) {
  const inactiveTone = 'bg-white text-slate-700 border-slate-200 hover:border-blue-300';
  const activeTone =
    tone === 'red'    ? 'bg-red-600 text-white border-red-600' :
    tone === 'amber'  ? 'bg-amber-500 text-white border-amber-500' :
    tone === 'purple' ? 'bg-purple-600 text-white border-purple-600' :
                        'bg-blue-600 text-white border-blue-600';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 text-[11px] rounded-full px-2 py-0.5 border transition-colors ${active ? activeTone : inactiveTone}`}
    >
      {children}
    </button>
  );
}

// Defensive empty-state if the role-context says we're an employee but the
// analyst name didn't make it out of localStorage. Surfaces instead of
// silently loading every alert in the bank.
function MissingAnalystState() {
  return (
    <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-md p-4 text-sm">
      Could not identify your analyst profile. Please log out and log back in.
    </div>
  );
}

function KanbanBoard({
  alerts, filteredAlerts, grouped, columns, selected, setSelected, tab, setTab,
  isManager, isEmployee, isL1, currentAnalyst,
  assignToMe, updateStatus, startInvestigation,
  filters, setFilters, sortBy, setSortBy,
  searchText, setSearchText, searchInputRef, matchesSearch,
  anyFilterActive, clearFilters,
  nextUp, hasOpenAfterFilters, onOpenNextUp, requestReopen
}) {
  const gridCols = columns.length >= 5
    ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-5'
    : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-4';
  const searchActive = searchText.trim().length > 0;

  return (
    <div className="flex gap-4 min-w-0">
      <div className="flex-1 min-w-0 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xl font-bold text-navy-900">
              {isManager
                ? 'Transaction Monitoring Alerts'
                : isL1
                  ? 'My Alerts'
                  : `${currentAnalyst || ''} — Alert Queue`}
            </div>
            <div className="text-sm text-slate-500">
              {isL1
                ? <>Alerts assigned to you — <span className="text-navy-900 font-medium">{currentAnalyst}</span> · {alerts.length} total · SLA varies by priority</>
                : `${alerts.length} alerts ${isEmployee ? '(yours + unassigned)' : 'team-wide'} · SLA varies by priority`}
            </div>
          </div>
        </div>

        {isL1 && hasOpenAfterFilters && (
          <NextUpBanner alert={nextUp} onOpen={onOpenNextUp} />
        )}

        {isL1 && (
          <Toolbar
            filters={filters}
            setFilters={setFilters}
            sortBy={sortBy}
            setSortBy={setSortBy}
            searchText={searchText}
            setSearchText={setSearchText}
            searchInputRef={searchInputRef}
            anyFilterActive={anyFilterActive}
            clearFilters={clearFilters}
          />
        )}

        <div className={`grid ${gridCols} gap-3`}>
          {columns.map(col => {
            const colAlerts = grouped[col] || [];
            const matchingCount = searchActive
              ? colAlerts.filter(matchesSearch).length
              : colAlerts.length;
            return (
              <div key={col} className={`bg-slate-100/70 rounded-lg border-t-4 ${COLUMN_ACCENT[col]}`}>
                <div className="flex items-center justify-between px-3 py-2.5">
                  <div className="text-sm font-semibold text-navy-900">{col}</div>
                  <span className="text-xs bg-white border border-slate-200 rounded-full px-2 py-0.5">
                    {searchActive ? `${matchingCount} of ${colAlerts.length}` : colAlerts.length}
                  </span>
                </div>
                <div className="px-2 pb-3 space-y-2 max-h-[calc(100vh-220px)] overflow-y-auto">
                  {colAlerts.map(a => {
                    const dim = searchActive && !matchesSearch(a);
                    return (
                      <div key={a.alert_id} style={{ opacity: dim ? 0.3 : 1, transition: 'opacity 0.15s ease' }}>
                        <AlertCard
                          alert={a}
                          column={col}
                          isEmployee={isEmployee}
                          isL1={isL1}
                          currentAnalyst={currentAnalyst}
                          onSelect={() => setSelected(a)}
                          onAssign={() => assignToMe(a)}
                          onRequestReopen={() => requestReopen && requestReopen(a)}
                        />
                      </div>
                    );
                  })}
                  {colAlerts.length === 0 && (
                    <div className="text-center text-xs text-slate-400 py-6">No alerts</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {selected && (
        <SelectedDetail
          selected={selected}
          setSelected={setSelected}
          tab={tab}
          setTab={setTab}
          isEmployee={isEmployee}
          isManager={isManager}
          isL1={isL1}
          assignToMe={assignToMe}
          startInvestigation={startInvestigation}
        />
      )}
    </div>
  );
}

function AlertCard({ alert: a, column, isEmployee, isL1, currentAnalyst, onSelect, onAssign, onRequestReopen }) {
  const sla = slaSnapshot(a);
  const isMine = isEmployee && a.assigned_to === currentAnalyst;
  const breached = sla.bucket === 'breached';
  const critical = sla.bucket === 'critical';
  const isEscalated = column === 'Escalated';
  const closed = isAlertClosed(a);
  const wasReturnedFromL2 = !!a.returned_from_l2_at;

  // Escalated cards are read-only for the L1 owner: muted styling, no action buttons
  const cardCls = isEscalated
    ? 'bg-slate-100/70 rounded-md border border-slate-200 shadow-sm p-3 cursor-pointer hover:border-purple-400 opacity-90'
    : breached
      ? 'bg-white rounded-md border-l-4 border-l-red-500 border border-slate-200 shadow-sm p-3 cursor-pointer hover:border-blue-400'
      : `bg-white rounded-md border shadow-sm p-3 cursor-pointer hover:border-blue-400 ${isMine ? 'border-blue-300' : 'border-slate-200'}`;

  return (
    <div onClick={onSelect} className={cardCls}>
      {wasReturnedFromL2 && !isEscalated && (
        <div className="mb-2 -mx-3 -mt-3 px-2 py-1 bg-yellow-100 text-yellow-800 text-[10px] font-semibold rounded-t-md inline-flex items-center gap-1 w-[calc(100%+1.5rem)] border-b border-yellow-200">
          <RotateCcw size={10} /> Returned by L2
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-mono text-slate-500 flex items-center gap-1">
          {a.alert_id}
          {critical && !isEscalated && !closed && <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" title="< 24h to breach" />}
        </div>
        <div className="flex items-center gap-1">
          {breached && !isEscalated && !closed && (
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-red-600 text-white inline-flex items-center gap-0.5">
              <AlertTriangle size={9} /> BREACHED
            </span>
          )}
          {isEscalated && (
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 inline-flex items-center gap-0.5">
              <ArrowUpRight size={9} /> {(!isL1 && a.alert_status === 'Escalated - SAR') ? 'SAR' : 'L2'}
            </span>
          )}
          {/* QC status badges — visible to the closing L1 analyst on their
              FP-closed cards. L1 cannot act, but can see whether their close
              passed, failed, or is still being reviewed. */}
          {(a.alert_status === 'Pending QC' || a.qc_status === 'pending') && (
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 inline-flex items-center gap-0.5" title="Pending QC review by L2">
              ⏳ QC Pending
            </span>
          )}
          {a.qc_status === 'passed' && a.alert_status === 'Closed — False Positive' && (
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-green-100 text-green-700 inline-flex items-center gap-0.5" title="QC review passed by L2">
              ✓ QC Passed
            </span>
          )}
          {a.qc_status === 'failed' && (
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700 inline-flex items-center gap-0.5" title="QC failed — reopen request submitted">
              ✗ QC Failed
            </span>
          )}
          <Badge value={a.priority} />
        </div>
      </div>
      <div className="mt-1 text-sm font-medium text-navy-900 truncate">{a.customer_name}</div>
      <div className="text-xs text-slate-500 mt-0.5">{a.scenario}</div>
      <div className="text-[11px] text-slate-400 mt-0.5">
        {usd(a.amount_flagged_inr)} · {a.txn_count_flagged} txn · {a.counterparty_country}
      </div>
      <div className="mt-2 flex items-center justify-between text-xs">
        <div className="text-slate-500 truncate max-w-[55%]">
          {a.assigned_to || <span className="italic text-slate-400">Unassigned</span>}
        </div>
        {!isEscalated && (
          <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${sla.tone}`}>
            <Clock size={11} /> {sla.label}
          </div>
        )}
      </div>
      {isEscalated && (
        <div className="mt-2 text-[11px] text-purple-700 bg-purple-50 border border-purple-200 rounded px-2 py-1">
          Awaiting L2 Review
          {a.l2_analyst_id && <> · with <span className="font-medium">{a.l2_analyst_id}</span></>}
          {a.escalated_to_l2_at && <> · {Math.max(0, Math.round((Date.now() - new Date(a.escalated_to_l2_at).getTime()) / 86400000))}d ago</>}
        </div>
      )}
      {isEmployee && column === 'Unassigned' && !isEscalated && (
        <button
          onClick={(e) => { e.stopPropagation(); onAssign(); }}
          className="mt-2 w-full text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-md py-1.5 inline-flex items-center justify-center gap-1"
        >
          <UserPlus size={12} /> Assign to Me
        </button>
      )}
      {/* L1 owner reopen-request link on closed cards. Gated to alerts the
          current analyst originally worked on (assigned_to match), and only
          when the alert has no pending request already pinned. */}
      {isL1 && closed && a.assigned_to === currentAnalyst && (
        a.reopen_request_id && !a.reopened_at ? (
          <div className="mt-2 pt-2 border-t border-slate-100 text-[10px] text-amber-700 inline-flex items-center gap-1">
            <RotateCcw size={10} /> Reopen pending
          </div>
        ) : (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRequestReopen && onRequestReopen(); }}
            className="mt-2 pt-2 border-t border-slate-100 w-full text-[11px] text-slate-500 hover:text-blue-700 hover:underline"
          >
            Request to reopen
          </button>
        )
      )}
    </div>
  );
}

function SelectedDetail({ selected, setSelected, tab, setTab, isEmployee, isManager, isL1, assignToMe, startInvestigation }) {
  const isEscalated = ESCALATED_STATUSES.has(selected.alert_status);
  const closed = isAlertClosed(selected);
  const sla = slaSnapshot(selected);
  return (
    <aside className="w-[440px] shrink-0 bg-white rounded-lg border border-slate-200 shadow-lg h-[calc(100vh-96px)] sticky top-20 flex flex-col">
      <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-slate-100">
        <div className="min-w-0">
          <div className="text-xs font-mono text-slate-500">{selected.alert_id}</div>
          <div className="text-base font-semibold text-navy-900 truncate">{selected.customer_name}</div>
          <div className="text-xs text-slate-500 mt-0.5">{selected.scenario} · {selected.segment}</div>
        </div>
        <button onClick={() => setSelected(null)} className="p-1 rounded hover:bg-slate-100">
          <X size={16} />
        </button>
      </div>

      <div className="flex gap-1 px-4 pt-2 border-b border-slate-100 text-xs">
        {['overview', 'customer'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 rounded-t capitalize ${
              tab === t ? 'text-blue-600 border-b-2 border-blue-600 -mb-px font-medium' : 'text-slate-500 hover:text-navy-900'
            }`}
          >{t}</button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-5 text-sm">
        {tab === 'overview' && (
          <div className="space-y-3">
            <Row k="Status" v={<Badge value={selected.alert_status} />} />
            <Row k="Priority" v={<Badge value={selected.priority} />} />
            <Row k="Risk Score" v={`${selected.risk_score}/100`} />
            <Row k="SLA" v={
              closed
                ? <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium ${sla.tone}`}>{sla.label}</span>
                : <span className={selected.sla_breached ? 'text-red-600 font-semibold' : 'text-green-600'}>{selected.due_status}</span>
            } />
            <Row k="Age" v={`${selected.age_days} / ${selected.sla_days} days`} />
            <Row k="Amount" v={usd(selected.amount_flagged_inr)} />
            <Row k="Txn count" v={selected.txn_count_flagged} />
            <Row k="Counterparty" v={selected.counterparty_country} />
            <Row k="Channel" v={selected.channel} />
            <Row k="Branch" v={selected.branch} />
            <Row k="Assigned To" v={selected.assigned_to || '—'} />
            {!isL1 && <Row k="Case ID" v={selected.case_id || '—'} />}
            {!isL1 && <Row k="Linked SAR" v={selected.linked_sar_id || '—'} />}
            {isEscalated && (
              <Row k="L2 Analyst" v={<span className="text-purple-700 font-medium">{selected.l2_analyst_id || 'Unassigned'}</span>} />
            )}
            <div className="pt-2 text-xs text-slate-600 bg-slate-50 p-3 rounded">
              {selected.scenario_description || selected.narrative_seed}
            </div>
            {selected.returned_from_l2_at && (
              <div className="bg-yellow-50 border border-yellow-300 rounded p-3 text-xs">
                <div className="font-semibold text-yellow-800">Returned by L2</div>
                {selected.l2_return_reason && <div className="mt-0.5"><span className="text-yellow-700">Reason:</span> {selected.l2_return_reason}</div>}
                {selected.l2_return_instructions && <div className="mt-0.5"><span className="text-yellow-700">Instructions:</span> {selected.l2_return_instructions}</div>}
              </div>
            )}
            {closed && <OutcomeCard alert={selected} />}
          </div>
        )}
        {tab === 'customer' && (
          <div className="space-y-3">
            <Row k="Customer ID" v={selected.customer_id} />
            <Row k="Customer" v={selected.customer_name} />
            <Row k="Type" v={selected.customer_type} />
            <Row k="Segment" v={selected.segment} />
            <Row k="Risk Rating" v={<Badge value={selected.customer_risk_rating} />} />
            <Row k="KYC Status" v={<span className={selected.kyc_review_status === 'Overdue' ? 'text-red-600 font-semibold' : ''}>{selected.kyc_review_status}</span>} />
            <Row k="PEP Match" v={selected.pep_match ? 'Yes' : 'No'} />
            <Row k="Sanctions Match" v={selected.sanctions_match ? <span className="text-red-600 font-semibold">Yes</span> : 'No'} />
          </div>
        )}
      </div>

      <div className="px-5 py-3 border-t border-slate-100 flex gap-2">
        {closed ? (
          <div className="flex-1 text-xs text-slate-500 italic text-center px-3 py-2">
            Read-only · alert is closed
          </div>
        ) : (
          <>
            {isEmployee && !selected.assigned_to && !isEscalated && (
              <button
                onClick={() => assignToMe(selected)}
                className="flex-1 text-sm bg-slate-600 hover:bg-slate-700 text-white rounded-md px-3 py-2 inline-flex items-center justify-center gap-1"
              >
                <UserPlus size={14} /> Assign to Me
              </button>
            )}
            {!isEscalated && (
              <button
                onClick={() => startInvestigation(selected)}
                className="flex-1 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md px-3 py-2 inline-flex items-center justify-center gap-1"
              >
                <PlayCircle size={14} /> Start Investigation
              </button>
            )}
            {isEscalated && (
              <div className="flex-1 text-xs text-slate-500 italic text-center px-3 py-2">
                Read-only · alert is with L2
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

function Row({ k, v }) {
  return (
    <div className="flex items-start justify-between gap-2 text-sm">
      <span className="text-slate-500">{k}</span>
      <span className="text-navy-900 font-medium text-right break-words">{v}</span>
    </div>
  );
}
