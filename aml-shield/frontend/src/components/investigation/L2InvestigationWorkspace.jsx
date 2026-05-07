import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../../api/client.js';
import Badge from '../shared/Badge.jsx';
import { useRole } from '../../state/RoleContext.jsx';
import { useRoleNavigate } from '../../state/useRoleNavigate.js';
import { useInvestigationTabs } from '../../state/InvestigationTabsContext.jsx';
import { useToast } from '../../state/ToastContext.jsx';
import { KycProfileBlock } from './InvestigationWorkspace.jsx';
import {
  AlertCircle, Filter, FileText, MessageSquare, FolderOpen, ListChecks,
  User, Briefcase, ClipboardList, Link2, Upload, Trash2, Download, Eye, X,
  ShieldAlert, Send, Loader2, Clock, ArrowUpRight, AlertTriangle, RotateCcw,
  CheckCircle2, Activity, BarChart3, Users, Network, Sparkles, MinusCircle
} from 'lucide-react';

const usd = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Reduce an /ofac/results response into a small summary the counterparty
// table can render inline: { status, top_score, top_sdn }.
function summarizeOfac(data) {
  if (!data) return { status: 'not_screened' };
  const top = (data.results || []).find(r => r.status === 'pending' || r.status === 'confirmed');
  return {
    status: data.status,
    top_score: top?.match_score || null,
    top_sdn: top?.sdn_name || null
  };
}

// Each ticked factor adds exactly +10 to the score. With 10 factors, the
// score lands on a 0..100 grid (multiples of 10) — checkboxes are the only
// driver of the score; there is no manual slider.
const RISK_FACTOR_WEIGHT = 10;
const RISK_FACTORS = [
  { k: 'structuring',            label: 'Structuring pattern confirmed' },
  { k: 'high_risk_jurisdiction', label: 'High risk jurisdiction involvement' },
  { k: 'watchlist',              label: 'Watchlist / sanctions match' },
  { k: 'inconsistent_purpose',   label: 'Inconsistent with stated business purpose' },
  { k: 'rapid_movement',         label: 'Rapid movement of funds' },
  { k: 'shell_company',          label: 'Shell company involvement' },
  { k: 'pep',                    label: 'PEP connection' },
  { k: 'prior_sar',              label: 'Prior SAR history' },
  { k: 'unexplained_wealth',     label: 'Unexplained wealth' },
  { k: 'uncooperative',          label: 'Uncooperative with information requests' }
].map(f => ({ ...f, weight: RISK_FACTOR_WEIGHT }));

function riskBand(score) {
  if (score <= 30) return { label: 'Low', cls: 'text-green-700', bg: 'bg-green-100', track: 'bg-green-500' };
  if (score <= 60) return { label: 'Medium', cls: 'text-orange-700', bg: 'bg-orange-100', track: 'bg-orange-500' };
  if (score <= 80) return { label: 'High', cls: 'text-red-700', bg: 'bg-red-100', track: 'bg-red-500' };
  return { label: 'Critical', cls: 'text-red-900 animate-pulse', bg: 'bg-red-200', track: 'bg-red-700' };
}

