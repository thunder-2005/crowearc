import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api/client.js';
import Card, { KpiCard } from '../components/shared/Card.jsx';
import Table from '../components/shared/Table.jsx';
import Badge from '../components/shared/Badge.jsx';
import { Search, Filter, Eye, AlertTriangle, ArrowLeft, ShieldCheck, Clock, CheckCircle2, FileText } from 'lucide-react';
import { KycProfileBlock } from '../components/investigation/InvestigationWorkspace.jsx';
import { useRole } from '../state/RoleContext.jsx';
import { useRoleNavigate } from '../state/useRoleNavigate.js';
import { useToast } from '../state/ToastContext.jsx';

export default function CustomerKYC() {
  const { id } = useParams();
  return id ? <CustomerProfilePage customerId={id} /> : <CustomerDirectory />;
}

function dueLabel(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr.length <= 10 ? `${dateStr}T00:00:00` : dateStr);
  if (isNaN(d.getTime())) return null;
  const days = Math.round((d.getTime() - Date.now()) / 86400000);
  if (days < 0)   return { label: `${Math.abs(days)}d overdue`, tone: 'text-red-600 font-semibold' };
  if (days <= 30) return { label: `${days}d to due`,            tone: 'text-orange-600' };
  return                { label: `${days}d to due`,             tone: 'text-green-700' };
}

function CustomerDirectory() {
  const { goTo } = useRoleNavigate();
  const { isManager } = useRole();
  const { push } = useToast();
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState({
    customer_risk_rating: '', cdd_level: '', kyc_review_status: '',
    pep_match: '', sanctions_match: ''
  });

  const load = () => {
    const params = { ...Object.fromEntries(Object.entries(filters).filter(([,v]) => v !== '')) };
    if (q) params.q = q;
    api.get('/customers', { params }).then(r => setRows(r.data));
  };

  useEffect(() => { load(); }, [filters]);

  const summary = useMemo(() => {
    let overdue = 0, soon = 0, current = 0;
    for (const r of rows) {
      const due = dueLabel(r.next_kyc_due_date);
      if (!due) continue;
      if (due.tone.includes('red'))    overdue++;
      else if (due.tone.includes('orange')) soon++;
      else                                  current++;
    }
    return { overdue, soon, current };
  }, [rows]);

  const initiateReview = async (r) => {
    try {
      const { data } = await api.post('/kyc-reviews', {
        customer_id: r.customer_id,
        review_type: 'manual',
        due_date: new Date().toISOString().slice(0, 10),
        priority: 'Normal',
        assigned_by: 'Compliance Manager'
      });
      push(`Review created — ${r.customer_name}`, 'success');
      goTo('kyc-reviews');
    } catch (e) {
      push('Failed to create review: ' + (e.response?.data?.error || e.message), 'error');
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xl font-bold text-navy-900">Customer KYC Directory</div>
        <div className="text-sm text-slate-500">{rows.length} customers · click a row for the full KYC profile</div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <KpiCard label="Overdue for Review" value={summary.overdue} icon={AlertTriangle} tone="red" />
        <KpiCard label="Due Within 30 Days" value={summary.soon}    icon={Clock}        tone="orange" />
        <KpiCard label="Up to Date"         value={summary.current} icon={CheckCircle2} tone="green" />
      </div>

      <Card bodyClassName="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[260px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              placeholder="Search by name, customer ID, account number"
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && load()}
              className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-md focus:border-blue-500 focus:outline-none"
            />
          </div>
          <select value={filters.customer_risk_rating}
            onChange={e => setFilters(f => ({ ...f, customer_risk_rating: e.target.value }))}
            className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white">
            <option value="">All risk</option>
            <option>Low</option><option>Medium</option><option>High</option><option>Very High</option>
          </select>
          <select value={filters.cdd_level}
            onChange={e => setFilters(f => ({ ...f, cdd_level: e.target.value }))}
            className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white">
            <option value="">All CDD</option><option>Standard</option><option>Enhanced</option>
          </select>
          <select value={filters.kyc_review_status}
            onChange={e => setFilters(f => ({ ...f, kyc_review_status: e.target.value }))}
            className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white">
            <option value="">All KYC</option>
            <option>Current</option><option>Due in 30 Days</option><option>Overdue</option>
          </select>
          <select value={filters.pep_match}
            onChange={e => setFilters(f => ({ ...f, pep_match: e.target.value }))}
            className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white">
            <option value="">PEP ?</option><option value="1">PEP</option><option value="0">Not PEP</option>
          </select>
          <select value={filters.sanctions_match}
            onChange={e => setFilters(f => ({ ...f, sanctions_match: e.target.value }))}
            className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white">
            <option value="">Sanctions ?</option><option value="1">Hit</option><option value="0">Clear</option>
          </select>
          <button onClick={load}
            className="text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md px-3 py-2 inline-flex items-center gap-1">
            <Filter size={14} /> Apply
          </button>
        </div>
      </Card>

      <Card bodyClassName="p-0">
        <Table
          onRowClick={r => goTo(`customers/${r.customer_id}`)}
          columns={[
            { key: 'customer_id', label: 'Customer ID', cellClass: 'font-mono text-xs text-navy-900 font-medium' },
            { key: 'customer_name', label: 'Name', cellClass: 'font-medium' },
            { key: 'segment', label: 'Segment' },
            { key: 'customer_risk_rating', label: 'Risk', render: r => <Badge value={r.customer_risk_rating} /> },
            { key: 'cdd_level', label: 'CDD' },
            { key: 'pep_match', label: 'PEP', render: r => r.pep_match ? <span className="text-orange-700 font-semibold">PEP</span> : '—' },
            { key: 'sanctions_match', label: 'Sanctions', render: r => r.sanctions_match ? <span className="text-red-600 font-semibold">Hit</span> : '—' },
            { key: 'last_kyc_review_date', label: 'Last KYC' },
            { key: 'next_kyc_due_date', label: 'KYC Due',
              render: r => <span className={r.kyc_review_status === 'Overdue' ? 'text-red-600 font-semibold' : ''}>{r.next_kyc_due_date}</span> },
            { key: 'days_until_due', label: 'Days',
              render: r => {
                const d = dueLabel(r.next_kyc_due_date);
                return d ? <span className={`text-xs ${d.tone}`}>{d.label}</span> : '—';
              } },
            { key: 'open_alerts', label: 'Open Alerts',
              render: r => r.open_alerts > 0
                ? <span className="inline-flex items-center gap-1 text-red-600 font-semibold"><AlertTriangle size={12} /> {r.open_alerts}</span>
                : '0' },
            {
              key: 'actions', label: '',
              render: r => (
                <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                  <button onClick={() => goTo(`customers/${r.customer_id}`)}
                    className="p-1.5 rounded hover:bg-slate-100 text-slate-600" title="View profile">
                    <Eye size={14} />
                  </button>
                  {isManager && (
                    <button onClick={() => initiateReview(r)}
                      className="text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1"
                      title="Initiate KYC review">
                      <ShieldCheck size={12} /> Initiate Review
                    </button>
                  )}
                </div>
              )
            }
          ]}
          rows={rows}
          emptyMessage="No customers"
        />
      </Card>
    </div>
  );
}

