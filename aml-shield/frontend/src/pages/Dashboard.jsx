import { useEffect, useRef, useState, Fragment } from 'react';
import api from '../api/client.js';
import { useRoleNavigate } from '../state/useRoleNavigate.js';
import { KpiCard } from '../components/shared/Card.jsx';
import Card from '../components/shared/Card.jsx';
import Table from '../components/shared/Table.jsx';
import Badge from '../components/shared/Badge.jsx';
import {
  AlertTriangle, Activity, CheckCircle2, Clock, TrendingUp, Briefcase,
  Target, Users, ShieldCheck, Eye, ShieldAlert, ArrowUpRight, X, Loader2
} from 'lucide-react';
import { useToast } from '../state/ToastContext.jsx';
import WorklistBand from '../components/dashboard/WorklistBand.jsx';
import HealthStrip from '../components/dashboard/HealthStrip.jsx';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar, Legend
} from 'recharts';
import { useRole } from '../state/RoleContext.jsx';

const DONUT_COLORS = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#6366f1', '#8b5cf6'];

// Resolve the dropdown selection to concrete YYYY-MM-DD bounds.
//   '7d'  → today − 7 days
//   '30d' → today − 30 days
//   '90d' → today − 90 days
//   'ytd' → Jan 1 of current year
// 'all' returns null/null so the caller can OMIT the from/to query params,
// which signals the backend to span every date. Every other option emits
// concrete YYYY-MM-DD strings.
function dateRangeFor(range) {
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  if (range === 'all') return { from: null, to: null };
  let from;
  if (range === '7d')       from = new Date(today.getTime() -  7 * 86400000);
  else if (range === '30d') from = new Date(today.getTime() - 30 * 86400000);
  else if (range === '90d') from = new Date(today.getTime() - 90 * 86400000);
  else if (range === 'ytd') from = new Date(today.getFullYear(), 0, 1);
  else                      from = new Date(today.getTime() - 30 * 86400000);
  return { from: from.toISOString().slice(0, 10), to };
}

export default function Dashboard() {
  const { isManager, isEmployee, currentAnalyst } = useRole();
  const { makePath } = useRoleNavigate();
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [range, setRange] = useState('all');
  const [refetching, setRefetching] = useState(false);
  const [drawerKind, setDrawerKind] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [pollError, setPollError] = useState(false);
  const { from, to } = dateRangeFor(range);

  // Build the API params from current state. Kept stable across the
  // initial fetch and the 60-second poll so both share the same scope.
  const buildParams = () => {
    const p = {};
    if (from) p.from = from;
    if (to) p.to = to;
    if (isEmployee && currentAnalyst) p.assigned_to = currentAnalyst;
    return p;
  };

  // Single fetch implementation. Returns the promise so callers (initial
  // load vs. background poll) can chain their own success/error handling.
  const fetchDashboard = ({ silent = false } = {}) => {
    if (!silent) setRefetching(true);
    return api.get('/dashboard/stats', { params: buildParams() })
      .then(r => {
        setStats(r.data);
        setError(null);
        setLastUpdated(new Date());
        setPollError(false);
        return r.data;
      })
      .catch(e => {
        if (silent) setPollError(true);
        else setError(e.message);
        throw e;
      })
      .finally(() => { if (!silent) setRefetching(false); });
  };

  // Initial load on scope change.
  useEffect(() => {
    fetchDashboard().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, isEmployee, currentAnalyst]);

  // 60-second background poll. Re-armed when the scope inputs change so
  // the interval always fires against the current date range / analyst.
  useEffect(() => {
    const id = setInterval(() => {
      fetchDashboard({ silent: true }).catch(() => {});
    }, 60000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, isEmployee, currentAnalyst]);

  const openDrawer = (kind) => isManager && setDrawerKind(kind);

  if (error && !stats) return (
    <DashboardErrorState
      message={error}
      lastAttempt={lastUpdated}
      onRetry={() => fetchDashboard().catch(() => {})}
    />
  );
  if (!stats) return <DashboardSkeleton isManager={isManager} />;

  const k = stats.kpis;

  return (
    <div className="space-y-6">
      {isManager && stats.ofac_status?.is_stale && (
        <OfacStaleBanner
          status={stats.ofac_status}
          onSynced={() => fetchDashboard({ silent: true }).catch(() => {})}
        />
      )}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xl font-bold text-navy-900">
            {isManager
              ? 'Team Dashboard — Suspicious Activity Monitoring'
              : `My Queue — ${currentAnalyst || ''}`}
          </div>
          <div className="text-sm text-slate-500 flex items-center gap-2">
            <span>Current operational state</span>
            {isManager && (
              <>
                <span className="text-slate-300">·</span>
                <a
                  href={makePath('analytics')}
                  className="text-blue-600 hover:underline text-xs"
                >
                  For trend analysis see Analytics →
                </a>
              </>
            )}
          </div>
        </div>
        <LastUpdatedIndicator lastUpdated={lastUpdated} pollError={pollError} />
      </div>

      {isManager && <WorklistBand />}
      {isManager && stats.health && <HealthStrip health={stats.health} />}

      <div className={`transition-opacity ${refetching ? 'opacity-60 animate-pulse' : ''} grid grid-cols-2 md:grid-cols-3 ${isManager ? 'lg:grid-cols-6' : 'lg:grid-cols-5'} gap-4`}>
        <Clickable enabled={isManager} onClick={() => openDrawer('total-alerts')}>
          <KpiCard label={isManager ? 'Total Alerts' : 'My Alerts'} value={k.total_alerts} icon={AlertTriangle} />
        </Clickable>
        <Clickable enabled={isManager} onClick={() => openDrawer('in-progress')}>
          <KpiCard label="In Progress" value={k.in_progress} tone="blue" icon={Activity} />
        </Clickable>
        <Clickable enabled={isManager} onClick={() => openDrawer('completed')}>
          <KpiCard label="Completed" value={k.completed} tone="green" icon={CheckCircle2} />
        </Clickable>
        <Clickable enabled={isManager} onClick={() => openDrawer('sla-breaches')}>
          <KpiCard label="SLA Breaches" value={k.sla_breaches} tone="red" icon={Clock} />
        </Clickable>
        <Clickable enabled={isManager} onClick={() => openDrawer('avg-aging')}>
          <KpiCard label="Avg Aging (days)" value={k.avg_aging_days} tone="orange" icon={TrendingUp} />
        </Clickable>
        {isManager && (
          <Clickable enabled={isManager} onClick={() => openDrawer('cases-converted')}>
            <KpiCard
              label="Cases Converted"
              value={`${k.conversion_rate_pct ?? 0}%`}
              tone="blue"
              icon={Briefcase}
              sub={
                <div className="space-y-0.5 text-[11px] leading-tight">
                  <div>{k.total_alerts} alerts in period</div>
                  <div>{k.total_cases ?? 0} cases created</div>
                  <div>{k.total_sars ?? 0} SARs filed</div>
                </div>
              }
            />
          </Clickable>
        )}
      </div>

      {isManager && (
        <div className={`transition-opacity ${refetching ? 'opacity-60 animate-pulse' : ''} grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4`}>
          {/* PR3 / Issue 9: headline flips from team-avg % to overloaded count.
              Drawer behind the card is unchanged. */}
          <Clickable enabled={isManager} onClick={() => openDrawer('team-capacity')}>
            <KpiCard
              label="Team Capacity"
              value={
                k.total_analysts > 0
                  ? `${k.overloaded_count} of ${k.total_analysts}`
                  : '—'
              }
              tone={k.overloaded_count > 0 ? 'red' : 'green'}
              icon={Users}
              sub={k.overloaded_count > 0 ? 'analysts overloaded' : 'no one overloaded'}
            />
          </Clickable>
          <Clickable enabled={isManager} onClick={() => openDrawer('false-positive')}>
            <KpiCard label="False Positive Rate" value={`${k.false_positive_rate_pct}%`} tone="orange"
                     icon={Target} sub={`${k.closed} closed alerts`} />
          </Clickable>
          <Clickable enabled={isManager} onClick={() => openDrawer('unassigned')}>
            <KpiCard label="Unassigned Queue" value={k.unassigned} tone="red" icon={ShieldCheck}
                     sub="Needs triage" />
          </Clickable>
          {/* PR3 / Issue 11: SAR Filing Clock — FinCEN 30-day requirement.
              Card opens the new 'sar-clock' drawer with per-SAR detail. */}
          <Clickable enabled={isManager} onClick={() => openDrawer('sar-clock')}>
            <SarClockKpiCard />
          </Clickable>
        </div>
      )}

      {isManager && <OfacStatusWidget />}

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

        <Card title="Alerts by Status">
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={stats.by_status} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
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
        <Card title="SLA Breaches by Aging Bucket">
          <div style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={stats.sla_buckets}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="value" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Alerts by Scenario">
          <div style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={stats.by_scenario} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
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
              render: r => (
                <span className="inline-flex items-center gap-1 text-red-700 font-semibold">
                  <UrgencyIcon tone="critical" size={12} />
                  {r.age_days}d
                </span>
              ) },
            { key: 'due_status', label: 'Status',
              render: r => (
                <span className="inline-flex items-center gap-1 text-red-700">
                  <UrgencyIcon tone="critical" size={11} withLabel label={r.due_status || 'Breached'} />
                </span>
              ) }
          ]}
          rows={stats.top_sla_breaches}
          emptyMessage="No SLA breaches"
        />
      </Card>

      {isManager && (
        <Card
          title="Analyst Workload"
          subtitle="L1 capacity 35 · L2 capacity 8 — capacities sourced from settings"
        >
          <AnalystWorkloadTable rows={stats.analyst_workload} />
        </Card>
      )}

      <DrawerContainer
        kind={drawerKind}
        onClose={() => setDrawerKind(null)}
        makePath={makePath}
        from={from}
        to={to}
      />
    </div>
  );
}

// ─────────────────────────────────────────────── interactive helpers

function Clickable({ enabled, onClick, children }) {
  if (!enabled) return children;
  return (
    <div onClick={onClick} className="cursor-pointer">
      {children}
    </div>
  );
}