export default function L2InvestigationWorkspace({ l2CaseId, alertId }) {
  const { isManager, currentAnalyst } = useRole();
  const [l2, setL2] = useState(null);
  const [loading, setLoading] = useState(true);
  const [leftTab, setLeftTab] = useState('summary');
  const [rightTab, setRightTab] = useState('kyc');
  const [riskScore, setRiskScore] = useState(0);
  const [riskFactors, setRiskFactors] = useState({});
  const [tabsVisited, setTabsVisited] = useState(new Set());

  // Track tabs visited for the decision checklist
  useEffect(() => {
    setTabsVisited(prev => new Set(prev).add(leftTab));
  }, [leftTab]);
  useEffect(() => {
    setTabsVisited(prev => new Set(prev).add('right:' + rightTab));
  }, [rightTab]);

  const reload = () => api.get(`/l2/${l2CaseId}`).then(r => {
    setL2(r.data);
    if (r.data.risk_score != null) setRiskScore(r.data.risk_score);
    if (r.data.risk_factors && typeof r.data.risk_factors === 'object') {
      const m = {};
      const arr = Array.isArray(r.data.risk_factors) ? r.data.risk_factors : Object.keys(r.data.risk_factors).filter(k => r.data.risk_factors[k]);
      for (const k of arr) m[k] = true;
      setRiskFactors(m);
    }
  });

  useEffect(() => {
    setLoading(true);
    reload().finally(() => setLoading(false));
  }, [l2CaseId]);

  // Recompute live risk score from selected factors
  useEffect(() => {
    const total = RISK_FACTORS.reduce((s, f) => s + (riskFactors[f.k] ? f.weight : 0), 0);
    setRiskScore(total);
  }, [riskFactors]);

  // Save risk score / factors (debounced) — only when L2 owns this case
  const isOwner = l2?.assigned_to === currentAnalyst;
  useEffect(() => {
    if (!isOwner || !l2) return;
    const t = setTimeout(() => {
      api.patch(`/l2/${l2CaseId}/risk-score`, {
        risk_score: riskScore,
        risk_factors: Object.keys(riskFactors).filter(k => riskFactors[k])
      }).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [riskScore, riskFactors, l2CaseId, isOwner, l2]);

  if (loading || !l2) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 size={18} className="animate-spin mr-2" /> Loading L2 workspace…
      </div>
    );
  }

  const readOnly = isManager || !isOwner;

  return (
    <div className="flex flex-col gap-3 min-w-0">
      <L2Header l2={l2} readOnly={readOnly} />
      <div className="flex gap-4 min-w-0 h-[calc(100vh-260px)]">
        <section className="flex-[0.65] min-w-0 bg-white rounded-lg border-2 border-purple-200 shadow-sm flex flex-col overflow-hidden">
          <LeftTabBar tab={leftTab} onChange={setLeftTab} />
          <div className="flex-1 min-h-0 overflow-y-auto">
            {leftTab === 'summary'      && <L1SummaryTab alertId={alertId} l2CaseId={l2CaseId} />}
            {leftTab === 'transactions' && <TransactionsTab l2={l2} alertId={alertId} l2CaseId={l2CaseId} />}
            {leftTab === 'deep'         && <DeepAnalysisTab l2={l2} l2CaseId={l2CaseId} riskScore={riskScore} riskFactors={riskFactors} setRiskFactors={setRiskFactors} readOnly={readOnly} />}
            {leftTab === 'notes'        && <L2NotesTab l2={l2} l2CaseId={l2CaseId} readOnly={readOnly} />}
            {leftTab === 'documents'    && <DocumentsTab l2={l2} alertId={alertId} l2CaseId={l2CaseId} readOnly={readOnly} />}
            {leftTab === 'activity'     && <ActivityLogTab alertId={alertId} l2CaseId={l2CaseId} />}
          </div>
        </section>
        <section className="flex-[0.35] min-w-0 bg-white rounded-lg border-2 border-purple-200 shadow-sm flex flex-col overflow-hidden">
          <RightTabBar tab={rightTab} onChange={setRightTab} />
          <div className="flex-1 min-h-0 overflow-y-auto">
            {rightTab === 'kyc'      && <CustomerKycTab customerId={l2.customer_id} />}
            {rightTab === 'business' && <BusinessTab    customerId={l2.customer_id} />}
            {rightTab === 'alerts'   && <AlertHistoryTab customerId={l2.customer_id} />}
            {rightTab === 'sars'     && <SarHistoryTab   customerId={l2.customer_id} />}
            {rightTab === 'decision' && (
              <DecisionTab
                l2={l2}
                riskScore={riskScore}
                tabsVisited={tabsVisited}
                readOnly={readOnly}
                onChanged={reload}
              />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────── header

function L2Header({ l2, readOnly }) {
  return (
    <div className="bg-purple-50 border-2 border-purple-300 rounded-md px-4 py-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-purple-600 flex items-center justify-center text-white">
            <ShieldAlert size={20} />
          </div>
          <div>
            <div className="text-purple-900 font-bold flex items-center gap-2">
              L2 Investigation · {l2.l2_case_id}
              <Badge value={l2.priority || 'Medium'} />
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${
                l2.status?.startsWith('Decision Made') ? 'bg-slate-200 text-slate-700'
                  : l2.status === 'Returned to L1' ? 'bg-yellow-100 text-yellow-700'
                  : 'bg-purple-200 text-purple-800'
              }`}>{l2.status}</span>
            </div>
            <div className="text-xs text-slate-600">
              {l2.customer_name} · {l2.scenario} · escalated by <span className="font-medium">{l2.escalated_by}</span> on {l2.escalated_at?.slice(0, 10)}
              {l2.assigned_to && <> · L2 owner: <span className="font-medium text-purple-700">{l2.assigned_to}</span></>}
            </div>
          </div>
        </div>
        {readOnly && (
          <div className="text-xs text-purple-700 italic bg-white border border-purple-300 rounded px-2 py-1">
            Read-only view
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────── tab bars

function LeftTabBar({ tab, onChange }) {
  const items = [
    { k: 'summary',      label: 'L1 Summary',     icon: ClipboardList },
    { k: 'transactions', label: 'Transactions',   icon: FileText },
    { k: 'deep',         label: 'Deep Analysis',  icon: Network },
    { k: 'notes',        label: 'L2 Notes',       icon: MessageSquare },
    { k: 'documents',    label: 'Documents',      icon: FolderOpen },
    { k: 'activity',     label: 'Activity Log',   icon: ListChecks }
  ];
  return (
    <div className="flex border-b border-purple-200 bg-purple-50/40">
      {items.map(it => {
        const Icon = it.icon;
        const active = tab === it.k;
        return (
          <button key={it.k} onClick={() => onChange(it.k)}
            className={`px-4 py-2.5 text-xs font-medium inline-flex items-center gap-1.5 border-b-2 ${
              active ? 'text-purple-700 border-purple-600 bg-white' : 'text-slate-600 border-transparent hover:text-purple-700'
            }`}>
            <Icon size={14} /> {it.label}
          </button>
        );
      })}
    </div>
  );
}

function RightTabBar({ tab, onChange }) {
  const items = [
    { k: 'kyc',      label: 'Customer KYC', icon: User },
    { k: 'business', label: 'Business',     icon: Briefcase },
    { k: 'alerts',   label: 'Alert History',icon: AlertCircle },
    { k: 'sars',     label: 'SAR History',  icon: FileText },
    { k: 'decision', label: 'L2 Decision',  icon: ShieldAlert, accent: true }
  ];
  return (
    <div className="flex border-b border-purple-200 bg-purple-50/40">
      {items.map(it => {
        const Icon = it.icon;
        const active = tab === it.k;
        const accent = it.accent;
        return (
          <button key={it.k} onClick={() => onChange(it.k)}
            className={`flex-1 px-2 py-2.5 text-xs font-medium inline-flex items-center justify-center gap-1 border-b-2 ${
              active
                ? (accent ? 'text-red-600 border-red-600 bg-white' : 'text-purple-700 border-purple-600 bg-white')
                : 'text-slate-600 border-transparent hover:text-purple-700'
            }`}>
            <Icon size={13} /> {it.label}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────── L1 SUMMARY TAB

function L1SummaryTab({ alertId, l2CaseId }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get(`/l2/l1-summary/${alertId}`).then(r => setData(r.data));
  }, [alertId]);
  if (!data) return <div className="p-8 text-slate-400 text-sm">Loading L1 summary…</div>;
  const { alert, l1_analyst, time_spent_days, final_disposition, notes, documents, checklist, escalation_reason } = data;
  const initials = (l1_analyst || '?').split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="p-5 space-y-5 text-sm">
      {/* Section 1 — L1 investigation summary */}
      <Section title="L1 Investigation Summary" icon={ClipboardList}>
        <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded p-3">
          <div className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold">
            {initials}
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-navy-900">{l1_analyst || 'Unassigned L1'}</div>
            <div className="text-xs text-slate-600">L1 Analyst · T1 Monitoring</div>
            <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
              <div><span className="text-slate-500">Assigned:</span> {alert.created_date}</div>
              <div><span className="text-slate-500">Escalated:</span> {alert.escalated_to_l2_at?.slice(0, 10) || '—'}</div>
              <div><span className="text-slate-500">Time on case:</span> <span className="font-semibold">{time_spent_days != null ? `${time_spent_days}d` : '—'}</span></div>
              <div><span className="text-slate-500">Final action:</span> <span className="font-medium text-purple-700">{final_disposition || 'Escalated to L2'}</span></div>
            </div>
          </div>
        </div>
      </Section>

      {/* Section 5 — escalation reason */}
      <Section title="Escalation Reason" icon={ArrowUpRight}>
        <div className="bg-purple-50 border border-purple-200 rounded p-3 text-purple-900">
          <div className="text-xs text-purple-600 mb-1">Why did L1 escalate this?</div>
          <div className="whitespace-pre-wrap text-sm">{escalation_reason || <span className="italic text-slate-500">No reason provided</span>}</div>
        </div>
      </Section>

      {/* Section 4 — checklist */}
      <Section title="L1 Checklist Completion" icon={CheckCircle2}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">
          {[
            ['transactions_reviewed', 'Transactions reviewed'],
            ['customer_kyc_checked',  'Customer KYC checked'],
            ['notes_added',           'Notes added'],
            ['documents_uploaded',    'Documents uploaded'],
            ['counterparty_research', 'Counterparty research']
          ].map(([k, l]) => (
            <div key={k} className={`flex items-center gap-2 px-2 py-1.5 rounded border ${checklist[k] ? 'bg-green-50 border-green-200 text-green-800' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
              {checklist[k] ? <CheckCircle2 size={13} /> : <MinusCircle size={13} />}
              <span>{l}</span>
            </div>
          ))}
        </div>
        <div className="text-xs text-slate-500 italic mt-2">
          Gaps highlight where L2 should focus the investigation.
        </div>
      </Section>

      {/* Section 2 — L1 notes (read-only) */}
      <Section title={`Investigation Notes from ${l1_analyst || 'L1'} (${notes.length})`} icon={MessageSquare}>
        {notes.length === 0
          ? <div className="text-xs text-slate-400 italic">No notes recorded by L1.</div>
          : (
            <ol className="relative border-l-2 border-blue-200 ml-2 space-y-3">
              {notes.map(n => (
                <li key={n.id} className="ml-4">
                  <div className="absolute -left-[7px] w-3 h-3 rounded-full bg-blue-500 mt-1" />
                  <div className="text-xs text-slate-500">{n.timestamp} · <span className="font-medium text-navy-900">{n.analyst}</span></div>
                  <div className="text-sm text-slate-800 mt-0.5 whitespace-pre-wrap bg-slate-50 border border-slate-100 rounded p-2">{n.note_text}</div>
                </li>
              ))}
            </ol>
          )}
        <div className="text-[11px] text-slate-400 italic mt-2">L2 cannot edit L1 notes</div>
      </Section>

      {/* Section 3 — L1 documents (read-only list) */}
      <Section title={`Evidence collected by ${l1_analyst || 'L1'} (${documents.length})`} icon={FolderOpen}>
        {documents.length === 0
          ? <div className="text-xs text-slate-400 italic">No documents uploaded by L1.</div>
          : (
            <div className="space-y-1.5">
              {documents.map(d => (
                <div key={d.id} className="flex items-center justify-between text-xs border border-slate-200 bg-white rounded px-2 py-1.5">
                  <div className="min-w-0">
                    <div className="font-medium text-navy-900 truncate">{d.file_name}</div>
                    <div className="text-[10px] text-slate-500">{d.document_type} · {d.uploaded_by} · {d.uploaded_at}</div>
                  </div>
                  <a href={`/api/case-documents/file/${d.id}`} className="text-blue-600 hover:underline shrink-0 flex items-center gap-1">
                    <Download size={11} /> View
                  </a>
                </div>
              ))}
            </div>
          )}
      </Section>
    </div>
  );
}

// ─────────────────────────────────────────────── TRANSACTIONS TAB

function TransactionsTab({ l2, alertId, l2CaseId }) {
  const [data, setData] = useState(null);
  const [patterns, setPatterns] = useState([]);
  const [filters, setFilters] = useState({
    from: ymd(addDays(new Date(), -365)), to: '', txn_type: '', alerted_only: false
  });

  const fetchTxns = () => {
    const params = {};
    for (const k of ['from', 'to', 'txn_type']) if (filters[k]) params[k] = filters[k];
    if (filters.alerted_only) params.alerted_only = 1;
    api.get(`/alerts/${alertId}/transactions`, { params }).then(r => setData(r.data));
  };
  useEffect(() => { fetchTxns(); }, [alertId, filters.from, filters.to, filters.txn_type, filters.alerted_only]);

  useEffect(() => {
    api.get(`/l2/${l2CaseId}/patterns`).then(r => setPatterns(r.data.patterns || []));
  }, [l2CaseId]);

  if (!data) return <div className="p-8 text-slate-400 text-sm">Loading transactions…</div>;

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2 text-xs">
        <Filter size={12} className="text-slate-400" />
        <input type="date" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))}
          className="border border-slate-200 rounded px-2 py-1" />
        <span className="text-slate-400">to</span>
        <input type="date" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))}
          className="border border-slate-200 rounded px-2 py-1" />
        <select value={filters.txn_type} onChange={e => setFilters(f => ({ ...f, txn_type: e.target.value }))}
          className="border border-slate-200 rounded px-2 py-1 bg-white">
          <option value="">All types</option><option>Credit</option><option>Debit</option>
        </select>
        <label className="inline-flex items-center gap-1 ml-auto cursor-pointer">
          <input type="checkbox" checked={filters.alerted_only}
            onChange={e => setFilters(f => ({ ...f, alerted_only: e.target.checked }))} />
          Alerted only
        </label>
        <span className="text-purple-700 font-medium ml-2">L2 default: 12 months</span>
      </div>

      {patterns.length > 0 && (
        <div className="px-5 py-3 border-b border-slate-100 bg-yellow-50/60 space-y-2">
          {patterns.map((p, i) => (
            <div key={i} className="flex items-start gap-2 text-xs bg-yellow-100 border border-yellow-300 rounded px-3 py-2">
              <Sparkles size={14} className="text-yellow-700 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="text-[10px] font-bold text-yellow-800 uppercase tracking-wider">
                  Auto-Detected Pattern ⚠️ · {p.kind}
                </div>
                <div className="text-yellow-900 mt-0.5">{p.message}</div>
              </div>
              <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ml-auto ${
                p.severity === 'high' ? 'bg-red-200 text-red-800' : 'bg-orange-200 text-orange-800'
              }`}>{p.severity}</span>
            </div>
          ))}
        </div>
      )}

      <div className="px-5 py-2 border-b border-slate-100 bg-red-50/40 text-xs text-slate-700 flex flex-wrap gap-x-4 gap-y-1">
        <span>{data.summary.shown} transactions shown</span>
        <span className="text-red-600 font-medium">{data.summary.alerted_count} alerted</span>
        <span>Total alerted: <span className="font-semibold text-red-700">{usd(data.summary.alerted_total_amount)}</span></span>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Date</th>
              <th className="px-2 py-2 text-left font-semibold">Type</th>
              <th className="px-2 py-2 text-left font-semibold">Channel</th>
              <th className="px-3 py-2 text-left font-semibold">Description / Counterparty</th>
              <th className="px-3 py-2 text-right font-semibold">Amount</th>
              <th className="px-2 py-2 text-left font-semibold">Country</th>
              <th className="px-2 py-2 text-left font-semibold">Flag</th>
            </tr>
          </thead>
          <tbody>
            {data.transactions.map(t => {
              const isAlerted = !!t.is_alerted;
              return (
                <tr key={t.transaction_id}
                  className={`border-b border-slate-100 ${isAlerted ? 'bg-red-50/60 border-l-4 border-l-red-500' : ''}`}>
                  <td className="px-3 py-2 whitespace-nowrap">{t.txn_date}</td>
                  <td className="px-2 py-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${t.txn_type === 'Credit' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                      {t.txn_type}
                    </span>
                  </td>
                  <td className="px-2 py-2">{t.channel}</td>
                  <td className="px-3 py-2 truncate max-w-[260px]">
                    <div className="truncate">{t.description}</div>
                    <div className="text-[10px] text-slate-500 truncate">{t.counterparty}</div>
                  </td>
                  <td className={`px-3 py-2 text-right font-mono ${t.txn_type === 'Credit' ? 'text-green-700' : 'text-slate-800'}`}>
                    {t.txn_type === 'Credit' ? '+' : '−'}{usd(t.amount)}
                  </td>
                  <td className="px-2 py-2 text-[11px]">{t.counterparty_country}</td>
                  <td className="px-2 py-2">
                    {isAlerted ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-700">
                        <AlertCircle size={10} /> ALERTED
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {data.transactions.length === 0 && (
          <div className="py-12 text-center text-slate-400 text-xs">No transactions match filters</div>
        )}
      </div>
    </div>
  );
}

function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

// ─────────────────────────────────────────────── DEEP ANALYSIS TAB

function DeepAnalysisTab({ l2, l2CaseId, riskScore, riskFactors, setRiskFactors, readOnly }) {
  const [counterparties, setCounterparties] = useState([]);
  const [linked, setLinked] = useState([]);
  const [counterFlags, setCounterFlags] = useState({});
  const [ofacByCp, setOfacByCp] = useState({});      // name → { status, top_score, top_sdn }
  const [screeningCp, setScreeningCp] = useState(null); // counterparty name currently screening

  useEffect(() => {
    api.get(`/l2/${l2CaseId}/counterparties`).then(r => setCounterparties(r.data));
    api.get(`/l2/${l2CaseId}/linked-entities`).then(r => setLinked(r.data));
  }, [l2CaseId]);

  // After counterparties load, fetch any cached OFAC results for them.
  useEffect(() => {
    if (counterparties.length === 0) return;
    let cancelled = false;
    (async () => {
      const map = {};
      await Promise.all(counterparties.slice(0, 25).map(async (c) => {
        if (!c.name) return;
        try {
          const { data } = await api.get(`/ofac/results/counterparty/${encodeURIComponent(c.name)}`);
          map[c.name] = summarizeOfac(data);
        } catch (_e) { /* ignore */ }
      }));
      if (!cancelled) setOfacByCp(prev => ({ ...prev, ...map }));
    })();
    return () => { cancelled = true; };
  }, [counterparties]);

  const screenCounterparty = async (name) => {
    if (!name) return;
    setScreeningCp(name);
    try {
      const { data } = await api.post(
        `/ofac/screen/counterparty/${encodeURIComponent(name)}`,
        { name }
      );
      const { data: results } = await api.get(`/ofac/results/counterparty/${encodeURIComponent(name)}`);
      setOfacByCp(prev => ({ ...prev, [name]: summarizeOfac(results) }));
      // If matches found, also auto-set the manual flag to "Watchlist Match"
      if (data.match_count > 0) {
        const cp = counterparties.find(c => c.name === name);
        if (cp) setCounterFlags(prev => ({ ...prev, [`${name}__${cp.country}`]: 'Watchlist Match' }));
      }
    } catch (_e) { /* swallow — cell will keep prior state */ }
    finally { setScreeningCp(null); }
  };

  const band = riskBand(riskScore);

  return (
    <div className="p-5 space-y-6 text-sm">
      {/* SECTION 4 — Risk Scoring (top so it's visible while user reviews) */}
      <Section title="Risk Scoring" icon={BarChart3}>
        <div className="bg-white border border-purple-200 rounded p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Overall Risk Score</div>
            <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded ${band.bg} ${band.cls}`}>
              {band.label}
            </span>
          </div>
          <div className="flex items-end gap-3">
            <div className={`text-4xl font-bold ${band.cls}`}>{riskScore}</div>
            <div className="text-xs text-slate-500 mb-1">/ 100</div>
          </div>
          <div className="mt-2 h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className={`h-full ${band.track}`} style={{ width: `${Math.min(100, riskScore)}%` }} />
          </div>
          <div className="text-[10px] text-slate-500 mt-1">
            0–30 Low · 31–60 Medium · 61–80 High · 81–100 Critical
          </div>
        </div>
        <div className="mt-3">
          <div className="text-xs font-medium text-slate-700 mb-2">Risk Factors (each ticked factor adds +10 to the score):</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {RISK_FACTORS.map(f => (
              <label key={f.k} className={`flex items-center gap-2 px-2 py-1.5 rounded border cursor-pointer ${
                riskFactors[f.k] ? 'bg-purple-50 border-purple-300 text-purple-900' : 'bg-white border-slate-200 hover:bg-slate-50'
              } ${readOnly ? 'opacity-60 cursor-not-allowed' : ''}`}>
                <input
                  type="checkbox"
                  disabled={readOnly}
                  checked={!!riskFactors[f.k]}
                  onChange={e => setRiskFactors(prev => ({ ...prev, [f.k]: e.target.checked }))}
                />
                <span className="text-xs flex-1">{f.label}</span>
                <span className="text-[10px] text-slate-500">+{f.weight}</span>
              </label>
            ))}
          </div>
        </div>
      </Section>

      {/* SECTION 1 — Counterparty analysis */}
      <Section title={`Counterparty Analysis (${counterparties.length})`} icon={Users}>
        <div className="overflow-x-auto -mx-2">
          <table className="min-w-full text-xs">
            <thead className="border-b border-slate-200 text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="text-left py-1.5 px-2">Counterparty</th>
                <th className="text-left py-1.5 px-2">Country</th>
                <th className="text-right py-1.5 px-2">Txns</th>
                <th className="text-right py-1.5 px-2">Total</th>
                <th className="text-left py-1.5 px-2">First / Last seen</th>
                <th className="text-left py-1.5 px-2">Risk Flag</th>
                <th className="text-left py-1.5 px-2">OFAC</th>
              </tr>
            </thead>
            <tbody>
              {counterparties.slice(0, 25).map((c, i) => {
                const key = `${c.name}__${c.country}`;
                const flag = counterFlags[key] || (c.alerted_count > 0 ? 'Suspicious' : 'Clear');
                const ofac = ofacByCp[c.name] || { status: 'not_screened' };
                const isMatch = ofac.status === 'pending' || ofac.status === 'confirmed';
                return (
                  <tr key={i} className={`border-b border-slate-100 ${isMatch ? 'bg-orange-50/40' : ''}`}>
                    <td className="py-1.5 px-2 font-medium text-navy-900 truncate max-w-[220px]">{c.name}</td>
                    <td className="py-1.5 px-2">{c.country || '—'}</td>
                    <td className="py-1.5 px-2 text-right">{c.total_transactions}</td>
                    <td className="py-1.5 px-2 text-right font-mono">{usd(c.total_amount)}</td>
                    <td className="py-1.5 px-2 text-[10px] text-slate-500">
                      {c.first_seen} → {c.last_seen}
                    </td>
                    <td className="py-1.5 px-2">
                      <select
                        value={flag}
                        disabled={readOnly}
                        onChange={e => setCounterFlags(prev => ({ ...prev, [key]: e.target.value }))}
                        className={`text-[11px] border rounded px-1 py-0.5 ${
                          flag === 'Watchlist Match' ? 'bg-red-50 border-red-300 text-red-700'
                            : flag === 'High Risk' ? 'bg-orange-50 border-orange-300 text-orange-700'
                            : flag === 'Suspicious' ? 'bg-yellow-50 border-yellow-300 text-yellow-700'
                            : 'bg-green-50 border-green-300 text-green-700'
                        }`}>
                        <option>Clear</option>
                        <option>Suspicious</option>
                        <option>High Risk</option>
                        <option>Watchlist Match</option>
                      </select>
                    </td>
                    <td className="py-1.5 px-2">
                      <CounterpartyOfacCell
                        ofac={ofac}
                        isScreening={screeningCp === c.name}
                        onScreen={() => screenCounterparty(c.name)}
                        disabled={readOnly}
                      />
                    </td>
                  </tr>
                );
              })}
              {counterparties.length === 0 && (
                <tr><td colSpan={7} className="py-6 text-center text-slate-400">No counterparty activity</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      {/* SECTION 2 — Linked entities */}
      <Section title="Linked Entities" icon={Network}>
        <div className="text-xs text-slate-500 mb-2">
          Other customers in our database who transacted with the same counterparties as {l2.customer_name}.
        </div>
        {linked.length === 0
          ? <div className="text-xs text-slate-400 italic">No linked entities found</div>
          : (
            <div className="space-y-1.5">
              {linked.slice(0, 10).map((e, i) => (
                <div key={i} className="flex items-center gap-2 text-xs border border-slate-200 rounded px-2 py-1.5 bg-white">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-navy-900 truncate">{e.customer_name}</div>
                    <div className="text-[10px] text-slate-500">Shares: {e.shared_counterparty}</div>
                  </div>
                  <Badge value={e.customer_risk_rating} />
                  <span className="text-slate-500 px-1.5 py-0.5 bg-slate-100 rounded text-[10px]">
                    {e.open_alerts} open · {e.sar_history} SAR{e.sar_history === 1 ? '' : 's'}
                  </span>
                </div>
              ))}
            </div>
          )}
      </Section>

      {/* SECTION 3 — Historical comparison (mini) */}
      <Section title="Historical Comparison" icon={Activity}>
        <HistoricalComparison customerId={l2.customer_id} />
      </Section>
    </div>
  );
}

function HistoricalComparison({ customerId }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get(`/customers/${customerId}/transactions`, { params: { months: 24 } })
      .then(r => setData(r.data))
      .catch(() => setData({ months: [] }));
  }, [customerId]);
  if (!data) return <div className="text-xs text-slate-400">Loading…</div>;
  const monthly = data.months || data; // tolerate either shape
  if (!Array.isArray(monthly) || monthly.length === 0) {
    return (
      <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded p-3">
        Historical chart will render here when monthly aggregates are available. Customer's transaction baseline is currently used to seed the pattern detector.
      </div>
    );
  }
  const max = Math.max(1, ...monthly.map(m => m.total || 0));
  return (
    <div className="grid grid-cols-12 gap-1 items-end h-24">
      {monthly.slice(-24).map((m, i) => (
        <div key={i} className="flex flex-col items-center" title={`${m.month || m.date}: ${usd(m.total)}`}>
          <div className="bg-purple-400 w-full rounded-t" style={{ height: `${Math.max(2, (m.total / max) * 80)}px` }} />
          <div className="text-[9px] text-slate-400 mt-0.5">{(m.month || '').slice(2, 7) || ''}</div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────── L2 NOTES TAB

function L2NotesTab({ l2, l2CaseId, readOnly }) {
  const { currentAnalyst } = useRole();
  const [notes, setNotes] = useState([]);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => api.get(`/l2/${l2CaseId}/notes`).then(r => setNotes(r.data));
  useEffect(() => { load(); }, [l2CaseId]);

  const save = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      await api.post(`/l2/${l2CaseId}/notes`, { note_text: draft.trim(), analyst_id: currentAnalyst });
      setDraft('');
      await load();
    } finally { setSaving(false); }
  };

  return (
    <div className="p-5 space-y-4">
      <div className="text-xs font-bold text-purple-700 bg-purple-50 border border-purple-200 rounded p-2 inline-block">
        L2 Investigation Notes — only visible to L2 and managers
      </div>
      {!readOnly && (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={5}
            placeholder="Document your L2 investigation steps — counterparty research, link analysis, customer outreach attempts, decision rationale…"
            className="w-full text-sm border border-purple-200 rounded-md p-3 focus:border-purple-500 focus:outline-none"
          />
          <div className="flex justify-end">
            <button onClick={save} disabled={saving || !draft.trim()}
              className="text-sm bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-md px-4 py-2 inline-flex items-center gap-1">
              <Send size={14} /> {saving ? 'Saving…' : 'Save L2 Note'}
            </button>
          </div>
        </div>
      )}
      <div className="border-t border-slate-100 pt-3">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
          L2 Notes Timeline ({notes.length})
        </div>
        <ol className="relative border-l-2 border-purple-200 ml-2 space-y-3">
          {notes.map(n => (
            <li key={n.id} className="ml-4">
              <div className="absolute -left-[7px] w-3 h-3 rounded-full bg-purple-500 mt-1" />
              <div className="text-xs text-slate-500">{n.created_at} · <span className="font-medium text-purple-700">{n.analyst_id || '—'}</span></div>
              <div className="text-sm text-slate-800 mt-0.5 whitespace-pre-wrap bg-purple-50/40 border border-purple-100 rounded p-2">{n.note_text}</div>
            </li>
          ))}
          {notes.length === 0 && <li className="ml-4 text-xs text-slate-400">No L2 notes yet</li>}
        </ol>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────── DOCUMENTS TAB

function DocumentsTab({ l2, alertId, l2CaseId, readOnly }) {
  const { currentAnalyst } = useRole();
  const [l1Docs, setL1Docs] = useState([]);
  const [l2Docs, setL2Docs] = useState([]);
  const [docType, setDocType] = useState('OFAC Screening');
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef();

  const loadAll = () => {
    api.get(`/case-documents/${alertId}`).then(r => setL1Docs(r.data));
    api.get(`/l2/${l2CaseId}/documents`).then(r => setL2Docs(r.data));
  };
  useEffect(() => { loadAll(); }, [alertId, l2CaseId]);

  const upload = async (file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('document_type', docType);
    fd.append('uploaded_by', currentAnalyst || '');
    setUploading(true);
    try {
      await api.post(`/l2/${l2CaseId}/documents`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      loadAll();
    } finally { setUploading(false); }
  };

  return (
    <div className="p-5 space-y-5">
      <Section title={`L1 Documents (${l1Docs.length})`} icon={FolderOpen}>
        <div className="text-xs text-slate-500 mb-2 italic">Read-only · uploaded by L1 during investigation</div>
        <div className="space-y-1.5">
          {l1Docs.map(d => (
            <div key={d.id} className="flex items-center justify-between text-xs border border-slate-200 bg-white rounded px-2 py-1.5">
              <div className="min-w-0">
                <div className="font-medium text-navy-900 truncate">{d.file_name}</div>
                <div className="text-[10px] text-slate-500">{d.document_type} · {d.uploaded_by} · {d.uploaded_at}</div>
              </div>
              <a href={`/api/case-documents/file/${d.id}`} className="text-blue-600 hover:underline shrink-0 flex items-center gap-1">
                <Download size={11} /> View
              </a>
            </div>
          ))}
          {l1Docs.length === 0 && <div className="text-xs text-slate-400 italic">No L1 documents</div>}
        </div>
      </Section>

      <Section title={`L2 Documents (${l2Docs.length})`} icon={FolderOpen}>
        {!readOnly && (
          <div className="space-y-2 mb-3">
            <div className="grid grid-cols-3 gap-2">
              <select value={docType} onChange={e => setDocType(e.target.value)}
                className="col-span-1 text-xs border border-purple-200 rounded-md px-2 py-1.5 bg-white">
                <option>OFAC Screening</option>
                <option>Adverse Media Report</option>
                <option>Corporate Registry</option>
                <option>Correspondent Bank Info</option>
                <option>Law Enforcement Referral</option>
                <option>Counterparty Research</option>
                <option>Other</option>
              </select>
              <button onClick={() => inputRef.current?.click()}
                className="col-span-2 text-xs border-2 border-dashed border-purple-300 rounded p-2 hover:bg-purple-50 inline-flex items-center justify-center gap-1 text-purple-700">
                <Upload size={12} /> {uploading ? 'Uploading…' : 'Upload to L2 evidence'}
              </button>
              <input ref={inputRef} type="file" className="hidden"
                accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx"
                onChange={e => { if (e.target.files?.[0]) upload(e.target.files[0]); e.target.value = ''; }} />
            </div>
          </div>
        )}
        <div className="space-y-1.5">
          {l2Docs.map(d => (
            <div key={d.id} className="flex items-center justify-between text-xs border border-purple-200 bg-purple-50/40 rounded px-2 py-1.5">
              <div className="min-w-0">
                <div className="font-medium text-navy-900 truncate">{d.document_name}</div>
                <div className="text-[10px] text-purple-700">{d.document_type} · {d.uploaded_by} · {d.uploaded_at}</div>
              </div>
            </div>
          ))}
          {l2Docs.length === 0 && <div className="text-xs text-slate-400 italic">No L2 documents uploaded yet</div>}
        </div>
      </Section>
    </div>
  );
}

// ─────────────────────────────────────────────── ACTIVITY LOG TAB

function ActivityLogTab({ alertId, l2CaseId }) {
  const [events, setEvents] = useState([]);
  useEffect(() => {
    Promise.all([
      api.get(`/audit-trail/${alertId}`).catch(() => ({ data: [] })),
      api.get(`/l2/${l2CaseId}/notes`),
      api.get(`/l2/l1-summary/${alertId}`)
    ]).then(([audit, notes, summary]) => {
      const ev = [];
      for (const a of audit.data || []) ev.push({
        ts: a.timestamp, kind: a.action, who: a.performed_by, detail: a.details, source: 'L1/Audit'
      });
      for (const n of notes.data || []) ev.push({
        ts: n.created_at, kind: 'L2 Note', who: n.analyst_id, detail: (n.note_text || '').slice(0, 140), source: 'L2'
      });
      const s = summary.data;
      if (s?.alert?.escalated_to_l2_at) ev.push({
        ts: s.alert.escalated_to_l2_at, kind: 'Escalated to L2', who: s.l1_analyst, detail: s.escalation_reason || '', source: 'L1'
      });
      ev.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
      setEvents(ev);
    });
  }, [alertId, l2CaseId]);

  return (
    <div className="p-5">
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Combined Activity · L1 + L2</div>
      <ol className="relative border-l-2 border-slate-200 ml-2 space-y-3">
        {events.map((e, i) => (
          <li key={i} className="ml-4">
            <div className={`absolute -left-[7px] w-3 h-3 rounded-full mt-1 ${e.source === 'L2' ? 'bg-purple-500' : 'bg-blue-500'}`} />
            <div className="text-xs font-medium text-navy-900">{e.kind}</div>
            <div className="text-[11px] text-slate-500">{e.ts} · {e.who || '—'} · <span className="italic">{e.source}</span></div>
            {e.detail && <div className="text-xs text-slate-700 mt-0.5">{e.detail}</div>}
          </li>
        ))}
        {events.length === 0 && <li className="ml-4 text-xs text-slate-400">No events</li>}
      </ol>
    </div>
  );
}

// ─────────────────────────────────────────────── RIGHT PANEL TABS

function CustomerKycTab({ customerId }) {
  const [cust, setCust] = useState(null);
  useEffect(() => { api.get(`/customers/${customerId}`).then(r => setCust(r.data)); }, [customerId]);
  if (!cust) return <div className="p-6 text-slate-400 text-sm">Loading KYC…</div>;
  return <KycProfileBlock c={cust} />;
}

function BusinessTab({ customerId }) {
  const [cust, setCust] = useState(null);
  useEffect(() => { api.get(`/customers/${customerId}`).then(r => setCust(r.data)); }, [customerId]);
  if (!cust) return <div className="p-6 text-slate-400 text-sm">Loading…</div>;
  return (
    <div className="p-4 text-sm">
      <div className="grid grid-cols-2 gap-y-1 text-xs">
        <div className="text-slate-500">Type</div><div>{cust.customer_type}</div>
        <div className="text-slate-500">Industry</div><div>{cust.industry || '—'}</div>
        <div className="text-slate-500">Business Type</div><div>{cust.business_type || '—'}</div>
        <div className="text-slate-500">Turnover</div><div>{cust.annual_turnover_range || '—'}</div>
        <div className="text-slate-500">Employees</div><div>{cust.number_of_employees || '—'}</div>
        <div className="text-slate-500">Source of Funds</div><div>{cust.source_of_funds || '—'}</div>
        <div className="text-slate-500">Source of Wealth</div><div>{cust.source_of_wealth || '—'}</div>
        <div className="text-slate-500">Expected Volume</div><div>{cust.expected_monthly_volume ? `${cust.expected_monthly_volume} txn/mo` : '—'}</div>
        <div className="text-slate-500">Expected Value</div><div>{cust.expected_monthly_value ? usd(cust.expected_monthly_value) : '—'}</div>
      </div>
    </div>
  );
}

function AlertHistoryTab({ customerId }) {
  const [items, setItems] = useState([]);
  useEffect(() => { api.get(`/customers/${customerId}/alerts`).then(r => setItems(r.data)).catch(() => {}); }, [customerId]);
  return (
    <div className="p-4 space-y-2 text-sm">
      <div className="text-xs font-semibold text-slate-500 uppercase">Alert History ({items.length})</div>
      {items.map(a => (
        <div key={a.alert_id} className="border border-slate-200 rounded p-2 text-xs">
          <div className="flex items-center justify-between">
            <div className="font-mono">{a.alert_id}</div>
            <Badge value={a.alert_status} />
          </div>
          <div className="text-slate-500 mt-0.5">{a.scenario} · {a.created_date}</div>
        </div>
      ))}
      {items.length === 0 && <div className="text-xs text-slate-400 italic">No prior alerts</div>}
    </div>
  );
}

function SarHistoryTab({ customerId }) {
  const [items, setItems] = useState([]);
  useEffect(() => { api.get(`/customers/${customerId}/sars`).then(r => setItems(r.data)).catch(() => {}); }, [customerId]);
  return (
    <div className="p-4 space-y-2 text-sm">
      <div className="text-xs font-semibold text-slate-500 uppercase">SAR History ({items.length})</div>
      <div className="text-xs text-slate-500 italic">If you escalate, this will be SAR #{items.length + 1} for this customer</div>
      {items.map(s => (
        <div key={s.sar_id} className="border border-slate-200 rounded p-2 text-xs">
          <div className="flex items-center justify-between">
            <div className="font-mono">{s.sar_id}</div>
            <Badge value={s.sar_status} />
          </div>
          <div className="text-slate-500 mt-0.5">{s.alert_scenario} · {s.filed_date || 'draft'}</div>
        </div>
      ))}
      {items.length === 0 && <div className="text-xs text-slate-400 italic">No SARs filed on this customer</div>}
    </div>
  );
}

// ─────────────────────────────────────────────── L2 DECISION TAB

function DecisionTab({ l2, riskScore, tabsVisited, readOnly, onChanged }) {
  const { currentAnalyst } = useRole();
  const { goTo } = useRoleNavigate();
  const { closeTab } = useInvestigationTabs();
  const { push } = useToast();
  const [checks, setChecks] = useState({
    notes_evidence: tabsVisited.has('summary'),
    full_history:   tabsVisited.has('transactions'),
    counterparty:   tabsVisited.has('deep'),
    kyc_profile:    tabsVisited.has('right:kyc') || tabsVisited.has('right:business'),
    sar_alert_hist: tabsVisited.has('right:alerts') || tabsVisited.has('right:sars'),
    risk_scoring:   riskScore > 0
  });
  const [modal, setModal] = useState(null);

  // Auto-update derived checkboxes as the user navigates
  useEffect(() => {
    setChecks(c => ({
      ...c,
      notes_evidence: c.notes_evidence || tabsVisited.has('summary'),
      full_history:   c.full_history   || tabsVisited.has('transactions'),
      counterparty:   c.counterparty   || tabsVisited.has('deep'),
      kyc_profile:    c.kyc_profile    || tabsVisited.has('right:kyc') || tabsVisited.has('right:business'),
      sar_alert_hist: c.sar_alert_hist || tabsVisited.has('right:alerts') || tabsVisited.has('right:sars'),
      risk_scoring:   c.risk_scoring   || riskScore > 0
    }));
  }, [tabsVisited, riskScore]);

  const allChecked = Object.values(checks).every(Boolean);
  const band = riskBand(riskScore);

  const onDecision = async (action, payload) => {
    try {
      let resp;
      if (action === 'return') resp = await api.patch(`/l2/${l2.l2_case_id}/return`, { ...payload, performed_by: currentAnalyst });
      if (action === 'close')  resp = await api.patch(`/l2/${l2.l2_case_id}/close`,  { ...payload, performed_by: currentAnalyst });
      if (action === 'sar')    resp = await api.patch(`/l2/${l2.l2_case_id}/escalate-sar`, { ...payload, performed_by: currentAnalyst });

      const messages = {
        return: 'Returned to L1 with instructions',
        close:  'Alert closed — no suspicious activity',
        sar:    'SAR case created — opening SAR Filing'
      };
      push(messages[action], 'success');
      setModal(null);
      const tabKey = `L2:${l2.l2_case_id}`;
      setTimeout(() => {
        closeTab(tabKey);
        if (action === 'sar') {
          const caseId = resp?.data?.case_id;
          if (caseId) goTo(`sar-filing/${caseId}`);
        }
      }, 1400);
    } catch (e) {
      push('Decision failed: ' + (e.response?.data?.error || e.message), 'error');
    }
  };

  if (readOnly && l2.decision) {
    return (
      <div className="p-5 space-y-3 text-sm">
        <div className="bg-slate-50 border border-slate-200 rounded p-3">
          <div className="text-xs uppercase text-slate-500">Final L2 Decision</div>
          <div className="text-base font-semibold text-navy-900 mt-1">{l2.status}</div>
          <div className="text-xs text-slate-500 mt-0.5">By {l2.decision_by || '—'} on {l2.decision_made_at?.slice(0, 10) || '—'}</div>
          {l2.return_reason && (
            <div className="mt-2 bg-yellow-50 border border-yellow-200 rounded p-2">
              <div className="text-xs font-medium">Return reason:</div>
              <div className="text-xs">{l2.return_reason}</div>
              <div className="text-xs mt-1 italic">{l2.return_instructions}</div>
            </div>
          )}
          {l2.l2_narrative && (
            <div className="mt-2 bg-slate-50 border border-slate-200 rounded p-2">
              <div className="text-xs font-medium">Narrative:</div>
              <div className="text-xs whitespace-pre-wrap">{l2.l2_narrative}</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-5 space-y-5 text-sm">
      <div className="bg-purple-50 border border-purple-200 rounded p-3">
        <div className="text-xs uppercase text-purple-700">Final L2 Risk Score</div>
        <div className="flex items-end gap-3 mt-1">
          <div className={`text-3xl font-bold ${band.cls.replace('animate-pulse', '')}`}>{riskScore}</div>
          <div className="text-xs text-slate-500 mb-1">/ 100 · <span className={`font-bold ${band.cls.replace('animate-pulse', '')}`}>{band.label}</span></div>
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
          Decision Checklist · all must be ticked
        </div>
        <div className="space-y-1">
          {[
            ['notes_evidence', 'Reviewed all L1 notes and evidence'],
            ['full_history',   'Reviewed full transaction history'],
            ['counterparty',   'Completed counterparty analysis'],
            ['kyc_profile',    'Reviewed customer KYC profile'],
            ['sar_alert_hist', 'Checked prior SAR/alert history'],
            ['risk_scoring',   'Completed risk scoring']
          ].map(([k, l]) => (
            <label key={k} className={`flex items-center gap-2 px-2 py-1.5 rounded border cursor-pointer text-xs ${
              checks[k] ? 'bg-green-50 border-green-200 text-green-800' : 'bg-slate-50 border-slate-200'
            }`}>
              <input type="checkbox" checked={checks[k]} onChange={e => setChecks(c => ({ ...c, [k]: e.target.checked }))} />
              {checks[k] ? <CheckCircle2 size={13} className="text-green-600" /> : <MinusCircle size={13} className="text-slate-400" />}
              <span className="flex-1">{l}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">L2 Decision</div>
        <div className="flex flex-col gap-2">
          <button
            disabled={!allChecked || readOnly}
            onClick={() => setModal('return')}
            className="text-sm font-medium bg-yellow-500 hover:bg-yellow-600 disabled:opacity-40 text-white rounded-md px-3 py-2 inline-flex items-center justify-center gap-1"
          >
            <RotateCcw size={14} /> Return to L1
          </button>
          <button
            disabled={!allChecked || readOnly}
            onClick={() => setModal('close')}
            className="text-sm font-medium bg-slate-500 hover:bg-slate-600 disabled:opacity-40 text-white rounded-md px-3 py-2 inline-flex items-center justify-center gap-1"
          >
            <X size={14} /> Close — No Suspicious Activity
          </button>
          <button
            disabled={!allChecked || readOnly}
            onClick={() => setModal('sar')}
            className="text-sm font-medium bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white rounded-md px-3 py-2 inline-flex items-center justify-center gap-1"
          >
            <ShieldAlert size={14} /> Escalate to SAR Filing
          </button>
          {!allChecked && (
            <div className="text-[11px] text-slate-500 italic mt-1">
              Tick every checklist item to unlock the decision buttons.
            </div>
          )}
        </div>
      </div>

      {modal === 'return' && <ReturnModal onCancel={() => setModal(null)} onSubmit={(p) => onDecision('return', p)} />}
      {modal === 'close'  && <CloseModal  onCancel={() => setModal(null)} onSubmit={(p) => onDecision('close', p)} />}
      {modal === 'sar'    && <SarModal    l2={l2} onCancel={() => setModal(null)} onSubmit={(p) => onDecision('sar', p)} />}
    </div>
  );
}

function ReturnModal({ onCancel, onSubmit }) {
  const [reason, setReason] = useState('Additional Information Needed');
  const [instructions, setInstructions] = useState('');
  const ready = instructions.trim().length >= 10;
  return (
    <ModalShell title="Return alert to L1" tone="yellow" onCancel={onCancel}>
      <div className="p-5 space-y-3">
        <div>
          <label className="text-xs font-semibold">Reason</label>
          <select value={reason} onChange={e => setReason(e.target.value)}
            className="mt-1 w-full text-sm border border-slate-200 rounded px-2 py-1.5">
            <option>Additional Information Needed</option>
            <option>Further Customer Research Required</option>
            <option>Transaction Pattern Needs Clarification</option>
            <option>Other</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold">Instructions for L1 <span className="text-red-500">*</span></label>
          <textarea value={instructions} onChange={e => setInstructions(e.target.value)} rows={5}
            placeholder="Tell L1 specifically what they need to do (min 10 chars)…"
            className="mt-1 w-full text-sm border border-slate-200 rounded p-2" />
        </div>
      </div>
      <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
        <button onClick={onCancel} className="text-sm border border-slate-300 rounded px-3 py-1.5 hover:bg-slate-50">Cancel</button>
        <button disabled={!ready} onClick={() => onSubmit({ reason, instructions: instructions.trim() })}
          className="text-sm bg-yellow-500 hover:bg-yellow-600 disabled:opacity-50 text-white rounded px-3 py-1.5">
          Confirm &amp; Return
        </button>
      </div>
    </ModalShell>
  );
}

function CloseModal({ onCancel, onSubmit }) {
  const [narrative, setNarrative] = useState('');
  const ready = narrative.trim().length >= 150;
  return (
    <ModalShell title="Close — no suspicious activity" tone="slate" onCancel={onCancel}>
      <div className="p-5 space-y-3">
        <div className="text-sm text-slate-600">
          This closes the alert as not suspicious. The narrative is logged to the audit trail.
        </div>
        <div>
          <label className="text-xs font-semibold">Closing narrative <span className="text-red-500">*</span> <span className="text-slate-500 font-normal">(min 150 chars · {narrative.length})</span></label>
          <textarea value={narrative} onChange={e => setNarrative(e.target.value)} rows={6}
            placeholder="Explain why this is not suspicious — what evidence supports the conclusion, what was verified, why the pattern is consistent with the customer's profile."
            className="mt-1 w-full text-sm border border-slate-200 rounded p-2" />
        </div>
      </div>
      <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
        <button onClick={onCancel} className="text-sm border border-slate-300 rounded px-3 py-1.5 hover:bg-slate-50">Cancel</button>
        <button disabled={!ready} onClick={() => onSubmit({ narrative: narrative.trim() })}
          className="text-sm bg-slate-600 hover:bg-slate-700 disabled:opacity-50 text-white rounded px-3 py-1.5">
          Confirm Close
        </button>
      </div>
    </ModalShell>
  );
}

function SarModal({ l2, onCancel, onSubmit }) {
  const [priority, setPriority] = useState('Standard');
  const [summary, setSummary] = useState(l2.l2_narrative || '');
  const ready = summary.trim().length >= 30;
  return (
    <ModalShell title="Escalate to SAR Filing" tone="red" onCancel={onCancel}>
      <div className="p-5 space-y-3">
        <div className="text-sm text-slate-600">
          A SAR case will be created and assigned to <span className="font-medium">{l2.assigned_to}</span>. You'll be redirected to the SAR Filing wizard.
        </div>
        <div>
          <label className="text-xs font-semibold">SAR Priority</label>
          <select value={priority} onChange={e => setPriority(e.target.value)}
            className="mt-1 w-full text-sm border border-slate-200 rounded px-2 py-1.5">
            <option>Standard</option><option>Urgent</option><option>Immediate</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold">Summary of findings <span className="text-red-500">*</span></label>
          <textarea value={summary} onChange={e => setSummary(e.target.value)} rows={6}
            placeholder="Pre-filled from L2 notes. Edit before creating the SAR case."
            className="mt-1 w-full text-sm border border-slate-200 rounded p-2" />
        </div>
      </div>
      <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
        <button onClick={onCancel} className="text-sm border border-slate-300 rounded px-3 py-1.5 hover:bg-slate-50">Cancel</button>
        <button disabled={!ready} onClick={() => onSubmit({ sar_priority: priority, summary: summary.trim() })}
          className="text-sm bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded px-3 py-1.5">
          Create SAR Case &amp; Proceed
        </button>
      </div>
    </ModalShell>
  );
}

// ─────────────────────────────────────────────── shared

function ModalShell({ title, tone = 'blue', children, onCancel }) {
  const ring = {
    blue:   'ring-blue-200',
    red:    'ring-red-200',
    yellow: 'ring-yellow-200',
    slate:  'ring-slate-200'
  }[tone] || 'ring-slate-200';
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className={`bg-white rounded-lg shadow-xl w-full max-w-md ring-2 ${ring}`} onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <div className="text-sm font-semibold text-navy-900">{title}</div>
          <button onClick={onCancel} className="p-1 rounded hover:bg-slate-100"><X size={14} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Section({ title, icon: Icon, children }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
        {Icon && <Icon size={12} />}
        {title}
      </div>
      {children}
    </div>
  );
}

// Inline OFAC cell for the counterparty table — shows the cached status
// (or a Screen button if never screened) plus a "rescreen" affordance
// once a result exists. Heavy review/confirm UX lives in the customer
// KYC panel; counterparty-level decisions are escalated there.
function CounterpartyOfacCell({ ofac, isScreening, onScreen, disabled }) {
  if (isScreening) {
    return <span className="inline-flex items-center gap-1 text-[10px] text-slate-500"><Loader2 size={10} className="animate-spin" /> Screening…</span>;
  }
  if (ofac.status === 'not_screened') {
    return (
      <button type="button" disabled={disabled} onClick={onScreen}
        className="text-[10px] px-2 py-0.5 rounded border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-50">
        Screen
      </button>
    );
  }
  if (ofac.status === 'confirmed') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-700">
        🚨 Confirmed{ofac.top_score ? ` ${ofac.top_score}%` : ''}
      </span>
    );
  }
  if (ofac.status === 'pending') {
    return (
      <button type="button" disabled={disabled} onClick={onScreen}
        title={ofac.top_sdn ? `Top match: ${ofac.top_sdn}` : ''}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-100 text-orange-700 hover:bg-orange-200">
        ⚠️ {ofac.top_score || ''}% Match
      </button>
    );
  }
  // status === 'clear' | 'dismissed'
  return (
    <button type="button" disabled={disabled} onClick={onScreen}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-green-100 text-green-700 hover:bg-green-200">
      ✅ Clear
    </button>
  );
}
