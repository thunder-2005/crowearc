import { useEffect, useState } from 'react';
import { Zap, PlayCircle, Clock } from 'lucide-react';
import api from '../../api/client.js';
import { useRole } from '../../state/RoleContext.jsx';
import { useInvestigationTabs } from '../../state/InvestigationTabsContext.jsx';
import { getNextUpAlert, getSlaDescriptor } from '../../utils/alertScoring.js';

// Floating "Next Up" widget — pinned to the bottom-right of the
// investigation workspace. Self-fetches the analyst's own alerts, scores
// them with the shared utility, and shows the highest-ranked alert
// excluding whichever one the analyst is currently viewing.
//
// One action only: "Open Alert". No skip, no dismiss — if the analyst
// doesn't want to act on it, they just ignore it.
//
// Rendering rules:
//   - L1 analysts only (manager / L2 hidden — different workflows)
//   - Self-fetches on mount + every 60 seconds
//   - Renders nothing if no next-up alert remains (silent rather than noisy)
export default function NextUpFloat({ excludeAlertId, onOpen }) {
  const { isL1, currentAnalyst } = useRole();
  const { activeId, alertsRefreshNonce } = useInvestigationTabs();
  const [alerts, setAlerts] = useState(null);

  // Refetch when:
  //   - currentAnalyst changes (different user logs in)
  //   - activeId changes (an investigation tab was just closed → the alert
  //     the analyst was working on may have been completed)
  //   - alertsRefreshNonce changes (an investigation workspace explicitly
  //     signalled that an alert just changed state — e.g. disposition
  //     submitted. We don't wait for the tab to close OR for the next
  //     poll tick; the float updates immediately so the just-dispositioned
  //     alert disappears.)
  // Background poll runs every 30s to catch out-of-band changes
  // (manager bulk-closed an alert, another analyst reassigned, etc.).
  //
  // Note: we fetch the FULL alerts list here, not just `?assigned_to=me`.
  // The customer-level claim rule inside getNextUpAlert needs to see
  // OTHER analysts' alerts on the same customer to know whether a
  // customer is "claimed" institution-wide. The restrictToAnalyst arg
  // still narrows the surfaced alert to mine.
  useEffect(() => {
    if (!isL1 || !currentAnalyst) return;
    let cancelled = false;
    const load = () => api.get('/alerts')
      .then(r => { if (!cancelled) setAlerts(r.data || []); })
      .catch(() => {});
    load();
    const id = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, [isL1, currentAnalyst, activeId, alertsRefreshNonce]);

  // Manager / L2 / unauthenticated → don't render anything.
  if (!isL1 || !currentAnalyst) return null;

  // No data yet (first paint) — stay silent, the workspace shouldn't flash
  // a placeholder for a secondary panel.
  if (alerts === null) return null;

  // Strict pick: open, not closed, not dispositioned, not SAR-linked, AND
  // owned by the current analyst (defense against the API filter slipping
  // through any alert assigned to someone else).
  const next = getNextUpAlert(alerts, excludeAlertId, currentAnalyst);
  if (!next) return null;

  const sla = getSlaDescriptor(next);
  const borderColor = sla.tone === 'red' ? '#DC2626' : sla.tone === 'amber' ? '#F59E0B' : '#2563EB';
  const slaCls = sla.tone === 'red' ? 'text-red-700' : sla.tone === 'amber' ? 'text-amber-700' : 'text-blue-700';

  const isPep = Number(next.pep_match) === 1;
  const isSanctions = Number(next.sanctions_match) === 1;
  const isHighRisk = next.customer_risk_rating === 'Very High' || next.customer_risk_rating === 'High';
  const amount = `$${Number(next.amount_flagged_inr || 0).toLocaleString('en-US')}`;

  return (
    <aside
      role="complementary"
      aria-label="Next priority alert"
      className="bg-white rounded-lg"
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        width: 320,
        zIndex: 40,
        borderLeft: `4px solid ${borderColor}`,
        boxShadow: '0 10px 25px -8px rgba(15, 23, 42, 0.25)',
        padding: '12px 14px'
      }}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <Zap size={12} className="text-amber-500" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Next Priority
        </span>
      </div>

      <div className="text-sm font-semibold text-navy-900 truncate" title={next.customer_name}>
        {next.customer_name}
      </div>

      {(isHighRisk || isPep || isSanctions) && (
        <div className="flex items-center gap-1 mt-1.5 flex-wrap">
          {isHighRisk && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-700">
              {next.customer_risk_rating} Risk
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
      )}

      <div className="text-[11px] text-slate-500 mt-1.5 font-mono">
        {next.alert_id} · <span className="tabular-nums">{amount}</span>
      </div>

      <div className={`text-[11px] mt-1 inline-flex items-center gap-1 ${slaCls}`}>
        <Clock size={11} />
        <span>{sla.text}</span>
      </div>

      <button
        type="button"
        onClick={() => onOpen ? onOpen(next) : null}
        className="mt-3 w-full inline-flex items-center justify-center gap-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded px-3 py-1.5"
      >
        <PlayCircle size={12} />
        Open Alert →
      </button>
    </aside>
  );
}