// PR4 / Issue 15: sortable, filterable, team-grouped analyst workload
// table. All in-memory state — no new API calls. Data comes from
// stats.analyst_workload (PR3 shape).
//
// Features:
//   - Click any column header to sort (ASC ↔ DESC). Default: open_alerts DESC.
//   - Filter chips: All · L1 Only · L2 Only · Overloaded Only.
//   - Group by team when more than one team is present; each team header
//     shows analyst count + total open, and is collapsible.
//   - Rows where open_alerts >= role_capacity get a red row tint and an
//     "Over capacity" badge with the critical icon.
//   - Rows >= 90% of role_capacity get an amber tint and a "Near capacity" badge.
//   - When the dataset exceeds 50 rows, only the first 50 in the current
//     sort order are rendered (virtualization gate). For 11 analysts this
//     branch never activates.
function AnalystWorkloadTable({ rows }) {
  const [sortKey, setSortKey] = useState('open_alerts');
  const [sortDir, setSortDir] = useState('desc');
  const [filter, setFilter] = useState('all');
  const [collapsedTeams, setCollapsedTeams] = useState(() => new Set());

  const allRows = Array.isArray(rows) ? rows : [];

  // Apply filter
  const filteredRows = allRows.filter(r => {
    if (filter === 'l1') return r.role === 'analyst_l1';
    if (filter === 'l2') return r.role === 'analyst_l2';
    if (filter === 'overloaded') return !!r.is_overloaded;
    return true;
  });

  // Apply sort
  const sortFns = {
    analyst:        (r) => (r.analyst || '').toLowerCase(),
    team:           (r) => (r.team || '').toLowerCase(),
    open_alerts:    (r) => Number(r.open_alerts) || 0,
    role_capacity:  (r) => Number(r.role_capacity) || 0,
    breached:       (r) => Number(r.breached) || 0,
    completed:      (r) => Number(r.completed) || 0,
    utilization_pct:(r) => Number(r.utilization_pct) || 0
  };
  const sortFn = sortFns[sortKey] || sortFns.open_alerts;
  const sorted = [...filteredRows].sort((a, b) => {
    const av = sortFn(a), bv = sortFn(b);
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ?  1 : -1;
    return 0;
  });

  // Virtualization gate
  const VIRT_LIMIT = 50;
  const visibleRows = sorted.length > VIRT_LIMIT ? sorted.slice(0, VIRT_LIMIT) : sorted;
  const virtualized = sorted.length > VIRT_LIMIT;

  // Group by team
  const teamNames = Array.from(new Set(allRows.map(r => r.team).filter(Boolean)));
  const groupByTeam = teamNames.length > 1;

  const toggleTeam = (t) => setCollapsedTeams(prev => {
    const next = new Set(prev);
    if (next.has(t)) next.delete(t); else next.add(t);
    return next;
  });

  const clickHeader = (k) => {
    if (sortKey === k) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir(k === 'analyst' || k === 'team' ? 'asc' : 'desc'); }
  };

  return (
    <div>
      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {[
          { k: 'all',        label: 'All',           count: allRows.length },
          { k: 'l1',         label: 'L1 Only',       count: allRows.filter(r => r.role === 'analyst_l1').length },
          { k: 'l2',         label: 'L2 Only',       count: allRows.filter(r => r.role === 'analyst_l2').length },
          { k: 'overloaded', label: 'Overloaded',    count: allRows.filter(r => r.is_overloaded).length }
        ].map(c => {
          const active = filter === c.k;
          return (
            <button
              key={c.k}
              type="button"
              onClick={() => setFilter(c.k)}
              className={`inline-flex items-center gap-1 text-xs rounded-full px-3 py-1 border transition-colors ${
                active
                  ? 'bg-blue-600 text-white border-blue-600 font-semibold'
                  : 'bg-white text-slate-700 border-slate-200 hover:border-blue-300'
              }`}
            >
              <span>{c.label}</span>
              <span className={`text-[10px] tabular-nums ${active ? 'opacity-90' : 'text-slate-500'}`}>({c.count})</span>
            </button>
          );
        })}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase text-slate-500 tracking-wider">
            <tr>
              <SortableTh active={sortKey === 'analyst'}        dir={sortDir} onClick={() => clickHeader('analyst')}>Analyst</SortableTh>
              {groupByTeam || <SortableTh active={sortKey === 'team'} dir={sortDir} onClick={() => clickHeader('team')}>Team</SortableTh>}
              <SortableTh active={sortKey === 'open_alerts'}    dir={sortDir} onClick={() => clickHeader('open_alerts')} align="right">Open Alerts</SortableTh>
              <SortableTh active={sortKey === 'role_capacity'}  dir={sortDir} onClick={() => clickHeader('role_capacity')} align="right">Capacity</SortableTh>
              <SortableTh active={sortKey === 'breached'}       dir={sortDir} onClick={() => clickHeader('breached')} align="right">SLA Breaches</SortableTh>
              <SortableTh active={sortKey === 'completed'}      dir={sortDir} onClick={() => clickHeader('completed')} align="right">Closed (30d)</SortableTh>
              <SortableTh active={sortKey === 'utilization_pct'} dir={sortDir} onClick={() => clickHeader('utilization_pct')} align="right">Utilization</SortableTh>
            </tr>
          </thead>
          <tbody>
            {groupByTeam
              ? teamNames.map(team => {
                  const teamRows = visibleRows.filter(r => r.team === team);
                  if (teamRows.length === 0) return null;
                  const teamTotal = teamRows.reduce((s, r) => s + (Number(r.open_alerts) || 0), 0);
                  const collapsed = collapsedTeams.has(team);
                  return (
                    <Fragment key={team}>
                      <tr className="bg-slate-100/60 border-t border-slate-200">
                        <td colSpan={6} className="px-3 py-1.5">
                          <button
                            type="button"
                            onClick={() => toggleTeam(team)}
                            className="inline-flex items-center gap-2 text-[11px] font-semibold text-slate-700 hover:text-navy-900"
                          >
                            <span>{collapsed ? '▸' : '▾'}</span>
                            <span>{team}</span>
                            <span className="text-slate-500 font-normal">
                              · {teamRows.length} analyst{teamRows.length === 1 ? '' : 's'} · {teamTotal} open
                            </span>
                          </button>
                        </td>
                      </tr>
                      {!collapsed && teamRows.map(r => <WorkloadRow key={r.user_id || r.analyst} r={r} hideTeam />)}
                    </Fragment>
                  );
                })
              : visibleRows.map(r => <WorkloadRow key={r.user_id || r.analyst} r={r} hideTeam={false} />)}
          </tbody>
        </table>
      </div>

      {visibleRows.length === 0 && (
        <div className="text-xs text-slate-400 italic px-3 py-4">No analysts match the current filter.</div>
      )}
      {virtualized && (
        <div className="text-[11px] text-slate-500 italic mt-2 px-1">
          Showing first {VIRT_LIMIT} of {sorted.length} rows (sorted by {sortKey}). Apply a filter to narrow the list.
        </div>
      )}
    </div>
  );
}

function SortableTh({ active, dir, onClick, align = 'left', children }) {
  const arrow = active ? (dir === 'asc' ? '▲' : '▼') : '';
  return (
    <th
      onClick={onClick}
      className={`px-3 py-2 cursor-pointer select-none hover:text-navy-900 text-${align}`}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {active && <span className="text-slate-400 text-[9px]">{arrow}</span>}
      </span>
    </th>
  );
}

