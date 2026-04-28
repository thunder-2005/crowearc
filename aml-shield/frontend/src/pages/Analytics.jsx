import { useEffect, useMemo, useState } from 'react';
import api from '../api/client.js';
import Card from '../components/shared/Card.jsx';
import { BarChart3, AlertCircle } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
  PieChart, Pie, Cell, ScatterChart, Scatter, ZAxis, LabelList
} from 'recharts';

// ─────────────────────────────────────────────── shared helpers

const TABS = [
  { k: 'alerts',   label: 'Alert Trends' },
  { k: 'sar',      label: 'SAR Trends' },
  { k: 'team',     label: 'Team Performance' },
  { k: 'rules',    label: 'Rule Effectiveness' },
  { k: 'risk',     label: 'Customer Risk' }
];

const RANGE_PRESETS = [
  { k: '30d',  label: 'Last 30 Days' },
  { k: '90d',  label: 'Last 90 Days' },
  { k: '6m',   label: 'Last 6 Months' },
  { k: '12m',  label: 'Last 12 Months' },
  { k: 'custom', label: 'Custom Range' }
];

const COLORS = {
  blue:   '#2563eb',
  green:  '#10b981',
  red:    '#ef4444',
  orange: '#f59e0b',
  indigo: '#6366f1',
  purple: '#8b5cf6',
  slate:  '#64748b',
  gold:   '#eab308'
};

const RATING_COLORS = {
  'Low':       '#10b981',
  'Medium':    '#eab308',
  'High':      '#f59e0b',
  'Very High': '#ef4444',
  'Unrated':   '#94a3b8'
};

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function rangeToDates(preset, custom) {
  const today = new Date();
  if (preset === 'custom' && custom?.from && custom?.to) {
    return { from: custom.from, to: custom.to };
  }
  const to = ymd(today);
  const back = (days) => ymd(new Date(today.getTime() - days * 24 * 3600 * 1000));
  if (preset === '30d')  return { from: back(30),  to };
  if (preset === '90d')  return { from: back(90),  to };
  if (preset === '6m')   return { from: back(182), to };
  return { from: back(365), to };
}

function granularityFor(preset, custom) {
  if (preset === '30d' || preset === '90d') return 'week';
  if (preset === 'custom') {
    if (!custom?.from || !custom?.to) return 'month';
    const d = (new Date(custom.to) - new Date(custom.from)) / (1000 * 3600 * 24);
    return d <= 90 ? 'week' : 'month';
  }
  return 'month';
}

const fmtUsd = (n) =>
  '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });

const fmtUsdShort = (n) => {
  const v = Number(n || 0);
  if (v >= 1_000_000) return '$' + (v / 1_000_000).toFixed(1) + 'M';
  if (v >= 1_000) return '$' + (v / 1_000).toFixed(0) + 'K';
  return '$' + v;
};

// ─────────────────────────────────────────────── empty state placeholder

function EmptyChart({ height = 260 }) {
  return (
    <div
      className="flex items-center justify-center text-sm text-slate-400 bg-slate-50 rounded-md border border-dashed border-slate-200"
      style={{ height }}
    >
      No data for this period
    </div>
  );
}

function hasData(arr, key = null) {
  if (!Array.isArray(arr) || arr.length === 0) return false;
  if (!key) return true;
  return arr.some(r => Number(r[key] || 0) > 0);
}
function hasAnyValue(arr, keys) {
  if (!Array.isArray(arr) || arr.length === 0) return false;
  return arr.some(r => keys.some(k => Number(r[k] || 0) > 0));
}

// ─────────────────────────────────────────────── page

