// ═══════════════════════════════════════════════════════════════════════════
// C-11 — Examination Readiness Mode (BSA Officer self-assessment surface).
//
// Three top-level sections, switched via tabs:
//   1. Self-Assessment — configuration panel + results panel + run history
//   2. MRA Tracker     — CRUD over exam_mra_items
//
// All API calls go through the existing axios client; role gate is enforced
// server-side by the requireBsaOfficer middleware on /api/exam-readiness/*.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import {
  ClipboardCheck, AlertTriangle, CheckCircle2, XCircle, Loader2, FileText,
  PlayCircle, RefreshCw, ChevronDown, ChevronUp, Plus, X, Clock,
  Shield, BookOpen
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, Cell
} from 'recharts';
import api from '../api/client.js';
import { useRole } from '../state/RoleContext.jsx';
import { useToast } from '../state/ToastContext.jsx';
import Card from '../components/shared/Card.jsx';
import { downloadReportPdf } from '../components/examReadiness/buildReportPdf.js';

const CHECK_OPTIONS = [
  { id: 'SAR_TIMELINESS',           label: 'SAR Filing Timeliness',           ffiec: 'Core Examination Procedures for SAR Monitoring and Filing' },
  { id: 'CDD_COMPLETENESS',         label: 'CDD Completeness',                ffiec: 'Core Examination Procedures for CDD' },
  { id: 'KYC_REVIEW_TIMELINESS',    label: 'KYC Review Timeliness',           ffiec: 'CDD — Ongoing Monitoring' },
  { id: 'OFAC_SCREENING_COVERAGE',  label: 'OFAC Screening Coverage',         ffiec: 'Core Examination Procedures for OFAC' },
  { id: 'AUDIT_TRAIL_COVERAGE',     label: 'Audit Trail Coverage',            ffiec: 'BSA/AML Compliance Programme Structures' },
  { id: 'FALSE_POSITIVE_TREND',     label: 'False Positive Rate Trend',       ffiec: 'Transaction Monitoring Systems' },
  { id: 'SAR_RETENTION_COMPLIANCE', label: 'SAR Retention Compliance',        ffiec: 'Recordkeeping and Reporting' }
];

const STATUS_BG = {
  pass:    'bg-green-100 text-green-800 border-green-300',
  concern: 'bg-amber-100 text-amber-800 border-amber-300',
  fail:    'bg-red-100 text-red-800 border-red-300',
  skipped: 'bg-slate-100 text-slate-600 border-slate-300'
};
const STATUS_STRIPE = {
  pass:    'border-l-green-500',
  concern: 'border-l-amber-500',
  fail:    'border-l-red-500',
  skipped: 'border-l-slate-300'
};

