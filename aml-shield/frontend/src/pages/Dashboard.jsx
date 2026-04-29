import { useEffect, useMemo, useState } from 'react';
import api from '../api/client.js';
import { useRoleNavigate } from '../state/useRoleNavigate.js';
import { KpiCard } from '../components/shared/Card.jsx';
import Card from '../components/shared/Card.jsx';
import Table from '../components/shared/Table.jsx';
import Badge from '../components/shared/Badge.jsx';
import {
  AlertTriangle, Activity, CheckCircle2, Clock, TrendingUp, Briefcase,
  Target, Users, ShieldCheck, Eye, ShieldAlert, ArrowUpRight, X
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar, Legend
} from 'recharts';
import { useRole } from '../state/RoleContext.jsx';

const DONUT_COLORS = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#6366f1', '#8b5cf6'];

export default function Dashboard() {
  const { isManager, isEmployee, currentAnalyst } = useRole();
  const { makePath } = useRoleNavigate();
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [range, setRange] = useState('30d');
  const [drawer, setDrawer] = useState(null); // { kind, title, filter, navigateFilter }

  useEffect(() => {
    const params = {};
    if (isEmployee && currentAnalyst) params.assigned_to = currentAnalyst;
    setStats(null);
    api.get('/dashboard/stats', { params })
      .then(r => setStats(r.data))
      .catch(e => setError(e.message));
  }, [range, isEmployee, currentAnalyst]);

  const openDrawer = (cfg) => isManager && setDrawer(cfg);

  if (error) return <div className="text-red-600">Failed to load: {error}</div>;
  if (!stats) return <div className="text-slate-500">Loading dashboard…</div>;

  const k = stats.kpis;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xl font-bold text-navy-900">
            {isManager
              ? 'Team Dashboard — Suspicious Activity Monitoring'
              : `My Queue — ${currentAnalyst || ''}`}
          </div>
          <div className="text-sm text-slate-500">
            {isManager
              ? 'Control #2 · All alerts, cases, SLA and analyst workload'
              : 'Your personal alert queue and investigation performance'}
          </div>
        </div>
        <select
          value={range}
          onChange={e => setRange(e.target.value)}
          className="bg-white border border-slate-200 rounded-md text-sm px-3 py-2"
        >
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="ytd">Year to date</option>
        </select>
      </div>

      <div className={`grid grid-cols-2 md:grid-cols-3 ${isManager ? 'lg:grid-cols-6' : 'lg:grid-cols-5'} gap-4`}>
        <Clickable enabled={isManager} onClick={() => openDrawer({ kind: 'all-alerts', title: 'All Alerts', navigateFilter: {} })}>
          <KpiCard label={isManager ? 'Total Alerts' : 'My Alerts'} value={k.total_alerts} icon={AlertTriangle} />
        </Clickable>
        <Clickable enabled={isManager} onClick={() => openDrawer({ kind: 'in-progress', title: 'Alerts In Progress', navigateFilter: { alert_status: 'Work in Progress' } })}>
          <KpiCard label="In Progress" value={k.in_progress} tone="blue" icon={Activity} />
        </Clickable>
        <Clickable enabled={isManager} onClick={() => openDrawer({ kind: 'closed', title: 'Recently Closed Alerts', navigateFilter: { alert_status: 'Completed' } })}>
          <KpiCard label="Completed" value={k.completed} tone="green" icon={CheckCircle2} />
        </Clickable>
        <Clickable enabled={isManager} onClick={() => openDrawer({ kind: 'sla-breaches', title: 'SLA Breaches', navigateFilter: { sla_breached: '1' } })}>
          <KpiCard label="SLA Breaches" value={k.sla_breaches} tone="red" icon={Clock} />
        </Clickable>
        <Clickable enabled={isManager} onClick={() => openDrawer({ kind: 'aging', title: 'Alerts by Aging Bucket', navigateFilter: {} })}>
          <KpiCard label="Avg Aging (days)" value={k.avg_aging_days} tone="orange" icon={TrendingUp} />
        </Clickable>
        {isManager && (
          <Clickable enabled={isManager} onClick={() => openDrawer({ kind: 'cases-converted', title: 'Escalated SAR Cases', navigateFilter: {} })}>
            <KpiCard label="Cases Converted" value={k.cases_converted} tone="blue" icon={Briefcase}
                     sub={`FP rate: ${k.false_positive_rate_pct}%`} />
          </Clickable>
        )}
      </div>

      {isManager && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <KpiCard label="Team Capacity" value={`${k.team_capacity_pct}%`} tone="blue" icon={Users}
                   sub="Avg across analysts" />
          <KpiCard label="False Positive Rate" value={`${k.false_positive_rate_pct}%`} tone="orange"
                   icon={Target} sub={`${k.closed} closed alerts`} />
          <Clickable enabled={isManager} onClick={() => openDrawer({ kind: 'unassigned', title: 'Unassigned Queue', navigateFilter: { alert_status: 'Unassigned' } })}>
            <KpiCard label="Unassigned Queue" value={k.unassigned} tone="red" icon={ShieldCheck}
                     sub="Needs triage" />
          </Clickable>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card title="Alert Volume Trend" subtitle={isEmployee ? `${currentAnalyst}'s alerts over time` : 'Last 30 days'} className="lg:col-span-2">
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <LineChart data={stats.trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="alerts" stroke="#2563eb" strokeWidth={2}
                      dot={{ r: 3 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Alerts by Status" subtitle={isManager ? 'Click a slice to drill down' : undefined}>
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={stats.by_status} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}
                     onClick={(d) => isManager && d?.name && openDrawer({
                       kind: 'by-status', title: `Alerts · Status: ${d.name}`,
                       statusName: d.name, navigateFilter: { alert_status: d.name }
                     })}
                     cursor={isManager ? 'pointer' : 'default'}>
                  {stats.by_status.map((_, i) => (
                    <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card title="SLA Breaches by Aging Bucket" subtitle={isManager ? 'Click a bar to drill down' : undefined}>
          <div style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={stats.sla_buckets}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="value" fill="#ef4444" radius={[4, 4, 0, 0]}
                     cursor={isManager ? 'pointer' : 'default'}
                     onClick={(d) => isManager && d?.name && openDrawer({
                       kind: 'aging-bucket', title: `Breached Alerts · ${d.name}`,
                       bucketName: d.name, navigateFilter: { sla_breached: '1' }
                     })} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Alerts by Scenario" subtitle={isManager ? 'Click a slice to drill down' : undefined}>
          <div style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={stats.by_scenario} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}
                     onClick={(d) => isManager && d?.name && openDrawer({
                       kind: 'by-scenario', title: `Alerts · ${d.name}`,
                       scenarioName: d.name, navigateFilter: { scenario: d.name }
                     })}
                     cursor={isManager ? 'pointer' : 'default'}>
                  {stats.by_scenario.map((_, i) => (
                    <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Quick Links" action={<Target size={14} className="text-slate-400" />}>
          <ul className="text-sm space-y-2">
            <li><a href={makePath('alerts')} className="text-blue-600 hover:underline">→ {isManager ? 'Team alert queue' : 'My alert queue'}</a></li>
            <li><a href={makePath('cases')} className="text-blue-600 hover:underline">→ {isManager ? 'All cases' : 'My cases'}</a></li>
            <li><a href={makePath('sars')} className="text-blue-600 hover:underline">→ SAR Repository</a></li>
            {isManager && <li><a href={makePath('retention')} className="text-blue-600 hover:underline">→ Retention Monitor</a></li>}
            {isManager && <li><a href={makePath('audit')} className="text-blue-600 hover:underline">→ Audit Trail</a></li>}
          </ul>
        </Card>
      </div>

      {isManager && <SlaWatch />}

      {isManager && <L2OversightWidget />}

      <Card title="SLA Breaches — Top 10" subtitle={isEmployee ? 'Your most overdue alerts' : 'Oldest breaching alerts (team-wide)'}>
        <Table
          columns={[
            { key: 'alert_id', label: 'Alert ID', cellClass: 'font-medium text-navy-900' },
            { key: 'customer_name', label: 'Customer' },
            { key: 'scenario', label: 'Scenario' },
            { key: 'priority', label: 'Priority', render: (r) => <Badge value={r.priority} /> },
            { key: 'assigned_to', label: 'Assigned To', render: r => r.assigned_to || '—' },
            { key: 'age_days', label: 'Age',
              render: r => <span className="text-red-600 font-semibold">{r.age_days}d</span> },
            { key: 'due_status', label: 'Status' }
          ]}
          rows={stats.top_sla_breaches}
          emptyMessage="No SLA breaches"
        />
      </Card>

      {isManager && (
        <Card title="Analyst Workload" subtitle="Capacity 15 alerts / analyst (always team-wide)">
          <Table
            columns={[
              { key: 'analyst', label: 'Analyst', cellClass: 'font-medium text-navy-900' },
              { key: 'total', label: 'Total' },
              { key: 'in_progress', label: 'In Progress' },
              { key: 'breached', label: 'Breached',
                render: r => r.breached > 0
                  ? <span className="text-red-600 font-semibold">{r.breached}</span>
                  : r.breached },
              { key: 'completed', label: 'Completed' },
              { key: 'utilization_pct', label: 'Capacity',
                render: r => (
                  <div className="flex items-center gap-2 min-w-[140px]">
                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          r.utilization_pct >= 90 ? 'bg-red-500'
                            : r.utilization_pct >= 70 ? 'bg-orange-500' : 'bg-green-500'
                        }`}
                        style={{ width: `${r.utilization_pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-slate-600 w-9 text-right">{r.utilization_pct}%</span>
                  </div>
                ) }
            ]}
            rows={stats.analyst_workload}
            emptyMessage="No analyst workload data"
          />
        </Card>
      )}

      {drawer && (
        <DashboardDrawer
          drawer={drawer}
          onClose={() => setDrawer(null)}
          onViewAll={(filter) => {
            setDrawer(null);
            const qs = new URLSearchParams(filter || {}).toString();
            const target = makePath(qs ? `alerts?${qs}` : 'alerts');
            window.location.href = target;
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────── interactive helpers

function Clickable({ enabled, onClick, children }) {
  if (!enabled) return children;
  return (
    <div onClick={onClick}
         className="cursor-pointer transition hover:shadow-md hover:-translate-y-0.5 active:translate-y-0">
      {children}
    </div>
  );
}

const usd = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const daysSinceIso = (iso) => {
  if (!iso) return '—';
  const d = (Date.now() - new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso.replace(' ', 'T')).getTime()) / 86400000;
  return Math.max(0, Math.floor(d));
};

function DashboardDrawer({ drawer, onClose, onViewAll }) {
  const [allAlerts, setAllAlerts] = useState(null);
  const [allCases, setAllCases] = useState(null);
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    setAllAlerts(null); setAllCases(null);
    if (drawer.kind === 'cases-converted') {
      api.get('/cases').then(r => setAllCases(r.data));
    } else {
      api.get('/alerts').then(r => setAllAlerts(r.data));
    }
  }, [drawer.kind]);

  const view = useMemo(() => buildDrawerView(drawer, allAlerts, allCases), [drawer, allAlerts, allCases]);

  const sortedRows = useMemo(() => {
    if (!view?.rows || !sortKey) return view?.rows || [];
    const arr = [...view.rows];
    arr.sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av;
      return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
    return arr;
  }, [view, sortKey, sortDir]);

  const onSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const loading = (drawer.kind === 'cases-converted' && allCases === null) || (drawer.kind !== 'cases-converted' && allAlerts === null);

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <aside className="fixed top-0 right-0 h-screen w-[520px] bg-white border-l border-slate-200 shadow-2xl z-50 flex flex-col">
        <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between">
          <div className="min-w-0">
            <div className="text-base font-semibold text-navy-900 truncate">{drawer.title}</div>
            {view?.subtitle && <div className="text-xs text-slate-500 mt-0.5">{view.subtitle}</div>}
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && <div className="py-12 text-center text-slate-400 text-sm">Loading…</div>}

          {!loading && view?.groups && (
            <div className="p-4 space-y-4">
              {view.groups.map((g, gi) => (
                <div key={gi}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-sm font-semibold text-navy-900">{g.name}</div>
                    <span className="text-xs bg-slate-100 rounded-full px-2 py-0.5">{g.rows.length}</span>
                  </div>
                  <DrawerTable
                    columns={view.columns}
                    rows={g.rows}
                    sortKey={sortKey} sortDir={sortDir} onSort={onSort}
                  />
                </div>
              ))}
            </div>
          )}

          {!loading && !view?.groups && view?.columns && (
            <div className="p-4">
              <DrawerTable
                columns={view.columns}
                rows={sortedRows}
                sortKey={sortKey} sortDir={sortDir} onSort={onSort}
              />
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between gap-2 bg-slate-50">
          <div className="text-xs text-slate-500">
            {view?.rows ? `${view.rows.length} item${view.rows.length === 1 ? '' : 's'}` : ''}
          </div>
          <button
            onClick={() => onViewAll(drawer.navigateFilter)}
            className="text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md px-3 py-1.5 inline-flex items-center gap-1"
          >
            View All <ArrowUpRight size={13} />
          </button>
        </div>
      </aside>
    </>
  );
}

function DrawerTable({ columns, rows, sortKey, sortDir, onSort }) {
  if (!rows || rows.length === 0) {
    return (
      <div className="text-xs text-slate-400 italic py-8 text-center bg-slate-50 rounded">
        No matching alerts
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            {columns.map(c => (
              <th key={c.key}
                onClick={() => onSort(c.key)}
                className="text-left py-1.5 px-2 font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none whitespace-nowrap">
                {c.label}{sortKey === c.key && (sortDir === 'desc' ? ' ▼' : ' ▲')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
              {columns.map(c => (
                <td key={c.key} className={`py-1.5 px-2 whitespace-nowrap ${c.cellClass || ''}`}>
                  {c.render ? c.render(r) : (r[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function buildDrawerView(drawer, allAlerts, allCases) {
  const slaCols = [
    { key: 'alert_id',     label: 'Alert ID', cellClass: 'font-mono' },
    { key: 'customer_name',label: 'Customer' },
    { key: 'assigned_to',  label: 'Analyst', render: r => r.assigned_to || '—' },
    { key: 'breached_by_days', label: 'Breached By', render: r => <span className="text-red-600 font-semibold">{r.breached_by_days}d</span> },
    { key: 'scenario',     label: 'Scenario' },
    { key: 'priority',     label: 'Priority', render: r => <Badge value={r.priority} /> }
  ];
  const ipCols = [
    { key: 'alert_id',     label: 'Alert ID', cellClass: 'font-mono' },
    { key: 'customer_name',label: 'Customer' },
    { key: 'assigned_to',  label: 'Analyst', render: r => r.assigned_to || '—' },
    { key: 'age_days',     label: 'Age (d)' },
    { key: 'sla_remaining',label: 'SLA Remaining', render: r => r.sla_remaining }
  ];
  const closedCols = [
    { key: 'alert_id',     label: 'Alert ID', cellClass: 'font-mono' },
    { key: 'customer_name',label: 'Customer' },
    { key: 'assigned_to',  label: 'Closed By', render: r => r.assigned_to || '—' },
    { key: 'closed_date',  label: 'Closed Date' },
    { key: 'disposition',  label: 'Disposition', render: r => r.disposition || '—' }
  ];
  const summaryCols = [
    { key: 'alert_id',     label: 'Alert ID', cellClass: 'font-mono' },
    { key: 'customer_name',label: 'Customer' },
    { key: 'alert_status', label: 'Status', render: r => <Badge value={r.alert_status} /> },
    { key: 'priority',     label: 'Priority', render: r => <Badge value={r.priority} /> },
    { key: 'assigned_to',  label: 'Analyst', render: r => r.assigned_to || '—' }
  ];
  const caseCols = [
    { key: 'case_id',         label: 'Case ID', cellClass: 'font-mono' },
    { key: 'source_alert_id', label: 'Alert ID', cellClass: 'font-mono' },
    { key: 'customer_name',   label: 'Customer' },
    { key: 'assigned_to',     label: 'Assigned To', render: r => r.assigned_to || '—' },
    { key: 'case_status',     label: 'Status', render: r => <Badge value={r.case_status} /> }
  ];

  if (drawer.kind === 'cases-converted') {
    if (!allCases) return null;
    return {
      columns: caseCols,
      rows: allCases,
      subtitle: `${allCases.length} cases · escalated SAR cases team-wide`
    };
  }

  if (!allAlerts) return null;

  const slaRemaining = (a) => {
    if (!a.sla_deadline) return a.due_status || '—';
    const ms = new Date(a.sla_deadline.length <= 10 ? `${a.sla_deadline}T23:59:59` : a.sla_deadline).getTime() - Date.now();
    if (ms <= 0) return <span className="text-red-600">Breached</span>;
    const d = Math.floor(ms / 86400000);
    const h = Math.floor((ms % 86400000) / 3600000);
    return d > 0 ? `${d}d ${h}h` : `${h}h`;
  };
  const breachedByDays = (a) => {
    if (!a.sla_deadline) return 0;
    const dl = new Date(a.sla_deadline.length <= 10 ? `${a.sla_deadline}T23:59:59` : a.sla_deadline).getTime();
    const closeOrNow = a.closed_date ? new Date(a.closed_date + 'T23:59:59').getTime() : Date.now();
    return Math.max(0, Math.floor((closeOrNow - dl) / 86400000));
  };
  const enrich = (rows) => rows.map(r => ({
    ...r,
    sla_remaining: slaRemaining(r),
    breached_by_days: breachedByDays(r)
  }));

  switch (drawer.kind) {
    case 'all-alerts':
      return { columns: summaryCols, rows: allAlerts, subtitle: `${allAlerts.length} alerts team-wide` };

    case 'sla-breaches': {
      const rows = enrich(allAlerts.filter(a => a.sla_breached === 1));
      rows.sort((a, b) => b.breached_by_days - a.breached_by_days);
      return { columns: slaCols, rows, subtitle: `${rows.length} breached alerts · sorted by most breached` };
    }

    case 'in-progress': {
      const rows = enrich(allAlerts.filter(a => a.alert_status === 'Work in Progress'));
      return { columns: ipCols, rows, subtitle: `${rows.length} in-progress alerts` };
    }

    case 'closed': {
      const rows = allAlerts
        .filter(a => a.alert_status === 'Completed')
        .sort((a, b) => (b.closed_date || '').localeCompare(a.closed_date || ''))
        .slice(0, 100);
      return { columns: closedCols, rows, subtitle: `Most recent ${rows.length} closed alerts` };
    }

    case 'unassigned': {
      const rows = allAlerts.filter(a => a.alert_status === 'Unassigned');
      return { columns: summaryCols, rows, subtitle: `${rows.length} unassigned · awaiting triage` };
    }

    case 'aging': {
      const buckets = { '0-7 days': [], '7-15 days': [], '15-30 days': [], '30+ days': [] };
      for (const a of allAlerts) {
        if (a.alert_status === 'Completed') continue;
        const age = a.age_days || 0;
        const k = age < 7 ? '0-7 days' : age < 15 ? '7-15 days' : age < 30 ? '15-30 days' : '30+ days';
        buckets[k].push(a);
      }
      const groups = Object.entries(buckets).map(([name, rows]) => ({ name, rows }));
      const total = groups.reduce((s, g) => s + g.rows.length, 0);
      return { columns: summaryCols, groups, rows: allAlerts, subtitle: `${total} open alerts grouped by age` };
    }

    case 'aging-bucket': {
      const map = {
        '0-7':  a => a.age_days < 7,
        '8-14': a => a.age_days >= 8 && a.age_days <= 14,
        '15-21': a => a.age_days >= 15 && a.age_days <= 21,
        '22-30': a => a.age_days >= 22 && a.age_days <= 30,
        '30+':  a => a.age_days > 30
      };
      const filt = map[drawer.bucketName] || (() => true);
      const rows = enrich(allAlerts.filter(a => a.sla_breached === 1 && filt(a)));
      rows.sort((a, b) => b.breached_by_days - a.breached_by_days);
      return { columns: slaCols, rows, subtitle: `${rows.length} breached alerts in ${drawer.bucketName}` };
    }

    case 'by-status': {
      const rows = allAlerts.filter(a => a.alert_status === drawer.statusName);
      return { columns: summaryCols, rows, subtitle: `${rows.length} alerts · status "${drawer.statusName}"` };
    }

    case 'by-scenario': {
      const rows = allAlerts.filter(a => a.scenario === drawer.scenarioName);
      return { columns: summaryCols, rows, subtitle: `${rows.length} alerts · scenario "${drawer.scenarioName}"` };
    }

    default:
      return { columns: summaryCols, rows: allAlerts, subtitle: '' };
  }
}

function fmtRemaining(hrs) {
  if (hrs == null) return '—';
  if (hrs <= 0) {
    const ago = Math.abs(hrs);
    return `Breached ${Math.floor(ago)}h ago`;
  }
  if (hrs < 24) {
    const m = Math.round((hrs - Math.floor(hrs)) * 60);
    return `${Math.floor(hrs)}h ${m}m`;
  }
  const d = Math.floor(hrs / 24);
  const h = Math.floor(hrs % 24);
  return `${d}d ${h}h`;
}

function L2OversightWidget() {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    const load = () => api.get('/l2/stats/manager').then(r => setStats(r.data)).catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);
  if (!stats) return null;

  const decisionTone = (d) => d === 'escalated_sar' ? 'text-red-700 bg-red-50 border-red-200'
    : d === 'closed' ? 'text-slate-700 bg-slate-50 border-slate-200'
    : d === 'returned' ? 'text-yellow-700 bg-yellow-50 border-yellow-200'
    : 'text-slate-600 bg-slate-50 border-slate-200';

  return (
    <Card
      title="L2 Investigation Queue"
      subtitle="L2 oversight · cases with L2 analysts and recent decisions"
      action={<ShieldAlert size={14} className="text-purple-500" />}
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="space-y-2">
          <div className="bg-purple-50 border border-purple-200 rounded p-3">
            <div className="text-[10px] uppercase tracking-wide text-purple-700">Alerts with L2</div>
            <div className="text-2xl font-bold text-purple-900 mt-1">{stats.total_open}</div>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded p-3">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Avg days open</div>
            <div className="text-2xl font-bold text-navy-900 mt-1">{stats.avg_days_open}<span className="text-sm text-slate-400">d</span></div>
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold text-slate-500 uppercase mb-2">L2 Workload</div>
          <div className="space-y-1.5">
            {stats.workload.length === 0 && <div className="text-xs text-slate-400 italic">No active L2 cases</div>}
            {stats.workload.map(w => (
              <div key={w.analyst} className="flex items-center gap-2 text-xs border border-slate-200 rounded px-2 py-1.5">
                <div className="w-6 h-6 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center font-bold text-[10px]">
                  {w.analyst.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase()}
                </div>
                <span className="flex-1 text-navy-900">{w.analyst}</span>
                <span className="px-2 py-0.5 rounded bg-purple-100 text-purple-700 font-semibold">{w.open_cases} open</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Recent Decisions (last 5)</div>
          <div className="space-y-1.5">
            {stats.recent_decisions.length === 0 && <div className="text-xs text-slate-400 italic">No decisions yet</div>}
            {stats.recent_decisions.map((r, i) => (
              <div key={i} className={`text-xs border rounded px-2 py-1.5 ${decisionTone(r.decision)}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium truncate">{r.customer_name || r.alert_id}</span>
                  <span className="text-[10px] uppercase font-bold whitespace-nowrap">
                    {r.decision === 'escalated_sar' ? 'SAR' : r.decision === 'closed' ? 'CLOSED' : r.decision === 'returned' ? 'RETURNED' : '—'}
                  </span>
                </div>
                <div className="text-[10px] mt-0.5">
                  {r.decision_by || '—'} · {(r.decision_made_at || '').slice(0, 10)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

function SlaWatch() {
  const { goTo } = useRoleNavigate();
  const [items, setItems] = useState([]);
  useEffect(() => {
    const load = () => api.get('/sla/status').then(r => setItems(r.data.slice(0, 5))).catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);
  return (
    <Card
      title="SLA Watch"
      subtitle="Top 5 alerts closest to breaching · refreshes every 60s"
      action={
        <button onClick={() => goTo('alerts')}
          className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1">
          View All <Eye size={12} />
        </button>
      }
      bodyClassName="p-0"
    >
      <Table
        rows={items}
        emptyMessage="All clear — no SLA pressure"
        columns={[
          { key: 'alert_id', label: 'Alert ID',
            render: r => <span className="font-mono text-xs text-navy-900 font-medium">{r.alert_id}</span> },
          { key: 'customer_name', label: 'Customer', cellClass: 'font-medium' },
          { key: 'assigned_to', label: 'Analyst',
            render: r => r.assigned_to || <span className="italic text-slate-400">Unassigned</span> },
          { key: 'remaining_hours', label: 'Time Left',
            render: r => {
              const cls = r.bucket === 'breached' ? 'bg-red-50 text-red-700'
                : r.bucket === 'critical' ? 'bg-orange-50 text-orange-700'
                : r.bucket === 'warning' ? 'bg-yellow-50 text-yellow-700'
                : 'bg-green-50 text-green-700';
              return (
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
                  <Clock size={11} /> {fmtRemaining(r.remaining_hours)}
                </span>
              );
            }
          }
        ]}
      />
    </Card>
  );
}
