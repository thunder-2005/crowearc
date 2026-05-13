import { useEffect, useMemo, useState } from 'react';
import api from '../api/client.js';
import { useRoleNavigate } from '../state/useRoleNavigate.js';
import Card, { KpiCard } from '../components/shared/Card.jsx';
import Badge from '../components/shared/Badge.jsx';
import Table from '../components/shared/Table.jsx';
import { useRole } from '../state/RoleContext.jsx';
import { useToast } from '../state/ToastContext.jsx';
import {
  Search, Filter, UserPlus, Eye, AlertTriangle, Inbox, AlertOctagon,
  Calendar, Briefcase, CheckCircle2, Zap, X, Plus
} from 'lucide-react';

const TABS = [
  { k: 'overdue',    label: 'Overdue' },
  { k: 'due_soon',   label: 'Due Soon' },
  { k: 'in_progress',label: 'In Progress' },
  { k: 'completed',  label: 'Completed' },
  { k: 'all',        label: 'All' }
];

const TYPE_TONES = {
  scheduled:        'bg-blue-100 text-blue-700',
  triggered_sar:    'bg-red-100 text-red-700',
  triggered_alerts: 'bg-orange-100 text-orange-700',
  manual:           'bg-slate-200 text-slate-700'
};
const TYPE_LABELS = {
  scheduled:        'Scheduled',
  triggered_sar:    'Triggered — SAR',
  triggered_alerts: 'Triggered — Alerts',
  manual:           'Manual'
};

function daysFromToday(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr.length <= 10 ? `${dateStr}T00:00:00` : dateStr);
  if (isNaN(d.getTime())) return null;
  const t = (d.getTime() - Date.now()) / 86400000;
  return Math.round(t);
}

