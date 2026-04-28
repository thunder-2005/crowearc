import { useEffect, useMemo, useState } from 'react';
import api from '../../api/client.js';
import Badge from '../shared/Badge.jsx';
import { useRole } from '../../state/RoleContext.jsx';
import { useInvestigationTabs } from '../../state/InvestigationTabsContext.jsx';
import { useToast } from '../../state/ToastContext.jsx';
import {
  ShieldAlert, PlayCircle, UserCheck, RefreshCw, Filter, Inbox, ClipboardList, Activity, Calendar
} from 'lucide-react';

const STATUS_TONES = {
  'Pending Assignment':       'bg-orange-50 text-orange-700 border-orange-200',
  'Assigned':                 'bg-blue-50 text-blue-700 border-blue-200',
  'Under L2 Review':          'bg-purple-50 text-purple-700 border-purple-200',
  'Decision Made — SAR Filed':'bg-red-50 text-red-700 border-red-200',
  'Decision Made — Closed':   'bg-slate-50 text-slate-600 border-slate-200',
  'Returned to L1':           'bg-yellow-50 text-yellow-700 border-yellow-200'
};

const usd = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const daysSince = (iso) => {
  if (!iso) return '—';
  const d = (Date.now() - new Date(iso.includes('T') ? iso : iso.replace(' ', 'T')).getTime()) / 86400000;
  return Math.max(0, Math.floor(d));
};

