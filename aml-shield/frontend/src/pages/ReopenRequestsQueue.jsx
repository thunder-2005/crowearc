import { useEffect, useState } from 'react';
import { Eye, Loader2, X, CheckCircle2, XCircle, RotateCcw, AlertTriangle } from 'lucide-react';
import api from '../api/client.js';
import { useRole } from '../state/RoleContext.jsx';
import { useToast } from '../state/ToastContext.jsx';
import Card from '../components/shared/Card.jsx';
import Table from '../components/shared/Table.jsx';

// Manager queue for alert-reopen requests. Same page mounts twice in the
// router — once at /manager/reopen-requests, once at /bsa/reopen-requests
// — controlled by the `mode` prop. (BSA mode is exported as a separate
// wrapper for ergonomic imports.)
//
// mode = 'manager' → list of pending_manager, action = approve/reject
// mode = 'bsa'     → list of pending_bsa,    action = authorize/deny

export default function ReopenRequestsQueue({ mode = 'manager' }) {
  const { isManager, isBsa } = useRole();
  const { push } = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [decisionModal, setDecisionModal] = useState(null);  // { decision: 'approve'|'reject' }

  const allowedHere = (mode === 'manager' && isManager) || (mode === 'bsa' && isBsa);
  const statusFilter = mode === 'manager' ? 'pending_manager' : 'pending_bsa';

  const reload = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/reopen-requests', { params: { status: statusFilter } });
      setItems(data.requests || []);
    } catch (_e) { setItems([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { reload(); }, [statusFilter]);

  if (!allowedHere) {
    return (
      <div className="text-center py-20 text-slate-500">
        <AlertTriangle size={32} className="mx-auto text-orange-400 mb-3" />
        This queue is not available for your role.
      </div>
    );
  }

  const decide = async ({ decision, notes }) => {
    if (!selected) return;
    const endpoint = mode === 'manager'
      ? `/reopen-requests/${selected.request_id}/manager`
      : `/reopen-requests/${selected.request_id}/bsa`;
    try {
      await api.patch(endpoint, { decision, notes });
      push(
        decision === 'approve'
          ? (mode === 'manager' ? 'Approved — sent to BSA Officer' : 'Authorized — alert reopened')
          : (mode === 'manager' ? 'Request rejected' : 'Request denied — final'),
        'success', 3500
      );
      setDecisionModal(null);
      setSelected(null);
      reload();
    } catch (e) {
      push(`Action failed: ${e?.response?.data?.error || e.message}`, 'error', 5000);
    }
  };

  const title = mode === 'manager' ? 'Alert Reopen Requests' : 'Reopen Authorizations';
  const subtitle = mode === 'manager'
    ? 'Review and approve analyst reopen requests'
    : 'Authorize manager-approved reopen requests (final step)';

  return (
    <div className="flex gap-4 min-w-0">
      <div className="flex-1 min-w-0 space-y-3">
        <div>
          <h1 className="text-xl font-bold text-navy-900">{title}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>
        </div>

        <Card bodyClassName="p-0">
          {loading ? (
            <div className="py-10 text-center text-sm text-slate-400">
              <Loader2 size={16} className="inline animate-spin mr-2" /> Loading…
            </div>
          ) : (
            <Table
              rows={items}
              emptyMessage={mode === 'manager'
                ? 'No reopen requests awaiting manager review'
                : 'No reopen requests awaiting BSA authorization'}
              columns={[
                { key: 'request_id', label: 'Request ID',
                  render: r => <span className="font-mono text-xs text-navy-900 font-medium">{r.request_id}</span> },
                { key: 'alert_id', label: 'Alert ID',
                  render: r => <span className="font-mono text-xs">{r.alert_id}</span> },
                { key: 'customer_name', label: 'Customer', cellClass: 'font-medium' },
                { key: 'requested_by', label: 'Requested By' },
                { key: 'reason_code', label: 'Reason',
                  render: r => <span className="text-xs text-slate-600">{reasonLabel(r.reason_code)}</span> },
                { key: 'requested_at', label: 'Date',
                  render: r => (r.requested_at || '').slice(0, 10) },
                { key: 'days_waiting', label: 'Days Waiting',
                  render: r => {
                    const anchor = mode === 'manager' ? r.requested_at : r.manager_reviewed_at;
                    if (!anchor) return '—';
                    const days = Math.max(0, Math.floor((Date.now() - new Date(anchor).getTime()) / 86400000));
                    return <span className={days > 3 ? 'text-red-700 font-semibold' : days > 1 ? 'text-amber-700' : 'text-slate-700'}>{days}d</span>;
                  } },
                { key: 'actions', label: '',
                  render: r => (
                    <button onClick={() => setSelected(r)}
                      className="text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1">
                      <Eye size={11} /> Review
                    </button>
                  ) }
              ]}
            />
          )}
        </Card>
      </div>

      {selected && (
        <DetailPanel
          mode={mode}
          request={selected}
          onClose={() => setSelected(null)}
          onAction={(decision) => setDecisionModal({ decision })}
        />
      )}

      {decisionModal && selected && (
        <DecisionModal
          mode={mode}
          decision={decisionModal.decision}
          request={selected}
          onCancel={() => setDecisionModal(null)}
          onSubmit={decide}
        />
      )}
    </div>
  );
}

function reasonLabel(code) {
  const map = {
    new_information:            'New information obtained',
    related_alert:              'Related alert flagged',
    law_enforcement:            'Law enforcement inquiry',
    senior_review_disagreement: 'Senior review disagreement',
    new_documentation:          'New documentation',
    system_error:               'System error',
    other:                      'Other'
  };
  return map[code] || code || '—';
}

function DetailPanel({ mode, request, onClose, onAction }) {
  return (
    <aside className="w-[480px] shrink-0 bg-white rounded-lg border border-slate-200 shadow-lg max-h-[calc(100vh-96px)] sticky top-20 flex flex-col">
      <header className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-slate-100">
        <div className="min-w-0">
          <div className="text-xs font-mono text-slate-500">{request.request_id}</div>
          <div className="text-base font-semibold text-navy-900 truncate">{request.customer_name}</div>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X size={16} /></button>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-xs">
        <section>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Request</div>
          <Row k="Alert ID" v={<span className="font-mono">{request.alert_id}</span>} />
          <Row k="Original disposition" v={request.original_disposition || '—'} />
          <Row k="Originally closed by" v={request.original_closed_by || '—'} />
          <Row k="Originally closed at" v={(request.original_closed_at || '').slice(0, 10) || '—'} />
        </section>

        <section>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Submitted</div>
          <Row k="By" v={request.requested_by} />
          <Row k="On" v={(request.requested_at || '').slice(0, 16).replace('T', ' ')} />
          <Row k="Reason code" v={reasonLabel(request.reason_code)} />
        </section>

        <section>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Detailed Explanation</div>
          <div className="bg-slate-50 rounded p-3 text-xs text-slate-800 whitespace-pre-wrap">
            {request.reason_detail}
          </div>
        </section>

        {request.manager_reviewed_at && (
          <section>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Manager Review</div>
            <Row k="By" v={request.manager_reviewed_by} />
            <Row k="On" v={(request.manager_reviewed_at || '').slice(0, 16).replace('T', ' ')} />
            <Row k="Decision" v={request.manager_decision === 'approve' ? 'Approved' : 'Rejected'} />
            {request.manager_notes && (
              <div className="mt-1 bg-slate-50 rounded p-2 text-xs whitespace-pre-wrap">{request.manager_notes}</div>
            )}
          </section>
        )}

        <section>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Timeline</div>
          <Timeline request={request} />
        </section>
      </div>

      <footer className="border-t border-slate-100 px-5 py-3 space-y-2">
        {mode === 'manager' ? (
          <>
            <button
              type="button"
              onClick={() => onAction('approve')}
              className="w-full text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-md px-3 py-2 inline-flex items-center justify-center gap-1.5"
            >
              <CheckCircle2 size={14} /> Approve — Send to BSA Officer
            </button>
            <button
              type="button"
              onClick={() => onAction('reject')}
              className="w-full text-sm font-medium border border-red-300 text-red-700 hover:bg-red-50 rounded-md px-3 py-2 inline-flex items-center justify-center gap-1.5"
            >
              <XCircle size={14} /> Reject Request
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onAction('approve')}
              className="w-full text-sm font-semibold bg-sky-600 hover:bg-sky-700 text-white rounded-md px-3 py-2 inline-flex items-center justify-center gap-1.5"
            >
              <CheckCircle2 size={14} /> Authorize Reopening
            </button>
            <button
              type="button"
              onClick={() => onAction('reject')}
              className="w-full text-sm font-medium border border-red-300 text-red-700 hover:bg-red-50 rounded-md px-3 py-2 inline-flex items-center justify-center gap-1.5"
            >
              <XCircle size={14} /> Deny — Final Decision
            </button>
          </>
        )}
      </footer>
    </aside>
  );
}

