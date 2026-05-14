import { useEffect, useState } from 'react';
import { CheckCircle2, PlayCircle, Clock, Zap } from 'lucide-react';
import api from '../../api/client.js';
import { useRole } from '../../state/RoleContext.jsx';
import { useRoleNavigate } from '../../state/useRoleNavigate.js';
import { useInvestigationTabs } from '../../state/InvestigationTabsContext.jsx';
import { getNextUpAlert, getSlaDescriptor } from '../../utils/alertScoring.js';

// CompletionPrompt — full-screen overlay that surfaces immediately after
// the analyst submits a successful disposition. Confirms what happened,
// suggests the next priority, and auto-navigates back to My Alerts after
// 10 seconds so the analyst must consciously choose to open the next one.
//
// Props:
//   open                 boolean — controls visibility
//   onClose              function — fired by every action that closes the prompt
//   justClosedAlertId    excluded from the next-priority lookup
//   dispositionLabel     "Closed as false positive" / "Escalated to L2" / ...
//   alertId              the just-closed alert id, shown beneath the title
//
// Behaviour:
//   - Self-fetches /alerts on mount (no shared list with the workspace);
//     excludes justClosedAlertId via getNextUpAlert.
//   - 10s countdown bar depletes left→right; auto-navigates to My Alerts.
//   - Either button cancels the countdown timer.
//   - If no next-up alert exists, shows the "queue is clear" banner and
//     hides "Open Next Alert" — countdown still runs.

const COUNTDOWN_SECONDS = 10;