export default function L2QueuePage() {
  const { currentAnalyst, analysts, analystProfiles } = useRole();
  const { openTab } = useInvestigationTabs();
  const { push } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [filters, setFilters] = useState({
    status: '', priority: '', scenario: '', escalated_by: '', from: '', to: '', q: ''
  });
  const [reassignFor, setReassignFor] = useState(null);

  const l2Analysts = useMemo(
    () => analysts.filter(a => analystProfiles[a]?.level === 'L2'),
    [analysts, analystProfiles]
  );

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/l2/queue/${encodeURIComponent(currentAnalyst)}`);
      setRows(data);
      const { data: s } = await api.get('/l2/stats/manager');
      setStats(s);
    } finally { setLoading(false); }
  };

  useEffect(() => { if (currentAnalyst) load(); }, [currentAnalyst]);

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (filters.status && r.status !== filters.status) return false;
      if (filters.priority && (r.priority || r.alert_priority) !== filters.priority) return false;
      if (filters.scenario && r.scenario !== filters.scenario) return false;
      if (filters.escalated_by && r.escalated_by !== filters.escalated_by) return false;
      if (filters.from && r.escalated_at < filters.from) return false;
      if (filters.to && r.escalated_at > filters.to + ' 23:59:59') return false;
      if (filters.q) {
        const q = filters.q.toLowerCase();
        if (![r.alert_id, r.l2_case_id, r.customer_name].some(v => (v || '').toLowerCase().includes(q))) return false;
      }
      return true;
    });
  }, [rows, filters]);

  const myAssigned = rows.filter(r => r.assigned_to === currentAnalyst).length;
  const pendingMine = rows.filter(r => r.assigned_to === currentAnalyst && r.status === 'Under L2 Review').length;
  const decisionsThisMonth = rows.filter(r => {
    if (!r.decision_made_at) return false;
    return r.decision_made_at.slice(0, 7) === new Date().toISOString().slice(0, 7);
  }).length;
  const avgReviewDays = (() => {
    const decided = rows.filter(r => r.decision_made_at && r.assigned_at);
    if (decided.length === 0) return 0;
    const total = decided.reduce((s, r) => s + Math.max(0, (new Date(r.decision_made_at) - new Date(r.assigned_at)) / 86400000), 0);
    return Math.round((total / decided.length) * 10) / 10;
  })();

  const accept = async (lc) => {
    try {
      await api.patch(`/l2/${lc.l2_case_id}/accept`, { analyst_id: currentAnalyst });
      push('Accepted — opening L2 workspace', 'success');
      openTab(
        { alert_id: lc.alert_id, customer_id: lc.customer_id, customer_name: lc.customer_name, scenario: lc.scenario, priority: lc.priority },
        { level: 'L2', l2_case_id: lc.l2_case_id }
      );
    } catch (e) { push('Failed: ' + (e.response?.data?.error || e.message), 'error'); }
  };

  const openReadOnly = (lc) => {
    openTab(
      { alert_id: lc.alert_id, customer_id: lc.customer_id, customer_name: lc.customer_name, scenario: lc.scenario, priority: lc.priority },
      { level: 'L2', l2_case_id: lc.l2_case_id }
    );
  };

  const reassign = async (lc, target) => {
    try {
      await api.patch(`/l2/${lc.l2_case_id}/reassign`, { analyst_id: target, performed_by: currentAnalyst });
      push(`Reassigned to ${target}`, 'success');
      setReassignFor(null);
      load();
    } catch (e) { push('Reassign failed: ' + (e.response?.data?.error || e.message), 'error'); }
  };

  const distinctScenarios = [...new Set(rows.map(r => r.scenario).filter(Boolean))];
  const distinctEscalators = [...new Set(rows.map(r => r.escalated_by).filter(Boolean))];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xl font-bold text-purple-900 flex items-center gap-2">
            <ShieldAlert size={20} className="text-purple-600" />
            L2 Investigations — Escalated Alerts
          </div>
          <div className="text-sm text-slate-500">
            Review escalated cases from L1 analysts · {currentAnalyst}
          </div>
        </div>
        <button onClick={load} className="text-sm border border-slate-300 hover:bg-slate-50 rounded-md px-3 py-1.5 inline-flex items-center gap-1">
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi label="Total Escalated" value={rows.length} icon={Inbox} />
        <Kpi label="Assigned to Me" value={myAssigned} icon={UserCheck} tone="purple" />
        <Kpi label="Pending My Review" value={pendingMine} icon={ClipboardList} tone="orange" />
        <Kpi label="Decisions This Month" value={decisionsThisMonth} icon={Activity} tone="green" />
        <Kpi label="Avg Review Time" value={`${avgReviewDays}d`} icon={Calendar} tone="blue" />
      </div>

      <div className="bg-white rounded-lg border border-slate-200 shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2 text-xs">
          <Filter size={12} className="text-slate-400" />
          <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
            className="border border-slate-200 rounded px-2 py-1 bg-white">
            <option value="">All statuses</option>
            {Object.keys(STATUS_TONES).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filters.priority} onChange={e => setFilters(f => ({ ...f, priority: e.target.value }))}
            className="border border-slate-200 rounded px-2 py-1 bg-white">
            <option value="">All priority</option><option>High</option><option>Medium</option><option>Low</option>
          </select>
          <select value={filters.scenario} onChange={e => setFilters(f => ({ ...f, scenario: e.target.value }))}
            className="border border-slate-200 rounded px-2 py-1 bg-white">
            <option value="">All scenarios</option>
            {distinctScenarios.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filters.escalated_by} onChange={e => setFilters(f => ({ ...f, escalated_by: e.target.value }))}
            className="border border-slate-200 rounded px-2 py-1 bg-white">
            <option value="">Any L1 analyst</option>
            {distinctEscalators.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <input type="date" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))}
            className="border border-slate-200 rounded px-2 py-1" />
          <span className="text-slate-400">to</span>
          <input type="date" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))}
            className="border border-slate-200 rounded px-2 py-1" />
          <input value={filters.q} onChange={e => setFilters(f => ({ ...f, q: e.target.value }))}
            placeholder="Search alert / customer"
            className="border border-slate-200 rounded px-2 py-1 ml-auto w-48" />
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-slate-500 border-b border-slate-200">
              <tr>
                <th className="text-left py-2 px-3">Alert ID</th>
                <th className="text-left py-2 px-3">Customer</th>
                <th className="text-left py-2 px-3">Scenario</th>
                <th className="text-right py-2 px-3">Amount</th>
                <th className="text-left py-2 px-3">Priority</th>
                <th className="text-left py-2 px-3">Escalated By</th>
                <th className="text-left py-2 px-3">Escalated On</th>
                <th className="text-right py-2 px-3">Days</th>
                <th className="text-left py-2 px-3">L1 Disposition</th>
                <th className="text-left py-2 px-3">Status</th>
                <th className="text-right py-2 px-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={11} className="py-8 text-center text-slate-400">Loading…</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={11} className="py-8 text-center text-slate-400">No L2 cases match filters</td></tr>
              )}
              {filtered.map(r => {
                const tone = STATUS_TONES[r.status] || 'bg-slate-50 text-slate-600 border-slate-200';
                const mine = r.assigned_to === currentAnalyst;
                const canAccept = r.status === 'Pending Assignment' || (!r.assigned_to);
                return (
                  <tr key={r.l2_case_id} className={`border-b border-slate-100 hover:bg-slate-50 ${mine ? 'bg-purple-50/30' : ''}`}>
                    <td className="py-2 px-3 font-mono text-xs">{r.alert_id}</td>
                    <td className="py-2 px-3 font-medium text-navy-900">{r.customer_name}</td>
                    <td className="py-2 px-3 text-slate-600">{r.scenario}</td>
                    <td className="py-2 px-3 text-right font-mono">{usd(r.amount)}</td>
                    <td className="py-2 px-3"><Badge value={r.priority || r.alert_priority} /></td>
                    <td className="py-2 px-3">{r.escalated_by}</td>
                    <td className="py-2 px-3 text-xs text-slate-500">{r.escalated_at?.slice(0, 10)}</td>
                    <td className="py-2 px-3 text-right text-slate-700">{daysSince(r.escalated_at)}d</td>
                    <td className="py-2 px-3 text-xs text-slate-600 max-w-[180px] truncate" title={r.l1_disposition || '—'}>{r.l1_disposition || '—'}</td>
                    <td className="py-2 px-3">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${tone}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      {canAccept ? (
                        <button onClick={() => accept(r)}
                          className="text-xs bg-purple-600 hover:bg-purple-700 text-white rounded px-2 py-1 inline-flex items-center gap-1">
                          <PlayCircle size={11} /> Accept &amp; Review
                        </button>
                      ) : (
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openReadOnly(r)}
                            className="text-xs border border-slate-300 hover:bg-slate-50 rounded px-2 py-1">
                            Open
                          </button>
                          <button onClick={() => setReassignFor(r)}
                            className="text-xs border border-slate-300 hover:bg-slate-50 rounded px-2 py-1">
                            Reassign
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {reassignFor && (
        <ReassignModal
          lc={reassignFor}
          onClose={() => setReassignFor(null)}
          onSubmit={(target) => reassign(reassignFor, target)}
          analysts={l2Analysts.filter(a => a !== currentAnalyst)}
        />
      )}
    </div>
  );
}

function Kpi({ label, value, tone = 'default', icon: Icon }) {
  const tones = {
    default: 'text-navy-900',
    blue:    'text-blue-600',
    purple:  'text-purple-600',
    orange:  'text-orange-600',
    green:   'text-green-600',
    red:     'text-red-600'
  };
  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
        {Icon && <Icon size={14} className="text-slate-400" />}
      </div>
      <div className={`mt-1 text-xl font-bold ${tones[tone]}`}>{value}</div>
    </div>
  );
}

function ReassignModal({ lc, onClose, onSubmit, analysts }) {
  const [target, setTarget] = useState(analysts[0] || '');
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-100 font-semibold text-navy-900">
          Reassign {lc.l2_case_id}
        </div>
        <div className="p-5 space-y-3 text-sm">
          <div className="text-slate-600">
            Currently assigned to <span className="font-medium">{lc.assigned_to}</span>. Reassign to another L2 analyst:
          </div>
          <select value={target} onChange={e => setTarget(e.target.value)}
            className="w-full border border-slate-200 rounded px-3 py-2 bg-white">
            {analysts.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="text-sm border border-slate-300 rounded px-3 py-1.5 hover:bg-slate-50">Cancel</button>
          <button onClick={() => onSubmit(target)}
            disabled={!target}
            className="text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded px-3 py-1.5">
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
