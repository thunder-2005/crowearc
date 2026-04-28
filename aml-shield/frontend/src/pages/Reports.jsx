import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../api/client.js';
import Card from '../components/shared/Card.jsx';
import { useRole } from '../state/RoleContext.jsx';
import { useToast } from '../state/ToastContext.jsx';
import {
  FileText, Clock, Users, ShieldCheck, Target, ScrollText, Award, Hourglass,
  Inbox, Activity, ClipboardCheck, Briefcase,
  Download, Printer, Calendar, Loader2, Trash2, Plus, X, CheckCircle2, AlertTriangle, MinusCircle
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

// ─────────────────────────────────────────────── catalogue

const MANAGER_REPORTS = [
  { k: 'sar-summary',       endpoint: 'sar-summary',       icon: FileText,    name: 'Monthly SAR Filing Summary', desc: 'All SARs filed in period with statuses' },
  { k: 'sla-breach',        endpoint: 'sla-breach',        icon: Clock,       name: 'SLA Breach Report',          desc: 'Alerts that breached SLA, by analyst and scenario' },
  { k: 'team-performance',  endpoint: 'team-performance',  icon: Users,       name: 'Team Performance Report',     desc: 'Per-analyst rollup of work and outcomes' },
  { k: 'kyc-status',        endpoint: 'kyc-status',        icon: ShieldCheck, name: 'KYC Review Status Report',    desc: 'Customers and current KYC review status' },
  { k: 'false-positive',    endpoint: 'false-positive',    icon: Target,      name: 'False Positive Rate Report',  desc: 'FP rate by scenario with period-over-period trend' },
  { k: 'audit-trail',       endpoint: 'audit-trail',       icon: ScrollText,  name: 'Audit Trail Export',          desc: 'All system activity in the period' },
  { k: 'regulatory',        endpoint: 'regulatory',        icon: Award,       name: 'Regulatory Compliance Report', desc: 'Pass/fail check against compliance targets' },
  { k: 'alert-aging',       endpoint: 'alert-aging',       icon: Hourglass,   name: 'Alert Aging Report',           desc: 'Open alerts grouped by aging bucket' }
];

const EMPLOYEE_REPORTS = [
  { k: 'my-alerts', endpoint: 'my-alerts', icon: Inbox,         name: 'My Alert Summary',   desc: 'My assigned alerts in period' },
  { k: 'my-sla',    endpoint: 'my-sla',    icon: Activity,      name: 'My SLA Performance', desc: 'On-time vs breached and avg resolution vs team' },
  { k: 'my-sars',   endpoint: 'my-sars',   icon: Briefcase,     name: 'My SAR History',     desc: 'SARs I prepared with approval outcomes' },
  { k: 'my-kyc',    endpoint: 'my-kyc',    icon: ClipboardCheck,name: 'My KYC Reviews',     desc: 'KYC reviews assigned to me' }
];

const RANGE_PRESETS = [
  { k: 'this-month',  label: 'This Month' },
  { k: 'last-month',  label: 'Last Month' },
  { k: 'last-quarter',label: 'Last Quarter' },
  { k: 'last-6m',     label: 'Last 6 Months' },
  { k: 'custom',      label: 'Custom' }
];

const TONE_CLS = {
  default: 'text-navy-900',
  blue:    'text-blue-600',
  green:   'text-green-600',
  red:     'text-red-600',
  orange:  'text-orange-600'
};

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function presetToRange(p, custom) {
  const today = new Date();
  if (p === 'this-month') {
    return {
      from: ymd(new Date(today.getFullYear(), today.getMonth(), 1)),
      to: ymd(today)
    };
  }
  if (p === 'last-month') {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const end = new Date(today.getFullYear(), today.getMonth(), 0);
    return { from: ymd(start), to: ymd(end) };
  }
  if (p === 'last-quarter') {
    const end = new Date(today);
    const start = new Date(today);
    start.setMonth(start.getMonth() - 3);
    return { from: ymd(start), to: ymd(end) };
  }
  if (p === 'last-6m') {
    const end = new Date(today);
    const start = new Date(today);
    start.setMonth(start.getMonth() - 6);
    return { from: ymd(start), to: ymd(end) };
  }
  if (p === 'custom' && custom?.from && custom?.to) {
    return { from: custom.from, to: custom.to };
  }
  return { from: ymd(new Date(today.getFullYear(), today.getMonth(), 1)), to: ymd(today) };
}

const fmtAmount = (v) => '$' + Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const fmtCell = (col, value) => {
  if (value == null || value === '') return '—';
  if (col.type === 'currency') return fmtAmount(value);
  if (col.type === 'pct') return `${value}%`;
  if (col.type === 'days') return `${value}d`;
  return String(value);
};

// ─────────────────────────────────────────────── page

export default function Reports() {
  const { isManager, currentAnalyst } = useRole();
  const reports = isManager ? MANAGER_REPORTS : EMPLOYEE_REPORTS;
  const [activeKey, setActiveKey] = useState(reports[0].k);
  const [lastGenerated, setLastGenerated] = useState({}); // { [k]: ISOString }

  const active = reports.find(r => r.k === activeKey) || reports[0];

  useEffect(() => {
    // when role flips, reset to that role's first report
    setActiveKey(reports[0].k);
  }, [isManager]); // eslint-disable-line

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xl font-bold text-navy-900">{isManager ? 'Reports' : 'My Reports'}</div>
        <div className="text-sm text-slate-500">
          {isManager
            ? 'Generate and export compliance reports'
            : `Personal reports for ${currentAnalyst || 'current analyst'}`}
        </div>
      </div>

      <div className="flex gap-4 items-start">
        <div className="w-72 shrink-0 space-y-3">
          <ReportList
            reports={reports}
            activeKey={activeKey}
            setActiveKey={setActiveKey}
            lastGenerated={lastGenerated}
          />
          {isManager && <SchedulesPanel />}
        </div>

        <div className="flex-1 min-w-0">
          <ReportPreview
            key={active.k}
            report={active}
            isManager={isManager}
            onGenerated={() => setLastGenerated(s => ({ ...s, [active.k]: new Date().toISOString() }))}
          />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────── sidebar list

function ReportList({ reports, activeKey, setActiveKey, lastGenerated }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm divide-y divide-slate-100">
      {reports.map(r => {
        const Icon = r.icon;
        const active = r.k === activeKey;
        const ts = lastGenerated[r.k];
        return (
          <button
            key={r.k}
            onClick={() => setActiveKey(r.k)}
            className={`w-full text-left p-3 transition ${
              active ? 'bg-indigo-50' : 'hover:bg-slate-50'
            }`}
          >
            <div className="flex items-start gap-2">
              <Icon size={16} className={`mt-0.5 shrink-0 ${active ? 'text-indigo-600' : 'text-slate-400'}`} />
              <div className="min-w-0">
                <div className={`text-sm font-medium ${active ? 'text-indigo-700' : 'text-navy-900'}`}>
                  {r.name}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">{r.desc}</div>
                <div className="text-[10px] text-slate-400 mt-1">
                  {ts ? `Last generated: ${new Date(ts).toLocaleString()}` : 'Not generated yet'}
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────── schedules panel

function SchedulesPanel() {
  const [items, setItems] = useState([]);
  const { push } = useToast();
  const load = () => api.get('/reports/schedules').then(r => setItems(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);
  const onDelete = async (id) => {
    if (!confirm('Delete this schedule?')) return;
    await api.delete(`/reports/schedules/${id}`);
    push?.('Schedule deleted', 'info');
    load();
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-3">
      <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-2">
        Saved Schedules
      </div>
      {items.length === 0 ? (
        <div className="text-xs text-slate-400 py-2">No schedules saved.</div>
      ) : (
        <ul className="space-y-2">
          {items.map(s => (
            <li key={s.id} className="text-xs flex items-start justify-between gap-2 border border-slate-100 rounded-md p-2">
              <div className="min-w-0">
                <div className="font-medium text-navy-900 truncate">{s.report_key}</div>
                <div className="text-slate-500">
                  {s.frequency}{s.day_of ? ` · ${s.day_of}` : ''} · {s.format.toUpperCase()}
                </div>
                <div className="text-slate-400 truncate">{s.recipients}</div>
              </div>
              <button onClick={() => onDelete(s.id)} className="text-slate-400 hover:text-red-600 shrink-0">
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────── preview area

function ReportPreview({ report, isManager, onGenerated }) {
  const { currentAnalyst } = useRole();
  const [preset, setPreset] = useState('this-month');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [auditFilters, setAuditFilters] = useState({ action_type: '', user: '' });
  const previewRef = useRef(null);

  const range = useMemo(() => presetToRange(preset, custom), [preset, custom]);

  const generate = async () => {
    setLoading(true); setErr(null); setData(null);
    try {
      const params = { from: range.from, to: range.to };
      if (!isManager) params.analyst_id = currentAnalyst || '';
      if (report.k === 'audit-trail') {
        if (auditFilters.action_type) params.action_type = auditFilters.action_type;
        if (auditFilters.user) params.user = auditFilters.user;
      }
      const { data: d } = await api.get(`/reports/${report.endpoint}`, { params });
      setData(d);
      onGenerated?.();
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || 'Failed to generate');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm">
      <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-base font-semibold text-navy-900">{report.name}</div>
          <div className="text-xs text-slate-500 mt-0.5">{report.desc}</div>
          {!isManager && (
            <div className="text-[11px] text-slate-400 mt-1">
              Filtered to: <span className="font-medium">{currentAnalyst || '—'}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={preset}
            onChange={e => setPreset(e.target.value)}
            className="text-sm border border-slate-200 rounded-md px-2 py-1.5 bg-white"
          >
            {RANGE_PRESETS.map(r => <option key={r.k} value={r.k}>{r.label}</option>)}
          </select>
          {preset === 'custom' && (
            <>
              <input type="date" value={custom.from}
                     onChange={e => setCustom(c => ({ ...c, from: e.target.value }))}
                     className="text-sm border border-slate-200 rounded-md px-2 py-1.5" />
              <span className="text-slate-400 text-xs">→</span>
              <input type="date" value={custom.to}
                     onChange={e => setCustom(c => ({ ...c, to: e.target.value }))}
                     className="text-sm border border-slate-200 rounded-md px-2 py-1.5" />
            </>
          )}
          <button
            onClick={generate}
            disabled={loading || (!isManager && !currentAnalyst)}
            className="text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-md px-3 py-1.5 inline-flex items-center gap-1"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
            {loading ? 'Generating…' : 'Generate Report'}
          </button>
          {isManager && (
            <button
              onClick={() => setScheduleOpen(true)}
              className="text-sm border border-slate-300 hover:bg-slate-50 rounded-md px-3 py-1.5 inline-flex items-center gap-1"
            >
              <Calendar size={14} /> Schedule Report
            </button>
          )}
        </div>
      </div>

      {report.k === 'audit-trail' && (
        <div className="px-5 py-2 border-b border-slate-100 flex items-center gap-2 text-xs text-slate-600 bg-slate-50">
          <span>Filters:</span>
          <input
            placeholder="Action type"
            value={auditFilters.action_type}
            onChange={e => setAuditFilters(f => ({ ...f, action_type: e.target.value }))}
            className="border border-slate-200 rounded-md px-2 py-1 bg-white"
          />
          <input
            placeholder="User"
            value={auditFilters.user}
            onChange={e => setAuditFilters(f => ({ ...f, user: e.target.value }))}
            className="border border-slate-200 rounded-md px-2 py-1 bg-white"
          />
          <span className="text-slate-400">applied on next Generate</span>
        </div>
      )}

      <div className="p-5">
        {loading && (
          <div className="flex items-center justify-center py-16 text-slate-400 text-sm gap-2">
            <Loader2 size={16} className="animate-spin" /> Generating report…
          </div>
        )}
        {err && <div className="text-red-600 text-sm py-4">Failed: {err}</div>}
        {!loading && !err && !data && (
          <div className="py-16 text-center text-sm text-slate-500">
            Select a date range and click <span className="font-medium">Generate Report</span> to build a preview.
          </div>
        )}
        {!loading && !err && data && (
          <>
            <div className="flex items-center justify-end gap-2 mb-3 print:hidden">
              <button
                onClick={() => downloadPdf(report, data, range)}
                className="text-xs border border-slate-300 hover:bg-slate-50 rounded-md px-3 py-1.5 inline-flex items-center gap-1"
              >
                <Download size={12} /> Download PDF
              </button>
              <button
                onClick={() => downloadExcel(report, data, range)}
                className="text-xs border border-slate-300 hover:bg-slate-50 rounded-md px-3 py-1.5 inline-flex items-center gap-1"
              >
                <Download size={12} /> Download Excel
              </button>
              <button
                onClick={() => printPreview(previewRef.current)}
                className="text-xs border border-slate-300 hover:bg-slate-50 rounded-md px-3 py-1.5 inline-flex items-center gap-1"
              >
                <Printer size={12} /> Print
              </button>
            </div>
            <div ref={previewRef} className="border border-slate-200 rounded-md p-5 bg-white">
              <PreviewBody data={data} />
            </div>
          </>
        )}
      </div>

      {scheduleOpen && (
        <ScheduleModal
          reportKey={report.k}
          onClose={() => setScheduleOpen(false)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────── preview body

function PreviewBody({ data }) {
  return (
    <div className="space-y-4">
      <div>
        <div className="text-base font-semibold text-navy-900">{data.title}</div>
        <div className="text-xs text-slate-500">
          Range: {data.range?.from} → {data.range?.to}
        </div>
      </div>

      {Array.isArray(data.summary) && data.summary.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {data.summary.map((s, i) => (
            <div key={i} className="bg-slate-50 rounded-md p-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">{s.label}</div>
              <div className={`text-lg font-bold mt-0.5 ${TONE_CLS[s.tone] || TONE_CLS.default}`}>
                {s.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Regulatory sections view */}
      {Array.isArray(data.sections) && data.sections.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {data.sections.map((sec, i) => <RegulatorySection key={i} section={sec} />)}
        </div>
      )}

      {/* Grouped report (alert-aging) */}
      {Array.isArray(data.groups) ? (
        <div className="space-y-4">
          {data.groups.map((g, gi) => (
            <div key={gi}>
              <div className="text-sm font-semibold text-navy-900 mb-1">
                {g.name} <span className="text-slate-500 font-normal">({g.rows.length})</span>
              </div>
              <DataTable columns={data.columns} rows={g.rows} />
            </div>
          ))}
        </div>
      ) : (
        Array.isArray(data.columns) && (
          <DataTable columns={data.columns} rows={data.rows || []} totalsRow={data.totals_row} />
        )
      )}
    </div>
  );
}

function RegulatorySection({ section }) {
  const status = section.status;
  const cfg = {
    pass:    { label: 'Pass',    cls: 'bg-green-50 text-green-700 border-green-200',   Icon: CheckCircle2 },
    at_risk: { label: 'At Risk', cls: 'bg-orange-50 text-orange-700 border-orange-200', Icon: AlertTriangle },
    fail:    { label: 'Fail',    cls: 'bg-red-50 text-red-700 border-red-200',         Icon: MinusCircle }
  }[status] || { label: '—', cls: 'bg-slate-50 text-slate-600 border-slate-200', Icon: MinusCircle };
  const { Icon } = cfg;
  return (
    <div className="border border-slate-200 rounded-md p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-navy-900">{section.title}</div>
          <div className="text-xs text-slate-500 mt-0.5">{section.detail}</div>
        </div>
        <span className={`inline-flex items-center gap-1 text-[11px] font-semibold border rounded px-2 py-0.5 ${cfg.cls}`}>
          <Icon size={11} /> {cfg.label}
        </span>
      </div>
      <div className="mt-3 flex items-end gap-3">
        <div className="text-2xl font-bold text-navy-900">{section.current_pct}%</div>
        <div className="text-xs text-slate-500 pb-1">Target: {section.target_pct}%</div>
      </div>
      <div className="mt-2 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${
            status === 'pass' ? 'bg-green-500'
              : status === 'at_risk' ? 'bg-orange-500' : 'bg-red-500'
          }`}
          style={{ width: `${Math.min(100, Math.max(0, section.current_pct))}%` }}
        />
      </div>
    </div>
  );
}

function DataTable({ columns, rows, totalsRow }) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return (
      <div className="text-sm text-slate-400 py-6 text-center bg-slate-50 rounded-md">
        No data found for this period
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
          <tr>
            {columns.map(c => (
              <th key={c.key} className="text-left py-2 px-3 font-medium whitespace-nowrap">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-slate-100">
              {columns.map(c => (
                <td key={c.key} className="py-1.5 px-3 text-slate-700 whitespace-nowrap">
                  {fmtCell(c, r[c.key])}
                </td>
              ))}
            </tr>
          ))}
          {totalsRow && (
            <tr className="bg-slate-50 font-semibold border-t-2 border-slate-200">
              {columns.map(c => (
                <td key={c.key} className="py-2 px-3 text-navy-900 whitespace-nowrap">
                  {fmtCell(c, totalsRow[c.key])}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────── schedule modal

function ScheduleModal({ reportKey, onClose }) {
  const [frequency, setFrequency] = useState('monthly');
  const [dayOf, setDayOf] = useState('1');
  const [format, setFormat] = useState('pdf');
  const [recipients, setRecipients] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const { push } = useToast();

  const dayOptions = useMemo(() => {
    if (frequency === 'weekly')
      return ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    if (frequency === 'monthly')
      return Array.from({ length: 28 }, (_, i) => String(i + 1));
    if (frequency === 'quarterly')
      return ['Day 1 of quarter', 'Day 15 of quarter', 'Last day of quarter'];
    return [];
  }, [frequency]);

  useEffect(() => {
    setDayOf(dayOptions[0] || '1');
  }, [frequency]); // eslint-disable-line

  const save = async () => {
    if (!recipients.trim()) { setErr('At least one recipient email is required'); return; }
    setSaving(true); setErr(null);
    try {
      await api.post('/reports/schedules', {
        report_key: reportKey,
        frequency,
        day_of: dayOf,
        format,
        recipients: recipients.trim()
      });
      push?.('Schedule saved', 'success');
      onClose();
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4 print:hidden">
      <div className="bg-white rounded-lg shadow-xl border border-slate-200 w-full max-w-md">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <div className="font-semibold text-navy-900 text-sm">Schedule Report</div>
          <button onClick={onClose} className="text-slate-400 hover:text-navy-900">
            <X size={16} />
          </button>
        </div>
        <div className="p-5 space-y-4 text-sm">
          <div>
            <div className="text-xs text-slate-500 mb-1">Report</div>
            <div className="font-medium text-navy-900">{reportKey}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Frequency</div>
            <select value={frequency} onChange={e => setFrequency(e.target.value)}
                    className="w-full border border-slate-200 rounded-md px-3 py-1.5">
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
            </select>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Day</div>
            <select value={dayOf} onChange={e => setDayOf(e.target.value)}
                    className="w-full border border-slate-200 rounded-md px-3 py-1.5">
              {dayOptions.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Format</div>
            <div className="flex gap-2">
              {['pdf', 'excel'].map(f => (
                <button key={f} onClick={() => setFormat(f)}
                        className={`text-xs px-3 py-1.5 rounded-md border ${
                          format === f ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 text-slate-700'
                        }`}>
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Recipients</div>
            <input
              value={recipients}
              onChange={e => setRecipients(e.target.value)}
              placeholder="alice@bank.com, bob@bank.com"
              className="w-full border border-slate-200 rounded-md px-3 py-1.5"
            />
          </div>
          {err && <div className="text-xs text-red-600">{err}</div>}
        </div>
        <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose}
                  className="text-sm border border-slate-300 hover:bg-slate-50 rounded-md px-3 py-1.5">
            Cancel
          </button>
          <button onClick={save} disabled={saving}
                  className="text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-md px-3 py-1.5 inline-flex items-center gap-1">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            {saving ? 'Saving…' : 'Save Schedule'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────── PDF / Excel / Print

function downloadPdf(report, data, range) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(data.title || report.name, 40, 50);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Range: ${range.from} → ${range.to}`, 40, 68);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 40, 82);

  // Summary
  let cursorY = 100;
  if (Array.isArray(data.summary) && data.summary.length > 0) {
    doc.setTextColor(20);
    doc.setFontSize(10);
    const cols = Math.min(data.summary.length, 5);
    const colW = (pageW - 80) / cols;
    data.summary.forEach((s, i) => {
      const x = 40 + (i % cols) * colW;
      const y = cursorY + Math.floor(i / cols) * 38;
      doc.setFillColor(245, 247, 250);
      doc.rect(x, y, colW - 8, 32, 'F');
      doc.setFontSize(7);
      doc.setTextColor(120);
      doc.text(String(s.label).toUpperCase(), x + 6, y + 12);
      doc.setFontSize(11);
      doc.setTextColor(20);
      doc.text(String(s.value ?? '—'), x + 6, y + 26);
    });
    cursorY += Math.ceil(data.summary.length / cols) * 38 + 12;
  }

  // Regulatory sections
  if (Array.isArray(data.sections) && data.sections.length > 0) {
    autoTable(doc, {
      startY: cursorY,
      head: [['Section', 'Current %', 'Target %', 'Status', 'Detail']],
      body: data.sections.map(s => [s.title, `${s.current_pct}%`, `${s.target_pct}%`, s.status, s.detail || '']),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [99, 102, 241], textColor: 255 }
    });
    cursorY = doc.lastAutoTable.finalY + 12;
  }

  // Grouped (alert aging)
  if (Array.isArray(data.groups)) {
    for (const g of data.groups) {
      doc.setFontSize(11);
      doc.setTextColor(20);
      doc.text(`${g.name} (${g.rows.length})`, 40, cursorY);
      cursorY += 6;
      autoTable(doc, {
        startY: cursorY + 4,
        head: [data.columns.map(c => c.label)],
        body: g.rows.map(r => data.columns.map(c => fmtCell(c, r[c.key]))),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [99, 102, 241], textColor: 255 }
      });
      cursorY = doc.lastAutoTable.finalY + 12;
    }
  } else if (Array.isArray(data.columns)) {
    const body = (data.rows || []).map(r => data.columns.map(c => fmtCell(c, r[c.key])));
    if (data.totals_row) {
      body.push(data.columns.map(c => fmtCell(c, data.totals_row[c.key])));
    }
    autoTable(doc, {
      startY: cursorY,
      head: [data.columns.map(c => c.label)],
      body,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [99, 102, 241], textColor: 255 },
      didParseCell: (hookData) => {
        if (data.totals_row && hookData.section === 'body' && hookData.row.index === body.length - 1) {
          hookData.cell.styles.fontStyle = 'bold';
          hookData.cell.styles.fillColor = [241, 245, 249];
        }
      }
    });
  }

  const filename = `${report.k}_${range.from}_${range.to}.pdf`;
  doc.save(filename);
}

function downloadExcel(report, data, range) {
  const wb = XLSX.utils.book_new();

  // Summary sheet
  const summaryAOA = [
    [data.title || report.name],
    [`Range: ${range.from} → ${range.to}`],
    [`Generated: ${new Date().toLocaleString()}`],
    [],
    ['Label', 'Value']
  ];
  (data.summary || []).forEach(s => summaryAOA.push([s.label, s.value]));
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryAOA);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

  // Sections sheet (regulatory)
  if (Array.isArray(data.sections) && data.sections.length > 0) {
    const aoa = [['Section', 'Current %', 'Target %', 'Status', 'Detail']];
    data.sections.forEach(s => aoa.push([s.title, s.current_pct, s.target_pct, s.status, s.detail || '']));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Sections');
  }

  // Data sheet(s)
  if (Array.isArray(data.groups)) {
    for (const g of data.groups) {
      const aoa = [data.columns.map(c => c.label)];
      g.rows.forEach(r => aoa.push(data.columns.map(c => formatExcelCell(c, r[c.key]))));
      const sheetName = g.name.slice(0, 31).replace(/[\\/?*[\]]/g, '_');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName);
    }
  } else if (Array.isArray(data.columns) && (data.rows || []).length > 0) {
    const aoa = [data.columns.map(c => c.label)];
    data.rows.forEach(r => aoa.push(data.columns.map(c => formatExcelCell(c, r[c.key]))));
    if (data.totals_row) {
      aoa.push(data.columns.map(c => formatExcelCell(c, data.totals_row[c.key])));
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Data');
  }

  const filename = `${report.k}_${range.from}_${range.to}.xlsx`;
  XLSX.writeFile(wb, filename);
}

function formatExcelCell(col, value) {
  if (value == null || value === '') return '';
  if (col.type === 'currency') return Number(value || 0);
  if (col.type === 'pct') return Number(value || 0);
  if (col.type === 'days') return Number(value || 0);
  return value;
}

function printPreview(node) {
  if (!node) return window.print();
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) return;
  const html = `
    <html><head><title>Print Report</title>
    <style>
      body { font-family: -apple-system, system-ui, sans-serif; padding: 24px; color: #0f172a; }
      table { border-collapse: collapse; width: 100%; font-size: 12px; }
      th { text-align: left; background: #f1f5f9; padding: 6px 8px; border-bottom: 1px solid #cbd5e1; }
      td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; }
      .grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin: 12px 0; }
      .grid > div { background: #f8fafc; padding: 8px; border-radius: 4px; }
      .grid .lbl { font-size: 10px; color: #64748b; text-transform: uppercase; }
      .grid .val { font-weight: 700; font-size: 14px; margin-top: 2px; }
      h1 { font-size: 16px; margin: 0 0 4px; }
      .range { font-size: 11px; color: #64748b; margin-bottom: 16px; }
    </style></head><body>${node.innerHTML}</body></html>
  `;
  w.document.write(html);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 250);
}