export default function KYCReviewQueue({ scope = 'manager' }) {
  const { isManager, isL1, currentAnalyst } = useRole();
  const { goTo } = useRoleNavigate();
  const { push } = useToast();
  const isMine = scope === 'mine';

  const [tab, setTab] = useState('overdue');
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(null);
  const [analysts, setAnalysts] = useState([]);
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [assignedFilter, setAssignedFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [assigning, setAssigning] = useState(null);

  // Bulk-assign — both L1 and L2 analysts are valid targets for KYC reviews
  // (spec). Manager view only.
  const [selected, setSelected] = useState(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState(null); // { analyst, count }
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  const reload = async () => {
    const params = { status: tab === 'all' ? '' : tab };
    if (q) params.q = q;
    if (typeFilter) params.type = typeFilter;
    if (assignedFilter) params.assigned_to = assignedFilter;
    if (isMine && currentAnalyst) params.assigned_to = currentAnalyst;
    const [{ data: rs }, { data: s }] = await Promise.all([
      api.get('/kyc-reviews', { params }),
      api.get('/kyc-reviews/stats')
    ]);
    setRows(rs);
    setStats(s);
  };

  useEffect(() => { reload(); }, [tab, typeFilter, assignedFilter]);
  useEffect(() => {
    api.get('/users').then(r => setAnalysts(r.data)).catch(() => setAnalysts([]));
  }, []);

  const visible = useMemo(() => rows.filter(r => {
    if (!q) return true;
    const needle = q.toLowerCase();
    return (r.customer_id || '').toLowerCase().includes(needle)
        || (r.customer_name || '').toLowerCase().includes(needle);
  }), [rows, q]);

  // Drop selections that no longer exist on the visible page (after filters/tabs)
  useEffect(() => {
    const visibleIds = new Set(visible.map(r => r.id));
    setSelected(prev => {
      const next = new Set([...prev].filter(id => visibleIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [visible]);

  const toggleSelect = (id) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleSelectAllVisible = () => setSelected(prev => {
    const visibleIds = visible.map(r => r.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every(id => prev.has(id));
    const next = new Set(prev);
    if (allSelected) visibleIds.forEach(id => next.delete(id));
    else visibleIds.forEach(id => next.add(id));
    return next;
  });
  const clearSelection = () => setSelected(new Set());

  // Show analysts as "Robert Wright (L1)" / "Olivia Brown (L2)" — both
  // levels are valid KYC reviewers. Filter to AML Analyst* roles only.
  const assignableAnalysts = useMemo(() => {
    return (analysts || [])
      .filter(u => /AML\s+Analyst/i.test(u.role || '') || /^analyst_(l1|l2)$/i.test(u.role || ''))
      .map(u => ({
        ...u,
        level: /L2|_l2/i.test(u.role || '') ? 'L2' : 'L1'
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [analysts]);

  const performBulkAssign = async (analystName) => {
    const ids = [...selected];
    if (ids.length === 0 || !analystName) return;
    setBulkSubmitting(true);
    try {
      const { data } = await api.patch('/kyc-reviews/bulk-assign', {
        review_ids: ids,
        assigned_to: analystName,
        assigned_by: 'Compliance Manager'
      });
      const assigned = data?.assigned ?? 0;
      const failed = data?.failed ?? 0;
      const parts = [`${assigned} KYC review${assigned === 1 ? '' : 's'} assigned to ${analystName}`];
      if (failed > 0) parts.push(`${failed} failed`);
      push(parts.join(' · '), failed > 0 ? 'warning' : 'success');
      setBulkConfirm(null);
      clearSelection();
      await reload();
    } catch (e) {
      push('Bulk assign failed: ' + (e.response?.data?.error || e.message), 'error');
    } finally {
      setBulkSubmitting(false);
    }
  };

  if (!isMine && !isManager) {
    return (
      <div className="text-center py-20 text-slate-500">
        <AlertTriangle size={32} className="mx-auto text-orange-400 mb-3" />
        KYC Review Queue is a manager-only view.
      </div>
    );
  }

  return (
    <div className="space-y-4 min-w-0">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xl font-bold text-navy-900">
            {isMine ? `My KYC Reviews — ${currentAnalyst || ''}` : 'KYC Periodic Reviews'}
          </div>
          <div className="text-sm text-slate-500">
            {isMine ? 'Reviews assigned to you' : 'Schedule, assign, and track customer KYC reviews'}
          </div>
        </div>
        {!isMine && (
          <button onClick={() => setCreateOpen(true)}
            className="text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md px-3 py-2 inline-flex items-center gap-1">
            <Plus size={14} /> Create Manual Review
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="Total Due"            value={stats?.total ?? '—'}                icon={Inbox} />
        <KpiCard label="Overdue"              value={stats?.overdue ?? '—'}              icon={AlertOctagon} tone="red" />
        <KpiCard label="Due This Month"       value={stats?.due_this_month ?? '—'}       icon={Calendar}     tone="orange" />
        <KpiCard label="In Progress"          value={stats?.in_progress ?? '—'}          icon={Briefcase}    tone="blue" />
        <KpiCard label="Completed (Month)"    value={stats?.completed_this_month ?? '—'} icon={CheckCircle2} tone="green" />
        <KpiCard label="Triggered"            value={stats?.triggered ?? '—'}            icon={Zap}          tone="orange" />
      </div>

      <Card bodyClassName="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[260px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              placeholder="Search by Customer ID or Name"
              value={q}
              onChange={e => setQ(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-md focus:border-blue-500 focus:outline-none"
            />
          </div>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
            className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white">
            <option value="">All types</option>
            <option value="scheduled">Scheduled</option>
            {!isL1 && <option value="triggered_sar">Triggered — SAR</option>}
            <option value="triggered_alerts">Triggered — Alerts</option>
            <option value="manual">Manual</option>
          </select>
          <select value={assignedFilter} onChange={e => setAssignedFilter(e.target.value)}
            className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white">
            <option value="">All analysts</option>
            {analysts.map(a => <option key={a.user_id} value={a.name}>{a.name}</option>)}
          </select>
          <button onClick={reload}
            className="text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md px-3 py-2 inline-flex items-center gap-1">
            <Filter size={14} /> Apply
          </button>
        </div>
      </Card>

      {/* Bulk action bar (manager view, ≥1 selected) */}
      {!isMine && selected.size > 0 && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-md px-3 py-2 flex items-center gap-3 text-sm">
          <div className="font-semibold text-indigo-700">
            {selected.size} review{selected.size === 1 ? '' : 's'} selected
          </div>
          <div className="relative">
            <button onClick={() => setBulkOpen(o => !o)}
              className="text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md px-3 py-1.5 inline-flex items-center gap-1">
              <UserPlus size={13} /> Assign To <Filter size={11} className="opacity-70" />
            </button>
            {bulkOpen && (
              <div className="absolute left-0 top-full mt-1 w-72 bg-white border border-slate-200 rounded-md shadow-xl z-30 max-h-72 overflow-y-auto">
                {assignableAnalysts.length === 0 && (
                  <div className="p-3 text-xs text-slate-400">Loading analysts…</div>
                )}
                {assignableAnalysts.map(u => (
                  <button key={u.user_id || u.name}
                    onClick={() => { setBulkOpen(false); setBulkConfirm({ analyst: u.name, count: selected.size }); }}
                    className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 text-xs border-b border-slate-100">
                    <span>{u.name}</span>
                    <span className={`text-[10px] font-bold px-1 rounded ${
                      u.level === 'L2' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                    }`}>{u.level}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={clearSelection}
            className="text-sm border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md px-3 py-1.5">
            Clear Selection
          </button>
        </div>
      )}

      <Card bodyClassName="p-0">
        <div className="flex border-b border-slate-200 bg-slate-50/60 overflow-x-auto">
          {TABS.map(t => {
            const active = tab === t.k;
            const badge = t.k === 'overdue' && stats?.overdue ? stats.overdue : null;
            return (
              <button key={t.k} onClick={() => setTab(t.k)}
                className={`px-4 py-2.5 text-xs font-medium inline-flex items-center gap-1.5 border-b-2 ${
                  active ? 'text-blue-600 border-blue-600 bg-white' : 'text-slate-600 border-transparent hover:text-navy-900'
                }`}>
                {t.label}
                {badge ? <span className="text-[10px] font-semibold bg-red-500 text-white rounded-full px-1.5 py-0.5">{badge}</span> : null}
              </button>
            );
          })}
        </div>
        <Table
          rows={visible}
          emptyMessage="No reviews match this filter"
          columns={[
            ...(isMine ? [] : [{
              key: '__select',
              label: (
                <input
                  type="checkbox"
                  checked={visible.length > 0 && visible.every(r => selected.has(r.id))}
                  onChange={toggleSelectAllVisible}
                  title="Select all visible"
                  onClick={e => e.stopPropagation()}
                />
              ),
              render: r => (
                <input
                  type="checkbox"
                  checked={selected.has(r.id)}
                  onChange={(e) => { e.stopPropagation(); toggleSelect(r.id); }}
                  onClick={e => e.stopPropagation()}
                />
              )
            }]),
            { key: 'customer_id', label: 'Customer ID',
              render: r => <span className="font-mono text-xs text-navy-900 font-medium">{r.customer_id}</span> },
            { key: 'customer_name', label: 'Name', cellClass: 'font-medium' },
            { key: 'customer_risk_rating', label: 'Risk',
              render: r => <Badge value={r.customer_risk_rating || r.previous_risk_rating} /> },
            { key: 'cdd_level', label: 'CDD',
              render: r => r.cdd_level || r.previous_cdd_level || '—' },
            { key: 'review_type', label: 'Type',
              render: r => {
                // L1 must never see the SAR-tagged trigger type label.
                const label = (isL1 && r.review_type === 'triggered_sar')
                  ? 'Triggered'
                  : (TYPE_LABELS[r.review_type] || r.review_type);
                return (
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_TONES[r.review_type] || 'bg-slate-100 text-slate-600'}`}>
                    {label}
                  </span>
                );
              } },
            { key: 'due_date', label: 'Due Date' },
            { key: 'days_remaining', label: 'Days',
              render: r => {
                const d = daysFromToday(r.due_date);
                if (d == null) return '—';
                if (d < 0)  return <span className="text-red-600 font-semibold">{Math.abs(d)}d overdue</span>;
                if (d <= 30) return <span className="text-orange-600">{d}d left</span>;
                return <span className="text-green-700">{d}d left</span>;
              } },
            { key: 'assigned_to', label: 'Assigned',
              render: r => r.assigned_to || <span className="italic text-slate-400">—</span> },
            { key: 'status', label: 'Status',
              render: r => <Badge value={statusLabel(r.status)} /> },
            { key: 'actions', label: '',
              render: r => (
                <div className="flex items-center gap-1 justify-end" onClick={e => e.stopPropagation()}>
                  <button onClick={() => setAssigning(r)}
                    title="Assign"
                    className="px-2 py-1 rounded text-xs bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1">
                    <UserPlus size={12} /> Assign
                  </button>
                  <button onClick={() => goTo(`kyc-review/${r.id}`)}
                    title="View"
                    className="px-2 py-1 rounded text-xs border border-slate-200 hover:border-blue-400 hover:text-blue-600 inline-flex items-center gap-1">
                    <Eye size={12} /> View
                  </button>
                </div>
              )
            }
          ]}
        />
      </Card>

      {assigning && (
        <AssignModal
          review={assigning}
          analysts={analysts}
          onCancel={() => setAssigning(null)}
          onAssigned={async () => { setAssigning(null); push('Review assigned', 'success'); reload(); }}
        />
      )}

      {createOpen && (
        <CreateManualModal
          analysts={analysts}
          onCancel={() => setCreateOpen(false)}
          onCreated={async () => { setCreateOpen(false); push('Review created', 'success'); reload(); }}
        />
      )}

      {bulkConfirm && (
        <BulkAssignConfirm
          analyst={bulkConfirm.analyst}
          count={bulkConfirm.count}
          submitting={bulkSubmitting}
          onCancel={() => setBulkConfirm(null)}
          onConfirm={() => performBulkAssign(bulkConfirm.analyst)}
        />
      )}
    </div>
  );
}

function BulkAssignConfirm({ analyst, count, submitting, onCancel, onConfirm }) {
  return (
    <Modal title={`Assign ${count} KYC review${count === 1 ? '' : 's'} to ${analyst}?`} onCancel={onCancel}>
      <div className="p-5 text-sm text-slate-700">
        Each review will be assigned to <span className="font-semibold text-navy-900">{analyst}</span> and
        an audit-trail entry will be added. The assignee will receive an in-app notification.
      </div>
      <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
        <button onClick={onCancel} disabled={submitting}
          className="text-sm px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50 disabled:opacity-50">
          Cancel
        </button>
        <button onClick={onConfirm} disabled={submitting}
          className="text-sm px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white">
          {submitting ? 'Assigning…' : `Assign ${count}`}
        </button>
      </div>
    </Modal>
  );
}

function statusLabel(s) {
  return ({
    pending: 'Pending', overdue: 'Overdue', assigned: 'Assigned',
    in_progress: 'In Progress', pending_approval: 'Pending Approval',
    returned: 'Returned for Revision', completed: 'Completed', rejected: 'Rejected'
  })[s] || s;
}

function AssignModal({ review, analysts, onCancel, onAssigned }) {
  const [assignedTo, setAssignedTo] = useState(review.assigned_to || '');
  const [dueDate, setDueDate] = useState(review.due_date || '');
  const [priority, setPriority] = useState(review.priority || 'Normal');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!assignedTo) return;
    setSubmitting(true);
    try {
      await api.patch(`/kyc-reviews/${review.id}/assign`, {
        assigned_to: assignedTo,
        assigned_by: 'Compliance Manager',
        assigned_note: note,
        due_date: dueDate, priority
      });
      onAssigned();
    } catch (e) {
      alert(e.response?.data?.error || e.message);
    } finally { setSubmitting(false); }
  };

  return (
    <Modal title={`Assign Review — ${review.customer_name}`} onCancel={onCancel}>
      <div className="p-5 space-y-3">
        <div>
          <label className="text-xs font-semibold text-slate-700">Assign to <span className="text-red-500">*</span></label>
          <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)}
            className="mt-1 w-full text-sm border border-slate-200 rounded px-2 py-1.5 bg-white">
            <option value="">— select analyst —</option>
            {analysts.map(a => (
              <option key={a.user_id} value={a.name}>
                {a.name} · {a.role} · {a.stats?.open_alerts ?? 0} open · {a.stats?.cases_in_progress ?? 0} cases
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-slate-700">Due date</label>
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
              className="mt-1 w-full text-sm border border-slate-200 rounded px-2 py-1.5" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700">Priority</label>
            <select value={priority} onChange={e => setPriority(e.target.value)}
              className="mt-1 w-full text-sm border border-slate-200 rounded px-2 py-1.5 bg-white">
              <option>Normal</option><option>Urgent</option>
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-700">Note to analyst (optional)</label>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
            className="mt-1 w-full text-sm border border-slate-200 rounded p-2 focus:border-blue-500 focus:outline-none" />
        </div>
      </div>
      <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
        <button onClick={onCancel} className="text-sm px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50">Cancel</button>
        <button onClick={submit} disabled={!assignedTo || submitting}
          className="text-sm px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white">
          {submitting ? 'Assigning…' : 'Assign Review'}
        </button>
      </div>
    </Modal>
  );
}

function CreateManualModal({ analysts, onCancel, onCreated }) {
  const [customerId, setCustomerId] = useState('');
  const [customerOptions, setCustomerOptions] = useState([]);
  const [assignedTo, setAssignedTo] = useState('');
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [priority, setPriority] = useState('Normal');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get('/customers').then(r => setCustomerOptions(r.data.slice(0, 100))).catch(() => {});
  }, []);

  const submit = async () => {
    if (!customerId) return;
    setSubmitting(true);
    try {
      await api.post('/kyc-reviews', {
        customer_id: customerId,
        review_type: 'manual',
        due_date: dueDate,
        priority,
        assigned_to: assignedTo || null,
        assigned_by: 'Compliance Manager',
        assigned_note: note
      });
      onCreated();
    } catch (e) {
      alert(e.response?.data?.error || e.message);
    } finally { setSubmitting(false); }
  };

  return (
    <Modal title="Create Manual KYC Review" onCancel={onCancel}>
      <div className="p-5 space-y-3">
        <div>
          <label className="text-xs font-semibold text-slate-700">Customer <span className="text-red-500">*</span></label>
          <select value={customerId} onChange={e => setCustomerId(e.target.value)}
            className="mt-1 w-full text-sm border border-slate-200 rounded px-2 py-1.5 bg-white">
            <option value="">— select customer —</option>
            {customerOptions.map(c => <option key={c.customer_id} value={c.customer_id}>{c.customer_id} · {c.customer_name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-700">Assign to (optional)</label>
          <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)}
            className="mt-1 w-full text-sm border border-slate-200 rounded px-2 py-1.5 bg-white">
            <option value="">— unassigned —</option>
            {analysts.map(a => <option key={a.user_id} value={a.name}>{a.name} · {a.role}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-slate-700">Due date</label>
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
              className="mt-1 w-full text-sm border border-slate-200 rounded px-2 py-1.5" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700">Priority</label>
            <select value={priority} onChange={e => setPriority(e.target.value)}
              className="mt-1 w-full text-sm border border-slate-200 rounded px-2 py-1.5 bg-white">
              <option>Normal</option><option>Urgent</option>
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-700">Note (optional)</label>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
            className="mt-1 w-full text-sm border border-slate-200 rounded p-2 focus:border-blue-500 focus:outline-none" />
        </div>
      </div>
      <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
        <button onClick={onCancel} className="text-sm px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50">Cancel</button>
        <button onClick={submit} disabled={!customerId || submitting}
          className="text-sm px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white">
          {submitting ? 'Creating…' : 'Create Review'}
        </button>
      </div>
    </Modal>
  );
}

function Modal({ title, children, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-lg w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3 p-5 border-b border-slate-100">
          <div className="font-semibold text-navy-900 flex-1">{title}</div>
          <button onClick={onCancel} className="p-1 rounded hover:bg-slate-100"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