function WorkloadRow({ r, hideTeam }) {
  const open = Number(r.open_alerts) || 0;
  const cap = Number(r.role_capacity) || 0;
  const isOverloaded = !!r.is_overloaded;
  const isNearCapacity = !isOverloaded && cap > 0 && open >= cap * 0.9;
  const rowBg = isOverloaded
    ? 'bg-red-50/60'
    : isNearCapacity
      ? 'bg-amber-50/60'
      : '';
  const breached = Number(r.breached) || 0;
  return (
    <tr className={`border-t border-slate-100 ${rowBg}`}>
      <td className="px-3 py-2 font-medium text-navy-900">
        <span className="inline-flex items-center gap-1.5">
          {r.analyst}
          {r.role === 'analyst_l2' && (
            <span className="text-[9px] font-bold px-1 rounded bg-purple-100 text-purple-700">L2</span>
          )}
          {r.role === 'analyst_l1' && (
            <span className="text-[9px] font-bold px-1 rounded bg-blue-100 text-blue-700">L1</span>
          )}
        </span>
      </td>
      {!hideTeam && <td className="px-3 py-2 text-slate-600">{r.team || '—'}</td>}
      <td className="px-3 py-2 text-right">
        <span className={`inline-flex items-center justify-end gap-1.5 font-semibold tabular-nums ${
          isOverloaded ? 'text-red-700' : isNearCapacity ? 'text-amber-700' : 'text-slate-800'
        }`}>
          {isOverloaded && <UrgencyIcon tone="critical" size={11} />}
          {isNearCapacity && <UrgencyIcon tone="warning" size={11} />}
          {open}
        </span>
        {isOverloaded && (
          <span className="ml-1.5 inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700 align-middle">
            Over capacity
          </span>
        )}
        {isNearCapacity && (
          <span className="ml-1.5 inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 align-middle">
            Near capacity
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-right text-slate-600 tabular-nums">{cap}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        {breached > 0
          ? (
            <span className="inline-flex items-center justify-end gap-1 text-red-700 font-semibold">
              <UrgencyIcon tone="critical" size={11} />
              {breached}
            </span>
          )
          : <span className="text-slate-400">0</span>}
      </td>
      <td className="px-3 py-2 text-right text-slate-600 tabular-nums">{Number(r.completed) || 0}</td>
      <td className="px-3 py-2 text-right">
        <div className="flex items-center gap-2 justify-end min-w-[140px]">
          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden max-w-[100px]">
            <div
              className={`h-full rounded-full ${
                r.utilization_pct >= 100 ? 'bg-red-500'
                  : r.utilization_pct >= 90 ? 'bg-orange-500'
                  : r.utilization_pct >= 70 ? 'bg-amber-400'
                  : 'bg-green-500'
              }`}
              style={{ width: `${Math.min(100, r.utilization_pct)}%` }}
            />
          </div>
          <span className="text-xs text-slate-700 w-10 text-right tabular-nums">{r.utilization_pct}%</span>
        </div>
      </td>
    </tr>
  );
}

// PR4 / Issue 16: urgency icon system. Color alone fails for ~8% of
// male users with red-green colour blindness (WCAG 1.4.1). Every urgency
// signal on the dashboard pairs a colour with one of these three icons
// plus an explicit text label. Imported lucide icons are reused, no new
// dependencies.
//   tone: 'healthy' | 'warning' | 'critical'
//   label: optional text — defaults to a sensible word per tone
function UrgencyIcon({ tone, label, size = 12, withLabel = false }) {
  const map = {
    healthy:  { Icon: Clock,         color: 'text-green-600',  text: label || 'Healthy'  },
    warning:  { Icon: AlertTriangle, color: 'text-amber-600',  text: label || 'Warning'  },
    critical: { Icon: ShieldAlert,   color: 'text-red-600',    text: label || 'Critical' }
  };
  const cfg = map[tone] || map.healthy;
  const { Icon } = cfg;
  return (
    <span className="inline-flex items-center gap-1">
      <Icon size={size} className={cfg.color} aria-hidden="true" />
      {withLabel && <span className={`text-[11px] font-medium ${cfg.color}`}>{cfg.text}</span>}
    </span>
  );
}

// PR4 / Issue 18: page-level skeleton. Same grid layout as the real
// dashboard so the page doesn't jump when the data lands. Uses Tailwind's
// animate-pulse for the shimmer; no real labels or numbers are shown.
function DashboardSkeleton({ isManager }) {
  const kpiCount = isManager ? 6 : 5;
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading dashboard">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-5 w-64 bg-slate-200 rounded animate-pulse" />
          <div className="h-3 w-80 bg-slate-100 rounded animate-pulse" />
        </div>
        <div className="h-4 w-24 bg-slate-100 rounded animate-pulse" />
      </div>

      {/* WorklistBand placeholder — 5 pill-like cards */}
      {isManager && (
        <>
          <div className="space-y-2">
            <div className="h-3 w-32 bg-slate-200 rounded animate-pulse" />
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {[0, 1, 2, 3, 4].map(i => (
                <div key={i}
                  className="bg-white border border-slate-200 animate-pulse"
                  style={{ borderRadius: 10, borderLeftWidth: 4, borderLeftColor: '#E2E8F0', padding: '12px 14px', minHeight: 92 }}
                />
              ))}
            </div>
          </div>
          {/* HealthStrip placeholder — 4 small pills */}
          <div className="flex flex-wrap gap-2">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="h-6 w-32 bg-slate-100 rounded-full animate-pulse" />
            ))}
          </div>
        </>
      )}

      {/* KPI grid — same column count as real layout */}
      <div className={`grid grid-cols-2 md:grid-cols-3 ${isManager ? 'lg:grid-cols-6' : 'lg:grid-cols-5'} gap-4`}>
        {Array.from({ length: kpiCount }).map((_, i) => (
          <div key={i} className="bg-white rounded-lg border border-slate-200 shadow-sm p-4 animate-pulse" style={{ minHeight: 96 }} />
        ))}
      </div>

      {/* Manager second row */}
      {isManager && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-lg border border-slate-200 shadow-sm p-4 animate-pulse" style={{ minHeight: 96 }} />
          ))}
        </div>
      )}

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-lg border border-slate-200 shadow-sm animate-pulse" style={{ height: 320 }} />
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm animate-pulse" style={{ height: 320 }} />
      </div>
    </div>
  );
}

