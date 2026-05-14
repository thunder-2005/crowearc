// Shared scoring + ranking helpers used by the L1 "Next Up" surfaces:
//   - NextUpBanner       (sticky banner above the Kanban on My Alerts)
//   - NextUpFloat        (floating widget in the investigation workspace)
//   - CompletionPrompt   (post-disposition modal that suggests the next alert)
//
// The math is identical across all three surfaces — single source of truth
// here so the analyst sees consistent ranking everywhere.

const OPEN_STATUSES = new Set(['Not Started', 'In Progress', 'Work in Progress']);

// An alert is genuinely actionable if and only if:
//   - it carries an "open" status, AND
//   - it has not been closed (closed_date null), AND
//   - it has not been dispositioned (e.g. False Positive / Escalated to L2 /
//     Escalated to SAR), AND
//   - it has not been linked into a SAR filing.
// We check all four explicitly. Status alone is not enough — there are real
// rows in production where a stale `alert_status` survives a status fix
// because of a bug in canonicalisation, and we don't want to surface those
// to an analyst as "your next priority".
export function isActionable(alert) {
  if (!alert) return false;
  if (!OPEN_STATUSES.has(alert.alert_status)) return false;
  if (alert.closed_date) return false;
  if (alert.disposition && String(alert.disposition).trim() !== '') return false;
  if (alert.linked_sar_id) return false;
  return true;
}

export function getAlertScore(alert) {
  if (!alert) return 0;
  const now = Date.now();
  const deadline = alert.sla_deadline ? new Date(alert.sla_deadline).getTime() : null;
  const hoursLeft = deadline ? (deadline - now) / 3600000 : Infinity;

  let slaScore = 1;
  if (hoursLeft <= 0)        slaScore = 30;
  else if (hoursLeft <= 24)  slaScore = 25;
  else if (hoursLeft <= 48)  slaScore = 18;
  else if (hoursLeft <= 168) slaScore = 8;

  const priorityScore = { High: 15, Medium: 8, Low: 3 }[alert.priority] || 0;
  const riskScore = { 'Very High': 10, 'High': 6, 'Medium': 3, 'Low': 0 }[alert.customer_risk_rating] || 0;
  const sanctionsBonus = (Number(alert.sanctions_match) === 1 || Number(alert.pep_match) === 1) ? 5 : 0;

  return slaScore + priorityScore + riskScore + sanctionsBonus;
}

// Customer-level exclusion set used by the Next Priority surfaces. Two
// independent rules feed it; both are narrow on purpose (we burned a day
// learning that a broader rule hides every customer in the seed data).
//
//   1. Cross-analyst live claim. A customer is "claimed" against me if
//      some OTHER analyst has an alert on it that is currently
//      In Progress / Work in Progress / Escalated. Two analysts shouldn't
//      both be steered to the same live investigation. Old historical
//      closures by others do NOT claim — they're done.
//
//   2. My same-session dedupe. A customer I personally dispositioned in
//      this browser session is hidden from my Next Priority for the
//      remainder of the session. Refresh clears the set. The alerts
//      themselves stay visible in My Alerts (still need disposition
//      under BSA), they just stop competing for the float / banner.
//
// Each alert is still a separate detection under BSA — this rule
// only governs which one is promoted to "Next."
function buildExcludedCustomerIds(allAlerts, restrictToAnalyst, sessionResolvedCustomerIds) {
  const excluded = new Set();
  if (sessionResolvedCustomerIds && typeof sessionResolvedCustomerIds.forEach === 'function') {
    sessionResolvedCustomerIds.forEach(id => { if (id) excluded.add(id); });
  }
  if (Array.isArray(allAlerts) && restrictToAnalyst) {
    for (const a of allAlerts) {
      if (!a || !a.customer_id) continue;
      if (a.assigned_to === restrictToAnalyst) continue;
      const s = a.alert_status || '';
      const live = s === 'In Progress' || s === 'Work in Progress' || s.startsWith('Escalated');
      if (live) excluded.add(a.customer_id);
    }
  }
  return excluded;
}

