// ═══════════════════════════════════════════════════════════════════════════
// SCORING SYSTEM AUDIT — pre-C-05 refactor
//
// What the legacy ranker actually does (read from the code below, NOT from
// any external doc):
//
//   getAlertScore(alert) → returns an INTEGER in [0, 60].
//     Inputs:
//       - alert.sla_deadline    : ISO date string (alert INVESTIGATION
//                                 deadline, NOT the SAR-filing deadline).
//                                 Sourced from alerts.sla_deadline which is
//                                 created_date + alert.sla_days
//                                 (sla_days is 3/7/15 based on priority,
//                                 from manager_settings.sla.*_days).
//       - alert.priority        : 'High' | 'Medium' | 'Low'
//       - alert.customer_risk_rating : 'Very High' | 'High' | 'Medium' | 'Low'
//       - alert.sanctions_match : 0 | 1
//       - alert.pep_match       : 0 | 1
//     Formula:
//       slaScore       = 1 / 8 / 18 / 25 / 30  (based on hours_left buckets)
//       priorityScore  = 0 / 3 / 8 / 15
//       riskScore      = 0 / 3 / 6 / 10
//       sanctionsBonus = 0 or 5
//       total = slaScore + priorityScore + riskScore + sanctionsBonus
//
//   getNextUpAlert(alerts, excludeAlertId, restrictToAnalyst, opts)
//     - Filters by isActionable() (open status, no closed_date, no
//       disposition, no linked SAR).
//     - Optionally filters out a specific alert_id and restricts to one
//       analyst's queue.
//     - Applies the customer-claim rule via buildExcludedCustomerIds:
//         (a) cross-analyst LIVE claim — a customer being actively
//             investigated by another analyst is suppressed.
//         (b) my same-session dedupe — a customer I dispositioned this
//             session won't re-surface until the next refresh.
//     - Sorts remaining candidates by getAlertScore DESC.
//     - Returns the single top alert (or null).
//
//   hasSurfaceableAlert(alerts, restrictToAnalyst, opts)
//     - Predicate version of the same filter set — returns boolean.
//     - Used by the banner to decide whether to render itself.
//
// NEXT UP banner + NextUpFloat consumption:
//   - Both call getNextUpAlert(...) with the SAME shared filter set.
//   - Alerts.jsx passes filteredAlerts (toolbar-filtered) and allAlerts
//     (institution-wide, for claim detection) and the
//     sessionResolvedCustomerIds set from InvestigationTabsContext.
//   - NextUpFloat does its own /api/alerts fetch every 30s plus on
//     activeId / alertsRefreshNonce change. So banner and float can briefly
//     disagree across the poll boundary; this is by design and acceptable.
//
// SLA fields available on each alert at ranking time (from /api/alerts):
//   - sla_deadline       : present (alerts.sla_deadline column, TEXT)
//   - sla_breached       : present (alerts.sla_breached INTEGER, but
//                          known stale — set by an older slaMonitor pass
//                          that didn't exclude FP-closed rows)
//   - created_date       : present (TEXT, YYYY-MM-DD)
//   - detection_date     : NOT PRESENT — would need backend addition.
//                          Audit B-5 plans an immutable detection_date.
//                          Until then we proxy with created_date.
//
// What changes in C-05:
//   - getAlertScore  → renamed to legacyRiskScore (kept exported,
//                      @deprecated). Other surfaces (reports, analytics)
//                      may still consume it; we don't touch them here.
//   - getNextUpAlert → signature gains a `weights` arg loaded from
//                      manager_settings; calls the new composite ranker.
//   - New: computeTimeUrgencyScore, computeRiskScore, computeCompositeScore,
//          rankAlerts.
//   - New: backend exposes days_remaining + sla_tier (30-day SAR clock)
//          via ALERT_SELECT — see backend/routes/alerts.js.
//
// Backwards compat: getAlertScore stays exported and continues to work
// unchanged. legacyRiskScore is its new canonical name.
// ═══════════════════════════════════════════════════════════════════════════

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