// PR4 / Issue 18: page-level error state matching the drawer ErrorState
// pattern — amber icon, headline, description, Retry button, and the
// last-attempted timestamp. Retry calls fetchDashboard() without a page
// refresh.
function DashboardErrorState({ message, lastAttempt, onRetry }) {
  const ts = lastAttempt
    ? `Last attempted: ${lastAttempt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : null;
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center text-center py-16 px-6"
      style={{ minHeight: '60vh' }}
    >
      <AlertTriangle size={32} className="text-amber-500 mb-3" />
      <h3 className="text-lg font-semibold text-navy-900">Dashboard data unavailable</h3>
      <p className="text-sm text-slate-600 mt-2 max-w-md">
        Could not load dashboard metrics. This may be a temporary issue with the backend or your network connection.
      </p>
      {message && (
        <p className="text-xs text-slate-400 mt-1 font-mono">{message}</p>
      )}
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md"
      >
        Try Again
      </button>
      {ts && <span className="text-[11px] text-slate-400 mt-2">{ts}</span>}
    </div>
  );
}

// Top-of-page red banner that surfaces when the OFAC SDN list is stale
// or the most recent download failed. Backend signals via
// stats.ofac_status.is_stale; this component renders nothing when healthy.
function OfacStaleBanner({ status, onSynced }) {
  const push = useToast().push;
  const { currentUser } = useRole();
  const [syncing, setSyncing] = useState(false);
  const hours = status?.hours_since_success;
  const detail =
    status?.last_status === 'failed'
      ? 'Last download attempt failed.'
      : hours != null
        ? `Last successful sync: ${formatHoursAgo(hours)}.`
        : 'No successful sync has been recorded.';

  const forceSync = async () => {
    setSyncing(true);
    try {
      await api.post('/ofac/sync');
      await api.post('/audit-trail', {
        entity_type: 'system',
        sar_id: 'ofac_sdn',
        action: 'manual_ofac_sync',
        performed_by: currentUser?.name || 'system',
        details: JSON.stringify({ triggered_by: 'stale_banner_force_sync', timestamp: new Date().toISOString() })
      }).catch(() => {});
      push('OFAC sync started — list will update shortly', 'success', 3500);
      setTimeout(() => { onSynced && onSynced(); }, 5000);
    } catch (e) {
      push(`OFAC sync failed: ${e?.response?.data?.error || e.message}`, 'error', 5000);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div
      role="alert"
      className="flex items-start gap-3 bg-red-50 px-4 py-3 rounded-md"
      style={{ borderLeft: '4px solid #B91C1C' }}
    >
      <ShieldAlert size={20} className="text-red-700 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-red-800">OFAC Sanctions List Outdated</div>
        <div className="text-xs text-red-700 mt-0.5">
          {detail} All screening results may be based on stale data. Contact your administrator immediately.
        </div>
      </div>
      <button
        type="button"
        onClick={forceSync}
        disabled={syncing}
        className="shrink-0 text-xs px-3 py-1.5 rounded border border-red-300 bg-white text-red-700 hover:bg-red-100 disabled:opacity-50 inline-flex items-center gap-1.5"
      >
        {syncing ? <><Loader2 size={12} className="animate-spin" /> Syncing…</> : 'Force Sync'}
      </button>
    </div>
  );
}

function formatHoursAgo(hours) {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min ago`;
  if (hours < 48) return `${Math.round(hours)} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}

// Header-right indicator for "Updated Xs ago / Xm ago / at HH:MM" plus
// an amber error state when the background poll fails. Re-renders every
// 15s so the relative time stays fresh without re-fetching.
function LastUpdatedIndicator({ lastUpdated, pollError }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 15000);
    return () => clearInterval(id);
  }, []);

  if (pollError) {
    return (
      <span
        className="text-xs text-amber-700 inline-flex items-center gap-1"
        title="Dashboard data may be outdated — check your connection"
      >
        <AlertTriangle size={12} /> Update failed
      </span>
    );
  }
  if (!lastUpdated) return null;
  const diffSec = Math.max(0, Math.round((Date.now() - lastUpdated.getTime()) / 1000));
  let label;
  if (diffSec < 60) label = `Updated ${diffSec}s ago`;
  else if (diffSec < 300) label = `Updated ${Math.floor(diffSec / 60)}m ago`;
  else {
    const hh = String(lastUpdated.getHours()).padStart(2, '0');
    const mm = String(lastUpdated.getMinutes()).padStart(2, '0');
    label = `Updated at ${hh}:${mm}`;
  }
  return <span className="text-xs text-slate-500">{label}</span>;
}

// ─────────────────────────────────────────────── drawer system

const DRAWER_META = {
  'total-alerts':    { title: 'Total Alerts',         icon: AlertTriangle, tone: 'default', viewAllLabel: 'View All Alerts',  viewAllPath: 'alerts', filter: {},                                trendDir: 'neutral' },
  'in-progress':     { title: 'In Progress',          icon: Activity,      tone: 'blue',    viewAllLabel: 'View In Progress', viewAllPath: 'alerts', filter: { alert_status: 'Work in Progress' }, trendDir: 'less_is_good' },
  'completed':       { title: 'Completed',            icon: CheckCircle2,  tone: 'green',   viewAllLabel: 'View Completed',   viewAllPath: 'alerts', filter: { alert_status: 'Completed' },     trendDir: 'more_is_good' },
  'sla-breaches':    { title: 'SLA Breaches',         icon: Clock,         tone: 'red',     viewAllLabel: 'View SLA Breaches',viewAllPath: 'alerts', filter: { sla_breached: '1' },             trendDir: 'less_is_good' },
  'avg-aging':       { title: 'Avg Aging',            icon: TrendingUp,    tone: 'orange',  viewAllLabel: 'View Aging Report',viewAllPath: 'alerts', filter: {},                                trendDir: 'less_is_good' },
  'cases-converted': { title: 'Cases Converted',      icon: Briefcase,     tone: 'blue',    viewAllLabel: 'View SAR Cases',   viewAllPath: 'cases',  filter: {},                                trendDir: 'neutral' },
  'team-capacity':   { title: 'Team Capacity',        icon: Users,         tone: 'blue',    viewAllLabel: 'View Team',        viewAllPath: 'users',  filter: {},                                trendDir: 'less_is_good' },
  'false-positive':  { title: 'False Positive Rate',  icon: Target,        tone: 'orange',  viewAllLabel: 'View Analytics',   viewAllPath: 'analytics', filter: {},                             trendDir: 'less_is_good' },
  'unassigned':      { title: 'Unassigned Queue',     icon: ShieldCheck,   tone: 'red',     viewAllLabel: 'Manage Unassigned',viewAllPath: 'alerts', filter: { alert_status: 'Unassigned' },    trendDir: 'less_is_good' },
  // PR3 / Issue 11: SAR Filing Clock drawer (FinCEN 30-day).
  'sar-clock':       { title: 'SAR Filing Clock',     icon: Clock,         tone: 'red',     viewAllLabel: 'View SAR Approvals', viewAllPath: 'sar-approvals', filter: {},                            trendDir: 'less_is_good', endpoint: '/dashboard/sar-clock' }
};

const TONE_TEXT = {
  default: 'text-navy-900',
  blue:    'text-blue-600',
  green:   'text-green-600',
  red:     'text-red-600',
  orange:  'text-orange-600'
};
const TONE_ICON_BG = {
  default: 'bg-slate-100 text-slate-700',
  blue:    'bg-blue-50 text-blue-600',
  green:   'bg-green-50 text-green-600',
  red:     'bg-red-50 text-red-600',
  orange:  'bg-orange-50 text-orange-600'
};

function DrawerContainer({ kind, onClose, makePath, from, to }) {
  const open = kind !== null;
  const lastKindRef = useRef(null);
  if (kind) lastKindRef.current = kind;
  const renderKind = kind || lastKindRef.current;
  const asideRef = useRef(null);
  const openerRef = useRef(null);

  // Lock body scroll while open + capture the element that had focus when
  // the drawer opened so we can restore focus to it on close.
  useEffect(() => {
    if (open) {
      openerRef.current = (typeof document !== 'undefined' && document.activeElement) || null;
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
    // On close: return focus to the KPI card that opened the drawer.
    if (openerRef.current && typeof openerRef.current.focus === 'function') {
      try { openerRef.current.focus(); } catch (_e) { /* ignore */ }
      openerRef.current = null;
    }
  }, [open]);

  // Move focus into the drawer (close button) after it opens, so keyboard
  // users land inside it instead of behind it.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const closeBtn = asideRef.current?.querySelector('[data-drawer-close]');
      if (closeBtn && typeof closeBtn.focus === 'function') closeBtn.focus();
    }, 60);
    return () => clearTimeout(t);
  }, [open, renderKind]);

  // Escape closes, and Tab cycles within the drawer (focus trap).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const root = asideRef.current;
        if (!root) return;
        const focusables = Array.from(root.querySelectorAll(
          'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )).filter(el => !el.disabled && el.offsetParent !== null);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0, 0, 0, 0.4)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 0.25s ease',
          zIndex: 40
        }}
      />
      <aside
        ref={asideRef}
        role="dialog" aria-modal="true"
        className="border-l border-slate-200"
        style={{
          position: 'fixed', top: 0, right: 0,
          height: '100vh', width: 480,
          backgroundColor: '#ffffff',
          boxShadow: '-12px 0 32px -8px rgba(15, 23, 42, 0.18)',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: open ? 'transform 0.25s ease-out' : 'transform 0.25s ease-in',
          zIndex: 50,
          display: 'flex', flexDirection: 'column'
        }}
      >
        {renderKind && (
          <DrawerBody
            key={renderKind + '|' + from + '|' + to}
            kind={renderKind}
            onClose={onClose}
            makePath={makePath}
            from={from}
            to={to}
          />
        )}
      </aside>
    </>
  );
}

function DrawerBody({ kind, onClose, makePath, from, to }) {
  const meta = DRAWER_META[kind];
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setData(null); setError(null);
    // Same lazy-params pattern as the main /stats call: omit from/to when
    // the parent has selected "All Time".
    const params = {};
    if (from) params.from = from;
    if (to) params.to = to;
    // DRAWER_META can specify a custom endpoint (e.g. /dashboard/sar-clock).
    // Default is the per-kind /dashboard/drawer/<kind> pattern.
    const endpoint = (DRAWER_META[kind] && DRAWER_META[kind].endpoint) || `/dashboard/drawer/${kind}`;
    api.get(endpoint, { params })
      .then(r => { if (!cancelled) setData(r.data); })
      .catch(e => { if (!cancelled) setError(e?.response?.data?.error || e.message || 'Failed to load'); });
    return () => { cancelled = true; };
  }, [kind, loadAttempt, from, to]);

  const onViewAll = () => {
    onClose();
    const qs = new URLSearchParams(meta.filter || {}).toString();
    const target = makePath(qs ? `${meta.viewAllPath}?${qs}` : meta.viewAllPath);
    window.location.href = target;
  };

  if (!meta) return null;

  return (
    <>
      <DrawerHeader meta={meta} data={data} onClose={onClose} kind={kind} />
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {error
          ? <ErrorState message={error} onRetry={() => setLoadAttempt(n => n + 1)} />
          : !data ? <SkeletonState />
          : <DrawerContent kind={kind} data={data} onAssigned={() => setLoadAttempt(n => n + 1)} />
        }
      </div>
      <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-end bg-slate-50">
        <button
          onClick={onViewAll}
          className="text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md px-3 py-1.5 inline-flex items-center gap-1"
        >
          {meta.viewAllLabel} <ArrowUpRight size={13} />
        </button>
      </div>
    </>
  );
}

function DrawerHeader({ meta, data, onClose, kind }) {
  const Icon = meta.icon;
  const big = headerBigNumber(data, kind);
  const trend = data?.trend ? renderTrend(data.trend, meta.trendDir) : null;
  return (
    <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between">
      <div className="flex items-start gap-3 min-w-0">
        <div className={`w-10 h-10 rounded-md flex items-center justify-center shrink-0 ${TONE_ICON_BG[meta.tone] || TONE_ICON_BG.default}`}>
          <Icon size={20} />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">{meta.title}</div>
          <div className={`text-3xl font-bold mt-0.5 ${TONE_TEXT[meta.tone] || TONE_TEXT.default}`}>
            {big != null ? big : '—'}
          </div>
          {trend}
        </div>
      </div>
      <button
        onClick={onClose}
        data-drawer-close
        className="p-1 rounded hover:bg-slate-100 shrink-0"
        aria-label="Close drawer"
      >
        <X size={16} />
      </button>
    </div>
  );
}

function headerBigNumber(data, kind) {
  if (!data) return null;
  if (kind === 'avg-aging' && data.avg != null) return `${data.avg}d`;
  if (kind === 'team-capacity' && data.team_pct != null) return `${data.team_pct}%`;
  if (kind === 'false-positive' && data.rate_pct != null) return `${data.rate_pct}%`;
  if (kind === 'sar-clock' && data.in_flight != null) return data.in_flight;
  if (data.total != null) return data.total;
  return '—';
}

function renderTrend(trend, dir) {
  if (!trend || (trend.curr === 0 && trend.prev === 0)) {
    return <div className="text-xs text-slate-400 mt-0.5">— vs last month</div>;
  }
  const up = trend.pct > 0;
  const flat = trend.pct === 0;
  const arrow = flat ? '→' : (up ? '↑' : '↓');
  let toneCls = 'text-slate-500';
  if (!flat) {
    if (dir === 'more_is_good') toneCls = up ? 'text-green-600' : 'text-red-600';
    else if (dir === 'less_is_good') toneCls = up ? 'text-red-600' : 'text-green-600';
    else toneCls = up ? 'text-blue-600' : 'text-slate-500';
  }
  return (
    <div className={`text-xs font-medium mt-0.5 ${toneCls}`}>
      {arrow} {Math.abs(trend.pct)}% vs last month
    </div>
  );
}

function ErrorState({ message, onRetry }) {
  return (
    <div className="p-8 text-center">
      <div className="text-sm text-slate-700 font-medium mb-1">Could not load data</div>
      <div className="text-xs text-slate-500 mb-4">{message}</div>
      <button onClick={onRetry}
        className="text-sm border border-slate-300 hover:bg-slate-50 rounded-md px-3 py-1.5">
        Retry
      </button>
    </div>
  );
}

function SkeletonState() {
  return (
    <div className="p-5 space-y-4 animate-pulse">
      <div className="grid grid-cols-3 gap-2">
        {[0,1,2].map(i => <div key={i} className="h-16 bg-slate-100 rounded" />)}
      </div>
      <div className="h-32 bg-slate-100 rounded" />
      <div className="space-y-2">
        {[0,1,2,3].map(i => <div key={i} className="h-9 bg-slate-100 rounded" />)}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────── reusable bits

function Pill({ tone = 'grey', children }) {
  const cls = {
    red:    'bg-red-50 text-red-700',
    orange: 'bg-orange-50 text-orange-700',
    blue:   'bg-blue-50 text-blue-700',
    purple: 'bg-purple-50 text-purple-700',
    green:  'bg-green-50 text-green-700',
    grey:   'bg-slate-100 text-slate-700'
  }[tone] || 'bg-slate-100 text-slate-700';
  return <span className={`inline-flex items-center text-xs font-semibold px-2 py-1 rounded ${cls}`}>{children}</span>;
}

function StatBlock({ tone = 'slate', label, value }) {
  const cls = {
    'dark-red': 'bg-red-100 border-red-300 text-red-900',
    red:        'bg-red-50 border-red-200 text-red-800',
    orange:     'bg-orange-50 border-orange-200 text-orange-800',
    grey:       'bg-slate-50 border-slate-200 text-slate-700',
    slate:      'bg-slate-50 border-slate-200 text-slate-700'
  }[tone] || 'bg-slate-50 border-slate-200 text-slate-700';
  return (
    <div className={`rounded-md border px-3 py-2 ${cls}`}>
      <div className="text-[10px] uppercase tracking-wide font-semibold opacity-80">{label}</div>
      <div className="text-2xl font-bold mt-0.5">{value}</div>
    </div>
  );
}

function CompactTable({ columns, rows, emptyMessage = 'No data' }) {
  if (!rows || rows.length === 0) {
    return <div className="text-xs text-slate-400 italic py-3 text-center">{emptyMessage}</div>;
  }
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-100">
          {columns.map(c => (
            <th key={c.key} className={`py-1.5 font-semibold ${c.align === 'right' ? 'text-right pr-1' : 'text-left pl-1'}`}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'} style={{ height: 36 }}>
            {columns.map(c => (
              <td key={c.key} className={`px-1 ${c.align === 'right' ? 'text-right' : ''} ${c.cellClass || ''}`}>
                {c.render ? c.render(r) : (r[c.key] ?? '—')}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ProgressBar({ pct, color }) {
  const cls = color
    || (pct >= 85 ? 'bg-red-500' : pct >= 70 ? 'bg-orange-500' : 'bg-green-500');
  return (
    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${cls}`} style={{ width: `${Math.min(100, pct || 0)}%` }} />
    </div>
  );
}

