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

// Pick the highest-scoring actionable alert excluding a given id (e.g. the
// alert the analyst is currently looking at). Uses isActionable() — so
// closed, dispositioned, or SAR-linked alerts never surface even if the
// status column hasn't been canonicalised yet. Optionally restrict to a
// specific analyst (defense against an API-side filter slipping through
// alerts owned by someone else).
export function getNextUpAlert(alerts, excludeAlertId = null, restrictToAnalyst = null) {
  if (!Array.isArray(alerts) || alerts.length === 0) return null;
  const candidates = alerts.filter(a =>
    a.alert_id !== excludeAlertId &&
    isActionable(a) &&
    (!restrictToAnalyst || a.assigned_to === restrictToAnalyst)
  );
  if (candidates.length === 0) return null;
  return candidates
    .map(a => ({ alert: a, score: getAlertScore(a) }))
    .sort((x, y) => y.score - x.score)[0].alert;
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
