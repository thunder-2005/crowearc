import { useState } from 'react';
import { X, AlertTriangle, Info, Loader2 } from 'lucide-react';
import api from '../../api/client.js';
import { useToast } from '../../state/ToastContext.jsx';
import { useRole } from '../../state/RoleContext.jsx';

// L1 analyst raises a request to reopen a closed alert. Three-level chain
// applies: this modal POSTs to /api/reopen-requests with status
// 'pending_manager'. Manager and BSA Officer decisions happen on separate
// queue pages.

const REASON_CODES = [
  { value: 'new_information',           label: 'New information obtained' },
  { value: 'related_alert',             label: 'Related alert flagged on customer' },
  { value: 'law_enforcement',           label: 'Law enforcement inquiry received' },
  { value: 'senior_review_disagreement',label: 'Senior analyst review disagreement' },
  { value: 'new_documentation',         label: 'Customer provided new documentation' },
  { value: 'system_error',              label: 'System error in original closure' },
  { value: 'other',                     label: 'Other' }
];

const MIN_DETAIL = 100;

export default function ReopenRequestModal({ alert, onClose, onSubmitted }) {
  const { push } = useToast();
  const { currentUser } = useRole();
  const [reasonCode, setReasonCode] = useState('');
  const [reasonDetail, setReasonDetail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [attempted, setAttempted] = useState(false);

  const detailLen = reasonDetail.trim().length;
  const detailOk = detailLen >= MIN_DETAIL;
  const reasonOk = !!reasonCode;
  const canSubmit = detailOk && reasonOk && !submitting;

  const submit = async () => {
    setAttempted(true);
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/reopen-requests', {
        alert_id: alert.alert_id,
        reason_code: reasonCode,
        reason_detail: reasonDetail.trim(),
        requested_by: currentUser?.name || 'Analyst',
        requested_by_role: currentUser?.role || 'analyst_l1'
      });
      push('Reopen request submitted. You will be notified when the manager reviews it.', 'success', 4000);
      if (typeof onSubmitted === 'function') onSubmitted();
      onClose();
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to submit request');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog" aria-modal="true"
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-[480px] max-h-[92vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <header className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-slate-100">
          <div>
            <div className="text-base font-semibold text-navy-900">Request Alert Reopen</div>
            <div className="text-xs text-slate-500 mt-0.5">
              This request requires manager approval and BSA Officer authorization before the alert can be reopened.
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X size={16} /></button>
        </header>

        <div className="px-5 py-4 space-y-4">
          <div className="bg-blue-50 border border-blue-200 text-blue-800 text-xs rounded p-3 flex items-start gap-2">
            <Info size={14} className="shrink-0 mt-0.5" />
            <div>
              Three-step appeal chain:
              <div className="mt-1 ml-1">L1 request → Manager review → BSA Officer authorization → Alert reopens.</div>
            </div>
          </div>

          <div className="bg-slate-50 rounded p-3 text-xs space-y-1">
            <Row k="Alert ID" v={<span className="font-mono">{alert.alert_id}</span>} />
            <Row k="Customer" v={alert.customer_name} />
            <Row k="Original disposition"
                 v={<span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-700">
                      {alert.disposition || alert.alert_status}
                    </span>} />
            <Row k="Closed by" v={alert.assigned_to || '—'} />
            {alert.closed_date && <Row k="Closed on" v={alert.closed_date} />}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Reason Code <span className="text-red-500">*</span>
            </label>
            <select
              value={reasonCode}
              onChange={e => setReasonCode(e.target.value)}
              className={`w-full text-sm border rounded px-2 py-1.5 bg-white focus:outline-none ${
                attempted && !reasonOk ? 'border-red-400 focus:border-red-500' : 'border-slate-200 focus:border-blue-500'
              }`}
            >
              <option value="">— select a reason —</option>
              {REASON_CODES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Detailed Explanation <span className="text-red-500">*</span>
            </label>
            <textarea
              rows={5}
              value={reasonDetail}
              onChange={e => setReasonDetail(e.target.value)}
              placeholder="Provide a detailed explanation of why this alert should be reopened. Include any new information, related alerts, or other evidence that supports this request. Minimum 100 characters."
              className={`w-full text-sm border rounded p-2 focus:outline-none ${
                attempted && !detailOk ? 'border-red-400 focus:border-red-500' : 'border-slate-200 focus:border-blue-500'
              }`}
            />
            <div className={`text-[11px] mt-1 ${detailOk ? 'text-slate-500' : 'text-red-600'}`}>
              {detailLen} / {MIN_DETAIL} minimum
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded p-3 text-[11px] text-slate-600 flex items-start gap-2">
            <AlertTriangle size={12} className="shrink-0 mt-0.5 text-slate-500" />
            <div>
              This request will be reviewed by the Compliance Manager and then authorized by the BSA Officer.
              The alert will <span className="font-semibold">not be reopened</span> until both approvals are received.
              You will be notified at each stage.
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded p-2">{error}</div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            {submitting ? <><Loader2 size={12} className="animate-spin" /> Submitting…</> : 'Submit Request'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-slate-500 shrink-0">{k}</span>
      <span className="text-navy-900 font-medium text-right break-words">{v ?? '—'}</span>
    </div>
  );
}
