import { useEffect, useMemo, useState } from 'react';
import api from '../../api/client.js';
import Badge from '../shared/Badge.jsx';
import { useRole } from '../../state/RoleContext.jsx';
import { useToast } from '../../state/ToastContext.jsx';
import {
  Search, Filter, X, ChevronLeft, ChevronRight, UserPlus, Loader2,
  Eye, ChevronDown, AlertTriangle, ArrowUpDown, ShieldOff, AlertCircle
} from 'lucide-react';
import OutcomeCard from '../shared/OutcomeCard.jsx';
import { isAlertClosed, slaSnapshot } from '../../utils/alertStatus.js';

const PAGE_SIZE = 25;
const ESCALATED_STATUSES = new Set(['Escalated - L2', 'Escalated - SAR']);

// Status filter dropdown options. Includes both 'In Progress' (seeded
// rows) and 'Work in Progress' (live transitions), plus the FP-closed
// label so the manager can filter to it explicitly.
const STATUS_OPTIONS = [
  'Unassigned', 'Not Started', 'In Progress', 'Work in Progress',
  'Completed', 'Closed — False Positive', 'Escalated - L2', 'Escalated - SAR'
];
const PRIORITY_OPTIONS = ['High', 'Medium', 'Low'];
const SLA_STATUSES = ['On Time', 'At Risk', 'Breached'];

const usd = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Wrap the shared slaSnapshot: collapse the live-countdown phrasing
// ("3h 12m") into the table-friendly bucket labels ("On Time" / "At Risk" /
// "Breached") and pass-through the new "Closed on time" / "Closed late"
// kinds for closed alerts.
function tableSlaSnapshot(a) {
  const snap = slaSnapshot(a);
  if (snap.bucket === 'breached') return { ...snap, label: 'Breached' };
  if (snap.bucket === 'critical') return { ...snap, label: 'At Risk', bucket: 'at_risk' };
  if (snap.bucket === 'ok')       return { ...snap, label: 'On Time', bucket: 'on_time' };
  return snap;
}

const COLS = [
  { key: 'alert_id',        label: 'Alert ID' },
  { key: 'customer_name',   label: 'Customer' },
  { key: 'scenario',        label: 'Scenario' },
  { key: 'priority',        label: 'Priority' },
  { key: 'alert_status',    label: 'Status' },
  { key: 'assigned_to',     label: 'Assigned To' },
  { key: 'team',            label: 'Team' },
  { key: 'amount_flagged_inr', label: 'Amount' },
  { key: 'age_days',        label: 'Age (d)' },
  { key: 'sla_deadline',    label: 'SLA Due' },
  { key: 'sla_status',      label: 'SLA Status' },
  { key: 'created_date',    label: 'Created' }
];

