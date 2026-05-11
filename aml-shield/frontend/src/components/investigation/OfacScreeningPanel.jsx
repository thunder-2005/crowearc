import { useEffect, useState, useCallback } from 'react';
import { Loader2, X } from 'lucide-react';
import api from '../../api/client.js';
import { useRole } from '../../state/RoleContext.jsx';

// Renders the "OFAC / Sanctions Screening" section for a customer or
// counterparty. Drops into the KYC profile block (works in both the
// CustomerKYC profile page and the investigation right-panel KYC tab
// since both render KycProfileBlock).
//
// Props:
//   entityType: 'customer' | 'counterparty'
//   entityId:   stable id (customer_id or URL-encoded counterparty name)
//   entityName: human-readable name to screen
//   onConfirmed?: callback fired after a match is confirmed (so the
//                 surrounding KYC block can refresh sanctions_match)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const day = String(d.getDate()).padStart(2, '0');
  const month = MONTHS[d.getMonth()];
  const year = d.getFullYear();
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${day} ${month} ${year} at ${String(h).padStart(2, '0')}:${m} ${ampm}`;
}

function confidenceLabel(score) {
  if (score >= 95) return 'High Confidence';
  if (score >= 85) return 'Probable Match';
  return 'Possible Match';
}

function decisionLabel(status) {
  if (status === 'confirmed') return 'Confirmed Match';
  if (status === 'dismissed') return 'Dismissed — Not a Match';
  return 'Pending Analyst Review';
}

export default function OfacScreeningPanel({ entityType, entityId, entityName, onConfirmed }) {
  const { currentAnalyst, isManager } = useRole();
  const performer = currentAnalyst || (isManager ? 'Compliance Manager' : 'system');

  const [data, setData] = useState({ status: 'not_screened', last_screened: null, list_version: null, results: [] });
  const [screening, setScreening] = useState(false);
  const [err, setErr] = useState(null);
  const [reviewing, setReviewing] = useState(null);

  const load = useCallback(async () => {
    if (!entityType || !entityId) return;
    try {
      const { data } = await api.get(
        `/ofac/results/${entityType}/${encodeURIComponent(entityId)}`
      );
      setData(data);
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    }
  }, [entityType, entityId]);

  useEffect(() => { load(); }, [load]);

  const screen = async () => {
    setScreening(true);
    setErr(null);
    try {
      await api.post(
        `/ofac/screen/${entityType}/${encodeURIComponent(entityId)}`,
        { name: entityName, performed_by: performer }
      );
      await load();
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally {
      setScreening(false);
    }
  };

  const submitReview = async (notes) => {
    if (!reviewing) return;
    try {
      await api.patch(`/ofac/results/${reviewing.result.id}`, {
        status: reviewing.action === 'confirm' ? 'confirmed' : 'dismissed',
        review_notes: notes,
        performed_by: performer
      });
      setReviewing(null);
      await load();
      if (reviewing.action === 'confirm' && typeof onConfirmed === 'function') onConfirmed();
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    }
  };

  const matchResults = (data.results || []).filter(
    r => r.status === 'pending' || r.status === 'confirmed' || r.status === 'dismissed'
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
          OFAC / Sanctions Screening
        </div>
        <button
          type="button"
          onClick={screen}
          disabled={screening}
          className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {screening
            ? <><Loader2 size={11} className="animate-spin" /> Screening…</>
            : <>Screen Now</>}
        </button>
      </div>

      {err && (
        <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
          {err}
        </div>
      )}

      {data.status === 'not_screened' && <NotScreenedCard entityName={entityName} />}

      {data.status === 'clear' && (
        <ClearCard
          entityName={entityName}
          listVersion={data.list_version}
          screenedAt={data.last_screened}
        />
      )}

      {matchResults.length > 0 && matchResults.map(r => (
        <MatchCard
          key={r.id}
          result={r}
          entityName={entityName}
          listVersion={data.list_version}
          onConfirm={() => setReviewing({ result: r, action: 'confirm' })}
          onDismiss={() => setReviewing({ result: r, action: 'dismiss' })}
        />
      ))}

      {reviewing && (
        <ReviewModal
          action={reviewing.action}
          result={reviewing.result}
          onClose={() => setReviewing(null)}
          onSubmit={submitReview}
        />
      )}
    </div>
  );
}

function FindingCard({ borderColor, label, labelColor, children }) {
  return (
    <div
      className="bg-white rounded-md border border-slate-200 text-xs"
      style={{ borderLeft: `4px solid ${borderColor}` }}
    >
      <div className="px-3 py-2 border-b border-slate-100">
        <div className={`text-[11px] font-semibold uppercase tracking-wider ${labelColor}`}>
          {label}
        </div>
      </div>
      <div className="px-3 py-2">{children}</div>
    </div>
  );
}

function LabelRow({ label, value, valueClass = '' }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-x-2 py-1 border-b border-slate-50 last:border-b-0">
      <div className="text-slate-500">{label}</div>
      <div className={`text-slate-800 ${valueClass}`}>{value || '—'}</div>
    </div>
  );
}

function NotScreenedCard({ entityName }) {
  return (
    <FindingCard borderColor="#94A3B8" label="Not Yet Screened" labelColor="text-slate-600">
      <p className="text-slate-700">
        {entityName ? <><span className="font-medium">{entityName}</span> has</> : 'This customer has'} not been screened against the OFAC SDN list. Click <span className="font-medium">Screen Now</span> to run screening.
      </p>
    </FindingCard>
  );
}

function ClearCard({ entityName, listVersion, screenedAt }) {
  return (
    <FindingCard borderColor="#16A34A" label="Screening Clear" labelColor="text-green-700">
      <p className="text-slate-700 mb-2">
        No sanctions match identified for <span className="font-medium">{entityName || 'this entity'}</span>.
      </p>
      <div className="mt-1">
        <LabelRow label="List Checked" value="OFAC SDN List" />
        <LabelRow label="List Version" value={listVersion ? `Downloaded ${formatDate(listVersion)}` : 'Unknown'} />
        <LabelRow label="Screened On" value={formatDate(screenedAt)} />
        <LabelRow label="Result" value={`No matches identified for ${entityName || 'this entity'}`} />
      </div>
    </FindingCard>
  );
}

function MatchCard({ result, entityName, listVersion, onConfirm, onDismiss }) {
  const status = result.status;
  let border = '#F59E0B';
  let labelText = 'Screening Finding — Review Required';
  let labelColor = 'text-orange-700';
  if (status === 'confirmed') {
    border = '#DC2626';
    labelText = 'Confirmed Sanctions Match';
    labelColor = 'text-red-700';
  } else if (status === 'dismissed') {
    border = '#94A3B8';
    labelText = 'Match Dismissed';
    labelColor = 'text-slate-600';
  }

  const isAka = result.match_type && result.match_type.toLowerCase().includes('aka');
  const matchFound = isAka
    ? `${result.sdn_name} — AKA Match`
    : `${result.sdn_name} — Primary Name`;
  const reviewedBy = result.reviewed_by || 'Pending Review';
  const reviewNotes = result.review_notes && String(result.review_notes).trim()
    ? result.review_notes
    : '—';

  return (
    <FindingCard borderColor={border} label={labelText} labelColor={labelColor}>
      <p className="text-slate-700 mb-2">
        A potential sanctions match has been identified for <span className="font-medium">{entityName || result.entity_name}</span>.
      </p>
      <div>
        <LabelRow label="List Checked" value="OFAC Specially Designated Nationals (SDN) List" />
        <LabelRow label="List Version" value={listVersion ? `Downloaded ${formatDate(listVersion)}` : 'Unknown'} />
        <LabelRow label="Screened On" value={formatDate(result.screened_at)} />
        <LabelRow label="Match Found" value={matchFound} valueClass="font-medium" />
        <LabelRow
          label="Match Score"
          value={`${result.match_score}% — ${confidenceLabel(result.match_score)}`}
        />
        <LabelRow label="Program" value={result.program || '—'} />
        <LabelRow label="Match Type" value={result.match_type || '—'} />
        <LabelRow label="Reviewed By" value={reviewedBy} />
        <LabelRow label="Review Decision" value={decisionLabel(status)} />
        <LabelRow label="Review Notes" value={reviewNotes} />
      </div>
      {status === 'pending' && (
        <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-end gap-2">
          <button
            onClick={onDismiss}
            className="text-[11px] px-2.5 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
          >
            Dismiss as Not a Match
          </button>
          <button
            onClick={onConfirm}
            className="text-[11px] px-2.5 py-1 rounded border border-red-300 bg-red-50 text-red-700 hover:bg-red-100"
          >
            Confirm Match
          </button>
        </div>
      )}
    </FindingCard>
  );
}

function ReviewModal({ action, result, onClose, onSubmit }) {
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const isConfirm = action === 'confirm';

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!notes.trim()) return;
    setSubmitting(true);
    try { await onSubmit(notes.trim()); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()}
        className="bg-white rounded-lg shadow-xl w-full max-w-md p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="font-semibold text-navy-900">
            {isConfirm ? 'Confirm this is a sanctions match?' : 'Dismiss this match?'}
          </div>
          <button type="button" onClick={onClose} className="p-1 hover:bg-slate-100 rounded"><X size={16} /></button>
        </div>
        <div className="text-xs text-slate-600 bg-slate-50 rounded p-2">
          <span className="font-medium">{result.entity_name}</span> ↔ <span className="font-mono">{result.sdn_name}</span>
          {result.program && <span className="text-slate-500"> · {result.program}</span>}
          <span className="text-slate-500"> · {result.match_score}% {result.match_type}</span>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-700">
            {isConfirm ? 'Explain why this is a confirmed match' : 'Explain why this is not a match'}
            <span className="text-red-500 ml-0.5">*</span>
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={4}
            placeholder={isConfirm
              ? 'e.g. Same name, DOB, and nationality match the SDN entry exactly.'
              : 'e.g. Different DOB, different nationality, common name with no other matching attributes.'}
            className="mt-1 w-full text-sm border border-slate-200 rounded p-2 focus:outline-none focus:border-blue-500"
            required
          />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="text-xs px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={submitting || !notes.trim()}
            className={`text-xs px-3 py-1.5 rounded text-white disabled:opacity-50 ${
              isConfirm ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-700 hover:bg-slate-800'
            }`}>
            {submitting ? 'Saving…' : isConfirm ? 'Confirm Match' : 'Dismiss Match'}
          </button>
        </div>
      </form>
    </div>
  );
}