export default function ExamReadiness() {
  const [tab, setTab] = useState('self_assessment');

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-navy-900 inline-flex items-center gap-2">
          <ClipboardCheck size={20} /> Examination Readiness
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Run the FFIEC procedure checks against your live data. Generate the report your examiner will hand you.
        </p>
      </header>

      <div className="flex items-center gap-1 border-b border-slate-200">
        <TabButton active={tab === 'self_assessment'} onClick={() => setTab('self_assessment')}>
          Self-Assessment
        </TabButton>
        <TabButton active={tab === 'mra'} onClick={() => setTab('mra')}>
          MRA Tracker
        </TabButton>
      </div>

      {tab === 'self_assessment' ? <SelfAssessmentTab /> : <MraTrackerTab />}
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 ${
        active
          ? 'border-blue-600 text-navy-900'
          : 'border-transparent text-slate-500 hover:text-navy-900'
      }`}
    >
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SELF-ASSESSMENT TAB
// ─────────────────────────────────────────────────────────────────────────
function SelfAssessmentTab() {
  const { push } = useToast();
  const [history, setHistory] = useState([]);
  const [activeRun, setActiveRun] = useState(null);     // currently rendered run (live or historical)
  const [polling, setPolling] = useState(false);
  const [configOpen, setConfigOpen] = useState(true);

  const loadHistory = async () => {
    try {
      const r = await api.get('/exam-readiness/runs', { params: { limit: 20 } });
      setHistory(r.data?.runs || []);
      if (!activeRun && (r.data?.runs || []).length > 0) {
        // Auto-collapse config if there's at least one prior run, per spec.
        setConfigOpen(false);
        // Load the most recent completed run by default.
        const last = r.data.runs.find(x => x.status === 'completed') || r.data.runs[0];
        if (last) loadRun(last.runId);
      }
    } catch (_e) {
      // Surface lightweight error — the page should still be usable.
    }
  };

  const loadRun = async (runId) => {
    try {
      const r = await api.get(`/exam-readiness/run/${runId}`);
      setActiveRun(r.data);
    } catch (e) {
      push(`Failed to load run: ${e?.response?.data?.error || e.message}`, 'error', 5000);
    }
  };

  useEffect(() => { loadHistory(); /* eslint-disable-next-line */ }, []);

  // Poll while a run is in progress.
  useEffect(() => {
    if (!activeRun || activeRun.status !== 'running') return;
    setPolling(true);
    const id = setInterval(async () => {
      try {
        const r = await api.get(`/exam-readiness/run/${activeRun.runId}`);
        setActiveRun(r.data);
        if (r.data.status !== 'running') {
          clearInterval(id);
          setPolling(false);
          await loadHistory();
        }
      } catch (_e) { /* keep polling */ }
    }, 3000);
    return () => { clearInterval(id); setPolling(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRun?.status, activeRun?.runId]);

  const startRun = async (config) => {
    try {
      const r = await api.post('/exam-readiness/run', config);
      push('Self-assessment started.', 'success', 3000);
      setActiveRun({ runId: r.data.runId, status: 'running', startedAt: r.data.startedAt, checksCompleted: 0, checksTotal: (config.checksEnabled || []).length });
      setConfigOpen(false);
    } catch (e) {
      push(`Failed to start: ${e?.response?.data?.error || e.message}`, 'error', 5000);
    }
  };

  return (
    <div className="space-y-6">
      <ConfigurationPanel
        open={configOpen}
        setOpen={setConfigOpen}
        onRun={startRun}
        disabled={polling}
      />

      {activeRun && (
        <ResultsPanel
          run={activeRun}
          onReload={() => loadRun(activeRun.runId)}
          onHistorySelect={(id) => { setConfigOpen(false); loadRun(id); }}
          history={history}
        />
      )}
    </div>
  );
}

function ConfigurationPanel({ open, setOpen, onRun, disabled }) {
  const [targetExamDate, setTargetExamDate] = useState('');
  const [lookbackDays, setLookbackDays] = useState(365);
  const [sarSampleSize, setSarSampleSize] = useState(25);
  const [cddSampleSize, setCddSampleSize] = useState(50);
  const [checksEnabled, setChecksEnabled] = useState(() => new Set(CHECK_OPTIONS.map(c => c.id)));

  const toggleCheck = (id) => {
    setChecksEnabled(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Card bodyClassName="p-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-3 flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <Shield size={16} className="text-blue-600" />
          <span className="text-sm font-semibold text-navy-900">Run New Assessment</span>
        </div>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {open && (
        <div className="p-4 border-t border-slate-200 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Labeled label="Target exam date">
              <input
                type="date"
                value={targetExamDate}
                onChange={(e) => setTargetExamDate(e.target.value)}
                className="w-full text-sm border border-slate-200 rounded-md px-3 py-1.5"
              />
            </Labeled>
            <Labeled label="Review period (days)">
              <input
                type="number"
                min={30}
                max={1825}
                value={lookbackDays}
                onChange={(e) => setLookbackDays(Math.max(30, Math.min(1825, Number(e.target.value) || 365)))}
                className="w-full text-sm border border-slate-200 rounded-md px-3 py-1.5"
              />
            </Labeled>
            <Labeled label="SAR timeliness sample">
              <input
                type="number"
                min={10}
                max={100}
                value={sarSampleSize}
                onChange={(e) => setSarSampleSize(Math.max(10, Math.min(100, Number(e.target.value) || 25)))}
                className="w-full text-sm border border-slate-200 rounded-md px-3 py-1.5"
              />
            </Labeled>
            <Labeled label="CDD completeness sample">
              <input
                type="number"
                min={10}
                max={200}
                value={cddSampleSize}
                onChange={(e) => setCddSampleSize(Math.max(10, Math.min(200, Number(e.target.value) || 50)))}
                className="w-full text-sm border border-slate-200 rounded-md px-3 py-1.5"
              />
            </Labeled>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Checks to include</div>
            <div className="space-y-2">
              {CHECK_OPTIONS.map(c => (
                <label key={c.id} className="flex items-start gap-2 text-sm cursor-pointer hover:bg-slate-50 rounded p-1.5">
                  <input
                    type="checkbox"
                    checked={checksEnabled.has(c.id)}
                    onChange={() => toggleCheck(c.id)}
                    className="mt-0.5"
                  />
                  <div className="min-w-0">
                    <div className="text-navy-900 font-medium">{c.label}</div>
                    <div className="text-[11px] text-slate-500">{c.ffiec}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <button
            type="button"
            disabled={disabled || checksEnabled.size === 0}
            onClick={() => onRun({
              checksEnabled: Array.from(checksEnabled),
              sarSampleSize,
              cddSampleSize,
              lookbackDays,
              targetExamDate: targetExamDate || null
            })}
            className="w-full md:w-auto inline-flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md px-5 py-2 disabled:opacity-50"
          >
            <PlayCircle size={14} /> Run Self-Assessment
          </button>
        </div>
      )}
    </Card>
  );
}

function Labeled({ label, children }) {
  return (
    <div>
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      {children}
    </div>
  );
}

function ResultsPanel({ run, onReload, onHistorySelect, history }) {
  const { push } = useToast();
  const { currentUser } = useRole();
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesDraft, setNotesDraft] = useState(run.notes || '');

  useEffect(() => { setNotesDraft(run.notes || ''); }, [run.notes]);

  if (run.status === 'running') {
    const total = run.checksTotal || CHECK_OPTIONS.length;
    const completed = run.checksCompleted || 0;
    const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
    return (
      <Card title="Self-Assessment In Progress" bodyClassName="p-6">
        <div className="flex items-center gap-3 mb-3">
          <Loader2 size={18} className="animate-spin text-blue-600" />
          <div className="text-sm text-navy-900">{completed} of {total} checks completed</div>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-3 text-[11px] text-slate-500">
          This page polls every 3 seconds. Partial results are not shown while the run is in progress.
        </div>
      </Card>
    );
  }

  if (run.status === 'failed') {
    return (
      <Card title="Self-Assessment Failed" bodyClassName="p-6">
        <div className="text-sm text-red-700">
          The run failed before completion. Check server logs for details.
        </div>
      </Card>
    );
  }

  const findings = run.findings || [];
  const skipped = findings.filter(f => f.status === 'skipped').length;
  const overallStatus = run.overallStatus || 'pass';

  const downloadReport = async () => {
    try {
      const r = await api.get(`/exam-readiness/runs/${run.runId}/report`);
      downloadReportPdf(r.data);
      push('Report generated.', 'success', 3000);
    } catch (e) {
      push(`Report failed: ${e?.response?.data?.error || e.message}`, 'error', 5000);
    }
  };

  const saveNotes = async () => {
    try {
      await api.patch(`/exam-readiness/run/${run.runId}/notes`, { notes: notesDraft });
      push('Notes saved.', 'success', 2500);
      setNotesOpen(false);
      onReload();
    } catch (e) {
      push(`Save failed: ${e?.response?.data?.error || e.message}`, 'error', 5000);
    }
  };

  return (
    <div className="space-y-4">
      <Card bodyClassName="p-6">
        <div className="flex flex-col md:flex-row md:items-center gap-6">
          <ScoreGauge score={run.overallScore} status={overallStatus} />
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <CountBadge tone="green" label="Passed" count={run.checksPassed || 0} />
              <CountBadge tone="amber" label="Concern" count={run.checksConcern || 0} />
              <CountBadge tone="red"   label="Failed"  count={run.checksFailed  || 0} />
              <CountBadge tone="slate" label="Skipped" count={skipped} />
            </div>
            <div className="text-xs text-slate-500">
              Run by {run.runByName || '(unknown)'} · started {new Date(run.startedAt).toLocaleString()}
              {run.completedAt && ` · completed ${new Date(run.completedAt).toLocaleString()}`}
            </div>
            <div className="flex items-center gap-2 flex-wrap pt-2">
              <button
                type="button"
                onClick={downloadReport}
                className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1.5"
              >
                <FileText size={12} /> Generate Report
              </button>
              <button
                type="button"
                onClick={() => setNotesOpen(o => !o)}
                className="text-xs px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50 inline-flex items-center gap-1.5"
              >
                {notesOpen ? 'Cancel Notes' : (run.notes ? 'Edit Notes' : 'Add Notes')}
              </button>
              <button
                type="button"
                onClick={onReload}
                className="text-xs px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50 inline-flex items-center gap-1.5"
              >
                <RefreshCw size={12} /> Refresh
              </button>
            </div>
            {notesOpen && (
              <div className="pt-3 space-y-2">
                <textarea
                  rows={4}
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  className="w-full text-sm border border-slate-200 rounded-md px-3 py-2"
                  placeholder="BSA Officer notes on this run (visible to other BSA officers, not exported by default)..."
                />
                <button
                  type="button"
                  onClick={saveNotes}
                  className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white"
                >
                  Save notes
                </button>
              </div>
            )}
          </div>
        </div>
      </Card>

      <div className="space-y-3">
        {findings.map(f => <FindingCard key={f.id || f.checkId} finding={f} />)}
      </div>

      <RunHistory history={history} onSelect={onHistorySelect} activeRunId={run.runId} />
    </div>
  );
}

// Simple SVG semicircular gauge. No third-party chart library.
function ScoreGauge({ score, status }) {
  const value = Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0;
  const cx = 90, cy = 90, r = 70;
  const arcAngle = Math.PI;                            // 180°
  const startAngle = Math.PI;                          // left
  const endAngle = startAngle + arcAngle * (value / 100);
  const xStart = cx + r * Math.cos(startAngle);
  const yStart = cy + r * Math.sin(startAngle);
  const xEnd   = cx + r * Math.cos(endAngle);
  const yEnd   = cy + r * Math.sin(endAngle);
  const largeArc = arcAngle * (value / 100) > Math.PI ? 1 : 0;
  const color = status === 'pass' ? '#16a34a' : status === 'concern' ? '#d97706' : status === 'fail' ? '#dc2626' : '#94a3b8';

  return (
    <div className="flex flex-col items-center">
      <svg width="180" height="110" viewBox="0 0 180 110">
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          stroke="#e5e7eb"
          strokeWidth="14"
          fill="none"
        />
        {value > 0 && (
          <path
            d={`M ${xStart} ${yStart} A ${r} ${r} 0 ${largeArc} 1 ${xEnd} ${yEnd}`}
            stroke={color}
            strokeWidth="14"
            fill="none"
            strokeLinecap="round"
          />
        )}
      </svg>
      <div className="-mt-2 text-center">
        <div className="text-3xl font-bold tabular-nums" style={{ color }}>
          {Number.isFinite(score) ? score : '—'}
        </div>
        <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color }}>
          {status?.toUpperCase()}
        </div>
      </div>
    </div>
  );
}

function CountBadge({ tone, label, count }) {
  const cls = {
    green: 'bg-green-100 text-green-800',
    amber: 'bg-amber-100 text-amber-800',
    red:   'bg-red-100 text-red-800',
    slate: 'bg-slate-100 text-slate-600'
  }[tone] || 'bg-slate-100';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${cls}`}>
      <span className="font-bold tabular-nums">{count}</span> {label}
    </span>
  );
}