export default function Analytics() {
  const [tab, setTab] = useState('alerts');
  const [preset, setPreset] = useState('12m');
  const [custom, setCustom] = useState({ from: '', to: '' });

  const range = useMemo(() => rangeToDates(preset, custom), [preset, custom]);
  const granularity = useMemo(() => granularityFor(preset, custom), [preset, custom]);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xl font-bold text-navy-900 flex items-center gap-2">
            <BarChart3 size={20} className="text-indigo-600" /> Analytics
          </div>
          <div className="text-sm text-slate-500">
            Trends, patterns and performance over time
          </div>
        </div>
        <DateRangePicker
          preset={preset} setPreset={setPreset}
          custom={custom} setCustom={setCustom}
          range={range}
        />
      </div>

      <div className="border-b border-slate-200">
        <nav className="flex gap-1 -mb-px">
          {TABS.map(t => (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
                tab === t.k
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-slate-500 hover:text-navy-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      <div>
        {tab === 'alerts' && <AlertTrendsTab range={range} granularity={granularity} />}
        {tab === 'sar'    && <SARTrendsTab    range={range} granularity={granularity} />}
        {tab === 'team'   && <TeamPerformanceTab range={range} granularity={granularity} />}
        {tab === 'rules'  && <RuleEffectivenessTab range={range} />}
        {tab === 'risk'   && <CustomerRiskTab range={range} granularity={granularity} />}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────── date range picker

function DateRangePicker({ preset, setPreset, custom, setCustom, range }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <select
        value={preset}
        onChange={e => setPreset(e.target.value)}
        className="bg-white border border-slate-200 rounded-md px-3 py-1.5"
      >
        {RANGE_PRESETS.map(r => <option key={r.k} value={r.k}>{r.label}</option>)}
      </select>
      {preset === 'custom' && (
        <>
          <input
            type="date" value={custom.from}
            onChange={e => setCustom({ ...custom, from: e.target.value })}
            className="bg-white border border-slate-200 rounded-md px-2 py-1.5"
          />
          <span className="text-slate-400">→</span>
          <input
            type="date" value={custom.to}
            onChange={e => setCustom({ ...custom, to: e.target.value })}
            className="bg-white border border-slate-200 rounded-md px-2 py-1.5"
          />
        </>
      )}
      <span className="text-xs text-slate-500 ml-1">
        {range.from} → {range.to}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────── data hook

function useAnalytics(path, range, granularity) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    api.get(`/analytics/${path}`, {
      params: { from: range.from, to: range.to, granularity }
    })
      .then(r => { if (!cancelled) setData(r.data); })
      .catch(e => { if (!cancelled) setErr(e.message || 'Failed to load'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [path, range.from, range.to, granularity]);

  return { data, loading, err };
}

function LoadingPanel() {
  return <div className="text-sm text-slate-400 py-12 text-center">Loading analytics…</div>;
}

// ─────────────────────────────────────────────── TAB 1: ALERT TRENDS

function AlertTrendsTab({ range, granularity }) {
  const { data, loading, err } = useAnalytics('alert-trends', range, granularity);
  if (loading) return <LoadingPanel />;
  if (err) return <div className="text-red-600 text-sm">Failed to load: {err}</div>;
  if (!data) return null;

  return (
    <div className="space-y-5">
      {data.backlog_growing && (
        <div className="flex items-start gap-2 bg-orange-50 border border-orange-200 rounded-md p-3 text-sm text-orange-800">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <div>
            <span className="font-semibold">Alert backlog is growing</span> — closure rate
            is below inflow rate across recent periods.
          </div>
        </div>
      )}

      <Card title="Alert Volume Over Time" subtitle="New alerts vs closed alerts">
        {hasAnyValue(data.volume, ['new', 'closed']) ? (
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <LineChart data={data.volume} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="new"    name="New Alerts"    stroke={COLORS.blue}  strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="closed" name="Closed Alerts" stroke={COLORS.green} strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : <EmptyChart />}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="False Positive Rate Trend" subtitle="Industry benchmark: 30%">
          {hasData(data.false_positive_rate, 'fp_pct') ? (
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer>
                <LineChart data={data.false_positive_rate}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} unit="%" />
                  <Tooltip
                    formatter={(v, _n, ctx) => {
                      const total = ctx.payload.total_closed;
                      return [`${v}% (${total} closed)`, 'False positive rate'];
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <ReferenceLine y={30} stroke={COLORS.slate} strokeDasharray="4 4"
                    label={{ value: 'Target 30%', fontSize: 10, fill: COLORS.slate, position: 'right' }} />
                  <Line type="monotone" dataKey="fp_pct" name="FP %"
                    stroke={fpTrendColor(data.false_positive_rate)} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyChart />}
        </Card>

        <Card title="Alert Age Distribution Over Time" subtitle="How quickly alerts are resolved">
          {hasAnyValue(data.age_distribution, ['lt7','d7_15','d15_30','gt30']) ? (
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={data.age_distribution}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="lt7"     name="<7 days"   stackId="a" fill={COLORS.green} />
                  <Bar dataKey="d7_15"   name="7-15 days" stackId="a" fill={COLORS.blue} />
                  <Bar dataKey="d15_30"  name="15-30 days" stackId="a" fill={COLORS.orange} />
                  <Bar dataKey="gt30"    name="30+ days"  stackId="a" fill={COLORS.red} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyChart />}
        </Card>
      </div>

      <Card title="Disposition Breakdown Trend" subtitle="How resolutions are shifting over time">
        {hasAnyValue(data.disposition_breakdown, ['false_positive','escalated_l2','escalated_sar','other_closed']) ? (
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={data.disposition_breakdown}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="false_positive" name="False Positive" stackId="a" fill={COLORS.slate} />
                <Bar dataKey="escalated_l2"   name="Escalated L2"   stackId="a" fill={COLORS.blue} />
                <Bar dataKey="escalated_sar"  name="Escalated SAR"  stackId="a" fill={COLORS.red} />
                <Bar dataKey="other_closed"   name="Other Closed"   stackId="a" fill={COLORS.purple} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : <EmptyChart />}
      </Card>

      <Card title="Alert Volume by Scenario Over Time" subtitle="Which scenarios are growing or shrinking">
        {data.scenarios?.length > 0 && hasAnyValue(data.by_scenario, data.scenarios) ? (
          <div style={{ width: '100%', height: 300 }}>
            <ResponsiveContainer>
              <LineChart data={data.by_scenario}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {data.scenarios.map((s, i) => (
                  <Line key={s} type="monotone" dataKey={s} name={s}
                    stroke={paletteAt(i)} strokeWidth={2} dot={{ r: 2 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : <EmptyChart />}
      </Card>
    </div>
  );
}

function fpTrendColor(series) {
  if (!series || series.length < 2) return COLORS.blue;
  const recent = series.slice(-3).reduce((s, r) => s + r.fp_pct, 0) / Math.min(3, series.length);
  const prev = series.slice(-6, -3).reduce((s, r) => s + r.fp_pct, 0) / Math.max(1, Math.min(3, series.length - 3));
  if (recent > prev + 2) return COLORS.red;
  if (recent < prev - 2) return COLORS.green;
  return COLORS.blue;
}

const PALETTE = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#6366f1', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#0ea5e9'];
const paletteAt = (i) => PALETTE[i % PALETTE.length];

// ─────────────────────────────────────────────── TAB 2: SAR TRENDS

function SARTrendsTab({ range, granularity }) {
  const { data, loading, err } = useAnalytics('sar-trends', range, granularity);
  if (loading) return <LoadingPanel />;
  if (err) return <div className="text-red-600 text-sm">Failed to load: {err}</div>;
  if (!data) return null;

  return (
    <div className="space-y-5">
      {data.rejection_trending_up && (
        <div className="flex items-start gap-2 bg-orange-50 border border-orange-200 rounded-md p-3 text-sm text-orange-800">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <div>
            <span className="font-semibold">Rejection rate increasing</span> — analyst guidance may be needed.
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="SAR Filing Volume by Month"
              subtitle={`Avg ${data.filing_volume_avg} per period · split by SAR type`}>
          {hasData(data.filing_volume, 'total') ? (
            <div style={{ width: '100%', height: 280 }}>
              <ResponsiveContainer>
                <BarChart data={data.filing_volume}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <ReferenceLine y={data.filing_volume_avg} stroke={COLORS.slate}
                    strokeDasharray="4 4"
                    label={{ value: `Avg ${data.filing_volume_avg}`, fontSize: 10, fill: COLORS.slate, position: 'right' }} />
                  {data.sar_types.map((t, i) => (
                    <Bar key={t} dataKey={t} name={t} stackId="s" fill={paletteAt(i)} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyChart />}
        </Card>

        <Card title="Alert to SAR Conversion Rate" subtitle="Industry benchmark: 5–10%">
          {hasData(data.conversion_rate, 'rate_pct') ? (
            <div style={{ width: '100%', height: 280 }}>
              <ResponsiveContainer>
                <LineChart data={data.conversion_rate}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip
                    formatter={(v, _n, ctx) => {
                      const { alerts, sars } = ctx.payload;
                      return [`${v}% (${sars} SARs / ${alerts} alerts)`, 'Conversion'];
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <ReferenceLine y={5}  stroke={COLORS.slate} strokeDasharray="4 4" />
                  <ReferenceLine y={10} stroke={COLORS.slate} strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="rate_pct" name="Conversion %"
                    stroke={COLORS.indigo} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyChart />}
        </Card>
      </div>

      <Card title="SAR Filing Timeliness" subtitle="Filed within 30 days of detection (FinCEN requirement)">
        {hasAnyValue(data.timeliness, ['on_time', 'late']) ? (
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={data.timeliness}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  formatter={(v, n, ctx) => {
                    if (n === 'On time' || n === 'Late') {
                      return [`${v} (compliance ${ctx.payload.compliance_pct}%)`, n];
                    }
                    return [v, n];
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="on_time" name="On time" stackId="t" fill={COLORS.green}>
                  <LabelList dataKey="compliance_pct" position="top"
                    formatter={(v) => v > 0 ? `${v}%` : ''} fontSize={10} fill={COLORS.slate} />
                </Bar>
                <Bar dataKey="late"    name="Late"    stackId="t" fill={COLORS.red} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : <EmptyChart />}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="SAR Dollar Amount Trend" subtitle="Total suspicious activity in filed SARs">
          {hasData(data.dollar_amount, 'amount') ? (
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={data.dollar_amount}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtUsdShort} />
                  <Tooltip formatter={(v) => [fmtUsd(v), 'Amount']} />
                  <Bar dataKey="amount" name="USD" fill={COLORS.indigo} radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyChart />}
        </Card>

        <Card title="SAR Rejection Rate Trend" subtitle="% of submitted SARs returned/rejected">
          {hasData(data.rejection_rate, 'rate_pct') ? (
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer>
                <LineChart data={data.rejection_rate}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip
                    formatter={(v, _n, ctx) => [`${v}% (${ctx.payload.rejected}/${ctx.payload.submitted})`, 'Rejection']}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="rate_pct" name="Rejection %"
                    stroke={COLORS.red} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyChart />}
        </Card>
      </div>

      <Card title="Top Rejection Reasons" subtitle="Where analysts need training">
        {data.rejection_reasons?.length > 0 ? (
          <div style={{ width: '100%', height: Math.max(220, data.rejection_reasons.length * 36) }}>
            <ResponsiveContainer>
              <BarChart data={data.rejection_reasons} layout="vertical" margin={{ left: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="reason" tick={{ fontSize: 11 }} width={180} />
                <Tooltip />
                <Bar dataKey="count" fill={COLORS.orange} radius={[0,4,4,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : <EmptyChart height={200} />}
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────── TAB 3: TEAM PERFORMANCE

function TeamPerformanceTab({ range, granularity }) {
  const { data, loading, err } = useAnalytics('team-performance', range, granularity);
  if (loading) return <LoadingPanel />;
  if (err) return <div className="text-red-600 text-sm">Failed to load: {err}</div>;
  if (!data) return null;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="Avg Resolution Time Trend" subtitle={`SLA target: ${data.sla_target_days} days`}>
          {hasData(data.avg_resolution, 'avg_days') ? (
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer>
                <LineChart data={data.avg_resolution}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} unit="d" />
                  <Tooltip formatter={(v) => [`${v} days`, 'Avg resolution']} />
                  <ReferenceLine y={data.sla_target_days} stroke={COLORS.red} strokeDasharray="4 4"
                    label={{ value: `Target ${data.sla_target_days}d`, fontSize: 10, fill: COLORS.red, position: 'right' }} />
                  <Line type="monotone" dataKey="avg_days" name="Avg days"
                    stroke={COLORS.blue} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyChart />}
        </Card>

        <Card title="SLA Breach Rate Trend" subtitle="Per priority level — target 0%">
          {hasAnyValue(data.sla_breach_rate, ['high_pct','medium_pct','low_pct']) ? (
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer>
                <LineChart data={data.sla_breach_rate}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="high_pct"   name="High"   stroke={COLORS.red} strokeWidth={2} dot={{ r: 2 }} />
                  <Line type="monotone" dataKey="medium_pct" name="Medium" stroke={COLORS.orange} strokeWidth={2} dot={{ r: 2 }} />
                  <Line type="monotone" dataKey="low_pct"    name="Low"    stroke={COLORS.green} strokeWidth={2} dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyChart />}
        </Card>
      </div>

      <Card title="Analyst Productivity Comparison" subtitle="Alerts closed per analyst per period">
        {data.analysts?.length > 0 && hasAnyValue(data.productivity, data.analysts) ? (
          <div style={{ width: '100%', height: 320 }}>
            <ResponsiveContainer>
              <ComposedChart data={data.productivity}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {data.analysts.map((a, i) => (
                  <Bar key={a} dataKey={a} name={a} fill={paletteAt(i)} />
                ))}
                <Line type="monotone" dataKey="team_avg" name="Team avg"
                  stroke={COLORS.slate} strokeDasharray="4 4" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : <EmptyChart />}
      </Card>

      <Card title="Workload Balance Over Time" subtitle={`Capacity threshold: ${data.capacity_threshold_pct}%`}>
        {data.analysts?.length > 0 && hasAnyValue(data.workload_balance, data.analysts) ? (
          <div style={{ width: '100%', height: 300 }}>
            <ResponsiveContainer>
              <LineChart data={data.workload_balance}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine y={data.capacity_threshold_pct} stroke={COLORS.red} strokeDasharray="4 4"
                  label={{ value: `${data.capacity_threshold_pct}%`, fontSize: 10, fill: COLORS.red, position: 'right' }} />
                {data.analysts.map((a, i) => (
                  <Line key={a} type="monotone" dataKey={a} name={a}
                    stroke={paletteAt(i)} strokeWidth={2} dot={{ r: 2 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : <EmptyChart />}
      </Card>

      <Card title="Team Activity Heatmap" subtitle="Case-note actions per analyst per week — darker = more active">
        <ActivityHeatmap heatmap={data.activity_heatmap} />
      </Card>
    </div>
  );
}

function ActivityHeatmap({ heatmap }) {
  if (!heatmap || !heatmap.rows?.length || !heatmap.weeks?.length) return <EmptyChart height={200} />;
  const max = Math.max(1, ...heatmap.rows.flatMap(r => r.values));
  const cellColor = (v) => {
    if (v === 0) return '#f1f5f9';
    const intensity = Math.min(1, v / max);
    const alpha = 0.18 + intensity * 0.82;
    return `rgba(79, 70, 229, ${alpha.toFixed(2)})`;
  };
  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse">
        <thead>
          <tr>
            <th className="sticky left-0 bg-white text-left p-1 pr-3 font-medium text-slate-600">Analyst</th>
            {heatmap.weeks.map((w, i) => (
              <th key={i} className="p-1 text-slate-500 font-normal min-w-[40px] text-center">{w}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {heatmap.rows.map(row => (
            <tr key={row.analyst}>
              <td className="sticky left-0 bg-white pr-3 py-1 text-navy-900 whitespace-nowrap font-medium">
                {row.analyst}
              </td>
              {row.values.map((v, i) => (
                <td key={i} className="p-1 text-center" title={`${row.analyst} · ${heatmap.weeks[i]} · ${v} actions`}>
                  <div
                    className="w-8 h-7 rounded-sm flex items-center justify-center text-[10px]"
                    style={{
                      backgroundColor: cellColor(v),
                      color: v > max * 0.5 ? '#fff' : '#475569'
                    }}
                  >
                    {v > 0 ? v : ''}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────── TAB 4: RULE EFFECTIVENESS

function RuleEffectivenessTab({ range }) {
  const { data, loading, err } = useAnalytics('rule-effectiveness', range, 'month');
  const [sortKey, setSortKey] = useState('total');
  const [sortDir, setSortDir] = useState('desc');

  const scenarios = data?.scenarios || [];
  const sorted = useMemo(() => {
    const rows = [...scenarios];
    rows.sort((a, b) => {
      const av = a[sortKey] ?? 0, bv = b[sortKey] ?? 0;
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return rows;
  }, [scenarios, sortKey, sortDir]);
  const tpData = useMemo(() =>
    [...scenarios].sort((a, b) => b.true_positive_rate_pct - a.true_positive_rate_pct),
    [scenarios]);
  const fpData = useMemo(() =>
    [...scenarios].sort((a, b) => b.fp_rate_pct - a.fp_rate_pct),
    [scenarios]);

  if (loading) return <LoadingPanel />;
  if (err) return <div className="text-red-600 text-sm">Failed to load: {err}</div>;
  if (!data) return null;

  const onSort = (k) => {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('desc'); }
  };

  return (
    <div className="space-y-5">
      <Card title="Scenario Performance" subtitle="Sortable — click a column header">
        {sorted.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
                <tr>
                  {[
                    ['scenario', 'Scenario', 'left'],
                    ['total', 'Total Alerts', 'right'],
                    ['true_positive', 'True Positive', 'right'],
                    ['false_positive', 'False Positive', 'right'],
                    ['sar_conversion_pct', 'SAR Conversion', 'right'],
                    ['fp_rate_pct', 'FP Rate %', 'right'],
                    ['avg_resolution_days', 'Avg Resolution', 'right']
                  ].map(([k, lbl, align]) => (
                    <th key={k} onClick={() => onSort(k)}
                        className={`py-2 px-3 cursor-pointer hover:text-navy-900 select-none ${align === 'right' ? 'text-right' : 'text-left'}`}>
                      {lbl}{sortKey === k && (sortDir === 'desc' ? ' ▼' : ' ▲')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(s => (
                  <tr key={s.scenario} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-2 px-3 font-medium text-navy-900">{s.scenario}</td>
                    <td className="py-2 px-3 text-right">{s.total}</td>
                    <td className="py-2 px-3 text-right text-green-700">{s.true_positive}</td>
                    <td className="py-2 px-3 text-right text-slate-700">{s.false_positive}</td>
                    <td className="py-2 px-3 text-right">{s.sar_conversion_pct}%</td>
                    <td className="py-2 px-3 text-right">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        s.fp_rate_pct < 20 ? 'bg-green-50 text-green-700'
                          : s.fp_rate_pct <= 40 ? 'bg-orange-50 text-orange-700'
                          : 'bg-red-50 text-red-700'
                      }`}>{s.fp_rate_pct}%</span>
                    </td>
                    <td className="py-2 px-3 text-right text-slate-600">
                      {s.avg_resolution_days != null ? `${s.avg_resolution_days}d` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyChart height={120} />}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="True Positive Rate by Scenario" subtitle="Which scenarios catch real cases">
          {hasData(tpData, 'true_positive_rate_pct') ? (
            <div style={{ width: '100%', height: Math.max(220, tpData.length * 36) }}>
              <ResponsiveContainer>
                <BarChart data={tpData} layout="vertical" margin={{ left: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis type="number" tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
                  <YAxis type="category" dataKey="scenario" tick={{ fontSize: 11 }} width={170} />
                  <Tooltip formatter={(v) => [`${v}%`, 'TP rate']} />
                  <Bar dataKey="true_positive_rate_pct" fill={COLORS.green} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyChart />}
        </Card>

        <Card title="False Positive Rate by Scenario" subtitle="Bars >40% likely need rule tuning">
          {hasData(fpData, 'fp_rate_pct') ? (
            <div style={{ width: '100%', height: Math.max(220, fpData.length * 36) }}>
              <ResponsiveContainer>
                <BarChart data={fpData} layout="vertical" margin={{ left: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis type="number" tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
                  <YAxis type="category" dataKey="scenario" tick={{ fontSize: 11 }} width={170} />
                  <Tooltip formatter={(v) => [`${v}%`, 'FP rate']} />
                  <Bar dataKey="fp_rate_pct" radius={[0, 4, 4, 0]}>
                    {fpData.map((s, i) => (
                      <Cell key={i} fill={s.fp_rate_pct > 40 ? COLORS.red
                                          : s.fp_rate_pct > 20 ? COLORS.orange
                                          : COLORS.green} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyChart />}
        </Card>
      </div>

      <Card title="Alert Volume vs SAR Conversion by Scenario"
            subtitle="Top right = catches a lot · Bottom right = noisy rule, needs tuning">
        {data.scenarios?.length > 0 ? (
          <div style={{ width: '100%', height: 360 }}>
            <ResponsiveContainer>
              <ScatterChart margin={{ top: 20, right: 30, bottom: 40, left: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" dataKey="total" name="Volume"
                       tick={{ fontSize: 11 }}
                       label={{ value: 'Alert volume', position: 'insideBottom', offset: -10, fontSize: 11, fill: COLORS.slate }} />
                <YAxis type="number" dataKey="sar_conversion_pct" name="SAR conversion"
                       tick={{ fontSize: 11 }} unit="%"
                       label={{ value: 'SAR conversion %', angle: -90, position: 'insideLeft', fontSize: 11, fill: COLORS.slate }} />
                <ZAxis range={[120, 120]} />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="bg-white border border-slate-200 rounded shadow text-xs p-2">
                        <div className="font-semibold text-navy-900">{d.scenario}</div>
                        <div>Volume: {d.total}</div>
                        <div>SAR conversion: {d.sar_conversion_pct}%</div>
                        <div>FP rate: {d.fp_rate_pct}%</div>
                      </div>
                    );
                  }}
                />
                <Scatter data={data.scenarios} fill={COLORS.indigo}>
                  <LabelList dataKey="scenario" position="top" fontSize={10} fill={COLORS.slate} />
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        ) : <EmptyChart />}
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────── TAB 5: CUSTOMER RISK

function CustomerRiskTab({ range, granularity }) {
  const { data, loading, err } = useAnalytics('customer-risk', range, granularity);
  if (loading) return <LoadingPanel />;
  if (err) return <div className="text-red-600 text-sm">Failed to load: {err}</div>;
  if (!data) return null;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="Customer Risk Rating Distribution" subtitle="Current portfolio split">
          {data.current_distribution?.length > 0 ? (
            <div style={{ width: '100%', height: 280 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={data.current_distribution} dataKey="count" nameKey="rating"
                       innerRadius={60} outerRadius={95} paddingAngle={2}
                       label={(e) => `${e.rating}: ${e.count} (${e.pct}%)`}
                       labelLine={false}>
                    {data.current_distribution.map((d, i) => (
                      <Cell key={i} fill={RATING_COLORS[d.rating] || paletteAt(i)} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v, _n, ctx) => [`${v} (${ctx.payload.pct}%)`, ctx.payload.rating]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyChart />}
        </Card>

        <Card title="Risk Rating Changes Over Time" subtitle="Upgrades vs downgrades per period">
          {hasAnyValue(data.rating_changes, ['upgraded','downgraded','no_change']) ? (
            <div style={{ width: '100%', height: 280 }}>
              <ResponsiveContainer>
                <BarChart data={data.rating_changes}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="upgraded"   name="Upgraded"   stackId="r" fill={COLORS.red} />
                  <Bar dataKey="downgraded" name="Downgraded" stackId="r" fill={COLORS.green} />
                  <Bar dataKey="no_change"  name="No change"  stackId="r" fill={COLORS.slate} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyChart />}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="KYC Review Compliance Trend" subtitle="Target: 95% of customers with current KYC">
          {hasData(data.kyc_compliance, 'current_pct') ? (
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer>
                <LineChart data={data.kyc_compliance}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
                  <Tooltip formatter={(v) => [`${v}%`, 'KYC current']} />
                  <ReferenceLine y={95} stroke={COLORS.green} strokeDasharray="4 4"
                    label={{ value: 'Target 95%', fontSize: 10, fill: COLORS.green, position: 'right' }} />
                  <Line type="monotone" dataKey="current_pct" name="KYC current %"
                    stroke={COLORS.indigo} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyChart />}
        </Card>

        <Card title="High Risk Customer Alert Concentration"
              subtitle="% of alerts from High + Very High risk customers">
          {hasData(data.high_risk_concentration, 'high_risk_pct') ? (
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={data.high_risk_concentration}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
                  <Tooltip formatter={(v, _n, ctx) =>
                    [`${v}% (${ctx.payload.high_count}/${ctx.payload.total})`, 'High-risk %']} />
                  <Bar dataKey="high_risk_pct" name="High-risk %" fill={COLORS.red} radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyChart />}
        </Card>
      </div>

      <Card title="Customers by Industry and Risk" subtitle="Concentration of risk per industry">
        <IndustryRiskMatrix matrix={data.industry_risk_matrix} ratings={data.ratings} />
      </Card>
    </div>
  );
}

function IndustryRiskMatrix({ matrix, ratings }) {
  if (!matrix?.length) return <EmptyChart height={160} />;
  const max = Math.max(1, ...matrix.flatMap(r => ratings.map(rt => r[rt] || 0)));
  const cellColor = (rating, v) => {
    if (v === 0) return '#f8fafc';
    const base = RATING_COLORS[rating] || '#94a3b8';
    const intensity = 0.2 + Math.min(1, v / max) * 0.7;
    return hexWithAlpha(base, intensity);
  };
  return (
    <div className="overflow-x-auto">
      <table className="text-sm border-collapse">
        <thead>
          <tr className="text-xs text-slate-500">
            <th className="text-left p-2 pr-4 font-medium">Industry</th>
            {ratings.map(r => <th key={r} className="p-2 text-center font-medium min-w-[80px]">{r}</th>)}
            <th className="p-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {matrix.map(row => (
            <tr key={row.industry} className="border-t border-slate-100">
              <td className="p-2 pr-4 text-navy-900 font-medium whitespace-nowrap">{row.industry}</td>
              {ratings.map(rt => (
                <td key={rt} className="p-1 text-center">
                  <div
                    className="rounded h-9 flex items-center justify-center font-medium"
                    style={{
                      backgroundColor: cellColor(rt, row[rt] || 0),
                      color: (row[rt] || 0) > max * 0.5 ? '#fff' : '#475569'
                    }}
                    title={`${row.industry} · ${rt}: ${row[rt] || 0}`}
                  >
                    {row[rt] || 0}
                  </div>
                </td>
              ))}
              <td className="p-2 text-right font-semibold text-navy-900">{row.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function hexWithAlpha(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
}