function Avatar({ initials, color, level }) {
  const ringCls = level === 'L2' ? 'ring-purple-200' : 'ring-blue-100';
  return (
    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-bold ring-2 ${ringCls}`}
         style={{ backgroundColor: color || '#64748b' }}>
      {initials}
    </div>
  );
}

const SectionDivider = () => <div className="border-t border-slate-100 my-4" />;

const Section = ({ title, action, children }) => (
  <div>
    <div className="flex items-center justify-between mb-2">
      <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{title}</div>
      {action}
    </div>
    {children}
  </div>
);

// ─────────────────────────────────────────────── per-kind content

const PIE_COLORS = ['#94a3b8', '#f59e0b', '#2563eb', '#10b981', '#8b5cf6', '#ef4444'];

function DrawerContent({ kind, data, onAssigned }) {
  if (kind === 'total-alerts')    return <TotalAlertsContent data={data} />;
  if (kind === 'in-progress')     return <InProgressContent data={data} onChanged={onAssigned} />;
  if (kind === 'completed')       return <CompletedContent data={data} onChanged={onAssigned} />;
  if (kind === 'sla-breaches')    return <SlaBreachesContent data={data} onChanged={onAssigned} />;
  if (kind === 'avg-aging')       return <AvgAgingContent data={data} />;
  if (kind === 'cases-converted') return <CasesConvertedContent data={data} />;
  if (kind === 'team-capacity')   return <TeamCapacityContent data={data} />;
  if (kind === 'false-positive')  return <FalsePositiveContent data={data} />;
  if (kind === 'unassigned')      return <UnassignedContent data={data} onAssigned={onAssigned} />;
  if (kind === 'sar-clock')       return <SarClockContent data={data} />;
  return null;
}

function TotalAlertsContent({ data }) {
  return (
    <div className="px-5 py-4 space-y-4">
      <Section title="Status Breakdown">
        <div style={{ width: '100%', height: 180 }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie data={data.breakdown} dataKey="value" nameKey="name"
                   innerRadius={45} outerRadius={70} paddingAngle={2}>
                {data.breakdown.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend verticalAlign="bottom" height={28} wrapperStyle={{ fontSize: 10 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </Section>
      <SectionDivider />
      <div className="flex flex-wrap gap-2">
        <Pill tone="red">High Priority: {data.high_priority}</Pill>
        <Pill tone="orange">Breaching Today: {data.breaching_today}</Pill>
        <Pill tone="grey">Unassigned: {data.unassigned}</Pill>
      </div>
      <SectionDivider />
      <Section title="Top 3 Scenarios">
        <CompactTable
          columns={[
            { key: 'name', label: 'Scenario' },
            { key: 'count', label: 'Count', align: 'right' },
            { key: 'pct', label: '% of total', align: 'right',
              render: r => <span className="text-slate-500">{r.pct}%</span> }
          ]}
          rows={data.top_scenarios}
        />
      </Section>
    </div>
  );
}

function InProgressContent({ data, onChanged }) {
  const { makePath } = useRoleNavigate();
  // PR4 / Issue 14: "Open Workspace" — sends manager into the alert
  // investigation tab via the manager deep-link pattern.
  const openWorkspace = (alertId) => {
    window.location.href = makePath(`alerts?alert=${encodeURIComponent(alertId)}`);
  };
  return (
    <div className="px-5 py-4 space-y-4">
      <Section title="Analyst Workload">
        <div className="space-y-2">
          {data.by_analyst.length === 0 && (
            <div className="text-xs text-slate-400 italic">No alerts in progress</div>
          )}
          {data.by_analyst.map(a => (
            <div key={a.name} className="flex items-center gap-2">
              <Avatar initials={a.initials} color={a.avatar_color} level={a.level} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-navy-900 truncate">
                    {a.name}
                    <span className={`ml-1 text-[9px] font-bold px-1 rounded ${a.level === 'L2' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>{a.level}</span>
                  </span>
                  <span className="text-slate-500 shrink-0 ml-2">{a.in_progress} alerts · {a.pct}%</span>
                </div>
                <ProgressBar pct={a.pct} />
              </div>
            </div>
          ))}
        </div>
      </Section>
      <SectionDivider />
      <Section title="Oldest in Progress">
        <CompactTable
          columns={[
            { key: 'alert_id', label: 'Alert', cellClass: 'font-mono text-[11px]' },
            { key: 'customer_name', label: 'Customer', cellClass: 'truncate max-w-[120px]' },
            { key: 'age_days', label: 'Days', align: 'right',
              render: r => {
                const tone = r.age_days >= 21 ? 'critical' : r.age_days >= 10 ? 'warning' : 'healthy';
                const cls = tone === 'critical' ? 'text-red-700' : tone === 'warning' ? 'text-amber-700' : 'text-green-700';
                return (
                  <span className={`inline-flex items-center justify-end gap-1 font-medium ${cls}`}>
                    <UrgencyIcon tone={tone} size={11} />
                    {r.age_days}d
                  </span>
                );
              } },
            { key: 'priority', label: 'Priority', align: 'right',
              render: r => <Badge value={r.priority} /> },
            { key: 'actions', label: '', align: 'right',
              render: r => (
                <button
                  type="button"
                  onClick={() => openWorkspace(r.alert_id)}
                  className="text-[11px] bg-blue-600 hover:bg-blue-700 text-white rounded px-2 py-0.5"
                >
                  Open Workspace
                </button>
              ) }
          ]}
          rows={data.oldest}
        />
      </Section>
    </div>
  );
}