function FindingCard({ finding }) {
  const [open, setOpen] = useState(false);
  const stripe = STATUS_STRIPE[finding.status] || STATUS_STRIPE.skipped;
  const badge = STATUS_BG[finding.status] || STATUS_BG.skipped;
  const isFpTrend = finding.checkId === 'FALSE_POSITIVE_TREND';
  return (
    <Card bodyClassName={`p-4 border-l-4 ${stripe}`}>
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold text-navy-900">{finding.checkName}</div>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${badge}`}>
              {(finding.status || '').toUpperCase()}
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">{finding.ffiecReference}</div>
          {!isFpTrend && finding.sampleSize != null && finding.status !== 'skipped' && (
            <div className="text-xs text-slate-600 mt-1.5 tabular-nums">
              {finding.samplePassed ?? '—'} of {finding.sampleSize} sampled records passed
              {finding.failureRate != null && ` (${Number(finding.failureRate).toFixed(2)}% failure rate)`}
            </div>
          )}
          {finding.findingSummary && (
            <div className="text-xs text-slate-700 mt-2">{finding.findingSummary}</div>
          )}
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-navy-900 tabular-nums">
            {finding.score == null ? '—' : finding.score}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Score</div>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="mt-3 text-xs text-blue-600 hover:underline inline-flex items-center gap-1"
      >
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        {open ? 'Hide details' : 'View details'}
      </button>
      {open && (
        <div className="mt-3 pt-3 border-t border-slate-200 space-y-4">
          {isFpTrend
            ? <FpTrendChart detail={finding.findingDetail || []} />
            : <DetailTable detail={finding.findingDetail || []} />}
          <RemediationList items={finding.remediationItems || []} />
          {finding.cfrReference && (
            <div className="text-[10px] text-slate-400 italic">{finding.cfrReference}</div>
          )}
        </div>
      )}
    </Card>
  );
}

