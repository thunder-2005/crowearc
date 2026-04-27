import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client.js';
import Card, { KpiCard } from '../components/shared/Card.jsx';
import Badge from '../components/shared/Badge.jsx';
import Table from '../components/shared/Table.jsx';
import { useRole } from '../state/RoleContext.jsx';
import { useToast } from '../state/ToastContext.jsx';
import {
  Search, Filter, Inbox, CheckCircle2, XCircle, Clock,
  Eye, Zap, AlertTriangle
} from 'lucide-react';

const STATUS_OPTIONS = ['', 'Pending Approval', 'Under Manager Review', 'Returned for Revision'];
const PRIORITY_OPTIONS = ['', 'High', 'Medium', 'Low'];

function daysSince(iso) {
  if (!iso) return null;
  const t = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z';
  const dt = new Date(t);
  if (isNaN(dt.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - dt.getTime()) / 86400000));
}

export default function SARApprovalQueue() {
  const { isManager } = useRole();
  const { push } = useToast();
  const navigate = useNavigate();

  const [items, setItems] = useState([]);
  const [stats, setStats] = useState(null);
  const [analysts, setAnalysts] = useState([]);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [filedBy, setFiledBy] = useState('');
  const [priority, setPriority] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const reload = async () => {
    const params = {};
    if (q) params.q = q;
    if (statusFilter) params.sar_status = statusFilter;
    if (filedBy) params.prepared_by = filedBy;
    if (priority) params.priority = priority;
    if (from) params.from = from;
    if (to)   params.to = to;
    const [{ data: rows }, { data: s }] = await Promise.all([
      api.get('/sar-approvals', { params }),
      api.get('/sar-approvals/stats')
    ]);
    setItems(rows);
    setStats(s);
  };

  useEffect(() => { reload(); }, [statusFilter, filedBy, priority, from, to]);

  useEffect(() => {
    api.get('/alerts/analysts').then(r => setAnalysts(r.data.map(a => a.analyst))).catch(() => {});
  }, []);

  const visible = useMemo(() => items.filter(r => {
    if (!q) return true;
    const needle = q.toLowerCase();
    return (r.sar_id || '').toLowerCase().includes(needle)
        || (r.case_id || '').toLowerCase().includes(needle)
        || (r.customer_name || '').toLowerCase().includes(needle);
  }), [items, q]);

  const review = (r) => navigate(`/sar-approval/${r.sar_id}`);

  const quickApprove = async (r) => {
    if (!confirm(`Quick-approve ${r.sar_id} for ${r.customer_name}? It will be filed immediately.`)) return;
    try {
      await api.post(`/sar-approvals/${r.sar_id}/approve`, {
        approved_by: 'Compliance Manager',
        notes: 'Quick-approved from queue (validation all green).',
        checklist: { quick_approve: true }
      });
      push(`SAR ${r.sar_id} approved and filed`, 'success');
      reload();
    } catch (e) {
      push('Approval failed: ' + (e.response?.data?.error || e.message), 'error');
    }
  };

  if (!isManager) {
    return (
      <div className="text-center py-20 text-slate-500">
        <AlertTriangle size={32} className="mx-auto text-orange-400 mb-3" />
        SAR Approval Queue is a manager-only view.
      </div>
    );
  }

  return (
    <div className="space-y-4 min-w-0">
      <div>
        <div className="text-xl font-bold text-navy-900">SAR Approval Queue</div>
        <div className="text-sm text-slate-500">Review and action SAR submissions from analysts</div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Pending Approval"      value={stats?.pending ?? '—'}              icon={Inbox}       tone="orange" />
        <KpiCard label="Approved This Month"   value={stats?.approved_this_month ?? '—'}  icon={CheckCircle2} tone="green" />
        <KpiCard label="Rejected This Month"   value={stats?.rejected_this_month ?? '—'}  icon={XCircle}     tone="red" />
        <KpiCard label="Avg Review (hours)"    value={stats?.avg_review_hours ?? '—'}     icon={Clock}       tone="blue" />
      </div>

      <Card bodyClassName="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[260px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              placeholder="Search by SAR ID, Case ID, Customer Name"
              value={q}
              onChange={e => setQ(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-md focus:border-blue-500 focus:outline-none"
            />
          </div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white">
            {STATUS_OPTIONS.map(s => <option key={s || '_any'} value={s}>{s || 'All status'}</option>)}
          </select>
          <select value={filedBy} onChange={e => setFiledBy(e.target.value)}
            className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white">
            <option value="">All analysts</option>
            {analysts.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={priority} onChange={e => setPriority(e.target.value)}
            className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white">
            {PRIORITY_OPTIONS.map(p => <option key={p || '_any'} value={p}>{p || 'All priorities'}</option>)}
          </select>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="text-sm border border-slate-200 rounded-md px-2 py-2" title="From" />
          <span className="text-xs text-slate-400">→</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="text-sm border border-slate-200 rounded-md px-2 py-2" title="To" />
        </div>
      </Card>

      <Card bodyClassName="p-0">
        <Table
          rows={visible}
          emptyMessage="No SARs awaiting approval"
          columns={[
            { key: 'sar_id', label: 'SAR ID',
              render: r => <span className="font-mono text-xs text-navy-900 font-medium">{r.sar_id}</span> },
            { key: 'case_id', label: 'Case ID',
              render: r => <span className="font-mono text-xs">{r.case_id || '—'}</span> },
            { key: 'customer_name', label: 'Customer', cellClass: 'font-medium' },
            { key: 'prepared_by', label: 'Filed By',
              render: r => r.prepared_by || '—' },
            { key: 'submitted_at', label: 'Submitted On',
              render: r => r.submitted_at ? r.submitted_at.slice(0, 16).replace('T', ' ') : '—' },
            { key: 'days_pending', label: 'Days Pending',
              render: r => {
                const d = daysSince(r.submitted_at);
                if (d === null) return '—';
                return <span className={d > 5 ? 'text-red-600 font-semibold' : d > 2 ? 'text-orange-600' : 'text-slate-700'}>{d} d</span>;
              } },
            { key: 'priority', label: 'Priority',
              render: r => r.alert_priority ? <Badge value={r.alert_priority} /> : '—' },
            { key: 'sar_status', label: 'Status',
              render: r => <Badge value={r.sar_status} /> },
            { key: 'actions', label: '',
              render: r => (
                <div className="flex items-center gap-1 justify-end">
                  <button onClick={() => review(r)}
                    className="px-2 py-1 rounded text-xs bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1">
                    <Eye size={12} /> Review
                  </button>
                  {r.sar_status === 'Pending Approval' && (
                    <button onClick={() => quickApprove(r)}
                      className="px-2 py-1 rounded text-xs border border-green-300 text-green-700 hover:bg-green-50 inline-flex items-center gap-1"
                      title="Quick approve">
                      <Zap size={12} /> Approve
                    </button>
                  )}
                </div>
              )
            }
          ]}
        />
      </Card>
    </div>
  );
}
