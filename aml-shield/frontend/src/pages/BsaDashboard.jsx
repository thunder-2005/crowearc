import { useEffect, useState } from 'react';
import {
  FileText, Clock, Activity, Database, ShieldAlert, AlertTriangle,
  CheckCircle2, RefreshCw, Loader2
} from 'lucide-react';
import api from '../api/client.js';
import { useRole } from '../state/RoleContext.jsx';
import { useToast } from '../state/ToastContext.jsx';
import Card, { KpiCard } from '../components/shared/Card.jsx';
import Table from '../components/shared/Table.jsx';
import Badge from '../components/shared/Badge.jsx';
import BsaActionQueue from '../components/dashboard/BsaActionQueue.jsx';
import HealthStrip from '../components/dashboard/HealthStrip.jsx';

// BSA Officer Command Center.
//
// Composition:
//   1. Action Queue (5 cards) — BsaActionQueue
//   2. Program Health Strip — reuses PR3 HealthStrip
//   3. SAR Program Metrics — new 4-card row driven by /api/bsa/program-metrics
//   4. SAR Filing Clock summary (inline render of the same data /sar-clock returns)
//   5. Team Overview (read-only) — inline render of stats + analyst workload table
//   6. OFAC Status — inline mini widget with Force Sync (audited)

export default function BsaDashboard() {
  const { currentUser } = useRole();
  const { push } = useToast();
  const [stats, setStats] = useState(null);
  const [sarClock, setSarClock] = useState(null);
  const [program, setProgram] = useState(null);
  const [ofac, setOfac] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const loadAll = async () => {
    try {
      setLoading(true);
      const [a, b, c, d] = await Promise.all([
        api.get('/dashboard/stats'),
        api.get('/dashboard/sar-clock'),
        api.get('/bsa/program-metrics'),
        api.get('/ofac/status')
      ]);
      setStats(a.data);
      setSarClock(b.data);
      setProgram(c.data);
      setOfac(d.data);
      setError(null);
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to load BSA dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    const id = setInterval(loadAll, 60000);
    return () => clearInterval(id);
  }, []);

  const forceOfacSync = async () => {
    setSyncing(true);
    try {
      await api.post('/ofac/sync');
      await api.post('/audit-trail', {
        entity_type: 'system',
        sar_id: 'ofac_sdn',
        action: 'manual_ofac_sync',
        performed_by: currentUser?.name || 'BSA Officer',
        details: JSON.stringify({ triggered_by: 'bsa_dashboard_force_sync', timestamp: new Date().toISOString() })
      }).catch(() => {});
      push('OFAC sync started — list will update shortly', 'success', 3500);
      setTimeout(loadAll, 5000);
    } catch (e) {
      push(`OFAC sync failed: ${e?.response?.data?.error || e.message}`, 'error', 5000);
    } finally {
      setSyncing(false);
    }
  };

  if (loading && !stats) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-400 py-16 justify-center">
        <Loader2 size={16} className="animate-spin" /> Loading BSA Command Center…
      </div>
    );
  }
  if (error) {
    return (
      <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-4 py-3">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-navy-900">BSA Officer Command Center</h1>
        <p className="text-sm text-slate-500 mt-0.5">Program oversight and regulatory compliance</p>
      </header>

      {/* 1. Action Queue */}
      <BsaActionQueue />

      {/* 2. Health Strip — reused as-is */}
      {stats?.health && <HealthStrip health={stats.health} />}

      {/* 3. SAR Program Metrics */}
      <section>
        <header className="mb-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-navy-900">SAR Program Metrics</h2>
        </header>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard
            label="SARs Filed (YTD)"
            value={program?.sars_filed_ytd ?? '—'}
            icon={FileText}
            tone="blue"
          />
          <KpiCard
            label="Avg Filing Time"
            value={program?.avg_filing_days != null ? `${program.avg_filing_days}d` : '—'}
            icon={Clock}
            tone={
              program?.avg_filing_days == null ? 'default'
              : program.avg_filing_days > 20 ? 'red'
              : program.avg_filing_days > 10 ? 'orange'
              : 'green'}
            sub={program?.avg_filing_days != null ? 'submission → filed' : null}
          />
          <KpiCard
            label="SARs In Flight"
            value={program?.sars_in_flight ?? '—'}
            icon={Activity}
            tone="orange"
            sub="not yet Filed"
          />
          <KpiCard
            label="Retention Expiring"
            value={program?.retention_expiring_90d ?? '—'}
            icon={Database}
            tone={program?.retention_expiring_90d > 0 ? 'red' : 'green'}
            sub="within 90 days"
          />
        </div>
      </section>

      {/* 4. SAR Filing Clock summary */}
      <section>
        <header className="mb-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-navy-900">SAR Filing Clock</h2>
          <p className="text-xs text-slate-500 mt-0.5">FinCEN 30-day requirement</p>
        </header>
        <Card bodyClassName="p-4">
          {!sarClock ? (
            <div className="text-xs text-slate-400 italic">Loading…</div>
          ) : sarClock.in_flight === 0 ? (
            <div className="flex items-center gap-2 text-sm text-green-700">
              <CheckCircle2 size={16} /> All SARs filed on time
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat tone="red"    label="Overdue"   value={sarClock.overdue} />
                <Stat tone="orange" label="Due ≤ 3d"  value={sarClock.due_within_3_days} />
                <Stat tone="amber"  label="Due ≤ 7d"  value={sarClock.due_within_7_days} />
                <Stat tone="blue"   label="In flight" value={sarClock.in_flight} />
              </div>
              {sarClock.items?.length > 0 && (
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
                      <tr>
                        <th className="text-left py-1.5 px-2">SAR</th>
                        <th className="text-left py-1.5 px-2">Customer</th>
                        <th className="text-left py-1.5 px-2">Status</th>
                        <th className="text-right py-1.5 px-2">Days Remaining</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {sarClock.items.slice(0, 8).map(it => {
                        const d = it.days_remaining;
                        const cls = d < 0 ? 'text-red-700 font-semibold'
                                  : d <= 3 ? 'text-orange-700 font-semibold'
                                  : d <= 7 ? 'text-amber-700 font-medium'
                                  : 'text-green-700';
                        const label = d < 0 ? `${Math.abs(d)}d overdue` : `${d}d left`;
                        return (
                          <tr key={it.sar_id}>
                            <td className="px-2 py-1.5 font-mono text-navy-900">{it.sar_id}</td>
                            <td className="px-2 py-1.5 truncate max-w-[180px]">{it.customer_name}</td>
                            <td className="px-2 py-1.5 text-slate-600">{it.sar_status}</td>
                            <td className={`px-2 py-1.5 text-right tabular-nums ${cls}`}>{label}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {sarClock.items.length > 8 && (
                    <div className="text-[11px] text-slate-400 italic mt-2">
                      Showing 8 of {sarClock.items.length} · view all in SAR Repository
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </Card>
      </section>

      {/* 5. Team Overview — read-only */}
      <section>
        <header className="mb-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-navy-900">Team Overview</h2>
          <p className="text-xs text-slate-500 mt-0.5">Read-only · see Manager Dashboard for actions</p>
        </header>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <KpiCard
            label="Open Alerts (Team)"
            value={(stats?.kpis?.in_progress ?? 0) + (stats?.kpis?.not_started ?? 0)}
            icon={Activity}
            tone="blue"
          />
          <KpiCard
            label="Cases in Progress"
            value={stats?.kpis?.total_cases ?? '—'}
            icon={FileText}
          />
          <KpiCard
            label="SLA Compliance"
            value={
              stats?.kpis?.completed > 0
                ? `${Math.max(0, 100 - Math.round((stats.kpis.sla_breaches / Math.max(1, stats.kpis.completed)) * 100))}%`
                : '—'
            }
            icon={Clock}
            tone="green"
            sub="closed-on-time rate"
          />
        </div>
        <Card title="Team Workload — Read Only" bodyClassName="p-0">
          <Table
            rows={stats?.analyst_workload || []}
            emptyMessage="No analyst workload data"
            columns={[
              { key: 'analyst', label: 'Analyst', cellClass: 'font-medium text-navy-900' },
              { key: 'role',    label: 'Role',
                render: r => r.role === 'analyst_l2'
                  ? <span className="text-[10px] font-bold px-1 rounded bg-purple-100 text-purple-700">L2</span>
                  : <span className="text-[10px] font-bold px-1 rounded bg-blue-100 text-blue-700">L1</span> },
              { key: 'team',    label: 'Team' },
              { key: 'open_alerts', label: 'Open',     render: r => r.open_alerts ?? r.total ?? 0 },
              { key: 'breached',    label: 'Breached',
                render: r => Number(r.breached) > 0
                  ? <span className="text-red-700 font-semibold">{r.breached}</span>
                  : r.breached || 0 },
              { key: 'utilization_pct', label: 'Utilization',
                render: r => (
                  <div className="flex items-center gap-2 min-w-[120px] justify-end">
                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden max-w-[80px]">
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
                    <span className="text-xs text-slate-600 w-10 text-right tabular-nums">{r.utilization_pct}%</span>
                  </div>
                ) }
            ]}
          />
        </Card>
      </section>

      {/* 6. OFAC Status — inline mini widget with Force Sync */}
      <section>
        <Card
          title="OFAC Screening Status"
          bodyClassName="p-4"
          action={
            <button
              type="button"
              onClick={forceOfacSync}
              disabled={syncing}
              className="text-xs px-3 py-1.5 rounded border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {syncing ? <><Loader2 size={12} className="animate-spin" /> Syncing…</> : <><RefreshCw size={12} /> Force Sync</>}
            </button>
          }
        >
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500">SDN List</div>
              <div className="mt-0.5 text-2xl font-bold text-navy-900">
                {ofac ? Number(ofac.entry_count || 0).toLocaleString() : '—'}
              </div>
              <div className="text-[10px] text-slate-500">entries</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Last Updated</div>
              <div className="mt-0.5 text-sm text-navy-900">
                {ofac?.last_updated ? new Date(ofac.last_updated).toLocaleString() : '—'}
              </div>
              <div className="text-[10px] text-slate-500">auto-syncs daily</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Pending Reviews</div>
              <div className="mt-0.5 text-2xl font-bold text-orange-600">{ofac ? ofac.pending_count : '—'}</div>
              <div className="text-[10px] text-slate-500">awaiting decision</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Confirmed Matches</div>
              <div className="mt-0.5 text-2xl font-bold text-red-600">{ofac ? ofac.confirmed_count : '—'}</div>
              <div className="text-[10px] text-slate-500">sanctions hits</div>
            </div>
          </div>
        </Card>
      </section>
    </div>
  );
}

function Stat({ tone, label, value }) {
  const toneMap = {
    red:    'bg-red-50 text-red-700 border-red-200',
    orange: 'bg-orange-50 text-orange-700 border-orange-200',
    amber:  'bg-amber-50 text-amber-700 border-amber-200',
    blue:   'bg-blue-50 text-blue-700 border-blue-200',
    green:  'bg-green-50 text-green-700 border-green-200'
  };
  return (
    <div className={`rounded border px-3 py-2 ${toneMap[tone] || toneMap.blue}`}>
      <div className="text-[10px] uppercase tracking-wider opacity-80">{label}</div>
      <div className="mt-0.5 text-2xl font-bold tabular-nums">{value ?? 0}</div>
    </div>
  );
}
