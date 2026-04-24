import { useEffect, useMemo, useState } from 'react';
import api from '../api/client.js';
import Badge from '../components/shared/Badge.jsx';
import { X, Clock, AlertOctagon, ArrowRight, UserPlus, Flag, PlayCircle } from 'lucide-react';
import { useRole } from '../state/RoleContext.jsx';
import { useInvestigationTabs } from '../state/InvestigationTabsContext.jsx';
import InvestigationWorkspace from '../components/investigation/InvestigationWorkspace.jsx';

const COLUMNS = ['Unassigned', 'Not Started', 'Work in Progress', 'Completed'];
const COLUMN_ACCENT = {
  'Unassigned':       'border-t-slate-400',
  'Not Started':      'border-t-orange-400',
  'Work in Progress': 'border-t-blue-500',
  'Completed':        'border-t-green-500'
};

function slaLabel(ageDays, slaDays, dueStatus) {
  const remaining = slaDays - ageDays;
  if (dueStatus && dueStatus.includes('overdue')) return { label: dueStatus, tone: 'text-red-600 bg-red-50' };
  if (remaining <= 3)                             return { label: dueStatus || `${remaining}d left`, tone: 'text-orange-700 bg-orange-50' };
  return { label: dueStatus || `${remaining}d left`, tone: 'text-green-700 bg-green-50' };
}

function inr(n) { return `₹${Number(n || 0).toLocaleString('en-IN')}`; }

export default function Alerts() {
  const { isManager, isEmployee, currentAnalyst } = useRole();
  const { tabs, activeId, setActiveId, openTab, closeTab } = useInvestigationTabs();
  const [alerts, setAlerts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState('overview');

  const load = () => {
    const params = {};
    if (isEmployee && currentAnalyst) {
      params.assigned_to = currentAnalyst;
      params.include_unassigned_for = 1;
    }
    return api.get('/alerts', { params }).then(r => setAlerts(r.data));
  };

  useEffect(() => { load(); }, [isEmployee, currentAnalyst]);

  const grouped = useMemo(() => {
    const g = Object.fromEntries(COLUMNS.map(c => [c, []]));
    for (const a of alerts) {
      const col = g[a.alert_status];
      if (col) col.push(a);
    }
    return g;
  }, [alerts]);

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
      await updateStatus(alert, 'Work in Progress');
    }
    openTab(alert);
    setSelected(null);
  };

  const activeTab = tabs.find(t => t.alert_id === activeId);

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
        <InvestigationWorkspace key={activeTab.alert_id} alertId={activeTab.alert_id} />
      ) : (
        <KanbanBoard
          alerts={alerts}
          grouped={grouped}
          selected={selected}
          setSelected={setSelected}
          tab={tab}
          setTab={setTab}
          isManager={isManager}
          isEmployee={isEmployee}
          currentAnalyst={currentAnalyst}
          assignToMe={assignToMe}
          updateStatus={updateStatus}
          startInvestigation={startInvestigation}
        />
      )}
    </div>
  );
}

