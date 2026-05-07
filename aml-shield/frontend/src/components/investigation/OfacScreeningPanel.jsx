import { useEffect, useState, useCallback } from 'react';
import { ShieldCheck, ShieldAlert, ShieldOff, Clock, Loader2, X } from 'lucide-react';
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

const TONE = {
  clear:        { label: 'Clear',           cls: 'bg-green-100 text-green-700 border-green-300',   icon: ShieldCheck },
  pending:      { label: 'Potential Match', cls: 'bg-orange-100 text-orange-700 border-orange-300',  icon: ShieldAlert },
  confirmed:    { label: 'Confirmed Match', cls: 'bg-red-100 text-red-700 border-red-300',         icon: ShieldOff },
  dismissed:    { label: 'Dismissed',       cls: 'bg-slate-100 text-slate-600 border-slate-300',     icon: ShieldCheck },
  not_screened: { label: 'Not Screened',    cls: 'bg-slate-100 text-slate-500 border-slate-200',    icon: Clock }
};

export default function OfacScreeningPanel({ entityType, entityId, entityName, onConfirmed }) {
  const { currentAnalyst, isManager } = useRole();
  const performer = currentAnalyst || (isManager ? 'Compliance Manager' : 'system');

  const [data, setData] = useState({ status: 'not_screened', last_screened: null, results: [] });
  const [screening, setScreening] = useState(false);
  const [err, setErr] = useState(null);
  const [reviewing, setReviewing] = useState(null); // { result, action: 'confirm'|'dismiss' }

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

  const tone = TONE[data.status] || TONE.not_screened;
  const Icon = tone.icon;
  const visibleResults = (data.results || []).filter(
    r => r.status === 'pending' || r.status === 'confirmed' || r.status === 'dismissed'
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">OFAC / Sanctions Screening</div>
        <button
          type="button"
          onClick={screen}
          disabled={screening}
          className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {screening ? <><Loader2 size={11} className="animate-spin" /> Screening…</> : <>Screen Now</>}
        </button>
      </div>

      <div className={`flex items-center gap-2 px-3 py-2 rounded-md border ${tone.cls}`}>
        <Icon size={16} />
        <span className="text-sm font-semibold">{tone.label}</span>
        {data.last_screened && (
          <span className="text-[11px] text-slate-600 ml-auto">
            Last screened {new Date(data.last_screened).toLocaleString()}
          </span>
        )}
      </div>

      {err && (
        <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">{err}</div>
      )}

      {visibleResults.length > 0 && (
        <div className="overflow-x-auto -mx-2">
          <table className="min-w-full text-xs">
            <thead className="border-b border-slate-200 text-[10px] text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="text-left py-1.5 px-2">SDN Name</th>
                <th className="text-left py-1.5 px-2">Match</th>
                <th className="text-left py-1.5 px-2">Program</th>
                <th className="text-left py-1.5 px-2">Type</th>
                <th className="text-left py-1.5 px-2">Status</th>
                <th className="text-right py-1.5 px-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleResults.map(r => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="py-1.5 px-2 font-medium text-navy-900 truncate max-w-[220px]">{r.sdn_name}</td>
                  <td className="py-1.5 px-2"><MatchBar score={r.match_score} /></td>
                  <td className="py-1.5 px-2 text-slate-600">{r.program || '—'}</td>
                  <td className="py-1.5 px-2 text-slate-600">{r.match_type}</td>
                  <td className="py-1.5 px-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      r.status === 'confirmed' ? 'bg-red-100 text-red-700'
                      : r.status === 'dismissed' ? 'bg-slate-100 text-slate-600'
                      : 'bg-orange-100 text-orange-700'
                    }`}>{r.status}</span>
                  </td>
                  <td className="py-1.5 px-2 text-right">
                    {r.status === 'pending' ? (
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => setReviewing({ result: r, action: 'confirm' })}
                          className="text-[10px] px-2 py-0.5 rounded border border-red-300 text-red-700 hover:bg-red-50"
                        >Confirm</button>
                        <button
                          onClick={() => setReviewing({ result: r, action: 'dismiss' })}
                          className="text-[10px] px-2 py-0.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
                        >Dismiss</button>
                      </div>
                    ) : (
                      <span className="text-[10px] text-slate-400">{r.reviewed_by ? `by ${r.reviewed_by}` : ''}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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

function MatchBar({ score }) {
  const tone = score >= 95 ? 'bg-red-500' : score >= 85 ? 'bg-orange-500' : 'bg-slate-400';
  return (
    <div className="flex items-center gap-1.5 min-w-[80px]">
      <div className="flex-1 h-1.5 bg-slate-100 rounded">
        <div className={`h-full rounded ${tone}`} style={{ width: `${Math.min(100, score)}%` }} />
      </div>
      <span className="text-[10px] font-mono text-slate-600 tabular-nums">{score}%</span>
    </div>
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
