import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api/client.js';
import Card from '../components/shared/Card.jsx';
import Table from '../components/shared/Table.jsx';
import Badge from '../components/shared/Badge.jsx';
import { Search, Filter, Eye, AlertTriangle, ArrowLeft } from 'lucide-react';
import { KycProfileBlock } from '../components/investigation/InvestigationWorkspace.jsx';

export default function CustomerKYC() {
  const { id } = useParams();
  return id ? <CustomerProfilePage customerId={id} /> : <CustomerDirectory />;
}

function CustomerDirectory() {
  const nav = useNavigate();
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

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xl font-bold text-navy-900">Customer KYC Directory</div>
        <div className="text-sm text-slate-500">{rows.length} customers · click a row for the full KYC profile</div>
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
          onRowClick={r => nav(`/customers/${r.customer_id}`)}
          columns={[
            { key: 'customer_id', label: 'Customer ID', cellClass: 'font-mono text-xs text-navy-900 font-medium' },
            { key: 'customer_name', label: 'Name', cellClass: 'font-medium' },
            { key: 'segment', label: 'Segment' },
            { key: 'customer_risk_rating', label: 'Risk', render: r => <Badge value={r.customer_risk_rating} /> },
            { key: 'cdd_level', label: 'CDD' },
            { key: 'pep_match', label: 'PEP', render: r => r.pep_match ? <span className="text-orange-700 font-semibold">PEP</span> : '—' },
            { key: 'sanctions_match', label: 'Sanctions', render: r => r.sanctions_match ? <span className="text-red-600 font-semibold">Hit</span> : '—' },
            { key: 'last_kyc_review_date', label: 'Last KYC' },
            { key: 'next_kyc_due_date', label: 'Next Due',
              render: r => <span className={r.kyc_review_status === 'Overdue' ? 'text-red-600 font-semibold' : ''}>{r.next_kyc_due_date}</span> },
            { key: 'open_alerts', label: 'Open Alerts',
              render: r => r.open_alerts > 0
                ? <span className="inline-flex items-center gap-1 text-red-600 font-semibold"><AlertTriangle size={12} /> {r.open_alerts}</span>
                : '0' },
            {
              key: 'actions', label: '',
              render: r => (
                <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                  <button onClick={() => nav(`/customers/${r.customer_id}`)}
                    className="p-1.5 rounded hover:bg-slate-100 text-slate-600" title="View profile">
                    <Eye size={14} />
                  </button>
                  <a href={`/alerts`}
                    className="text-xs px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 inline-flex items-center gap-1">
                    View Alerts
                  </a>
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
  const nav = useNavigate();
  const [cust, setCust] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [sars, setSars] = useState([]);

  useEffect(() => {
    api.get(`/customers/${customerId}`).then(r => setCust(r.data));
    api.get(`/customers/${customerId}/alerts`).then(r => setAlerts(r.data));
    api.get(`/customers/${customerId}/sars`).then(r => setSars(r.data));
  }, [customerId]);

  if (!cust) return <div className="p-10 text-slate-400">Loading…</div>;

  return (
    <div className="space-y-4">
      <button onClick={() => nav('/customers')}
        className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-navy-900">
        <ArrowLeft size={14} /> Back to directory
      </button>
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
            <Row k="Expected Vol/Val" v={`${cust.expected_monthly_volume} txn · ₹${(cust.expected_monthly_value || 0).toLocaleString('en-IN')}`} />
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