function DetailTable({ detail }) {
  if (!detail || detail.length === 0) return (
    <div className="text-xs text-slate-400 italic">No specific record-level findings.</div>
  );
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs">
        <thead className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
          <tr>
            <th className="text-left py-1.5 px-2">Record ID</th>
            <th className="text-left py-1.5 px-2">Type</th>
            <th className="text-left py-1.5 px-2">Detail</th>
            <th className="text-left py-1.5 px-2">Severity</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {detail.map((d, i) => (
            <tr key={i}>
              <td className="px-2 py-1.5 font-mono text-navy-900 text-[10px]">{d.recordId || '—'}</td>
              <td className="px-2 py-1.5 text-slate-600">{d.recordType || '—'}</td>
              <td className="px-2 py-1.5">{d.detailText || ''}</td>
              <td className="px-2 py-1.5">
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                  d.severity === 'high'   ? 'bg-red-100 text-red-700'
                  : d.severity === 'medium'? 'bg-amber-100 text-amber-800'
                  : d.severity === 'low'  ? 'bg-slate-100 text-slate-600'
                  : 'bg-blue-100 text-blue-700'
                }`}>
                  {(d.severity || '').toUpperCase()}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FpTrendChart({ detail }) {
  const data = (detail || []).map(d => ({
    month: d.month || d.recordId || '',
    fp_rate: Number(d.fp_rate ?? 0),
    closed: Number(d.total_closed ?? 0),
    fp_count: Number(d.fp_count ?? 0)
  }));
  return (
    <div>
      <div className="text-xs text-slate-500 mb-2">Monthly false positive rate</div>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" tick={{ fontSize: 10 }} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
            <Tooltip />
            <ReferenceLine y={90} stroke="#dc2626" strokeDasharray="3 3" label={{ value: '90% threshold', position: 'right', fontSize: 10, fill: '#dc2626' }} />
            <Bar dataKey="fp_rate">
              {data.map((d, i) => (
                <Cell
                  key={i}
                  fill={d.fp_rate > 95 ? '#dc2626' : d.fp_rate > 90 ? '#d97706' : '#16a34a'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="w-full text-xs mt-2">
        <thead className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
          <tr>
            <th className="text-left py-1 px-2">Month</th>
            <th className="text-right py-1 px-2">Closed</th>
            <th className="text-right py-1 px-2">FP</th>
            <th className="text-right py-1 px-2">Rate</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.map(d => (
            <tr key={d.month}>
              <td className="px-2 py-1">{d.month}</td>
              <td className="px-2 py-1 text-right tabular-nums">{d.closed}</td>
              <td className="px-2 py-1 text-right tabular-nums">{d.fp_count}</td>
              <td className="px-2 py-1 text-right tabular-nums">{d.fp_rate.toFixed(2)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RemediationList({ items }) {
  if (!items || items.length === 0) return null;
  const priorityCls = (p) => p === 'high' ? 'bg-red-100 text-red-700'
                          : p === 'medium' ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-100 text-slate-600';
  return (
    <div>
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Remediation</div>
      <ol className="space-y-2 list-decimal list-inside text-xs">
        {items.map((r, i) => (
          <li key={i} className="text-navy-900">
            <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded mr-2 ${priorityCls(r.priority)}`}>
              {(r.priority || '').toUpperCase()}
            </span>
            {r.action}
            {r.ownerRole && (
              <span className="text-[10px] text-slate-500 ml-1">(owner: {r.ownerRole})</span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function RunHistory({ history, onSelect, activeRunId }) {
  const [open, setOpen] = useState(false);
  if (!history || history.length === 0) return null;
  return (
    <Card bodyClassName="p-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-3 flex items-center justify-between"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-navy-900">
          <Clock size={14} /> Previous Self-Assessments ({history.length})
        </div>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {open && (
        <div className="overflow-x-auto border-t border-slate-200">
          <table className="min-w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
              <tr>
                <th className="text-left py-2 px-3">Date</th>
                <th className="text-left py-2 px-3">Score</th>
                <th className="text-left py-2 px-3">Status</th>
                <th className="text-left py-2 px-3">Breakdown</th>
                <th className="text-left py-2 px-3">Run by</th>
                <th className="text-left py-2 px-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {history.map(h => {
                const tone = h.overallStatus === 'pass' ? 'text-green-700'
                          : h.overallStatus === 'concern' ? 'text-amber-700'
                          : h.overallStatus === 'fail' ? 'text-red-700'
                          : 'text-slate-500';
                const isActive = h.runId === activeRunId;
                return (
                  <tr key={h.runId} className={isActive ? 'bg-blue-50' : ''}>
                    <td className="px-3 py-2 text-slate-700">
                      {h.completedAt
                        ? new Date(h.completedAt).toLocaleDateString()
                        : new Date(h.startedAt).toLocaleDateString()}
                    </td>
                    <td className={`px-3 py-2 font-bold tabular-nums ${tone}`}>
                      {h.overallScore ?? '—'}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${STATUS_BG[h.overallStatus] || STATUS_BG.skipped}`}>
                        {(h.overallStatus || h.status || 'running').toUpperCase()}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {h.checksPassed || 0} Pass · {h.checksConcern || 0} Concern · {h.checksFailed || 0} Fail
                    </td>
                    <td className="px-3 py-2 text-slate-600">{h.runByName || '—'}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => onSelect(h.runId)}
                        className="text-blue-600 hover:underline text-xs"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// MRA TRACKER TAB
// ─────────────────────────────────────────────────────────────────────────
const MRA_CATEGORIES = [
  'SAR_FILING', 'CDD_KYC', 'OFAC_SANCTIONS', 'AUDIT_TRAIL',
  'INTERNAL_CONTROLS', 'BSA_OFFICER', 'TRAINING',
  'INDEPENDENT_TESTING', 'OTHER'
];
const MRA_SEVERITIES = ['mra', 'mria', 'violation', 'recommendation'];
const MRA_STATUSES = ['open', 'in_progress', 'remediated', 'verified_closed'];

function MraTrackerTab() {
  const { push } = useToast();
  const [items, setItems] = useState([]);
  const [filters, setFilters] = useState({ status: '', category: '', severity: '' });
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState(null);

  const load = async () => {
    try {
      const r = await api.get('/exam-readiness/mras', { params: filters });
      setItems(r.data || []);
    } catch (e) {
      push(`Failed to load MRAs: ${e?.response?.data?.error || e.message}`, 'error', 5000);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filters.status, filters.category, filters.severity]);

  const summary = useMemo(() => {
    const open = items.filter(i => i.status === 'open' || i.status === 'in_progress');
    const counts = { mria: 0, mra: 0, violation: 0, recommendation: 0 };
    for (const i of open) counts[i.severity] = (counts[i.severity] || 0) + 1;
    const overdue = open.filter(i => i.target_date && new Date(i.target_date) < new Date()).length;
    return { openCount: open.length, counts, overdue };
  }, [items]);

  return (
    <div className="space-y-4">
      <Card bodyClassName="p-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="text-sm text-navy-900">
            <span className="font-bold tabular-nums">{summary.openCount}</span> open MRAs —
            {' '}{summary.counts.mria || 0} MRIA, {summary.counts.mra || 0} MRA,
            {' '}{summary.counts.violation || 0} Violation, {summary.counts.recommendation || 0} Recommendation.
            {' '}<span className={summary.overdue > 0 ? 'text-red-700 font-semibold' : 'text-slate-500'}>
              {summary.overdue} past target date.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1.5"
          >
            <Plus size={12} /> Add MRA
          </button>
        </div>
      </Card>

      <Card bodyClassName="p-4">
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <FilterSelect label="Status" value={filters.status} onChange={(v) => setFilters(f => ({ ...f, status: v }))} options={['', ...MRA_STATUSES]} />
          <FilterSelect label="Category" value={filters.category} onChange={(v) => setFilters(f => ({ ...f, category: v }))} options={['', ...MRA_CATEGORIES]} />
          <FilterSelect label="Severity" value={filters.severity} onChange={(v) => setFilters(f => ({ ...f, severity: v }))} options={['', ...MRA_SEVERITIES]} />
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
              <tr>
                <th className="text-left py-2 px-3">Exam Date</th>
                <th className="text-left py-2 px-3">Agency</th>
                <th className="text-left py-2 px-3">Category</th>
                <th className="text-left py-2 px-3">Title</th>
                <th className="text-left py-2 px-3">Severity</th>
                <th className="text-left py-2 px-3">Status</th>
                <th className="text-left py-2 px-3">Target</th>
                <th className="text-left py-2 px-3">Overdue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.length === 0 && (
                <tr><td colSpan={8} className="py-6 text-center text-slate-400 italic">No MRAs recorded.</td></tr>
              )}
              {items.map(m => {
                const overdueDays = m.target_date && new Date(m.target_date) < new Date() && m.status !== 'verified_closed' && m.status !== 'remediated'
                  ? Math.floor((Date.now() - new Date(m.target_date).getTime()) / 86400000)
                  : null;
                return (
                  <tr key={m.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setSelected(m)}>
                    <td className="px-3 py-2">{m.exam_date ? new Date(m.exam_date).toLocaleDateString() : '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{m.examiner_agency}</td>
                    <td className="px-3 py-2">
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                        {m.category}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-navy-900 font-medium">{m.title}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        m.severity === 'mria' ? 'bg-red-100 text-red-700'
                        : m.severity === 'violation' ? 'bg-red-100 text-red-700'
                        : m.severity === 'mra' ? 'bg-amber-100 text-amber-800'
                        : 'bg-slate-100 text-slate-600'
                      }`}>
                        {m.severity?.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        m.status === 'verified_closed' ? 'bg-green-100 text-green-700'
                        : m.status === 'remediated' ? 'bg-blue-100 text-blue-700'
                        : m.status === 'in_progress' ? 'bg-amber-100 text-amber-800'
                        : 'bg-red-100 text-red-700'
                      }`}>
                        {m.status?.replace('_', ' ').toUpperCase()}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{m.target_date ? new Date(m.target_date).toLocaleDateString() : '—'}</td>
                    <td className={`px-3 py-2 ${overdueDays != null ? 'text-red-700 font-semibold' : 'text-slate-400'}`}>
                      {overdueDays != null ? `${overdueDays}d` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {createOpen && <MraCreateModal onClose={() => setCreateOpen(false)} onSaved={() => { setCreateOpen(false); load(); }} />}
      {selected && <MraDetailModal mra={selected} onClose={() => setSelected(null)} onSaved={() => { setSelected(null); load(); }} />}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <div className="text-xs text-slate-600">
      <span className="mr-1">{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-xs border border-slate-200 rounded px-2 py-1 bg-white"
      >
        {options.map(o => (
          <option key={o} value={o}>{o === '' ? 'All' : o.replace('_', ' ')}</option>
        ))}
      </select>
    </div>
  );
}

function MraCreateModal({ onClose, onSaved }) {
  const { push } = useToast();
  const [form, setForm] = useState({
    examDate: '',
    examinerAgency: '',
    category: 'OTHER',
    title: '',
    description: '',
    severity: 'mra',
    targetDate: '',
    mraReference: ''
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      await api.post('/exam-readiness/mras', form);
      push('MRA created.', 'success', 2500);
      onSaved();
    } catch (e) {
      push(`Save failed: ${e?.response?.data?.error || e.message}`, 'error', 5000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Add Matter Requiring Attention" onClose={onClose}>
      <div className="space-y-3">
        <Labeled label="Exam date *">
          <input type="date" value={form.examDate} onChange={(e) => set('examDate', e.target.value)} className="w-full text-sm border border-slate-200 rounded-md px-3 py-1.5" />
        </Labeled>
        <Labeled label="Examiner agency *">
          <input type="text" value={form.examinerAgency} onChange={(e) => set('examinerAgency', e.target.value)} placeholder="OCC / FDIC / Federal Reserve / State DFI" className="w-full text-sm border border-slate-200 rounded-md px-3 py-1.5" />
        </Labeled>
        <Labeled label="MRA reference">
          <input type="text" value={form.mraReference} onChange={(e) => set('mraReference', e.target.value)} placeholder="Examiner-supplied reference" className="w-full text-sm border border-slate-200 rounded-md px-3 py-1.5" />
        </Labeled>
        <Labeled label="Category *">
          <select value={form.category} onChange={(e) => set('category', e.target.value)} className="w-full text-sm border border-slate-200 rounded-md px-3 py-1.5 bg-white">
            {MRA_CATEGORIES.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
          </select>
        </Labeled>
        <Labeled label="Severity *">
          <select value={form.severity} onChange={(e) => set('severity', e.target.value)} className="w-full text-sm border border-slate-200 rounded-md px-3 py-1.5 bg-white">
            {MRA_SEVERITIES.map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
          </select>
        </Labeled>
        <Labeled label="Title *">
          <input type="text" value={form.title} onChange={(e) => set('title', e.target.value)} className="w-full text-sm border border-slate-200 rounded-md px-3 py-1.5" />
        </Labeled>
        <Labeled label="Description *">
          <textarea rows={4} value={form.description} onChange={(e) => set('description', e.target.value)} className="w-full text-sm border border-slate-200 rounded-md px-3 py-2" />
        </Labeled>
        <Labeled label="Target remediation date">
          <input type="date" value={form.targetDate} onChange={(e) => set('targetDate', e.target.value)} className="w-full text-sm border border-slate-200 rounded-md px-3 py-1.5" />
        </Labeled>
      </div>
      <div className="flex items-center justify-end gap-2 mt-4">
        <button type="button" onClick={onClose} className="text-xs px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50">Cancel</button>
        <button type="button" onClick={save} disabled={saving} className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
          {saving ? 'Saving…' : 'Save MRA'}
        </button>
      </div>
    </ModalShell>
  );
}

function MraDetailModal({ mra, onClose, onSaved }) {
  const { push } = useToast();
  const [status, setStatus] = useState(mra.status);
  const [notes, setNotes] = useState(mra.remediation_notes || '');
  const [remediatedDate, setRemediatedDate] = useState(mra.remediated_date || '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/exam-readiness/mras/${mra.id}`, {
        status,
        remediationNotes: notes,
        remediatedDate: remediatedDate || null
      });
      push('MRA updated.', 'success', 2500);
      onSaved();
    } catch (e) {
      push(`Save failed: ${e?.response?.data?.error || e.message}`, 'error', 5000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title={mra.title} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <div className="text-xs text-slate-500">
          {mra.examiner_agency} · {new Date(mra.exam_date).toLocaleDateString()} · {mra.category} · {(mra.severity || '').toUpperCase()}
        </div>
        <div className="text-sm text-slate-800 whitespace-pre-wrap">{mra.description}</div>
        <div className="border-t border-slate-200 pt-3 space-y-3">
          <Labeled label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full text-sm border border-slate-200 rounded-md px-3 py-1.5 bg-white">
              {MRA_STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ').toUpperCase()}</option>)}
            </select>
          </Labeled>
          <Labeled label="Remediation notes">
            <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full text-sm border border-slate-200 rounded-md px-3 py-2" />
          </Labeled>
          <Labeled label="Remediated date">
            <input type="date" value={remediatedDate} onChange={(e) => setRemediatedDate(e.target.value)} className="w-full text-sm border border-slate-200 rounded-md px-3 py-1.5" />
          </Labeled>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 mt-4">
        <button type="button" onClick={onClose} className="text-xs px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50">Cancel</button>
        <button type="button" onClick={save} disabled={saving} className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </ModalShell>
  );
}

function ModalShell({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <h2 className="text-sm font-bold text-navy-900">{title}</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={16} />
          </button>
        </div>
        <div className="p-4">
          {children}
        </div>
      </div>
    </div>
  );
}
