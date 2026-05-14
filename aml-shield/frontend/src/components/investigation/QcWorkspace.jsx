import { useEffect, useMemo, useState } from 'react';
import api from '../../api/client.js';
import Badge from '../shared/Badge.jsx';
import { useRole } from '../../state/RoleContext.jsx';
import { useInvestigationTabs } from '../../state/InvestigationTabsContext.jsx';
import { useToast } from '../../state/ToastContext.jsx';
import {
  AlertTriangle, CheckCircle2, XCircle, Lock, Loader2, ClipboardList, FileText, MessageSquare, FolderOpen, ListChecks
} from 'lucide-react';
import RuleExplanationBanner from './RuleExplanationBanner.jsx';

// QC Workspace — read-only investigation view (60%) + QC decision panel (40%).
// Opens as an investigation tab via useInvestigationTabs with level='QC'.
// L2 / Manager only. L1 cannot reach this surface.
//
// Reuses the L1 InvestigationWorkspace data tabs (transactions, notes,
// documents, activity log) so the reviewer sees exactly what the L1 had
// in front of them. The right panel is a fresh decision UI scoped to QC
// (5-item Yes/No checklist + Pass / Fail buttons + failure-reason flow).

const FAILURE_REASONS = [
  { value: 'insufficient_investigation', label: 'Insufficient investigation' },
  { value: 'missed_red_flags',           label: 'Missed red flags' },
  { value: 'inadequate_notes',           label: 'Inadequate case notes' },
  { value: 'risk_not_considered',        label: 'Risk not considered' },
  { value: 'new_information',            label: 'New information identified' },
  { value: 'other',                      label: 'Other' }
];

const CHECKLIST_ITEMS = [
  { key: 'fp_justified',              label: 'Was the False Positive disposition justified by the available evidence?' },
  { key: 'notes_adequate',            label: 'Were case notes sufficient and clearly documented?' },
  { key: 'risk_considered',           label: "Was the customer's risk profile considered?" },
  { key: 'customer_profile_reviewed', label: 'Was the customer profile reviewed (KYC, PEP, sanctions)?' },
  { key: 'no_new_red_flags',          label: 'Are there no new red flags or suspicious patterns visible in the transactions?' }
];