// Pick the highest-scoring actionable alert excluding a given id (e.g. the
// alert the analyst is currently looking at). Uses isActionable() — so
// closed, dispositioned, or SAR-linked alerts never surface even if the
// status column hasn't been canonicalised yet. Optionally restrict to a
// specific analyst (defense against an API-side filter slipping through
// alerts owned by someone else).
//
// `opts.allAlerts`: cross-analyst alerts list, used to compute live claims.
//   When omitted, `alerts` is used for both — fine when the caller already
//   has the full institutional view in `alerts`.
// `opts.sessionResolvedCustomerIds`: Set of customer ids I dispositioned
//   in this session. When omitted, no session dedupe is applied.
export function getNextUpAlert(alerts, excludeAlertId = null, restrictToAnalyst = null, opts = {}) {
  if (!Array.isArray(alerts) || alerts.length === 0) return null;
  const { allAlerts = null, sessionResolvedCustomerIds = null } = opts || {};
  const excludedCustomers = buildExcludedCustomerIds(
    allAlerts || alerts,
    restrictToAnalyst,
    sessionResolvedCustomerIds
  );
  const candidates = alerts.filter(a =>
    a.alert_id !== excludeAlertId &&
    isActionable(a) &&
    (!restrictToAnalyst || a.assigned_to === restrictToAnalyst) &&
    !excludedCustomers.has(a.customer_id)
  );
  if (candidates.length === 0) return null;
  return candidates
    .map(a => ({ alert: a, score: getAlertScore(a) }))
    .sort((x, y) => y.score - x.score)[0].alert;
}

// Predicate that matches getNextUpAlert's filter exactly — so the
// "you have N open" banner and the actual Next Priority surface
// always agree.
export function hasSurfaceableAlert(alerts, restrictToAnalyst = null, opts = {}) {
  if (!Array.isArray(alerts) || alerts.length === 0) return false;
  const { allAlerts = null, sessionResolvedCustomerIds = null } = opts || {};
  const excludedCustomers = buildExcludedCustomerIds(
    allAlerts || alerts,
    restrictToAnalyst,
    sessionResolvedCustomerIds
  );
  return alerts.some(a =>
    isActionable(a) &&
    (!restrictToAnalyst || a.assigned_to === restrictToAnalyst) &&
    !excludedCustomers.has(a.customer_id)
  );
}

// Short human-readable reason this alert is the next priority — used as
// the second-row caption on NextUpFloat and CompletionPrompt cards.
export function getPriorityReason(alert) {
  if (!alert) return '';
  if (Number(alert.sanctions_match) === 1) return `Sanctions hit · ${alert.scenario}`;
  if (Number(alert.pep_match) === 1)       return `PEP customer · ${alert.scenario}`;
  if (alert.priority === 'High')           return `High priority · ${alert.scenario}`;
  if (alert.customer_risk_rating === 'Very High') return `Very High risk · ${alert.scenario}`;
  return alert.scenario || '';
}

// SLA countdown copy + urgency tone for a given alert. Used by both the
// float and the completion prompt mini-card so the same wording shows
// in both places.
export function getSlaDescriptor(alert) {
  const deadline = alert?.sla_deadline ? new Date(alert.sla_deadline).getTime() : null;
  if (!deadline) return { tone: 'blue', text: 'No SLA set' };
  const hoursLeft = (deadline - Date.now()) / 3600000;
  if (hoursLeft <= 0)        return { tone: 'red',   text: `Breached ${Math.round(Math.abs(hoursLeft))}h ago` };
  if (hoursLeft <= 24)       return { tone: 'red',   text: `Breaching in ${Math.round(hoursLeft)}h` };
  if (hoursLeft <= 48)       return { tone: 'amber', text: `Due in ${Math.round(hoursLeft / 24)} day${Math.round(hoursLeft / 24) === 1 ? '' : 's'}` };
  return { tone: 'blue', text: `${Math.round(hoursLeft / 24)} days remaining` };
}