export default function ManagerAlertsTable({ onSelect }) {
  const { analystProfiles } = useRole();
  const { push } = useToast();
  const [alerts, setAlerts] = useState([]);
  // L1-only analyst pool — manager only assigns to T1 Monitoring
  // (L2 cases are self-assigned from the L2 queue).
  const [l1Analysts, setL1Analysts] = useState([]); // [{ name, role, team, ... }]
  const [loading, setLoading] = useState(true);
  // Manager-tunable: alerts older than this number of days are highlighted
  // in the table. 2× this value flips the styling to "critical".
  const [agingThreshold, setAgingThreshold] = useState(30);
  useEffect(() => {
    api.get('/settings/manager').then(r => {
      const t = Number(r.data?.['alert_aging_highlight_days']);
      if (Number.isFinite(t) && t > 0) setAgingThreshold(t);
    }).catch(() => { /* keep default */ });
  }, []);
  const [filters, setFilters] = useState({
    scenarios: [], priority: '', statuses: [], assigned_to: '',
    team: '', sla_status: '', from: '', to: '', q: ''
  });
  // sortKey === null means "use the order the backend returned" — i.e. the
  // bucketed Unassigned → Not Started → In Progress → Escalated → Closed
  // priority sort produced by ?priority_bucket_sort=1. Clicking any column
  // header switches to that column's sort.
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(new Set()); // Set of alert_id
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState(null); // { analyst, count }
  const [bulkClose, setBulkClose] = useState(false);    // false-positive bulk close modal
  const [singleAssign, setSingleAssign] = useState(null); // alert object
  const [submitting, setSubmitting] = useState(false);
  const [viewing, setViewing] = useState(null);

  // Backend already groups by lifecycle bucket when this flag is on:
  // Unassigned → Not Started → In Progress → Escalated → Closed.
  // Within each band rows are ordered newest-first.
  const load = () => {
    setLoading(true);
    return api.get('/alerts', { params: { priority_bucket_sort: 1 } })
      .then(r => setAlerts(r.data))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  // Manager assigns to L1 only — pull the curated list from the backend.
  useEffect(() => {
    api.get('/users', { params: { role: 'analyst_l1', status: 'Active' } })
      .then(r => setL1Analysts(r.data || []))
      .catch(() => setL1Analysts([]));
  }, []);

  // Open-alert counts per analyst for the bulk assign dropdown
  const analystOpenCounts = useMemo(() => {
    const m = {};
    for (const a of alerts) {
      if (!a.assigned_to) continue;
      if (a.alert_status === 'Completed') continue;
      m[a.assigned_to] = (m[a.assigned_to] || 0) + 1;
    }
    return m;
  }, [alerts]);

  const distinctScenarios = useMemo(() =>
    [...new Set(alerts.map(a => a.scenario).filter(Boolean))].sort(),
    [alerts]);

  const enriched = useMemo(() => {
    // Hide alerts whose linked SAR has already been filed — those live in
    // the SAR Repository and shouldn't reappear in the alerts queue.
    return alerts
      .filter(a => a.linked_sar_status !== 'Filed')
      .map(a => {
        const sla = tableSlaSnapshot(a);
        return {
          ...a,
          team: analystProfiles[a.assigned_to]?.team || '—',
          sla_status: sla.label,
          sla_bucket: sla.bucket,
          sla_tone: sla.tone
        };
      });
  }, [alerts, analystProfiles]);

  const filtered = useMemo(() => {
    return enriched.filter(a => {
      if (filters.scenarios.length && !filters.scenarios.includes(a.scenario)) return false;
      if (filters.priority && a.priority !== filters.priority) return false;
      if (filters.statuses.length && !filters.statuses.includes(a.alert_status)) return false;
      if (filters.assigned_to && a.assigned_to !== filters.assigned_to) return false;
      if (filters.team) {
        const t = analystProfiles[a.assigned_to]?.team;
        if (filters.team === 'T1' && t !== 'T1 Monitoring') return false;
        if (filters.team === 'T2' && t !== 'T2 Investigations') return false;
      }
      if (filters.sla_status) {
        if (filters.sla_status === 'Breached' && a.sla_bucket !== 'breached') return false;
        if (filters.sla_status === 'At Risk' && a.sla_bucket !== 'at_risk') return false;
        if (filters.sla_status === 'On Time' && a.sla_bucket !== 'on_time') return false;
      }
      if (filters.from && a.created_date < filters.from) return false;
      if (filters.to && a.created_date > filters.to) return false;
      if (filters.q) {
        const q = filters.q.toLowerCase();
        if (!(a.alert_id || '').toLowerCase().includes(q) &&
            !(a.customer_name || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [enriched, filters, analystProfiles]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered; // honour server-side priority bucket sort
    const arr = [...filtered];
    arr.sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      const num = (typeof av === 'number') || (typeof bv === 'number');
      if (num) return sortDir === 'asc' ? (av || 0) - (bv || 0) : (bv || 0) - (av || 0);
      return sortDir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [filters, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const toggleSelect = (id) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleSelectAllOnPage = () => {
    setSelected(prev => {
      const next = new Set(prev);
      const allOnPage = pageRows.every(r => next.has(r.alert_id));
      if (allOnPage) pageRows.forEach(r => next.delete(r.alert_id));
      else pageRows.forEach(r => next.add(r.alert_id));
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());

  const filtersActive = (
    filters.scenarios.length || filters.priority || filters.statuses.length ||
    filters.assigned_to || filters.team || filters.sla_status ||
    filters.from || filters.to || filters.q
  );
  const clearFilters = () => setFilters({
    scenarios: [], priority: '', statuses: [], assigned_to: '',
    team: '', sla_status: '', from: '', to: '', q: ''
  });

  // Full directory (L1 + L2) — used by the Assigned-To filter and the table's
  // Team column lookup, since alerts in the table can have L2 historical owners.
  const allAnalysts = Object.keys(analystProfiles).sort();
  // L1-only — used by the bulk and single Assign controls per spec.
  const assignableAnalysts = useMemo(
    () => l1Analysts.map(u => u.name).sort(),
    [l1Analysts]
  );

  const performBulkAssign = async (analyst) => {
    const ids = [...selected];
    if (ids.length === 0 || !analyst) return;
    setSubmitting(true);
    try {
      // Single transactional call → backend writes ONE consolidated
      // notification for the assignee instead of N (one per alert).
      const { data } = await api.patch('/alerts/bulk-assign', {
        alert_ids: ids,
        assigned_to: analyst,
        assigned_by: 'Compliance Manager'
      });
      const a = data?.assigned ?? 0;
      const s = data?.skipped ?? 0;
      const f = data?.failed ?? 0;
      // Detect at-capacity skips so the toast names the analyst instead
      // of saying "skipped (already assigned)" — those mean the manager's
      // max_alerts_per_analyst setting blocked further assignment.
      const skippedDetails = data?.skipped_details || [];
      const atCapacity = skippedDetails.find(x => /capacity/i.test(x.reason));
      const parts = [`${a} alert${a === 1 ? '' : 's'} assigned to ${analyst}`];
      if (atCapacity) parts.push(`${s} skipped — ${atCapacity.reason}`);
      else if (s > 0) parts.push(`${s} skipped (already assigned)`);
      if (f > 0) parts.push(`${f} failed`);
      push(parts.join(' · '), atCapacity || f > 0 ? 'warning' : 'success');
      setBulkConfirm(null);
      clearSelection();
      await load();
    } catch (e) {
      push('Bulk assign failed: ' + (e.response?.data?.error || e.message), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const performBulkClose = async ({ reason, notes }) => {
    const ids = [...selected];
    if (ids.length === 0 || !reason) return;
    setSubmitting(true);
    try {
      const { data } = await api.patch('/alerts/bulk-close', {
        alert_ids: ids,
        disposition: 'False Positive',
        reason,
        notes: notes || '',
        closed_by: 'Compliance Manager'
      });
      const closedCount = data?.closed ?? 0;
      const skippedCount = data?.skipped ?? 0;
      const parts = [`${closedCount} alert${closedCount === 1 ? '' : 's'} closed as False Positive`];
      if (skippedCount > 0) parts.push(`${skippedCount} skipped`);
      push(parts.join(' · '), 'success');
      setBulkClose(false);
      clearSelection();
      await load();
    } catch (e) {
      push('Failed to close alerts. Please try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const performSingleAssign = async (alert, analyst) => {
    setSubmitting(true);
    try {
      await api.patch(`/alerts/${alert.alert_id}/assign`, { assigned_to: analyst });
      push(`${alert.alert_id} assigned to ${analyst}`, 'success');
      setSingleAssign(null);
      await load();
    } catch (e) {
      push('Assign failed: ' + (e.response?.data?.error || e.message), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const allOnPageSelected = pageRows.length > 0 && pageRows.every(r => selected.has(r.alert_id));

  return (
    <div className="flex gap-4 min-w-0">
      <div className="flex-1 min-w-0 space-y-3">
        <div>
          <div className="text-xl font-bold text-navy-900">Transaction Monitoring Alerts</div>
          <div className="text-sm text-slate-500">
            {alerts.length} alerts team-wide · table view · click any column header to sort
          </div>
        </div>

        {/* Filters bar */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-3 flex flex-wrap items-center gap-2 text-xs">
          <Filter size={12} className="text-slate-400" />
          <MultiSelect label="Scenario" options={distinctScenarios}
            values={filters.scenarios}
            onChange={v => setFilters(f => ({ ...f, scenarios: v }))} />
          <select value={filters.priority} onChange={e => setFilters(f => ({ ...f, priority: e.target.value }))}
            className="border border-slate-200 rounded px-2 py-1 bg-white">
            <option value="">All priority</option>
            {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <MultiSelect label="Status" options={STATUS_OPTIONS}
            values={filters.statuses}
            onChange={v => setFilters(f => ({ ...f, statuses: v }))} />
          <select value={filters.assigned_to} onChange={e => setFilters(f => ({ ...f, assigned_to: e.target.value }))}
            className="border border-slate-200 rounded px-2 py-1 bg-white">
            <option value="">Any analyst</option>
            {allAnalysts.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={filters.team} onChange={e => setFilters(f => ({ ...f, team: e.target.value }))}
            className="border border-slate-200 rounded px-2 py-1 bg-white">
            <option value="">Any team</option>
            <option value="T1">T1 Monitoring</option>
            <option value="T2">T2 Investigations</option>
          </select>
          <select value={filters.sla_status} onChange={e => setFilters(f => ({ ...f, sla_status: e.target.value }))}
            className="border border-slate-200 rounded px-2 py-1 bg-white">
            <option value="">Any SLA</option>
            {SLA_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <input type="date" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))}
            className="border border-slate-200 rounded px-2 py-1" />
          <span className="text-slate-400">to</span>
          <input type="date" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))}
            className="border border-slate-200 rounded px-2 py-1" />
          <div className="relative ml-auto">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={filters.q} onChange={e => setFilters(f => ({ ...f, q: e.target.value }))}
              placeholder="Alert ID or customer"
              className="border border-slate-200 rounded pl-7 pr-2 py-1 w-56" />
          </div>
          {filtersActive ? (
            <button onClick={clearFilters}
              className="text-blue-600 hover:underline inline-flex items-center gap-1">
              <X size={11} /> Clear Filters
            </button>
          ) : null}
        </div>

        {/* Bulk action bar */}
        {selected.size > 0 && (
          <div className="bg-indigo-50 border border-indigo-200 rounded-md px-3 py-2 flex items-center gap-3 text-sm">
            <div className="font-semibold text-indigo-700">{selected.size} alert{selected.size === 1 ? '' : 's'} selected</div>
            <div className="relative">
              <button onClick={() => setBulkOpen(o => !o)}
                className="text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md px-3 py-1.5 inline-flex items-center gap-1">
                <UserPlus size={13} /> Assign To <ChevronDown size={12} />
              </button>
              {bulkOpen && (
                <div className="absolute left-0 top-full mt-1 w-72 bg-white border border-slate-200 rounded-md shadow-xl z-30 max-h-72 overflow-y-auto">
                  {assignableAnalysts.length === 0 && <div className="p-3 text-xs text-slate-400">Loading analysts…</div>}
                  {assignableAnalysts.map(a => (
                    <button key={a} onClick={() => { setBulkOpen(false); setBulkConfirm({ analyst: a, count: selected.size }); }}
                      className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center justify-between gap-2 text-xs border-b border-slate-100">
                      <span>
                        {a}
                        <span className="ml-1 text-[10px] font-bold px-1 rounded bg-blue-100 text-blue-700">L1</span>
                      </span>
                      <span className="text-slate-500">{analystOpenCounts[a] || 0} open</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => setBulkClose(true)}
              className="text-sm border border-red-300 text-red-700 hover:bg-red-50 rounded-md px-3 py-1.5 inline-flex items-center gap-1"
            >
              <ShieldOff size={13} /> Close as False Positive
            </button>
            <button onClick={clearSelection}
              className="text-sm border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md px-3 py-1.5">
              Clear Selection
            </button>
          </div>
        )}

        {/* Table */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="py-2 px-3 text-left">
                    <input type="checkbox"
                      checked={allOnPageSelected}
                      onChange={toggleSelectAllOnPage}
                      title="Select all on page" />
                  </th>
                  {COLS.map(c => (
                    <th key={c.key} onClick={() => toggleSort(c.key)}
                      className="py-2 px-3 text-left font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none whitespace-nowrap">
                      <span className="inline-flex items-center gap-1">
                        {c.label}
                        {sortKey === c.key
                          ? <span>{sortDir === 'desc' ? '▼' : '▲'}</span>
                          : <ArrowUpDown size={10} className="opacity-30" />}
                      </span>
                    </th>
                  ))}
                  <th className="py-2 px-3 text-right font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={COLS.length + 2} className="py-12 text-center text-slate-400">
                    <Loader2 size={14} className="inline animate-spin mr-1" /> Loading alerts…
                  </td></tr>
                )}
                {!loading && pageRows.length === 0 && (
                  <tr><td colSpan={COLS.length + 2} className="py-12 text-center text-slate-400">
                    No alerts match the current filters.
                  </td></tr>
                )}
                {!loading && pageRows.map(a => {
                  const isChecked = selected.has(a.alert_id);
                  const isEscalated = ESCALATED_STATUSES.has(a.alert_status);
                  const closed = isAlertClosed(a);
                  const slaCls = a.sla_bucket === 'breached' ? 'bg-red-50 text-red-700'
                    : a.sla_bucket === 'at_risk' ? 'bg-orange-50 text-orange-700'
                    : a.sla_bucket === 'on_time' ? 'bg-green-50 text-green-700'
                    : a.sla_bucket === 'closed_on_time' ? 'bg-green-50 text-green-700'
                    : a.sla_bucket === 'closed_late' ? 'bg-slate-100 text-slate-600'
                    : 'bg-slate-50 text-slate-600';
                  return (
                    <tr key={a.alert_id} className={`border-b border-slate-100 hover:bg-slate-50 ${isChecked ? 'bg-indigo-50/40' : ''}`}>
                      <td className="py-2 px-3">
                        <input type="checkbox" checked={isChecked} onChange={() => toggleSelect(a.alert_id)} />
                      </td>
                      <td className="py-2 px-3 font-mono">{a.alert_id}</td>
                      <td className="py-2 px-3 font-medium text-navy-900 truncate max-w-[180px]">{a.customer_name}</td>
                      <td className="py-2 px-3">{a.scenario}</td>
                      <td className="py-2 px-3"><Badge value={a.priority} /></td>
                      <td className="py-2 px-3"><Badge value={a.alert_status} /></td>
                      <td className="py-2 px-3">{a.assigned_to || <span className="italic text-slate-400">Unassigned</span>}</td>
                      <td className="py-2 px-3">{a.team}</td>
                      <td className="py-2 px-3 text-right font-mono">{usd(a.amount_flagged_inr)}</td>
                      <td className="py-2 px-3 text-right">
                        {(() => {
                          const ageVal = Number(a.age_days) || 0;
                          // Highlight tiers driven by alert_aging_highlight_days:
                          // > threshold → red bold + "Aging"; > 2× threshold →
                          // dark red + "Critical Age". sla_breached always wins.
                          if (!closed && a.sla_breached) {
                            return <span className="text-red-600 font-semibold">{ageVal}d</span>;
                          }
                          if (!closed && ageVal > agingThreshold * 2) {
                            return (
                              <span className="inline-flex items-center gap-1">
                                <span className="text-red-800 font-bold">{ageVal}d</span>
                                <span className="px-1 py-0 rounded text-[9px] uppercase tracking-wider bg-red-100 text-red-800 font-semibold">Critical Age</span>
                              </span>
                            );
                          }
                          if (!closed && ageVal > agingThreshold) {
                            return (
                              <span className="inline-flex items-center gap-1">
                                <span className="text-red-600 font-semibold">{ageVal}d</span>
                                <span className="px-1 py-0 rounded text-[9px] uppercase tracking-wider bg-red-50 text-red-700">Aging</span>
                              </span>
                            );
                          }
                          return `${ageVal}d`;
                        })()}
                      </td>
                      <td className="py-2 px-3 text-[11px] text-slate-500">{a.sla_deadline || '—'}</td>
                      <td className="py-2 px-3">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${slaCls}`}>
                          {!closed && a.sla_bucket === 'breached' && <AlertTriangle size={10} className="mr-1" />}
                          {a.sla_status}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-[11px] text-slate-500">{a.created_date}</td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        <button onClick={() => onSelect ? onSelect(a) : setViewing(a)}
                          className="text-[11px] border border-slate-200 hover:border-blue-400 hover:text-blue-600 rounded px-2 py-1 inline-flex items-center gap-1 mr-1">
                          <Eye size={11} /> View
                        </button>
                        <button onClick={() => setSingleAssign(a)}
                          disabled={isEscalated || closed}
                          title={closed ? 'Alert is closed' : ''}
                          className="text-[11px] bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded px-2 py-1 inline-flex items-center gap-1">
                          <UserPlus size={11} /> Assign
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="px-3 py-2 border-t border-slate-100 flex items-center justify-between text-xs">
            <div className="text-slate-500">
              {sorted.length === 0
                ? 'Showing 0 of 0 alerts'
                : `Showing ${(safePage - 1) * PAGE_SIZE + 1}–${Math.min(safePage * PAGE_SIZE, sorted.length)} of ${sorted.length} alerts`}
            </div>
            <Pagination page={safePage} totalPages={totalPages} onChange={setPage} />
          </div>
        </div>
      </div>

      {/* Right detail panel */}
      {viewing && (
        <ManagerDetail alert={viewing} onClose={() => setViewing(null)} />
      )}

      {/* Bulk confirm modal */}
      {bulkConfirm && (
        <ConfirmModal
          title={`Assign ${bulkConfirm.count} alert${bulkConfirm.count === 1 ? '' : 's'} to ${bulkConfirm.analyst}?`}
          submitting={submitting}
          onCancel={() => setBulkConfirm(null)}
          onConfirm={() => performBulkAssign(bulkConfirm.analyst)}
          confirmLabel={`Assign ${bulkConfirm.count}`}
        />
      )}

      {/* Single-alert assign modal */}
      {singleAssign && (
        <SingleAssignModal
          alert={singleAssign}
          analysts={assignableAnalysts}
          analystProfiles={analystProfiles}
          analystOpenCounts={analystOpenCounts}
          submitting={submitting}
          onCancel={() => setSingleAssign(null)}
          onSubmit={(analyst) => performSingleAssign(singleAssign, analyst)}
        />
      )}

      {/* Bulk close as False Positive */}
      {bulkClose && (
        <BulkFalsePositiveModal
          alerts={enriched.filter(a => selected.has(a.alert_id))}
          submitting={submitting}
          onCancel={() => setBulkClose(false)}
          onConfirm={performBulkClose}
        />
      )}
    </div>
  );
}

function MultiSelect({ label, options, values, onChange }) {
  const [open, setOpen] = useState(false);
  const display = values.length === 0 ? `All ${label.toLowerCase()}` : `${label}: ${values.length}`;
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="border border-slate-200 rounded px-2 py-1 bg-white inline-flex items-center gap-1">
        {display} <ChevronDown size={11} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-52 bg-white border border-slate-200 rounded-md shadow-xl z-20 max-h-64 overflow-y-auto">
          {options.map(opt => {
            const selected = values.includes(opt);
            return (
              <button key={opt}
                onClick={() => onChange(selected ? values.filter(v => v !== opt) : [...values, opt])}
                className={`w-full text-left px-2 py-1 text-[11px] flex items-center gap-1 hover:bg-slate-50 ${selected ? 'text-blue-700 font-medium' : ''}`}>
                <input type="checkbox" readOnly checked={selected} className="pointer-events-none" />
                {opt}
              </button>
            );
          })}
          <div className="border-t border-slate-100 px-2 py-1 flex justify-between">
            <button onClick={() => onChange([])} className="text-[11px] text-slate-500 hover:underline">Clear</button>
            <button onClick={() => setOpen(false)} className="text-[11px] text-blue-600 hover:underline">Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Pagination({ page, totalPages, onChange }) {
  const pages = [];
  const window = 1;
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - page) <= window) pages.push(i);
    else if (pages[pages.length - 1] !== '…') pages.push('…');
  }
  return (
    <div className="flex items-center gap-1">
      <button disabled={page <= 1} onClick={() => onChange(page - 1)}
        className="p-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50">
        <ChevronLeft size={12} />
      </button>
      {pages.map((p, i) => p === '…' ? (
        <span key={i} className="px-2 text-slate-400">…</span>
      ) : (
        <button key={i} onClick={() => onChange(p)}
          className={`px-2 py-1 rounded ${p === page ? 'bg-blue-600 text-white' : 'hover:bg-slate-100 text-slate-700'}`}>
          {p}
        </button>
      ))}
      <button disabled={page >= totalPages} onClick={() => onChange(page + 1)}
        className="p-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50">
        <ChevronRight size={12} />
      </button>
    </div>
  );
}

function ManagerDetail({ alert, onClose }) {
  const closed = isAlertClosed(alert);
  const sla = slaSnapshot(alert);
  return (
    <aside className="w-[400px] shrink-0 bg-white rounded-lg border border-slate-200 shadow-lg h-[calc(100vh-96px)] sticky top-20 flex flex-col">
      <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-slate-100">
        <div className="min-w-0">
          <div className="text-xs font-mono text-slate-500">{alert.alert_id}</div>
          <div className="text-base font-semibold text-navy-900 truncate">{alert.customer_name}</div>
          <div className="text-xs text-slate-500 mt-0.5">{alert.scenario}</div>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X size={16} /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-5 space-y-2 text-xs">
        <div className="text-[10px] uppercase text-slate-400 italic mb-2">Manager view · read-only</div>
        <Row k="Status" v={<Badge value={alert.alert_status} />} />
        <Row k="Priority" v={<Badge value={alert.priority} />} />
        <Row k="Risk Score" v={`${alert.risk_score}/100`} />
        <Row k="Assigned" v={alert.assigned_to || '—'} />
        <Row k="Team" v={alert.team} />
        <Row k="Amount" v={usd(alert.amount_flagged_inr)} />
        <Row k="Counterparty" v={alert.counterparty_country || '—'} />
        <Row k="Channel" v={alert.channel || '—'} />
        <Row k="Branch" v={alert.branch || '—'} />
        <Row k="Created" v={alert.created_date} />
        <Row k="SLA Due" v={alert.sla_deadline || '—'} />
        <Row k="Age" v={`${alert.age_days} / ${alert.sla_days} days`} />
        <Row k="SLA" v={
          closed
            ? <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${sla.tone}`}>{sla.label}</span>
            : <span className={alert.sla_breached ? 'text-red-600 font-semibold' : 'text-green-600'}>{alert.sla_status}</span>
        } />
        <Row k="Case ID" v={alert.case_id || '—'} />
        <Row k="Linked SAR" v={alert.linked_sar_id || '—'} />
        {closed
          ? <div className="pt-2"><OutcomeCard alert={alert} /></div>
          : <Row k="Disposition" v={alert.disposition || '—'} />}
        <div className="pt-2 text-slate-600 bg-slate-50 p-2 rounded">{alert.scenario_description}</div>
      </div>
    </aside>
  );
}

function Row({ k, v }) {
  return (
    <div className="flex items-start justify-between gap-2 text-xs">
      <span className="text-slate-500">{k}</span>
      <span className="text-navy-900 font-medium text-right break-words">{v}</span>
    </div>
  );
}

function ConfirmModal({ title, submitting, onCancel, onConfirm, confirmLabel }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-100 font-semibold text-navy-900">{title}</div>
        <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onCancel} className="text-sm border border-slate-300 rounded px-3 py-1.5 hover:bg-slate-50">Cancel</button>
          <button onClick={onConfirm} disabled={submitting}
            className="text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded px-3 py-1.5">
            {submitting ? 'Assigning…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function SingleAssignModal({ alert, analysts, analystProfiles, analystOpenCounts, submitting, onCancel, onSubmit }) {
  const [target, setTarget] = useState(alert.assigned_to || analysts[0] || '');
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-100 font-semibold text-navy-900">Assign {alert.alert_id}</div>
        <div className="p-5 space-y-3 text-sm">
          <div className="text-slate-600">Currently assigned to <span className="font-medium">{alert.assigned_to || 'Unassigned'}</span>.</div>
          <select value={target} onChange={e => setTarget(e.target.value)}
            className="w-full border border-slate-200 rounded px-2 py-1.5 bg-white">
            {analysts.map(a => {
              const lvl = analystProfiles[a]?.level || '';
              return (
                <option key={a} value={a}>
                  {a} ({lvl}) — {analystOpenCounts[a] || 0} open
                </option>
              );
            })}
          </select>
        </div>
        <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onCancel} className="text-sm border border-slate-300 rounded px-3 py-1.5 hover:bg-slate-50">Cancel</button>
          <button onClick={() => onSubmit(target)} disabled={!target || submitting}
            className="text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded px-3 py-1.5">
            {submitting ? 'Assigning…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

const FP_REASONS = [
  'Rule threshold too sensitive',
  'Customer activity explained by business type',
  'Duplicate of existing alert',
  'Transaction within expected profile',
  'Counterparty verified and low risk',
  'Insufficient evidence of suspicion',
  'Other'
];

function BulkFalsePositiveModal({ alerts, submitting, onCancel, onConfirm }) {
  const [reason, setReason] = useState('');
  const [otherText, setOtherText] = useState('');
  const [notes, setNotes] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);

  const skippedAlerts  = alerts.filter(a => isAlertClosed(a));
  const closeableAlerts = alerts.filter(a => !isAlertClosed(a));
  const closeableCount = closeableAlerts.length;
  const skippedCount   = skippedAlerts.length;

  const scenarioCounts = closeableAlerts.reduce((m, a) => {
    const k = a.scenario || 'Unknown';
    m[k] = (m[k] || 0) + 1;
    return m;
  }, {});
  const scenarioEntries = Object.entries(scenarioCounts).sort((a, b) => b[1] - a[1]);

  const effectiveReason = reason === 'Other' ? otherText.trim() : reason;
  const reasonValid = reason && (reason !== 'Other' || otherText.trim().length > 0);
  const canSubmit = closeableCount > 0 && reasonValid && confirmed && !submitting;

  const submit = () => {
    if (!canSubmit) return;
    onConfirm({ reason: effectiveReason, notes });
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <div className="font-semibold text-navy-900 inline-flex items-center gap-2">
            <ShieldOff size={16} className="text-red-600" />
            Close Alerts as False Positive
          </div>
          <button onClick={onCancel} className="p-1 rounded hover:bg-slate-100">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4 text-sm overflow-y-auto">
          <div className="text-slate-700">
            You are closing <span className="font-semibold text-navy-900">{closeableCount}</span> alert{closeableCount === 1 ? '' : 's'} as False Positive.
          </div>

          {scenarioEntries.length > 1 && (
            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Scenario breakdown</div>
              <div className="space-y-0.5">
                {scenarioEntries.map(([s, n]) => (
                  <div key={s} className="flex items-center justify-between">
                    <span className="text-slate-700">{s}</span>
                    <span className="font-semibold text-navy-900">{n}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {skippedCount > 0 && (
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <div className="flex items-center gap-1.5 font-semibold">
                <AlertCircle size={12} />
                {skippedCount} alert{skippedCount === 1 ? ' is' : 's are'} already closed and will be skipped.
              </div>
              <button
                type="button"
                onClick={() => setShowSkipped(s => !s)}
                className="mt-1 text-amber-800 hover:underline text-[11px] inline-flex items-center gap-0.5"
              >
                {showSkipped ? '▴ Hide skipped alerts' : '▾ Show skipped alerts'}
              </button>
              {showSkipped && (
                <div className="mt-1.5 max-h-28 overflow-y-auto font-mono text-[11px] text-amber-900 space-y-0.5">
                  {skippedAlerts.map(a => (
                    <div key={a.alert_id}>{a.alert_id} <span className="text-amber-700">· {a.alert_status}</span></div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Reason for False Positive closure <span className="text-red-600">*</span>
            </label>
            <select
              value={reason}
              onChange={e => setReason(e.target.value)}
              className="w-full text-sm border border-slate-200 rounded-md px-2 py-1.5 bg-white"
            >
              <option value="">— select a reason —</option>
              {FP_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            {reason === 'Other' && (
              <input
                type="text"
                value={otherText}
                onChange={e => setOtherText(e.target.value)}
                placeholder="Specify the reason"
                className="mt-2 w-full text-sm border border-slate-200 rounded-md px-2 py-1.5"
              />
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Additional notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder="Add any context for the audit trail..."
              className="w-full text-sm border border-slate-200 rounded-md px-2 py-1.5 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={e => setConfirmed(e.target.checked)}
              className="mt-0.5"
            />
            <span>I confirm these alerts have been reviewed and are not suspicious</span>
          </label>
        </div>

        <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={submitting}
            className="text-sm border border-slate-300 rounded px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="text-sm bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded px-3 py-1.5 inline-flex items-center gap-1"
          >
            {submitting && <Loader2 size={13} className="animate-spin" />}
            {submitting ? 'Closing…' : `Close ${closeableCount} Alert${closeableCount === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