function CompletedContent({ data, onChanged }) {
  const push = useToast().push;
  const { currentUser } = useRole();
  const [expandedAlertId, setExpandedAlertId] = useState(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  // PR4 / Issue 14: per-row "Add QA Comment" — inline textarea (not a modal).
  // POSTs to /case-notes with a "[QA Review] " prefix so the note is easy
  // to spot in the investigation log later.
  const saveQa = async (alertId) => {
    const text = note.trim();
    if (!text) return;
    setSaving(true);
    try {
      await api.post('/case-notes', {
        alert_id: alertId,
        note_text: `[QA Review] ${text}`,
        analyst: currentUser?.name || 'Compliance Manager'
      });
      push('QA comment added', 'success', 2500);
      setExpandedAlertId(null);
      setNote('');
      onChanged?.();
    } catch (e) {
      push(`Failed to add QA comment: ${e?.response?.data?.error || e.message}`, 'error', 4000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="px-5 py-4 space-y-4">
      <div className="flex flex-wrap gap-2">
        <Pill tone="grey">False Positive: {data.fp}</Pill>
        <Pill tone="blue">Escalated to L2: {data.l2}</Pill>
        <Pill tone="purple">Escalated to SAR: {data.sar}</Pill>
      </div>
      <SectionDivider />
      <Section title="Last 4 Weeks">
        <div style={{ width: '100%', height: 140 }}>
          <ResponsiveContainer>
            <BarChart data={data.by_week}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="#10b981" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="text-[11px] text-slate-500 italic mt-1">
          Last 4 weeks · not affected by operational filter
        </div>
      </Section>
      <SectionDivider />
      <Section title="Fastest Closures This Month">
        <div className="space-y-2 text-xs">
          {(data.fastest || []).length === 0 && (
            <div className="text-slate-400 italic">No closures this month</div>
          )}
          {(data.fastest || []).map(r => (
            <div key={r.alert_id} className="border border-slate-100 rounded p-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-[11px] text-navy-900">{r.alert_id}</span>
                  <span className="text-slate-500 truncate">{r.analyst}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-medium text-green-700">{r.days}d</span>
                  <button
                    type="button"
                    onClick={() => {
                      setExpandedAlertId(expandedAlertId === r.alert_id ? null : r.alert_id);
                      setNote('');
                    }}
                    className="text-[11px] border border-slate-300 rounded px-2 py-0.5 hover:bg-slate-50"
                  >
                    {expandedAlertId === r.alert_id ? 'Cancel' : 'Add QA Comment'}
                  </button>
                </div>
              </div>
              {expandedAlertId === r.alert_id && (
                <div className="mt-2 space-y-2">
                  <textarea
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    rows={2}
                    placeholder="QA review notes…"
                    className="w-full border border-slate-200 rounded p-1.5 text-xs focus:outline-none focus:border-blue-500"
                    autoFocus
                  />
                  <div className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => saveQa(r.alert_id)}
                      disabled={saving || !note.trim()}
                      className="text-[11px] bg-blue-600 hover:bg-blue-700 text-white rounded px-2 py-0.5 disabled:opacity-50"
                    >
                      {saving ? 'Saving…' : 'Save Note'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function SlaBreachesContent({ data, onChanged }) {
  const push = useToast().push;
  const { currentUser, analysts: allAnalystNames, analystProfiles } = useRole();

  // L1 analyst list pulled from RoleContext, no extra round-trip.
  const l1Analysts = (allAnalystNames || []).filter(
    n => analystProfiles[n]?.level === 'L1'
  );

  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkTarget, setBulkTarget] = useState('');
  const [bulkInFlight, setBulkInFlight] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(null); // text e.g. "Reassigning…"

  // Per-row inline state for Reassign dropdown + Add Note textarea
  const [openMenu, setOpenMenu] = useState(null);    // { alertId, kind: 'reassign'|'note' } | null
  const [noteText, setNoteText] = useState('');
  const [busy, setBusy] = useState(false);

  const rows = data.most_overdue || [];

  const toggleRow = (id) => setSelectedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allSelected = rows.length > 0 && rows.every(r => selectedIds.has(r.alert_id));
  const toggleAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(rows.map(r => r.alert_id)));
  };

  // PR4 / Issue 14: single-row Reassign → PATCH /api/alerts/:id/assign
  const reassignOne = async (alertId, analystName) => {
    setBusy(true);
    try {
      await api.patch(`/alerts/${encodeURIComponent(alertId)}/assign`, {
        assigned_to: analystName,
        assigned_by: currentUser?.name || 'Compliance Manager'
      });
      push(`Alert ${alertId} reassigned to ${analystName}`, 'success', 2500);
      setOpenMenu(null);
      setTimeout(() => onChanged?.(), 1000);
    } catch (e) {
      push(`Reassign failed: ${e?.response?.data?.error || e.message}`, 'error', 4000);
    } finally {
      setBusy(false);
    }
  };

  // PR4 / Issue 14: single-row Add Note → POST /api/case-notes
  const saveNote = async (alertId) => {
    const text = noteText.trim();
    if (!text) return;
    setBusy(true);
    try {
      await api.post('/case-notes', {
        alert_id: alertId,
        note_text: text,
        analyst: currentUser?.name || 'Compliance Manager'
      });
      push('Note added', 'success', 2500);
      setOpenMenu(null);
      setNoteText('');
    } catch (e) {
      push(`Failed to add note: ${e?.response?.data?.error || e.message}`, 'error', 4000);
    } finally {
      setBusy(false);
    }
  };

  // PR4 / Issue 14: bulk Reassign → PATCH /api/alerts/bulk-assign (single
  // round-trip, capacity-aware). Reports assigned vs. skipped counts in
  // the toast so the manager sees if anyone was over capacity.
  const bulkReassign = async () => {
    if (!bulkTarget || selectedIds.size === 0) return;
    setBulkInFlight(true);
    setBulkProgress(`Reassigning ${selectedIds.size} alert${selectedIds.size === 1 ? '' : 's'}…`);
    try {
      const ids = Array.from(selectedIds);
      const r = await api.patch('/alerts/bulk-assign', {
        alert_ids: ids,
        assigned_to: bulkTarget,
        assigned_by: currentUser?.name || 'Compliance Manager'
      });
      const { assigned = 0, skipped = 0, failed = 0 } = r.data || {};
      let msg = `${assigned} alert${assigned === 1 ? '' : 's'} reassigned to ${bulkTarget}`;
      if (skipped > 0) msg += ` · ${skipped} skipped (capacity)`;
      if (failed > 0) msg += ` · ${failed} failed`;
      push(msg, skipped + failed > 0 ? 'warning' : 'success', 4000);
      setSelectedIds(new Set());
      setBulkTarget('');
      setTimeout(() => onChanged?.(), 1000);
    } catch (e) {
      push(`Bulk reassign failed: ${e?.response?.data?.error || e.message}`, 'error', 4000);
    } finally {
      setBulkInFlight(false);
      setBulkProgress(null);
    }
  };

  return (
    <div className="px-5 py-4 space-y-4">
      <Section title="Urgency">
        <div className="grid grid-cols-3 gap-2">
          <StatBlock tone="dark-red" label=">7 days" value={data.urgency_buckets.gt7} />
          <StatBlock tone="red"      label="3-7 days" value={data.urgency_buckets.between3and7} />
          <StatBlock tone="orange"   label="<3 days" value={data.urgency_buckets.lt3} />
        </div>
      </Section>
      <SectionDivider />
      <Section title="Breaches by Analyst">
        <div className="space-y-2">
          {data.by_analyst.length === 0 && <div className="text-xs text-slate-400 italic">No breaches</div>}
          {data.by_analyst.map(a => {
            const max = Math.max(1, ...data.by_analyst.map(x => x.breaches));
            const pct = (a.breaches / max) * 100;
            return (
              <div key={a.name} className="flex items-center gap-2">
                <Avatar initials={a.initials} color={a.avatar_color} level={a.level} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-navy-900 truncate">{a.name}</span>
                    <span className="text-red-700 font-semibold ml-2">{a.breaches}</span>
                  </div>
                  <ProgressBar pct={pct} color="bg-red-500" />
                </div>
              </div>
            );
          })}
        </div>
      </Section>
      <SectionDivider />
      <Section title="Most Overdue">
        {/* Bulk action bar — only renders when 1+ rows are selected. */}
        {selectedIds.size > 0 && (
          <div className="mb-2 flex items-center gap-2 bg-blue-50 border border-blue-200 rounded px-2 py-1.5 text-xs">
            <span className="text-blue-900 font-medium">{selectedIds.size} selected</span>
            <select
              value={bulkTarget}
              onChange={e => setBulkTarget(e.target.value)}
              disabled={bulkInFlight}
              className="border border-slate-300 rounded text-xs px-2 py-0.5"
            >
              <option value="">Bulk Reassign to…</option>
              {l1Analysts.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <button
              type="button"
              onClick={bulkReassign}
              disabled={!bulkTarget || bulkInFlight}
              className="text-[11px] bg-blue-600 hover:bg-blue-700 text-white rounded px-2 py-0.5 disabled:opacity-50"
            >
              {bulkInFlight ? (bulkProgress || 'Reassigning…') : 'Apply'}
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              disabled={bulkInFlight}
              className="text-[11px] text-slate-600 hover:text-navy-900 ml-auto"
            >
              Clear Selection
            </button>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase text-slate-500 tracking-wider">
              <tr className="border-b border-slate-200">
                <th className="px-1 py-1.5 w-6">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all rows"
                  />
                </th>
                <th className="px-2 py-1.5 text-left">Alert ID</th>
                <th className="px-2 py-1.5 text-left">Analyst</th>
                <th className="px-2 py-1.5 text-left">Assigned</th>
                <th className="px-2 py-1.5 text-right">Breached</th>
                <th className="px-2 py-1.5 text-left">Scenario</th>
                <th className="px-2 py-1.5 text-left">Priority</th>
                <th className="px-2 py-1.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={8} className="text-xs italic text-slate-400 px-2 py-3 text-center">No breaches</td></tr>
              )}
              {rows.map(r => {
                const checked = selectedIds.has(r.alert_id);
                const reassignOpen = openMenu?.alertId === r.alert_id && openMenu?.kind === 'reassign';
                const noteOpen     = openMenu?.alertId === r.alert_id && openMenu?.kind === 'note';
                return (
                  <Fragment key={r.alert_id}>
                    <tr className={`border-t border-slate-100 ${checked ? 'bg-blue-50/40' : ''}`}>
                      <td className="px-1 py-1.5 align-top">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleRow(r.alert_id)}
                          aria-label={`Select ${r.alert_id}`}
                        />
                      </td>
                      <td className="px-2 py-1.5 font-mono text-[11px] text-navy-900">{r.alert_id}</td>
                      <td className="px-2 py-1.5 text-[11px] truncate max-w-[90px]">
                        {r.assigned_to || <span className="italic text-slate-400">Unassigned</span>}
                      </td>
                      <td className="px-2 py-1.5 text-[11px] whitespace-nowrap">{formatAssignedDate(r.created_date)}</td>
                      <td className="px-2 py-1.5 text-right font-medium">
                        <span className="inline-flex items-center justify-end gap-1 text-red-700">
                          <UrgencyIcon tone="critical" size={11} />
                          {r.days_overdue}d
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-[11px] truncate max-w-[100px]">{r.scenario}</td>
                      <td className="px-2 py-1.5 text-[11px]"><Badge value={r.priority} /></td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => {
                            setOpenMenu(reassignOpen ? null : { alertId: r.alert_id, kind: 'reassign' });
                            setNoteText('');
                          }}
                          className="text-[11px] border border-slate-300 rounded px-2 py-0.5 hover:bg-slate-50 mr-1"
                        >
                          Reassign
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setOpenMenu(noteOpen ? null : { alertId: r.alert_id, kind: 'note' });
                            setNoteText('');
                          }}
                          className="text-[11px] border border-blue-300 text-blue-700 rounded px-2 py-0.5 hover:bg-blue-50"
                        >
                          Add Note
                        </button>
                      </td>
                    </tr>
                    {reassignOpen && (
                      <tr className="bg-slate-50">
                        <td colSpan={8} className="px-3 py-2">
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-slate-600">Reassign to:</span>
                            <select
                              defaultValue=""
                              disabled={busy}
                              onChange={e => e.target.value && reassignOne(r.alert_id, e.target.value)}
                              className="border border-slate-300 rounded text-xs px-2 py-0.5"
                            >
                              <option value="">Select an L1 analyst…</option>
                              {l1Analysts.map(n => <option key={n} value={n}>{n}</option>)}
                            </select>
                            <button
                              type="button"
                              onClick={() => setOpenMenu(null)}
                              className="text-[11px] text-slate-500 hover:text-navy-900 ml-1"
                            >
                              Cancel
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                    {noteOpen && (
                      <tr className="bg-slate-50">
                        <td colSpan={8} className="px-3 py-2">
                          <div className="space-y-1.5">
                            <textarea
                              value={noteText}
                              onChange={e => setNoteText(e.target.value)}
                              rows={2}
                              placeholder="Add investigation note…"
                              className="w-full border border-slate-200 rounded p-1.5 text-xs focus:outline-none focus:border-blue-500"
                              autoFocus
                            />
                            <div className="flex justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => setOpenMenu(null)}
                                className="text-[11px] text-slate-500 hover:text-navy-900 px-2 py-0.5"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => saveNote(r.alert_id)}
                                disabled={busy || !noteText.trim()}
                                className="text-[11px] bg-blue-600 hover:bg-blue-700 text-white rounded px-2 py-0.5 disabled:opacity-50"
                              >
                                {busy ? 'Saving…' : 'Save Note'}
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function AvgAgingContent({ data }) {
  const total = data.total_open || 1;
  const segments = [
    { key: '1-7d',  label: '1-7d',  count: data.distribution['1-7d'],  color: '#10b981' },
    { key: '7-15d', label: '7-15d', count: data.distribution['7-15d'], color: '#eab308' },
    { key: '15-30d',label: '15-30d',count: data.distribution['15-30d'],color: '#f59e0b' },
    { key: '30d+',  label: '30d+',  count: data.distribution['30d+'],  color: '#ef4444' }
  ];
  return (
    <div className="px-5 py-4 space-y-4">
      <Section title="Aging Distribution">
        <div className="h-3 w-full rounded-full overflow-hidden flex bg-slate-100">
          {segments.map(s => {
            const w = (s.count / total) * 100;
            if (w === 0) return null;
            return <div key={s.key} title={`${s.label}: ${s.count} (${Math.round(w)}%)`}
                        style={{ width: `${w}%`, backgroundColor: s.color }} />;
          })}
        </div>
        <div className="grid grid-cols-4 gap-2 mt-2 text-[10px]">
          {segments.map(s => (
            <div key={s.key} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: s.color }} />
              <span className="text-slate-600">{s.label}</span>
              <span className="ml-auto font-semibold text-navy-900">{s.count}</span>
            </div>
          ))}
        </div>
        <div className="text-[11px] text-slate-500 italic mt-2">
          Current state · alerts grouped by aging bucket
        </div>
      </Section>
      <SectionDivider />
      <div className="grid grid-cols-3 gap-2">
        <StatBlock label="Longest open" value={`${data.longest}d`} tone="red" />
        <StatBlock label="Newest alert" value={`${data.newest}d`} tone="grey" />
        <StatBlock label="Team target"  value={`${data.target}d`} tone="grey" />
      </div>
      <SectionDivider />
      <Section title="Older than 30 days">
        <CompactTable
          columns={[
            { key: 'alert_id', label: 'Alert', cellClass: 'font-mono text-[11px]' },
            { key: 'customer_name', label: 'Customer', cellClass: 'truncate max-w-[100px]' },
            { key: 'age', label: 'Age', align: 'right',
              render: r => <span className="font-medium text-red-700">{r.age}d</span> },
            { key: 'assigned_to', label: 'Analyst', cellClass: 'text-[11px] truncate max-w-[90px]',
              render: r => r.assigned_to || '—' }
          ]}
          rows={data.oldest_4}
          emptyMessage="No alerts older than 30 days"
        />
      </Section>
    </div>
  );
}

function CasesConvertedContent({ data }) {
  const conversionPct = data.funnel.alerts > 0
    ? Math.round((data.funnel.escalated_sar / data.funnel.alerts) * 100) : 0;
  return (
    <div className="px-5 py-4 space-y-4">
      <Section title="Conversion Funnel">
        <div className="space-y-1">
          <FunnelRow label="Alerts Generated" value={data.funnel.alerts} accent="bg-blue-500" />
          <div className="text-center text-slate-400 text-xs">↓</div>
          <FunnelRow label="Escalated to SAR" value={`${data.funnel.escalated_sar} (${conversionPct}%)`} accent="bg-orange-500" />
          <div className="text-center text-slate-400 text-xs">↓</div>
          <FunnelRow label="Filed SARs" value={data.funnel.filed} accent="bg-green-500" />
        </div>
      </Section>
      <SectionDivider />
      <div className="flex flex-wrap gap-2">
        <Pill tone="orange">Pending Approval: {data.pending_approval}</Pill>
        <Pill tone="green">Filed This Month: {data.filed_this_month}</Pill>
      </div>
      <SectionDivider />
      <Section title="Recent Conversions">
        <CompactTable
          columns={[
            { key: 'case_id', label: 'Case', cellClass: 'font-mono text-[11px]' },
            { key: 'customer_name', label: 'Customer', cellClass: 'truncate max-w-[120px]' },
            { key: 'filed_by', label: 'Filed By', cellClass: 'text-[11px] truncate max-w-[80px]',
              render: r => r.filed_by || '—' },
            { key: 'date', label: 'Date', align: 'right', cellClass: 'text-[11px]' }
          ]}
          rows={data.recent}
          emptyMessage="No recent conversions"
        />
      </Section>
    </div>
  );
}

function FunnelRow({ label, value, accent }) {
  return (
    <div className="flex items-center gap-3 bg-slate-50 rounded p-2">
      <div className={`w-1 h-8 rounded-full ${accent}`} />
      <div className="flex-1">
        <div className="text-xs text-slate-500">{label}</div>
        <div className="text-base font-bold text-navy-900">{value}</div>
      </div>
    </div>
  );
}

function TeamCapacityContent({ data }) {
  const overloaded = data.analysts.filter(a => a.pct >= 100);
  return (
    <div className="px-5 py-4 space-y-4">
      <Section title="Analysts">
        <div className="space-y-2">
          {data.analysts.map(a => (
            <div key={a.name} className="flex items-center gap-2">
              <Avatar initials={a.initials} color={a.avatar_color} level={a.level} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-navy-900 truncate">
                    {a.name}
                    <span className={`ml-1 text-[9px] font-bold px-1 rounded ${a.level === 'L2' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>{a.level}</span>
                  </span>
                  <span className="text-slate-500 shrink-0 ml-2">
                    {a.open}/{a.capacity} · <span className={a.pct >= 85 ? 'text-red-600 font-semibold' : ''}>{a.pct}%</span>
                  </span>
                </div>
                <ProgressBar pct={a.pct} />
              </div>
            </div>
          ))}
        </div>
      </Section>
      {overloaded.length > 0 && (
        <>
          <SectionDivider />
          <div className="text-sm bg-red-50 border border-red-200 rounded p-3 text-red-700">
            <span className="font-semibold">{overloaded.length} analyst{overloaded.length === 1 ? '' : 's'} at full capacity</span>
            <div className="text-xs mt-0.5 text-red-600">{overloaded.map(a => a.name).join(', ')}</div>
          </div>
        </>
      )}
      {data.team_pct >= data.threshold_pct && data.total_unassigned > 0 && (
        <div className="text-xs">
          <Pill tone="orange">Consider redistributing {data.total_unassigned} unassigned alert{data.total_unassigned === 1 ? '' : 's'}</Pill>
        </div>
      )}
    </div>
  );
}

function FalsePositiveContent({ data }) {
  const above = data.rate_pct > data.benchmark_pct;
  const monthDelta = (data.this_month_pct - data.last_month_pct).toFixed(1);
  const monthArrow = data.this_month_pct > data.last_month_pct ? '↑' : data.this_month_pct < data.last_month_pct ? '↓' : '→';
  const monthCls = data.this_month_pct > data.last_month_pct ? 'text-red-600' : data.this_month_pct < data.last_month_pct ? 'text-green-600' : 'text-slate-500';
  const fpRateCellCls = (p) => p > 40 ? 'text-red-700 font-semibold' : p >= 20 ? 'text-orange-700 font-semibold' : 'text-green-700 font-semibold';
  return (
    <div className="px-5 py-4 space-y-4">
      <Section title="vs Industry Benchmark">
        <div className="space-y-2">
          <CompareBar label="Your rate" pct={data.rate_pct} color="bg-orange-500" />
          <CompareBar label="Benchmark" pct={data.benchmark_pct} color="bg-slate-400" />
        </div>
        {above && (
          <div className="mt-2 text-xs bg-red-50 border border-red-200 rounded p-2 text-red-700">
            ⚠ Above industry benchmark of {data.benchmark_pct}%
          </div>
        )}
      </Section>
      <SectionDivider />
      <Section title="FP Rate by Scenario">
        <CompactTable
          columns={[
            { key: 'scenario', label: 'Scenario', cellClass: 'truncate max-w-[140px]' },
            { key: 'total', label: 'Total', align: 'right' },
            { key: 'fp_count', label: 'FP', align: 'right' },
            { key: 'fp_rate_pct', label: 'FP Rate %', align: 'right',
              render: r => <span className={fpRateCellCls(r.fp_rate_pct)}>{r.fp_rate_pct}%</span> }
          ]}
          rows={data.by_scenario}
        />
      </Section>
      <SectionDivider />
      <div className="text-xs text-slate-600">
        FP rate was <span className="font-semibold">{data.last_month_pct}%</span> last month —
        <span className={`ml-1 font-semibold ${monthCls}`}>{monthArrow} {Math.abs(monthDelta)}pp</span>
      </div>
      <div className="text-[11px] text-slate-500 italic">
        This month vs last month · rolling
      </div>
    </div>
  );
}

function CompareBar({ label, pct, color }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-0.5">
        <span className="text-slate-600">{label}</span>
        <span className="font-semibold text-navy-900">{pct}%</span>
      </div>
      <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

function UnassignedContent({ data, onAssigned }) {
  const [assignFor, setAssignFor] = useState(null);
  return (
    <div className="px-5 py-4 space-y-4">
      <Section title="Priority">
        <div className="grid grid-cols-3 gap-2">
          <StatBlock tone="red"    label="High"   value={data.by_priority.High || 0} />
          <StatBlock tone="orange" label="Medium" value={data.by_priority.Medium || 0} />
          <StatBlock tone="grey"   label="Low"    value={data.by_priority.Low || 0} />
        </div>
      </Section>
      <SectionDivider />
      <Section title="Available Capacity">
        {data.available_analysts.length === 0
          ? <div className="text-xs text-slate-400 italic">No analyst is below 85% capacity</div>
          : (
            <div className="space-y-1.5">
              {data.available_analysts.map(a => (
                <div key={a.name} className="flex items-center gap-2 text-xs">
                  <Avatar initials={a.initials} color={a.avatar_color} level={a.level} />
                  <span className="font-medium text-navy-900 truncate flex-1">{a.name}</span>
                  <span className="text-slate-500">{a.open}/{a.capacity}</span>
                  <Pill tone="green">Can take {a.can_take} more</Pill>
                </div>
              ))}
            </div>
          )}
      </Section>
      {data.recommendation && (
        <div className="text-xs bg-blue-50 border border-blue-200 rounded p-3 text-blue-800">
          <span className="font-semibold">Recommended:</span> {data.recommendation.message}
        </div>
      )}
      <SectionDivider />
      <Section title="Top Unassigned Alerts">
        <CompactTable
          columns={[
            { key: 'alert_id', label: 'Alert', cellClass: 'font-mono text-[11px]' },
            { key: 'scenario', label: 'Scenario', cellClass: 'truncate max-w-[100px] text-[11px]' },
            { key: 'priority', label: 'Priority',
              render: r => <Badge value={r.priority} /> },
            { key: 'age_days', label: 'Age', align: 'right',
              render: r => <span className="text-slate-600">{r.age_days}d</span> },
            { key: 'actions', label: '', align: 'right',
              render: r => (
                <button onClick={() => setAssignFor(r)}
                  className="text-[11px] bg-blue-600 hover:bg-blue-700 text-white rounded px-2 py-0.5">
                  Assign
                </button>
              )}
          ]}
          rows={data.top_5}
          emptyMessage="No unassigned alerts"
        />
      </Section>

      {assignFor && (
        <InlineAssignModal
          alert={assignFor}
          analysts={data.available_analysts}
          onCancel={() => setAssignFor(null)}
          onAssigned={() => { setAssignFor(null); onAssigned?.(); }}
        />
      )}
    </div>
  );
}

function InlineAssignModal({ alert, analysts, onCancel, onAssigned }) {
  const [target, setTarget] = useState(analysts[0]?.name || '');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState(null);
  const submit = async () => {
    if (!target) return;
    setSubmitting(true); setErr(null);
    try {
      await api.patch(`/alerts/${alert.alert_id}/assign`, { assigned_to: target });
      onAssigned();
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    } finally { setSubmitting(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-100 font-semibold text-navy-900 text-sm">
          Assign {alert.alert_id}
        </div>
        <div className="p-5 space-y-3 text-sm">
          {analysts.length === 0 ? (
            <div className="text-xs text-slate-500">No available analysts (all at capacity).</div>
          ) : (
            <select value={target} onChange={e => setTarget(e.target.value)}
              className="w-full border border-slate-200 rounded px-2 py-1.5 bg-white">
              {analysts.map(a => <option key={a.name} value={a.name}>{a.name} ({a.level}) — {a.pct}% capacity</option>)}
            </select>
          )}
          {err && <div className="text-xs text-red-600">{err}</div>}
        </div>
        <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onCancel} className="text-sm border border-slate-300 rounded px-3 py-1.5 hover:bg-slate-50">Cancel</button>
          <button onClick={submit} disabled={!target || submitting}
            className="text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded px-3 py-1.5">
            {submitting ? 'Assigning…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}


// Format an ISO-style date (YYYY-MM-DD or full ISO) as "DD MMM YYYY".
function formatAssignedDate(raw) {
  if (!raw) return '—';
  const iso = raw.length <= 10 ? `${raw}T00:00:00` : raw;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return raw;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
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

// ─────────────────────────────────────────────── Issue 11: SAR Clock card
//
// KPI card on the manager second row. Fetches /dashboard/sar-clock on
// mount + every 60s. Surfaces 4 colour-coded counts in the card body
// and a green checkmark when nothing is in flight.
function SarClockKpiCard() {
  const [data, setData] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const load = () => api.get('/dashboard/sar-clock')
      .then(r => { if (!cancelled) setData(r.data); })
      .catch(() => {});
    load();
    const id = setInterval(load, 60000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const overdue = data?.overdue ?? 0;
  const c3 = data?.due_within_3_days ?? 0;
  const c7 = data?.due_within_7_days ?? 0;
  const inFlight = data?.in_flight ?? 0;
  const isAllClear = data && inFlight === 0;
  const isOverdue = overdue > 0;

  const borderColor = isOverdue ? '#DC2626' : (c3 + c7 > 0 ? '#F59E0B' : '#16A34A');

  return (
    <div
      className="bg-white border border-slate-200 shadow-sm p-4 cursor-pointer transition-all duration-200 ease-in-out hover:border-[#BFDBFE] hover:bg-[#F8FAFF]"
      style={{ borderRadius: 8, borderLeftWidth: 4, borderLeftColor: borderColor }}
    >
      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-500 uppercase tracking-wide">SAR Filing Clock</div>
        <Clock size={16} className={isOverdue ? 'text-red-500' : 'text-slate-400'} />
      </div>
      <div className="text-[10px] text-slate-500 mt-0.5">FinCEN 30-day requirement</div>

      {isAllClear ? (
        <div className="mt-2 flex items-center gap-1.5 text-sm text-green-700 font-medium">
          <CheckCircle2 size={14} /> All SARs filed on time
        </div>
      ) : (
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
            <span className="text-slate-600">Overdue:</span>
            <span className={`font-bold tabular-nums ${overdue > 0 ? 'text-red-600' : 'text-slate-400'}`}>{overdue}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-orange-500 inline-block" />
            <span className="text-slate-600">≤ 3d:</span>
            <span className={`font-bold tabular-nums ${c3 > 0 ? 'text-orange-600' : 'text-slate-400'}`}>{c3}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
            <span className="text-slate-600">≤ 7d:</span>
            <span className={`font-bold tabular-nums ${c7 > 0 ? 'text-amber-600' : 'text-slate-400'}`}>{c7}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
            <span className="text-slate-600">In flight:</span>
            <span className="font-bold tabular-nums text-slate-700">{inFlight}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// Drawer body for the SAR Filing Clock — sorted by days_remaining ASC.
function SarClockContent({ data }) {
  const items = data?.items || [];
  if (items.length === 0) {
    return (
      <div className="px-5 py-8 text-center text-sm text-slate-500">
        <CheckCircle2 size={28} className="mx-auto mb-2 text-green-500" />
        All SARs are filed on time — no in-flight items.
      </div>
    );
  }
  return (
    <div className="px-5 py-4 space-y-3 text-xs">
      <div className="grid grid-cols-3 gap-2 mb-3">
        <StatBlock tone="red"    label="Overdue"     value={data.overdue} />
        <StatBlock tone="orange" label="≤ 3 days"    value={data.due_within_3_days} />
        <StatBlock tone="blue"   label="≤ 7 days"    value={data.due_within_7_days} />
      </div>
      <Section title={`In-flight SARs (${items.length})`}>
        <div className="overflow-x-auto -mx-2">
          <table className="min-w-full text-xs">
            <thead className="border-b border-slate-200 text-[10px] uppercase text-slate-500 tracking-wider">
              <tr>
                <th className="text-left py-1.5 px-2">SAR</th>
                <th className="text-left py-1.5 px-2">Customer</th>
                <th className="text-left py-1.5 px-2">Status</th>
                <th className="text-left py-1.5 px-2">Detection</th>
                <th className="text-right py-1.5 px-2">Days Remaining</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map(it => {
                const d = it.days_remaining;
                const tone = d < 0 ? 'critical' : d <= 7 ? 'warning' : 'healthy';
                const cls = d < 0
                  ? 'text-red-700 font-semibold'
                  : d <= 3
                    ? 'text-orange-700 font-semibold'
                    : d <= 7
                      ? 'text-amber-700 font-medium'
                      : 'text-green-700';
                const label = d < 0
                  ? `${Math.abs(d)}d overdue`
                  : `${d}d left`;
                return (
                  <tr key={it.sar_id}>
                    <td className="px-2 py-1.5 font-mono text-navy-900">{it.sar_id}</td>
                    <td className="px-2 py-1.5 truncate max-w-[140px]">{it.customer_name}</td>
                    <td className="px-2 py-1.5 text-slate-600">{it.sar_status}</td>
                    <td className="px-2 py-1.5 text-slate-600 tabular-nums">{(it.detection_date || '').slice(0, 10)}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${cls}`}>
                      <span className="inline-flex items-center justify-end gap-1">
                        <UrgencyIcon tone={tone} size={11} />
                        {label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {data?.detection_date_source && (
          <div className="text-[10px] text-slate-400 italic mt-2">
            {data.detection_date_source}
          </div>
        )}
      </Section>
    </div>
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

// Manager-only status card. Calls /api/ofac/status on mount and gives the
// manager a one-click "Force Sync" trigger. Failures don't break the rest
// of the dashboard — the widget just shows a dash.
function OfacStatusWidget() {
  const push = useToast().push;
  const { currentUser } = useRole();
  const [s, setS] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [err, setErr] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get('/ofac/status');
      setS(data);
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    }
  };
  useEffect(() => { load(); }, []);

  // Confirm-modal driven Force Sync (replaces window.confirm). On success:
  //   1. POST /ofac/sync
  //   2. Write an audit-trail row tagging the user that triggered it
  //   3. Toast feedback
  //   4. Refresh widget after 5 s so the new last_updated lands
  const forceSync = async () => {
    setConfirmOpen(false);
    setSyncing(true);
    setErr(null);
    try {
      await api.post('/ofac/sync');
      await api.post('/audit-trail', {
        entity_type: 'system',
        sar_id: 'ofac_sdn',
        action: 'manual_ofac_sync',
        performed_by: currentUser?.name || 'system',
        details: JSON.stringify({
          triggered_by: 'dashboard_force_sync',
          timestamp: new Date().toISOString()
        })
      }).catch(() => {});
      push('OFAC sync started — list will update shortly', 'success', 3500);
      setTimeout(() => { load(); }, 5000);
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'OFAC sync failed';
      setErr(msg);
      push(`OFAC sync failed: ${msg}`, 'error', 5000);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Card title="OFAC Screening Status" bodyClassName="p-4"
      action={
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={syncing}
          className="text-xs px-3 py-1.5 rounded border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
        >
          {syncing ? 'Syncing…' : 'Force Sync'}
        </button>
      }>
      {err && <div className="text-xs text-red-700 mb-2">{err}</div>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">SDN List</div>
          <div className="mt-0.5 text-2xl font-bold text-navy-900">
            {s ? Number(s.entry_count || 0).toLocaleString() : '—'}
          </div>
          <div className="text-[10px] text-slate-500">entries</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Last Updated</div>
          <div className="mt-0.5 text-sm text-navy-900">
            {s?.last_updated ? new Date(s.last_updated).toLocaleString() : '—'}
          </div>
          <div className="text-[10px] text-slate-500">
            {s?.last_download?.status === 'failed' ? <span className="text-red-600">last download failed</span> : 'auto-syncs daily'}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Pending Reviews</div>
          <div className="mt-0.5 text-2xl font-bold text-orange-600">
            {s ? s.pending_count : '—'}
          </div>
          <div className="text-[10px] text-slate-500">awaiting decision</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Confirmed Matches</div>
          <div className="mt-0.5 text-2xl font-bold text-red-600">
            {s ? s.confirmed_count : '—'}
          </div>
          <div className="text-[10px] text-slate-500">sanctions hits</div>
        </div>
      </div>
      {confirmOpen && (
        <ForceSyncConfirmModal
          syncing={syncing}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={forceSync}
        />
      )}
    </Card>
  );
}

// Confirmation modal for manual OFAC sync. Mirrors the InlineAssignModal
// pattern so the dashboard stays consistent — no browser confirm() popup.
function ForceSyncConfirmModal({ syncing, onConfirm, onCancel }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        role="dialog" aria-modal="true"
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-lg shadow-xl w-full max-w-md p-5 space-y-4"
      >
        <div className="flex items-center justify-between">
          <div className="font-semibold text-navy-900">Force OFAC List Sync</div>
          <button type="button" onClick={onCancel} className="p-1 hover:bg-slate-100 rounded">
            <X size={16} />
          </button>
        </div>
        <p className="text-sm text-slate-700">
          This will immediately download the latest OFAC SDN list from the US Treasury.
          This action will be logged in the audit trail.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={syncing}
            className="text-xs px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={syncing}
            className="text-xs px-3 py-1.5 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {syncing ? <><Loader2 size={12} className="animate-spin" /> Syncing…</> : 'Sync Now'}
          </button>
        </div>
      </div>
    </div>
  );
}