export default function CompletionPrompt({
  open,
  onClose,
  justClosedAlertId,
  dispositionLabel,
  alertId
}) {
  const { isL1, isL2, currentAnalyst } = useRole();
  const { goTo } = useRoleNavigate();
  const { openTab } = useInvestigationTabs();
  const isAnalyst = isL1 || isL2;

  const [alerts, setAlerts] = useState(null);
  const [remaining, setRemaining] = useState(COUNTDOWN_SECONDS);

  // Self-fetch the FULL alerts list when the prompt opens. We need the
  // cross-analyst view so getNextUpAlert's customer-level claim rule can
  // exclude customers already being investigated (or already resolved)
  // by another analyst — otherwise the prompt could suggest a customer
  // the analyst just dispositioned (different alert_id, same customer).
  useEffect(() => {
    if (!open || !isAnalyst || !currentAnalyst) return;
    let cancelled = false;
    api.get('/alerts')
      .then(r => { if (!cancelled) setAlerts(r.data || []); })
      .catch(() => { if (!cancelled) setAlerts([]); });
    return () => { cancelled = true; };
  }, [open, isAnalyst, currentAnalyst]);

  // Countdown ticks down every second while the prompt is open. Hitting
  // zero navigates to My Alerts. Closing the prompt clears the interval.
  useEffect(() => {
    if (!open) { setRemaining(COUNTDOWN_SECONDS); return; }
    setRemaining(COUNTDOWN_SECONDS);
    const id = setInterval(() => {
      setRemaining(prev => {
        if (prev <= 1) {
          clearInterval(id);
          goTo('alerts');
          onClose && onClose();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || !isAnalyst) return null;

  // restrictToAnalyst=currentAnalyst so we only surface MY next alert
  // even though the fetch now returns the full institution-wide list.
  const next = alerts ? getNextUpAlert(alerts, justClosedAlertId, currentAnalyst) : null;
  const loading = alerts === null;
  const queueClear = !loading && !next;

  const openNext = () => {
    if (!next) return;
    onClose && onClose();
    // Open the next alert directly in an investigation tab and route to
    // the alerts page. We can't rely on `?alert=<id>` deep links — the
    // Alerts page doesn't read that query param to open tabs (the float's
    // "Open Alert" button uses the same direct openTab pattern).
    openTab(next, { level: 'L1' });
    goTo('alerts');
  };
  const returnToList = () => {
    onClose && onClose();
    goTo('alerts');
  };

  const progressPct = (remaining / COUNTDOWN_SECONDS) * 100;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Disposition complete"
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        zIndex: 80,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16
      }}
    >
      <div
        className="bg-white"
        style={{ width: 420, maxWidth: '100%', borderRadius: 16, padding: 32, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.4)' }}
      >
        {/* TOP — success header */}
        <div className="flex flex-col items-center text-center">
          <CheckCircle2 size={32} className="text-green-600" />
          <h3 className="mt-3 text-lg font-bold text-navy-900">Alert closed</h3>
          {dispositionLabel && (
            <div className="mt-1 text-sm text-slate-600">{dispositionLabel}</div>
          )}
          {alertId && (
            <div className="mt-1 text-xs text-slate-400 font-mono">{alertId}</div>
          )}
        </div>

        <hr className="my-5 border-slate-200" />

        {/* MIDDLE — next priority */}
        {loading && (
          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2 inline-flex items-center gap-1">
              <Zap size={11} /> Your next priority
            </div>
            <div className="bg-slate-100 rounded-lg animate-pulse" style={{ height: 90 }} />
            <div className="text-xs text-slate-500 italic mt-2">Finding your next priority…</div>
          </div>
        )}

        {queueClear && (
          <div className="bg-green-50 rounded-md p-4 text-sm text-green-800 text-center"
               style={{ borderLeft: '4px solid #16A34A' }}>
            🎉 Your queue is clear — great work today!
          </div>
        )}

        {!loading && next && (
          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2 inline-flex items-center gap-1">
              <Zap size={11} className="text-amber-500" /> Your next priority
            </div>
            <NextPriorityCard alert={next} />
          </div>
        )}

        {/* BOTTOM — actions */}
        <div className="mt-5 space-y-2">
          {!queueClear && (
            <button
              type="button"
              onClick={openNext}
              disabled={!next}
              className="w-full inline-flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-md px-4 py-2.5 disabled:opacity-50"
            >
              <PlayCircle size={14} />
              Open Next Alert →
            </button>
          )}
          <button
            type="button"
            onClick={returnToList}
            className="w-full text-sm font-medium text-slate-700 hover:bg-slate-50 border border-slate-300 rounded-md px-4 py-2.5"
          >
            Return to My Alerts
          </button>
        </div>

        {/* Countdown bar */}
        <div className="mt-4">
          <div className="h-1 w-full bg-slate-100 rounded overflow-hidden">
            <div
              className="h-full bg-slate-400 transition-all duration-1000 ease-linear"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="text-[11px] text-slate-500 text-center mt-1.5">
            Returning to My Alerts in {remaining}s…
          </div>
        </div>
      </div>
    </div>
  );
}

function NextPriorityCard({ alert }) {
  const sla = getSlaDescriptor(alert);
  const slaCls = sla.tone === 'red' ? 'text-red-700 font-semibold'
               : sla.tone === 'amber' ? 'text-amber-700'
               : 'text-blue-700';
  const isPep = Number(alert.pep_match) === 1;
  const isSanctions = Number(alert.sanctions_match) === 1;
  const isHighRisk = alert.customer_risk_rating === 'Very High' || alert.customer_risk_rating === 'High';
  const amount = `$${Number(alert.amount_flagged_inr || 0).toLocaleString('en-US')}`;

  return (
    <div className="bg-slate-50 rounded-lg p-3">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="font-semibold text-sm text-navy-900 truncate">{alert.customer_name}</span>
        {isHighRisk && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-700">
            {alert.customer_risk_rating} Risk
          </span>
        )}
        {isPep && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-100 text-purple-700">
            PEP
          </span>
        )}
        {isSanctions && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-700">
            Sanctions
          </span>
        )}
      </div>
      <div className="text-[11px] text-slate-500 mt-1 font-mono">
        {alert.alert_id} · <span className="tabular-nums">{amount}</span>
      </div>
      <div className={`text-[11px] mt-1 inline-flex items-center gap-1 ${slaCls}`}>
        <Clock size={11} />
        <span>{sla.text}</span>
      </div>
    </div>
  );
}