function CustomerProfilePage({ customerId }) {
  const { goTo } = useRoleNavigate();
  const { isManager } = useRole();
  const { push } = useToast();
  const [cust, setCust] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [sars, setSars] = useState([]);
  const [reviews, setReviews] = useState([]);

  const reload = () => {
    api.get(`/customers/${customerId}`).then(r => setCust(r.data));
    api.get(`/customers/${customerId}/alerts`).then(r => setAlerts(r.data));
    api.get(`/customers/${customerId}/sars`).then(r => setSars(r.data));
    api.get(`/kyc-reviews/customer/${customerId}/history`).then(r => setReviews(r.data)).catch(() => setReviews([]));
  };
  useEffect(() => { reload(); }, [customerId]);

  if (!cust) return <div className="p-10 text-slate-400">Loading…</div>;

  const open = reviews.find(r => r.status !== 'completed' && r.status !== 'rejected');
  const due = dueLabel(cust.next_kyc_due_date);

  const initiate = async () => {
    try {
      await api.post('/kyc-reviews', {
        customer_id: customerId, review_type: 'manual',
        due_date: new Date().toISOString().slice(0, 10), priority: 'Normal',
        assigned_by: 'Compliance Manager'
      });
      push('Review created', 'success');
      reload();
      goTo('kyc-reviews');
    } catch (e) {
      push('Failed: ' + (e.response?.data?.error || e.message), 'error');
    }
  };

  return (
    <div className="space-y-4">
      <button onClick={() => goTo('customers')}
        className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-navy-900">
        <ArrowLeft size={14} /> Back to directory
      </button>

      {sars.length > 0 && (
        <div className="bg-red-50 border border-red-300 rounded p-3 flex items-center gap-3">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-600 text-white text-xs font-semibold">
            <AlertTriangle size={12} /> SAR Filed
          </span>
          <div className="text-sm text-red-900 flex-1">
            <span className="font-semibold">{sars.length}</span> SAR{sars.length === 1 ? '' : 's'} on record for this customer
            {sars[0] && (
              <span className="text-xs text-red-700 ml-2">
                · most recent: <span className="font-mono">{sars[0].sar_id}</span>
                {sars[0].filed_date ? ` filed ${sars[0].filed_date}` : ' (draft)'}
              </span>
            )}
          </div>
        </div>
      )}
      {cust.exit_status === 'Pending Exit' && (
        <div className="bg-orange-50 border border-orange-300 rounded p-3 text-sm text-orange-900 inline-flex items-center gap-2">
          <AlertTriangle size={14} />
          <span>This customer is flagged <span className="font-semibold">Pending Exit</span> from a prior KYC review recommendation.</span>
        </div>
      )}

      <Card title="KYC Review Status" bodyClassName="p-4"
        action={
          isManager && (
            <button onClick={initiate}
              className="text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1">
              <ShieldCheck size={12} /> Initiate Review
            </button>
          )
        }>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Next Review Due</div>
            <div className="mt-0.5 text-navy-900 font-medium">{cust.next_kyc_due_date || '—'}</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Days Remaining</div>
            <div className={`mt-0.5 font-medium ${due?.tone || ''}`}>{due?.label || '—'}</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Last Reviewed</div>
            <div className="mt-0.5 text-navy-900 font-medium">{cust.last_kyc_review_date || '—'}</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Open Review</div>
            <div className="mt-0.5">
              {open
                ? <button onClick={() => goTo(`kyc-review/${open.id}`)}
                    className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1">
                    <FileText size={11} /> Review #{open.id}
                  </button>
                : <span className="text-slate-500 text-xs">None</span>}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">History</div>
            <div className="mt-0.5 text-xs text-slate-600">{reviews.length} review{reviews.length === 1 ? '' : 's'} total</div>
          </div>
        </div>
      </Card>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1" bodyClassName="p-0">
          <KycProfileBlock c={cust} />
        </Card>
        <Card className="lg:col-span-2" title="Business & Expected Activity">
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <Row k="Trading Name" v={cust.trading_name} />
            <Row k="Registration" v={cust.registration_number} />
            <Row k="Incorporation" v={cust.date_of_incorporation} />
            <Row k="Country of Inc." v={cust.country_of_incorporation} />
            <Row k="Business Type" v={cust.business_type} />
            <Row k="Industry" v={cust.industry} />
            <Row k="NAICS" v={cust.naics_code} />
            <Row k="Turnover" v={cust.annual_turnover_range} />
            <Row k="Employees" v={cust.number_of_employees} />
            <Row k="Source of Funds" v={cust.source_of_funds} />
            <Row k="Source of Wealth" v={cust.source_of_wealth} />
            <Row k="Expected Vol/Val" v={`${cust.expected_monthly_volume} txn · $${Number(cust.expected_monthly_value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <Section title={`Beneficial Owners (${cust.beneficial_owners?.length || 0})`}>
              {(cust.beneficial_owners || []).map((o, i) => (
                <div key={i} className="flex items-center justify-between text-xs border border-slate-100 rounded px-2 py-1.5">
                  <div className="font-medium text-navy-900">{o.name}</div>
                  <div className="text-slate-500">{o.pct}%</div>
                  <div className="text-slate-500">{o.nationality}</div>
                </div>
              ))}
            </Section>
            <Section title={`Directors (${cust.directors?.length || 0})`}>
              {(cust.directors || []).map((d, i) => (
                <div key={i} className="text-xs border border-slate-100 rounded px-2 py-1.5">{d}</div>
              ))}
            </Section>
          </div>
        </Card>
      </div>

      <Card title={`Alert History (${alerts.length})`} bodyClassName="p-0">
        <Table
          columns={[
            { key: 'alert_id', label: 'Alert ID', cellClass: 'font-mono text-xs font-medium' },
            { key: 'created_date', label: 'Created' },
            { key: 'scenario', label: 'Scenario' },
            { key: 'priority', label: 'Priority', render: r => <Badge value={r.priority} /> },
            { key: 'assigned_to', label: 'Assigned', render: r => r.assigned_to || '—' },
            { key: 'alert_status', label: 'Status', render: r => <Badge value={r.alert_status} /> },
            { key: 'due_status', label: 'SLA',
              render: r => <span className={r.sla_breached ? 'text-red-600 font-semibold' : ''}>{r.due_status}</span> }
          ]}
          rows={alerts}
          emptyMessage="No alerts"
        />
      </Card>

      <Card title={`SAR History (${sars.length})`} bodyClassName="p-0">
        <Table
          columns={[
            { key: 'sar_id', label: 'SAR ID', cellClass: 'font-mono text-xs font-medium' },
            { key: 'filed_date', label: 'Filed', render: r => r.filed_date || '—' },
            { key: 'alert_scenario', label: 'Scenario' },
            { key: 'sar_status', label: 'Status', render: r => <Badge value={r.sar_status} /> },
            { key: 'regulator_reference', label: 'Regulator Ref', render: r => r.regulator_reference || '—' },
            { key: 'retention_expiry_date', label: 'Retention', render: r => r.retention_expiry_date || '—' }
          ]}
          rows={sars}
          emptyMessage="No SARs filed"
        />
      </Card>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">{title}</div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-slate-500 shrink-0">{k}</span>
      <span className="text-navy-900 font-medium text-right break-words">{v ?? '—'}</span>
    </div>
  );
}