// @deprecated — pre-C-05 single-dimension ranker. Returns an integer in
// [0, 60]. Kept exported under both names (legacyRiskScore is the
// canonical post-refactor name; getAlertScore is the historical export
// name so any out-of-scope consumer keeps working). Do NOT add new
// callers — use computeCompositeScore + rankAlerts instead.
export function legacyRiskScore(alert) {
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

// Back-compat alias — keeps the historical export name working for any
// surface that imported getAlertScore directly. The body is the legacy
// score; the new ranker uses computeCompositeScore.
export const getAlertScore = legacyRiskScore;

// ─── C-05 composite scoring ────────────────────────────────────────────────

// Default weights/thresholds. Used when the manager-settings fetch fails.
// Mirror the seed values in backend/database/admin_defaults.js — keep in
// sync. The "risk weight" is implicit at (1 - sla).
export const DEFAULT_SCORING_WEIGHTS = Object.freeze({
  sla: 0.60,
  risk: 0.40,
  criticalDays: 5,
  warningDays: 10,
  lockoutOnCritical: true
});

// Build a frozen weights object from a raw manager_settings payload. Used
// by the UI hook that consumes /api/settings/manager — handles missing /
// malformed keys without throwing.
export function weightsFromSettings(settings = {}) {
  const slaRaw = Number(settings['scoring.weight_sla']);
  const sla = Number.isFinite(slaRaw) ? Math.max(0, Math.min(1, slaRaw)) : DEFAULT_SCORING_WEIGHTS.sla;
  const critRaw = Number(settings['scoring.critical_tier_days']);
  const warnRaw = Number(settings['scoring.warning_tier_days']);
  const critical = Number.isFinite(critRaw) ? Math.max(1, Math.min(14, Math.round(critRaw))) : DEFAULT_SCORING_WEIGHTS.criticalDays;
  const warning  = Number.isFinite(warnRaw) ? Math.max(2, Math.min(20, Math.round(warnRaw))) : DEFAULT_SCORING_WEIGHTS.warningDays;
  // Force the invariant: warning must be strictly greater than critical.
  // If a stored config violates it (e.g. a manager fat-fingered them in
  // the legacy direct DB write), promote warning by one day.
  const safeWarning = warning > critical ? warning : critical + 1;
  const lockout = settings['scoring.float_lockout_on_critical'];
  return Object.freeze({
    sla,
    risk: 1 - sla,
    criticalDays: critical,
    warningDays: safeWarning,
    lockoutOnCritical: lockout === undefined ? DEFAULT_SCORING_WEIGHTS.lockoutOnCritical : !!lockout
  });
}

// Normalised time-pressure score ∈ [0, 1]. days_remaining is the integer
// SAR-filing-clock countdown the backend now emits (see ALERT_SELECT in
// backend/routes/alerts.js). Clamped to [-5, 30] so a wildly-stale alert
// doesn't dominate the score and so 30+ days of runway all map to 0.
//
//   daysRemaining = 30  → urgency = 0.0
//   daysRemaining = 10  → urgency ≈ 0.571
//   daysRemaining =  5  → urgency ≈ 0.714
//   daysRemaining =  0  → urgency ≈ 0.857
//   daysRemaining = -5  → urgency = 1.0  (and any more-breached value clamps here)
export function computeTimeUrgencyScore(alert) {
  if (!alert) return 0;
  const raw = alert.days_remaining;
  const daysRemaining = raw == null ? 30 : Number(raw);
  if (!Number.isFinite(daysRemaining)) return 0;
  const clamped = Math.max(-5, Math.min(30, daysRemaining));
  return Math.min(1.0, Math.max(0, (30 - clamped) / 35));
}

// Normalised risk score ∈ [0, 1]. The existing risk signal on each alert
// is `customer_risk_rating`, a string enum. We map it directly. PEP and
// sanctions matches act as additive bonuses on top, capped at 1.0 — they
// matter and should bias the score, but they don't allow a Low-risk alert
// with no PEP/sanctions to outrank a Very High one.
//
//   Low       → 0.25
//   Medium    → 0.50
//   High      → 0.75
//   Very High → 1.0
//   PEP match       → +0.15
//   sanctions match → +0.25
//   missing rating  → 0.0
export function computeRiskScore(alert) {
  if (!alert) return 0;
  const RISK_MAP = { 'Low': 0.25, 'Medium': 0.50, 'High': 0.75, 'Very High': 1.0 };
  const base = RISK_MAP[alert.customer_risk_rating] || 0;
  const pepBonus = Number(alert.pep_match) === 1 ? 0.15 : 0;
  const sanctionsBonus = Number(alert.sanctions_match) === 1 ? 0.25 : 0;
  return Math.min(1.0, base + pepBonus + sanctionsBonus);
}

// Composite urgency score ∈ [0, 1]. Returns 0 when both components are 0
// and 1 when both components are 1. Linear blend on the two normalised
// components — keep it linear so a manager tuning the weight slider sees
// proportional changes and can reason about behaviour.
export function computeCompositeScore(alert, weights = DEFAULT_SCORING_WEIGHTS) {
  if (!alert) return 0;
  const t = computeTimeUrgencyScore(alert);
  const r = computeRiskScore(alert);
  const slaW = Number.isFinite(weights?.sla) ? weights.sla : DEFAULT_SCORING_WEIGHTS.sla;
  const riskW = Number.isFinite(weights?.risk) ? weights.risk : (1 - slaW);
  return (t * slaW) + (r * riskW);
}

// Resolve a tier for an alert. Prefers the SQL-supplied `sla_tier` when
// present so the frontend's tier-driven UI agrees with the backend audit
// surface. When days_remaining is available we also respect manager-tuned
// criticalDays / warningDays cutoffs (the SQL classifier uses the seed
// defaults; the manager may have overridden them in settings).
export function resolveSlaTier(alert, weights = DEFAULT_SCORING_WEIGHTS) {
  if (!alert) return 'normal';
  const days = alert.days_remaining;
  if (days == null) return alert.sla_tier || 'normal';
  const n = Number(days);
  if (!Number.isFinite(n)) return alert.sla_tier || 'normal';
  if (n < 0) return 'breached';
  if (n <= (weights.criticalDays ?? DEFAULT_SCORING_WEIGHTS.criticalDays)) return 'critical';
  if (n <= (weights.warningDays  ?? DEFAULT_SCORING_WEIGHTS.warningDays))  return 'warning';
  return 'normal';
}

// Rank a list of alerts by composite score (descending), filtered to
// actionable rows only. Returns a NEW array; original is not mutated.
// Each returned row carries _compositeScore / _timeUrgency / _risk so
// the float can render the breakdown without recomputing.
//
// Tier promotion (non-negotiable invariant): an alert whose SAR-filing
// 30-day clock has been BREACHED is by definition a regulatory exposure
// under 31 CFR 1020.320(b). It sorts above any non-breached alert
// regardless of composite weights — a manager cannot tune the weights so
// that a breached alert gets ranked below a normal-tier high-risk one.
// Within the breached group, composite score still orders the rows.
export function rankAlerts(alerts, weights = DEFAULT_SCORING_WEIGHTS) {
  if (!Array.isArray(alerts) || alerts.length === 0) return [];
  const tierRank = (a) => resolveSlaTier(a, weights) === 'breached' ? 1 : 0;
  return alerts
    .filter(isActionable)
    .map(a => {
      const t = computeTimeUrgencyScore(a);
      const r = computeRiskScore(a);
      const slaW = Number.isFinite(weights?.sla) ? weights.sla : DEFAULT_SCORING_WEIGHTS.sla;
      const riskW = Number.isFinite(weights?.risk) ? weights.risk : (1 - slaW);
      return { ...a, _timeUrgency: t, _risk: r, _compositeScore: (t * slaW) + (r * riskW) };
    })
    .sort((a, b) => {
      const tierDelta = tierRank(b) - tierRank(a);
      if (tierDelta !== 0) return tierDelta;
      return b._compositeScore - a._compositeScore;
    });
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
// C-05: composite-score ranker. Signature back-compat with the pre-refactor
// call sites — extra args land in opts so existing imports keep working.
// New `weights` arg supports the composite blend; when omitted, defaults
// preserve the audit-recommended 60/40 SLA-heavy ratio.
export function getNextUpAlert(alerts, excludeAlertId = null, restrictToAnalyst = null, opts = {}) {
  if (!Array.isArray(alerts) || alerts.length === 0) return null;
  const {
    allAlerts = null,
    sessionResolvedCustomerIds = null,
    weights = DEFAULT_SCORING_WEIGHTS
  } = opts || {};
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
  const ranked = rankAlerts(candidates, weights);
  return ranked[0] || null;
}

// Returns true when there is at least one critical-tier (sla_tier ===
// 'critical' or sla_tier === 'breached') alert in the analyst's queue,
// after applying the same actionability + exclusion rules as
// getNextUpAlert. Drives the float-dismiss lockout.
export function hasCriticalSlaAlert(alerts, restrictToAnalyst = null, opts = {}) {
  if (!Array.isArray(alerts) || alerts.length === 0) return false;
  const { allAlerts = null, sessionResolvedCustomerIds = null, weights = DEFAULT_SCORING_WEIGHTS } = opts || {};
  const excludedCustomers = buildExcludedCustomerIds(
    allAlerts || alerts,
    restrictToAnalyst,
    sessionResolvedCustomerIds
  );
  return alerts.some(a => {
    if (!isActionable(a)) return false;
    if (restrictToAnalyst && a.assigned_to !== restrictToAnalyst) return false;
    if (excludedCustomers.has(a.customer_id)) return false;
    const tier = resolveSlaTier(a, weights);
    return tier === 'critical' || tier === 'breached';
  });
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
