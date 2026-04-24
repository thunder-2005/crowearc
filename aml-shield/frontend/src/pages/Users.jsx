import { useEffect, useMemo, useState } from 'react';
import api from '../api/client.js';
import Card from '../components/shared/Card.jsx';
import Badge from '../components/shared/Badge.jsx';
import {
  Search, Filter, User, Mail, Users as UsersIcon, X, AlertTriangle,
  Briefcase, Clock, Target, Flame, Activity
} from 'lucide-react';
import { useRole } from '../state/RoleContext.jsx';

const STATUS_TONES = {
  'Active':   'bg-green-100 text-green-700',
  'Inactive': 'bg-slate-200 text-slate-600',
  'On Leave': 'bg-orange-100 text-orange-700'
};

function initialsOf(name) {
  return (name || '').split(/\s+/).slice(0, 2).map(s => s[0]).join('').toUpperCase();
}

export default function Users() {
  const { isEmployee, currentAnalyst } = useRole();
  const [users, setUsers] = useState([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [role, setRoleFilter] = useState('');
  const [team, setTeam] = useState('');
  const [selected, setSelected] = useState(null);

  const load = () => {
    const params = {};
    if (q) params.q = q;
    if (status) params.status = status;
    if (role) params.role = role;
    if (team) params.team = team;
    api.get('/users', { params }).then(r => setUsers(r.data));
  };

  useEffect(() => { load(); }, [status, role, team]);

  const visible = useMemo(() => {
    if (isEmployee && currentAnalyst) {
      return users.filter(u => u.name === currentAnalyst);
    }
    return users;
  }, [users, isEmployee, currentAnalyst]);

  const openProfile = async (u) => {
    const { data } = await api.get(`/users/${encodeURIComponent(u.name)}`);
    setSelected(data);
  };

  const roles = useMemo(() => [...new Set(users.map(u => u.role))].sort(), [users]);
  const teams = useMemo(() => [...new Set(users.map(u => u.team).filter(Boolean))].sort(), [users]);

  return (
    <div className="flex gap-4 min-w-0">
      <div className="flex-1 min-w-0 space-y-4">
        <div>
          <div className="text-xl font-bold text-navy-900">Team Members</div>
          <div className="text-sm text-slate-500">
            {visible.length} {visible.length === 1 ? 'analyst' : 'analysts'} currently active
            {isEmployee && <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">Employee View — your profile only</span>}
          </div>
        </div>

        {!isEmployee && (
          <Card bodyClassName="p-4">
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-[260px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  placeholder="Search by name or role"
                  value={q}
                  onChange={e => setQ(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && load()}
                  className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-md focus:border-blue-500 focus:outline-none"
                />
              </div>
              <select value={status} onChange={e => setStatus(e.target.value)}
                className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white">
                <option value="">All status</option>
                <option>Active</option><option>Inactive</option><option>On Leave</option>
              </select>
              <select value={role} onChange={e => setRoleFilter(e.target.value)}
                className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white">
                <option value="">All roles</option>
                {roles.map(r => <option key={r}>{r}</option>)}
              </select>
              <select value={team} onChange={e => setTeam(e.target.value)}
                className="text-sm border border-slate-200 rounded-md px-3 py-2 bg-white">
                <option value="">All teams</option>
                {teams.map(t => <option key={t}>{t}</option>)}
              </select>
              <button onClick={load}
                className="text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md px-3 py-2 inline-flex items-center gap-1">
                <Filter size={14} /> Apply
              </button>
            </div>
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visible.map(u => (
            <Card key={u.user_id} bodyClassName="p-4">
              <div className="flex items-start gap-3">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold shrink-0"
                  style={{ background: u.avatar_color || '#2563eb' }}
                >
                  {initialsOf(u.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="font-semibold text-navy-900 truncate">{u.name}</div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_TONES[u.status] || STATUS_TONES['Inactive']}`}>
                      {u.status}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500">{u.role}</div>
                  <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                    <UsersIcon size={11} /> {u.team || '—'}
                  </div>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <MiniStat icon={AlertTriangle} label="Open Alerts" value={u.stats.open_alerts}
                  tone={u.stats.open_alerts > 0 ? 'text-red-600' : 'text-slate-700'} />
                <MiniStat icon={Briefcase} label="Cases In Progress" value={u.stats.cases_in_progress} />
              </div>

              <button
                onClick={() => openProfile(u)}
                className="mt-3 w-full text-xs border border-slate-200 hover:border-blue-400 hover:text-blue-600 rounded-md px-3 py-1.5"
              >
                View Profile
              </button>
            </Card>
          ))}
          {visible.length === 0 && (
            <div className="col-span-full text-center text-sm text-slate-400 py-10">
              No team members match
            </div>
          )}
        </div>
      </div>

      {selected && <ProfilePanel user={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function MiniStat({ icon: Icon, label, value, tone = 'text-slate-700' }) {
  return (
    <div className="bg-slate-50 rounded-md px-2 py-1.5 flex items-center gap-2">
      <Icon size={14} className="text-slate-400 shrink-0" />
      <div className="min-w-0">
        <div className="text-[10px] text-slate-500 uppercase tracking-wider leading-tight">{label}</div>
        <div className={`text-sm font-semibold ${tone}`}>{value}</div>
      </div>
    </div>
  );
}

function ProfilePanel({ user, onClose }) {
  return (
    <aside className="w-[460px] shrink-0 bg-white rounded-lg border border-slate-200 shadow-lg h-[calc(100vh-96px)] sticky top-20 flex flex-col">
      <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-slate-100">
        <div className="flex items-start gap-3 min-w-0">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold shrink-0"
            style={{ background: user.avatar_color || '#2563eb' }}
          >
            {initialsOf(user.name)}
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-navy-900 truncate">{user.name}</div>
            <div className="text-xs text-slate-500">{user.user_id} · {user.role}</div>
            <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
              <Mail size={11} /> {user.email || '—'}
            </div>
          </div>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X size={16} /></button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <section className="px-5 py-4 border-b border-slate-100">
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Performance</div>
          <div className="grid grid-cols-2 gap-2">
            <StatCard icon={Target} label="Closed This Month" value={user.stats.alerts_closed_this_month} />
            <StatCard icon={Clock} label="Avg Resolution"
              value={user.stats.avg_resolution_days != null ? `${user.stats.avg_resolution_days}d` : '—'} />
            <StatCard icon={Flame} label="SLA Breaches" value={user.stats.sla_breaches}
              tone={user.stats.sla_breaches > 0 ? 'text-red-600' : 'text-slate-700'} />
            <StatCard icon={Activity} label="False Positive Rate" value={`${user.stats.false_positive_rate_pct}%`} />
          </div>
        </section>

        <section className="px-5 py-4 border-b border-slate-100">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Open Alerts</div>
            <span className="text-xs text-slate-500">{user.open_alerts.length}</span>
          </div>
          <ul className="space-y-1.5">
            {user.open_alerts.slice(0, 8).map(a => (
              <li key={a.alert_id} className="flex items-center justify-between text-xs border border-slate-100 rounded px-2 py-1.5">
                <div className="min-w-0">
                  <div className="font-mono font-medium truncate">{a.alert_id} · {a.customer_name}</div>
                  <div className="text-slate-500 truncate">{a.scenario} · {a.due_status}</div>
                </div>
                <Badge value={a.alert_status} />
              </li>
            ))}
            {user.open_alerts.length === 0 && (
              <li className="text-xs text-slate-400">None open</li>
            )}
          </ul>
        </section>

        <section className="px-5 py-4 border-b border-slate-100">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Cases</div>
            <span className="text-xs text-slate-500">{user.open_cases.length}</span>
          </div>
          <ul className="space-y-1.5">
            {user.open_cases.slice(0, 8).map(c => (
              <li key={c.case_id} className="flex items-center justify-between text-xs border border-slate-100 rounded px-2 py-1.5">
                <div className="min-w-0">
                  <div className="font-mono font-medium truncate">{c.case_id} · {c.customer_name}</div>
                  <div className="text-slate-500 truncate">{c.scenario}</div>
                </div>
                <Badge value={c.case_status} />
              </li>
            ))}
            {user.open_cases.length === 0 && (
              <li className="text-xs text-slate-400">None</li>
            )}
          </ul>
        </section>

        <section className="px-5 py-4">
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Recent Activity
          </div>
          <ol className="relative border-l border-slate-200 ml-2 space-y-3">
            {user.recent_activity.map((e, i) => (
              <li key={i} className="ml-4">
                <div className="absolute -left-1.5 w-3 h-3 rounded-full bg-blue-500 mt-1" />
                <div className="text-xs font-medium text-navy-900">{e.kind}</div>
                <div className="text-[11px] text-slate-500">{e.ts} · {e.ref || '—'}</div>
                {e.detail && <div className="text-xs text-slate-700 mt-0.5">{e.detail}</div>}
              </li>
            ))}
            {user.recent_activity.length === 0 && (
              <li className="ml-4 text-xs text-slate-400">No recent activity</li>
            )}
          </ol>
        </section>
      </div>
    </aside>
  );
}

function StatCard({ icon: Icon, label, value, tone = 'text-slate-800' }) {
  return (
    <div className="bg-slate-50 rounded-md px-3 py-2">
      <div className="flex items-center gap-1.5">
        <Icon size={12} className="text-slate-400" />
        <div className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</div>
      </div>
      <div className={`mt-0.5 text-base font-bold ${tone}`}>{value}</div>
    </div>
  );
}