export default function QcWorkspace({ qcId, alertId }) {
  const { currentAnalyst } = useRole();
  const { closeTab, signalAlertsChanged } = useInvestigationTabs();
  const { push } = useToast();

  const [qc, setQc] = useState(null);
  const [alert, setAlert] = useState(null);
  const [loading, setLoading] = useState(true);
  const [leftTab, setLeftTab] = useState('transactions');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.get(`/qc-reviews/${qcId}`),
      api.get(`/alerts/${alertId}`)
    ]).then(([qr, ar]) => {
      if (cancelled) return;
      setQc(qr.data);
      setAlert(ar.data);
    }).catch(e => {
      if (!cancelled) push('Failed to load QC review: ' + (e?.response?.data?.error || e.message), 'error');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [qcId, alertId, push]);

  if (loading || !qc || !alert) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 size={18} className="animate-spin mr-2" /> Loading QC review…
      </div>
    );
  }

  const alreadyDecided = qc.status === 'passed' || qc.status === 'failed';

  return (
    <div className="flex flex-col gap-3 min-w-0">
      {alreadyDecided && (
        <div className="bg-slate-100 border border-slate-200 rounded-md px-4 py-2.5 text-sm text-slate-700 flex items-center gap-2">
          <Lock size={14} className="text-slate-500 shrink-0" />
          <span>This QC review has been {qc.status}. The decision panel is read-only.</span>
        </div>
      )}

      <RuleExplanationBanner alert={alert} variant="full" />

      <div className="flex gap-4 min-w-0 h-[calc(100vh-220px)]">
        {/* LEFT — read-only investigation snapshot */}
        <section className="flex-[0.6] min-w-0 bg-white rounded-lg border border-slate-200 shadow-sm flex flex-col overflow-hidden">
          <LeftTabBar tab={leftTab} onChange={setLeftTab} />
          <div className="flex-1 min-h-0 overflow-y-auto">
            {leftTab === 'transactions' && <ReadOnlyTransactions alert={alert} />}
            {leftTab === 'notes'        && <ReadOnlyCaseNotes alert={alert} />}
            {leftTab === 'documents'    && <ReadOnlyDocuments alert={alert} />}
            {leftTab === 'activity'     && <ReadOnlyActivityLog alert={alert} />}
            {leftTab === 'customer'     && <ReadOnlyCustomerKyc customerId={alert.customer_id} />}
          </div>
        </section>

        {/* RIGHT — QC decision panel */}
        <section className="flex-[0.4] min-w-0 bg-white rounded-lg border border-slate-200 shadow-sm flex flex-col overflow-hidden">
          <QcDecisionPanel
            qc={qc}
            alert={alert}
            currentAnalyst={currentAnalyst}
            disabled={alreadyDecided}
            onDone={() => {
              signalAlertsChanged();
              push('QC decision submitted', 'success');
              closeTab('QC:' + qcId);
            }}
            push={push}
          />
        </section>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────── LEFT — tab bar

function LeftTabBar({ tab, onChange }) {
  const tabs = [
    { k: 'transactions', label: 'Transactions', icon: ListChecks },
    { k: 'notes',        label: 'Case Notes',   icon: MessageSquare },
    { k: 'documents',    label: 'Documents',    icon: FolderOpen },
    { k: 'activity',     label: 'Activity Log', icon: FileText },
    { k: 'customer',     label: 'Customer KYC', icon: ClipboardList }
  ];
  return (
    <div className="flex border-b border-slate-200 bg-slate-50/60">
      {tabs.map(t => {
        const Icon = t.icon;
        const active = tab === t.k;
        return (
          <button
            key={t.k}
            onClick={() => onChange(t.k)}
            className={`flex-1 px-3 py-2.5 text-xs font-medium border-b-2 inline-flex items-center justify-center gap-1.5 ${
              active ? 'text-blue-600 border-blue-600 bg-white' : 'text-slate-600 border-transparent hover:text-navy-900'
            }`}
          >
            <Icon size={12} /> {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────── LEFT — read-only data tabs

function ReadOnlyTransactions({ alert }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    // Defensive: a non-2xx error JSON or a stale alert_id can leave us with
    // a non-array body. Coerce to [] so .map() below never blows up the page.
    api.get(`/alerts/${alert.alert_id}/transactions`)
      .then(r => setRows(Array.isArray(r.data) ? r.data : []))
      .catch(() => setRows([]));
  }, [alert.alert_id]);
  if (!rows) return <div className="p-5 text-sm text-slate-400">Loading transactions…</div>;
  if (rows.length === 0) return <div className="p-5 text-sm text-slate-400">No transactions linked to this alert.</div>;
  const fmt = n => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return (
    <div className="p-4">
      <table className="min-w-full text-xs">
        <thead className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
          <tr>
            <th className="text-left py-1.5 px-2">Date</th>
            <th className="text-left py-1.5 px-2">Type</th>
            <th className="text-left py-1.5 px-2">Channel</th>
            <th className="text-right py-1.5 px-2">Amount</th>
            <th className="text-left py-1.5 px-2">Counterparty</th>
            <th className="text-left py-1.5 px-2">Country</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map(t => (
            <tr key={t.transaction_id}>
              <td className="px-2 py-1.5 text-slate-700">{t.txn_date}</td>
              <td className="px-2 py-1.5">{t.txn_type}</td>
              <td className="px-2 py-1.5 text-slate-600">{t.channel}</td>
              <td className="px-2 py-1.5 text-right font-mono">{fmt(t.amount)}</td>
              <td className="px-2 py-1.5 text-slate-700">{t.counterparty}</td>
              <td className="px-2 py-1.5 text-slate-600">{t.counterparty_country || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReadOnlyCaseNotes({ alert }) {
  const [notes, setNotes] = useState(null);
  useEffect(() => {
    api.get(`/case-notes/${alert.alert_id}`)
      .then(r => setNotes(Array.isArray(r.data) ? r.data : []))
      .catch(() => setNotes([]));
  }, [alert.alert_id]);
  if (!notes) return <div className="p-5 text-sm text-slate-400">Loading notes…</div>;
  if (notes.length === 0) return <div className="p-5 text-sm text-slate-400">No case notes on this alert.</div>;
  return (
    <div className="p-4 space-y-2">
      {notes.map(n => (
        <div key={n.id} className="border border-slate-200 rounded p-3 text-sm">
          <div className="flex justify-between text-[11px] text-slate-500 mb-1">
            <span className="font-medium">{n.analyst}</span>
            <span>{new Date(n.timestamp).toLocaleString()}</span>
          </div>
          <div className="text-slate-800 whitespace-pre-wrap">{n.note_text}</div>
        </div>
      ))}
    </div>
  );
}

function ReadOnlyDocuments({ alert }) {
  const [docs, setDocs] = useState(null);
  useEffect(() => {
    api.get(`/case-documents/${alert.alert_id}`)
      .then(r => setDocs(Array.isArray(r.data) ? r.data : []))
      .catch(() => setDocs([]));
  }, [alert.alert_id]);
  if (!docs) return <div className="p-5 text-sm text-slate-400">Loading documents…</div>;
  if (docs.length === 0) return <div className="p-5 text-sm text-slate-400">No documents uploaded.</div>;
  return (
    <div className="p-4 space-y-2">
      {docs.map(d => (
        <div key={d.id} className="flex items-center justify-between border border-slate-200 rounded p-2 text-xs">
          <div>
            <div className="font-medium text-navy-900">{d.file_name}</div>
            <div className="text-slate-500">{d.document_type} · uploaded by {d.uploaded_by} · {new Date(d.uploaded_at).toLocaleDateString()}</div>
          </div>
          <a
            href={`/api/case-documents/file/${d.id}`}
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 hover:underline"
          >
            View
          </a>
        </div>
      ))}
    </div>
  );
}

function ReadOnlyActivityLog({ alert }) {
  const [items, setItems] = useState(null);
  useEffect(() => {
    api.get(`/audit-trail/alert/${alert.alert_id}`)
      .then(r => setItems(Array.isArray(r.data) ? r.data : []))
      .catch(() => setItems([]));
  }, [alert.alert_id]);
  if (!items) return <div className="p-5 text-sm text-slate-400">Loading activity log…</div>;
  if (items.length === 0) return <div className="p-5 text-sm text-slate-400">No audit entries.</div>;
  return (
    <div className="p-4 space-y-2">
      {items.map(it => (
        <div key={it.id} className="border-l-2 border-slate-200 pl-3 text-xs">
          <div className="text-slate-500">{new Date(it.timestamp).toLocaleString()} · {it.performed_by}</div>
          <div className="text-navy-900 mt-0.5">{it.action}</div>
          {it.details && <div className="text-slate-600 text-[11px] mt-0.5 truncate">{it.details}</div>}
        </div>
      ))}
    </div>
  );
}

function ReadOnlyCustomerKyc({ customerId }) {
  const [c, setC] = useState(null);
  useEffect(() => {
    if (!customerId) return;
    api.get(`/customers/${customerId}`).then(r => setC(r.data)).catch(() => setC(null));
  }, [customerId]);
  if (!c) return <div className="p-5 text-sm text-slate-400">Loading customer profile…</div>;
  return (
    <div className="p-4 text-sm space-y-3">
      <div>
        <div className="text-base font-semibold text-navy-900">{c.customer_name}</div>
        <div className="text-xs text-slate-500">{c.customer_id} · {c.customer_type || '—'}</div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <Row k="Risk Rating" v={<Badge value={c.customer_risk_rating} />} />
        <Row k="CDD Level" v={c.cdd_level || '—'} />
        <Row k="PEP" v={Number(c.pep_match) === 1 ? 'Yes' : 'No'} />
        <Row k="Sanctions" v={Number(c.sanctions_match) === 1 ? <span className="text-red-600 font-semibold">Hit</span> : 'Clear'} />
        <Row k="Last KYC" v={c.last_kyc_review_date || '—'} />
        <Row k="Next KYC Due" v={c.next_kyc_due_date || '—'} />
        <Row k="Country" v={c.nationality || c.country_of_incorporation || '—'} />
        <Row k="Source of Funds" v={c.source_of_funds || '—'} />
      </div>
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div className="flex justify-between border-b border-slate-100 py-1">
      <span className="text-slate-500">{k}</span>
      <span className="text-navy-900 text-right">{v}</span>
    </div>
  );
}

// ─────────────────────────────────────────────── RIGHT — decision panel

function QcDecisionPanel({ qc, alert, currentAnalyst, disabled, onDone, push }) {
  const [checks, setChecks] = useState({});
  const [failureReason, setFailureReason] = useState('');
  const [failureNotes, setFailureNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirm, setConfirm] = useState(null); // 'pass' | 'fail' | null

  // If review is already decided, hydrate the panel from the saved record.
  useEffect(() => {
    if (qc.checklist && typeof qc.checklist === 'object') setChecks(qc.checklist);
    if (qc.failure_reason) setFailureReason(qc.failure_reason);
    if (qc.failure_notes)  setFailureNotes(qc.failure_notes);
  }, [qc]);

  const allAnswered = CHECKLIST_ITEMS.every(it => typeof checks[it.key] === 'boolean');
  const allYes = allAnswered && CHECKLIST_ITEMS.every(it => checks[it.key] === true);
  const anyNo  = allAnswered && CHECKLIST_ITEMS.some(it => checks[it.key] === false);

  const submit = async (decision) => {
    setSubmitting(true);
    try {
      const body = {
        reviewed_by: currentAnalyst,
        overall_decision: decision,
        checklist: checks
      };
      if (decision === 'fail') {
        body.failure_reason = failureReason;
        body.failure_notes  = failureNotes.trim();
      }
      await api.patch(`/qc-reviews/${qc.qc_id}/decision`, body);
      setConfirm(null);
      onDone();
    } catch (e) {
      push('Failed to submit QC decision: ' + (e?.response?.data?.error || e.message), 'error');
      setConfirm(null);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <header className="px-4 py-3 border-b border-slate-200 bg-slate-50/60">
        <div className="text-sm font-semibold text-navy-900 inline-flex items-center gap-1.5">
          <ClipboardList size={14} className="text-purple-600" /> QC Review
        </div>
        <div className="text-xs text-slate-500 mt-1">
          <span className="font-mono">{alert.alert_id}</span> · {alert.customer_name}
        </div>
        <div className="text-[11px] text-slate-500 mt-0.5">
          Closed as FP by <span className="font-medium">{qc.original_analyst}</span>
          {qc.original_closed_at && <> on {new Date(qc.original_closed_at).toLocaleDateString()}</>}
        </div>
      </header>

      <div className="bg-amber-50 border-y border-amber-200 px-4 py-2 text-xs text-amber-900 flex items-start gap-2">
        <AlertTriangle size={13} className="text-amber-600 mt-0.5 shrink-0" />
        <span>You are reviewing a False Positive closure. Check if the L1 decision was justified.</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div>
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Checklist</div>
          <div className="space-y-2">
            {CHECKLIST_ITEMS.map((it, idx) => (
              <ChecklistRow
                key={it.key}
                index={idx + 1}
                label={it.label}
                value={checks[it.key]}
                onChange={(v) => setChecks(s => ({ ...s, [it.key]: v }))}
                disabled={disabled}
              />
            ))}
          </div>
        </div>

        {!disabled && allAnswered && anyNo && (
          <div className="space-y-2 border border-red-200 rounded-md bg-red-50/50 p-3">
            <div className="text-[11px] font-semibold text-red-800 uppercase tracking-wider">Failure Details (required for QC Fail)</div>
            <select
              value={failureReason}
              onChange={e => setFailureReason(e.target.value)}
              className="w-full border border-slate-200 rounded px-2 py-1.5 bg-white text-sm"
            >
              <option value="">— select failure reason —</option>
              {FAILURE_REASONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
            <textarea
              value={failureNotes}
              onChange={e => setFailureNotes(e.target.value)}
              rows={4}
              minLength={50}
              placeholder="Explain why this FP closure should be reopened… (min 50 characters)"
              className="w-full border border-slate-200 rounded px-2 py-1.5 bg-white text-sm"
            />
            <div className="text-[10px] text-slate-500 text-right">{failureNotes.trim().length} / 50 chars min</div>
          </div>
        )}
      </div>

      <footer className="border-t border-slate-200 p-3 flex flex-col gap-2">
        <button
          onClick={() => setConfirm('pass')}
          disabled={disabled || !allYes || submitting}
          className="w-full inline-flex items-center justify-center gap-1.5 text-sm font-semibold bg-green-600 hover:bg-green-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded px-3 py-2"
        >
          <CheckCircle2 size={14} /> Pass QC
        </button>
        <button
          onClick={() => setConfirm('fail')}
          disabled={
            disabled || !allAnswered || !anyNo || !failureReason || failureNotes.trim().length < 50 || submitting
          }
          className="w-full inline-flex items-center justify-center gap-1.5 text-sm font-semibold bg-red-600 hover:bg-red-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded px-3 py-2"
        >
          <XCircle size={14} /> Fail QC
        </button>
        {!disabled && !allAnswered && (
          <div className="text-[11px] text-slate-500 text-center">Answer all 5 checklist items to enable the decision buttons.</div>
        )}
      </footer>

      {confirm === 'pass' && (
        <ConfirmModal
          title="Confirm QC Pass?"
          body={
            <>
              This will permanently close <span className="font-mono">{alert.alert_id}</span> as False Positive.
              This action cannot be undone.
            </>
          }
          confirmLabel="Confirm Pass"
          confirmTone="green"
          disabled={submitting}
          onCancel={() => setConfirm(null)}
          onConfirm={() => submit('pass')}
        />
      )}
      {confirm === 'fail' && (
        <ConfirmModal
          title="Confirm QC Failure?"
          body={
            <>
              This will automatically create a reopen request for <span className="font-mono">{alert.alert_id}</span>.
              The alert will be reopened to <span className="font-semibold">{qc.original_analyst}</span> if approved
              by Manager and BSA Officer.
            </>
          }
          confirmLabel="Confirm Failure"
          confirmTone="red"
          disabled={submitting}
          onCancel={() => setConfirm(null)}
          onConfirm={() => submit('fail')}
        />
      )}
    </div>
  );
}

function ChecklistRow({ index, label, value, onChange, disabled }) {
  const yes = value === true;
  const no  = value === false;
  return (
    <div className="border border-slate-200 rounded p-2.5">
      <div className="flex items-start gap-2">
        <div className="text-[11px] font-mono text-slate-400 mt-0.5">{index}.</div>
        <div className="flex-1 text-sm text-slate-800">{label}</div>
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(true)}
          className={`flex-1 text-xs rounded px-2 py-1 border ${
            yes
              ? 'bg-green-50 border-green-300 text-green-800 font-semibold'
              : 'bg-white border-slate-200 text-slate-600 hover:border-green-200'
          } disabled:opacity-60 disabled:cursor-not-allowed`}
        >
          ✓ Yes
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(false)}
          className={`flex-1 text-xs rounded px-2 py-1 border ${
            no
              ? 'bg-red-50 border-red-300 text-red-800 font-semibold'
              : 'bg-white border-slate-200 text-slate-600 hover:border-red-200'
          } disabled:opacity-60 disabled:cursor-not-allowed`}
        >
          ✗ No
        </button>
      </div>
    </div>
  );
}

function ConfirmModal({ title, body, confirmLabel, confirmTone, disabled, onCancel, onConfirm }) {
  const btnTone = confirmTone === 'green'
    ? 'bg-green-600 hover:bg-green-700'
    : 'bg-red-600 hover:bg-red-700';
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="px-5 py-3 border-b border-slate-100 font-semibold text-navy-900">{title}</div>
        <div className="p-5 text-sm text-slate-700">{body}</div>
        <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onCancel} className="text-sm border border-slate-300 rounded px-3 py-1.5 hover:bg-slate-50">Cancel</button>
          <button
            onClick={onConfirm}
            disabled={disabled}
            className={`text-sm rounded px-3 py-1.5 text-white disabled:opacity-50 ${btnTone}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