function Timeline({ request }) {
  const items = [
    { done: true, label: `Request submitted by ${request.requested_by} on ${(request.requested_at || '').slice(0, 10)}` },
    {
      done: !!request.manager_reviewed_at,
      label: request.manager_reviewed_at
        ? `${request.manager_decision === 'approve' ? 'Approved' : 'Rejected'} by Manager ${request.manager_reviewed_by} on ${(request.manager_reviewed_at || '').slice(0, 10)}`
        : 'Manager review pending'
    },
    {
      done: !!request.bsa_reviewed_at,
      label: request.bsa_reviewed_at
        ? `${request.bsa_decision === 'approve' ? 'Authorized' : 'Denied'} by BSA Officer ${request.bsa_reviewed_by} on ${(request.bsa_reviewed_at || '').slice(0, 10)}`
        : 'BSA Officer authorization pending'
    },
    {
      done: request.status === 'bsa_approved',
      label: request.status === 'bsa_approved'
        ? 'Alert reopened'
        : 'Alert reopened'
    }
  ];
  return (
    <ol className="space-y-1.5">
      {items.map((it, i) => (
        <li key={i} className="flex items-start gap-2">
          <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${it.done ? 'bg-blue-600' : 'bg-slate-300'}`} />
          <span className={`text-xs ${it.done ? 'text-slate-800' : 'text-slate-400'}`}>{it.label}</span>
        </li>
      ))}
    </ol>
  );
}

function DecisionModal({ mode, decision, request, onCancel, onSubmit }) {
  const [notes, setNotes] = useState('');
  const isReject = decision === 'reject';
  const isApprove = decision === 'approve';
  const isBsa = mode === 'bsa';
  const minNotes = (isReject || isBsa) ? 20 : 0;
  const submitDisabled = notes.trim().length < minNotes;

  const labelHeader = isApprove
    ? (isBsa ? `Authorize reopening of ${request.alert_id}?` : `Approve reopen request for ${request.alert_id}?`)
    : (isBsa ? `Deny reopen request for ${request.alert_id}?` : `Reject reopen request for ${request.alert_id}?`);

  const placeholder = isApprove
    ? (isBsa
        ? 'Authorization notes (required — this will be permanently recorded)…'
        : 'Optional notes for BSA Officer…')
    : (isBsa
        ? 'Reason for denial (required — this is final and cannot be appealed)…'
        : 'Reason for rejection (required, minimum 20 characters)…');

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5 space-y-4"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="font-semibold text-navy-900">{labelHeader}</div>
          <button onClick={onCancel} className="p-1 rounded hover:bg-slate-100"><X size={16} /></button>
        </div>

        {isBsa && isReject && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded p-2">
            This is a <span className="font-semibold">final decision</span>. The analyst cannot appeal further.
          </div>
        )}

        <textarea
          rows={4}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder={placeholder}
          required={minNotes > 0}
          className="w-full text-sm border border-slate-200 rounded p-2 focus:outline-none focus:border-blue-500"
        />
        {minNotes > 0 && (
          <div className={`text-[11px] ${notes.trim().length >= minNotes ? 'text-slate-500' : 'text-red-600'}`}>
            {notes.trim().length} / {minNotes} minimum
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel}
            className="text-xs px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="button"
            disabled={submitDisabled}
            onClick={() => onSubmit({ decision, notes: notes.trim() })}
            className={`text-xs px-3 py-1.5 rounded text-white disabled:opacity-50 ${
              isApprove
                ? (isBsa ? 'bg-sky-600 hover:bg-sky-700' : 'bg-blue-600 hover:bg-blue-700')
                : 'bg-red-600 hover:bg-red-700'
            }`}
          >
            {isApprove
              ? (isBsa ? 'Authorize' : 'Approve')
              : (isBsa ? 'Deny — Final' : 'Reject')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div className="flex items-start justify-between gap-2 py-0.5">
      <span className="text-slate-500 shrink-0">{k}</span>
      <span className="text-navy-900 font-medium text-right break-words">{v ?? '—'}</span>
    </div>
  );
}
