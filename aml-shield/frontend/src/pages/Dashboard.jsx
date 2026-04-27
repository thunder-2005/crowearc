import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client.js';
import { KpiCard } from '../components/shared/Card.jsx';
import Card from '../components/shared/Card.jsx';
import Table from '../components/shared/Table.jsx';
import Badge from '../components/shared/Badge.jsx';
import {
  AlertTriangle, Activity, CheckCircle2, Clock, TrendingUp, Briefcase,
  Target, Users, ShieldCheck, Eye
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar, Legend
} from 'recharts';
import { useRole } from '../state/RoleContext.jsx';

const DONUT_COLORS = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#6366f1', '#8b5cf6'];

export default function Dashboard() {
  const { isManager, isEmployee, currentAnalyst } = useRole();
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [range, setRange] = useState('30d');

  useEffect(() => {
    const params = {};
    if (isEmployee && currentAnalyst) params.assigned_to = currentAnalyst;
    setStats(null);
    api.get('/dashboard/stats', { params })
      .then(r => setStats(r.data))
      .catch(e => setError(e.message));
  }, [range, isEmployee, currentAnalyst]);

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
        <KpiCard label={isManager ? 'Total Alerts' : 'My Alerts'} value={k.total_alerts} icon={AlertTriangle} />
        <KpiCard label="In Progress" value={k.in_progress} tone="blue" icon={Activity} />
        <KpiCard label="Completed" value={k.completed} tone="green" icon={CheckCircle2} />
        <KpiCard label="SLA Breaches" value={k.sla_breaches} tone="red" icon={Clock} />
        <KpiCard label="Avg Aging (days)" value={k.avg_aging_days} tone="orange" icon={TrendingUp} />
        {isManager && (
          <KpiCard label="Cases Converted" value={k.cases_converted} tone="blue" icon={Briefcase}
                   sub={`FP rate: ${k.false_positive_rate_pct}%`} />
        )}
      </div>

      {isManager && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <KpiCard label="Team Capacity" value={`${k.team_capacity_pct}%`} tone="blue" icon={Users}
                   sub="Avg across analysts" />
          <KpiCard label="False Positive Rate" value={`${k.false_positive_rate_pct}%`} tone="orange"
                   icon={Target} sub={`${k.closed} closed alerts`} />
          <KpiCard label="Unassigned Queue" value={k.unassigned} tone="red" icon={ShieldCheck}
                   sub="Needs triage" />
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
            <li><a href="/alerts" className="text-blue-600 hover:underline">→ {isManager ? 'Team alert queue' : 'My alert queue'}</a></li>
            <li><a href="/cases" className="text-blue-600 hover:underline">→ {isManager ? 'All cases' : 'My cases'}</a></li>
            <li><a href="/sars" className="text-blue-600 hover:underline">→ SAR Repository</a></li>
            {isManager && <li><a href="/retention" className="text-blue-600 hover:underline">→ Retention Monitor</a></li>}
            {isManager && <li><a href="/audit" className="text-blue-600 hover:underline">→ Audit Trail</a></li>}
          </ul>
        </Card>
      </div>

      {isManager && <SlaWatch />}

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
    </div>
  );
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

function SlaWatch() {
  const navigate = useNavigate();
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
        <button onClick={() => navigate('/alerts')}
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