function TabBar({ tabs, activeId, onSelect, onClose }) {
  return (
    <div className="flex items-center gap-1 border-b border-slate-200 bg-white rounded-t-lg px-2 pt-2 overflow-x-auto">
      {tabs.map(t => {
        const active = t.alert_id === activeId;
        return (
          <div
            key={t.alert_id}
            onClick={() => onSelect(t.alert_id)}
            className={`cursor-pointer flex items-center gap-2 px-3 py-2 rounded-t-md text-xs border-t border-l border-r transition ${
              active
                ? 'bg-white border-slate-200 text-navy-900 font-semibold'
                : 'bg-slate-100 border-transparent text-slate-500 hover:bg-slate-200 hover:text-navy-900'
            }`}
          >
            <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
            <span className="font-mono">{t.alert_id}</span>
            <span className="text-slate-400">·</span>
            <span className="truncate max-w-[140px]">{t.customer_name}</span>
            <button
              onClick={(e) => { e.stopPropagation(); onClose(t.alert_id); }}
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

function KanbanBoard({
  alerts, grouped, selected, setSelected, tab, setTab,
  isManager, isEmployee, currentAnalyst,
  assignToMe, updateStatus, startInvestigation
}) {
  return (
    <div className="flex gap-4 min-w-0">
      <div className="flex-1 min-w-0 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xl font-bold text-navy-900">
              {isManager ? 'Transaction Monitoring Alerts' : `${currentAnalyst || ''} — Alert Queue`}
            </div>
            <div className="text-sm text-slate-500">
              {alerts.length} alerts {isEmployee ? '(yours + unassigned)' : 'team-wide'} · SLA 30 days
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {COLUMNS.map(col => (
            <div key={col} className={`bg-slate-100/70 rounded-lg border-t-4 ${COLUMN_ACCENT[col]}`}>
              <div className="flex items-center justify-between px-3 py-2.5">
                <div className="text-sm font-semibold text-navy-900">{col}</div>
                <span className="text-xs bg-white border border-slate-200 rounded-full px-2 py-0.5">
                  {(grouped[col] || []).length}
                </span>
              </div>
              <div className="px-2 pb-3 space-y-2 max-h-[calc(100vh-220px)] overflow-y-auto">
                {(grouped[col] || []).map(a => {
                  const sla = slaLabel(a.age_days, a.sla_days, a.due_status);
                  const isMine = isEmployee && a.assigned_to === currentAnalyst;
                  return (
                    <div
                      key={a.alert_id}
                      onClick={() => setSelected(a)}
                      className={`bg-white rounded-md border shadow-sm p-3 cursor-pointer hover:border-blue-400 ${isMine ? 'border-blue-300' : 'border-slate-200'}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-mono text-slate-500">{a.alert_id}</div>
                        <Badge value={a.priority} />
                      </div>
                      <div className="mt-1 text-sm font-medium text-navy-900 truncate">
                        {a.customer_name}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">{a.scenario}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        {inr(a.amount_flagged_inr)} · {a.txn_count_flagged} txn · {a.counterparty_country}
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs">
                        <div className="text-slate-500 truncate max-w-[55%]">
                          {a.assigned_to || <span className="italic text-slate-400">Unassigned</span>}
                        </div>
                        <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${sla.tone}`}>
                          <Clock size={11} /> {sla.label}
                        </div>
                      </div>
                      {isEmployee && col === 'Unassigned' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); assignToMe(a); }}
                          className="mt-2 w-full text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-md py-1.5 inline-flex items-center justify-center gap-1"
                        >
                          <UserPlus size={12} /> Assign to Me
                        </button>
                      )}
                    </div>
                  );
                })}
                {(grouped[col] || []).length === 0 && (
                  <div className="text-center text-xs text-slate-400 py-6">No alerts</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {selected && (
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
                <Row k="SLA" v={<span className={selected.sla_breached ? 'text-red-600 font-semibold' : 'text-green-600'}>{selected.due_status}</span>} />
                <Row k="Age" v={`${selected.age_days} / ${selected.sla_days} days`} />
                <Row k="Amount" v={inr(selected.amount_flagged_inr)} />
                <Row k="Txn count" v={selected.txn_count_flagged} />
                <Row k="Counterparty" v={selected.counterparty_country} />
                <Row k="Channel" v={selected.channel} />
                <Row k="Branch" v={selected.branch} />
                <Row k="Assigned To" v={selected.assigned_to || '—'} />
                <Row k="Case ID" v={selected.case_id || '—'} />
                <Row k="Linked SAR" v={selected.linked_sar_id || '—'} />
                <div className="pt-2 text-xs text-slate-600 bg-slate-50 p-3 rounded">
                  {selected.scenario_description || selected.narrative_seed}
                </div>
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
            {isEmployee && !selected.assigned_to && (
              <button
                onClick={() => assignToMe(selected)}
                className="flex-1 text-sm bg-slate-600 hover:bg-slate-700 text-white rounded-md px-3 py-2 inline-flex items-center justify-center gap-1"
              >
                <UserPlus size={14} /> Assign to Me
              </button>
            )}
            <button
              onClick={() => startInvestigation(selected)}
              className="flex-1 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md px-3 py-2 inline-flex items-center justify-center gap-1"
            >
              <PlayCircle size={14} /> Start Investigation
            </button>
            {isEmployee && (
              <button
                className="text-sm border border-red-200 text-red-600 hover:bg-red-50 rounded-md px-3 py-2 inline-flex items-center gap-1"
                title="Flag for manager"
              >
                <Flag size={14} />
              </button>
            )}
          </div>
        </aside>
      )}
    </div>
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
