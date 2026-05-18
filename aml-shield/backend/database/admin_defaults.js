const MANAGER_DEFAULTS = {
  'sla.high_days': 3,
  'sla.medium_days': 7,
  'sla.low_days': 15,
  'sla.warning_threshold_pct': 80,
  'sla.auto_escalate_days_overdue': 5,
  'max_alerts_per_analyst': 35,
  'alert_aging_highlight_days': 30,

  // Scenario Configuration — extended in the new "Scenario Configuration"
  // settings section. Each scenario carries: active flag, default priority,
  // and FP-rate warning threshold. The FP threshold is functional — the
  // Analytics Rule Effectiveness tab compares the actual FP rate against
  // it and surfaces a warning when the configured ceiling is exceeded.
  'scenarios.active': {
    'Structuring': true,
    'High Risk Country': true,
    'Watchlist Hit': true,
    'Cash Intensive': true,
    'Rapid Movement': true,
    'Trade Based ML': true
  },
  'scenarios.config': {
    'Structuring':       { priority: 'Medium', fp_warn_pct: 40 },
    'High Risk Country': { priority: 'High',   fp_warn_pct: 40 },
    'Watchlist Hit':     { priority: 'High',   fp_warn_pct: 40 },
    'Cash Intensive':    { priority: 'Low',    fp_warn_pct: 40 },
    'Rapid Movement':    { priority: 'Medium', fp_warn_pct: 40 },
    'Trade Based ML':    { priority: 'Low',    fp_warn_pct: 40 }
  },

  'team.capacity_warn_pct': 85,
  'team.auto_distribute': false,
  'team.round_robin': false,
  'team.assign_by_workload': true,
  'team.lead_escalation_hours': 24,

  'sar.retention_years': 5,
  'sar.retention_warn_days': 90,
  'sar.dual_approval_required': true,
  'sar.filing_deadline_days': 30,
  'sar.auto_archive_closed_days': 365,
  'sar.mandatory_fields': {
    narrative: true,
    supporting_document: true,
    transaction_evidence: true,
    supervisor_approval: false
  },

  'report.refresh_interval': 'Every 15 min',
  'report.notify_sla_breach': true,
  'report.notify_high_priority': true,
  'report.weekly_autoreport': false,
  'report.recipients': '',
  'report.export_format': 'PDF',

  'audit.require_fp_reason': true,
  'audit.require_note_on_status_change': true,
  'audit.lock_case_after_sar': true,
  'audit.min_note_length': 100,
  'audit.session_timeout_min': 30,
  'audit.export_requires_confirm': true,

  // C-04: hours since the last successful OFAC SDN sync before the
  // staleness banner appears. Default of 26 = 24h cadence + 2h grace.
  // Recommended range 25-48; UI enforces a 24h floor and 168h (one week)
  // ceiling. The Postgres view ofac_sync_status hard-codes 26 for its
  // own is_stale flag; the API derives the configurable banner threshold
  // from this setting.
  'ofac.staleness_threshold_hours': 26,

  // ─── C-05: Alert Priority Scoring ────────────────────────────────────
  // Weights that drive the L1 Next Priority composite score (float + banner
  // + within-column Kanban sort). Read on the frontend via /api/settings/manager
  // and passed into rankAlerts(). Defaults are documented in the audit
  // remediation plan for C-05 — see frontend/src/utils/alertScoring.js.
  //
  //   scoring.weight_sla     time-pressure weight ∈ [0.0, 1.0]; the
  //                          risk-score weight is implicitly 1 − weight_sla.
  //                          Default 0.60 — time-to-SAR-breach dominates.
  //   scoring.critical_tier_days  Alerts with ≤ N days to SAR breach
  //                          surface in the red tier (border stripe + pulse
  //                          + dismiss-lockout when enabled). Default 5.
  //   scoring.warning_tier_days   Alerts with ≤ N days (and above critical)
  //                          surface in the amber tier. Default 10.
  //   scoring.float_lockout_on_critical  Hide the float's dismiss button
  //                          while any critical-tier alert is in the queue.
  //                          Forces analysts to acknowledge before
  //                          continuing. Default true.
  'scoring.weight_sla': 0.60,
  'scoring.critical_tier_days': 5,
  'scoring.warning_tier_days': 10,
  'scoring.float_lockout_on_critical': true,

  // ─── C-11: Examination Readiness Mode ───────────────────────────────
  // Default configuration for the BSA Officer self-assessment runs. Each
  // run's config is persisted on the run row so a manager re-tuning these
  // values mid-cycle doesn't retroactively change historical scores.
  'exam.sar_sample_size':              25,
  'exam.cdd_sample_size':              50,
  'exam.lookback_days':                365,
  'exam.sar_timeliness_threshold_days': 30,
  'exam.ofac_screening_staleness_days': 365,
  'exam.kyc_review_overdue_days':      30,
  'institution.name':                  '[Institution Name]'
};

const EMPLOYEE_DEFAULTS = {
  'workspace.landing': 'My Dashboard',
  'workspace.alert_sort': 'SLA Earliest',
  'workspace.txn_date_range': 'Last 90 Days',
  'workspace.collapse_kanban': false,
  'workspace.show_sla_timer': true,
  'workspace.show_risk_badge': true,

  'investigation.left_tab': 'Transactions',
  'investigation.right_tab': 'Customer KYC',
  'investigation.autoexpand_alerted': true,
  'investigation.show_running_balance': true,
  'investigation.highlight_counterparty': true,
  'investigation.autosave_seconds': 30,
  'investigation.confirm_close_tab': true,

  'notif.new_alert_assigned': true,
  'notif.sla_within_2hr': true,
  'notif.case_approved': true,
  'notif.supervisor_comment': true,
  'notif.sound': false,
  'notif.style': 'Banner',

  'display.date_format': 'DD/MM/YYYY',
  'display.time_format': '24hr',
  'display.currency': 'Symbol',
  'display.row_density': 'Comfortable',
  'display.theme': 'Light',

  'docs.default_type': 'Screenshot',
  'docs.preview_on_hover': true,
  'docs.spellcheck_notes': true,
  'docs.note_template': ''
};

const AVATAR_COLORS = [
  '#2563eb', '#10b981', '#f59e0b', '#ef4444', '#6366f1',
  '#8b5cf6', '#ec4899', '#0891b2', '#ea580c', '#14b8a6'
];
function colorForName(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

module.exports = { MANAGER_DEFAULTS, EMPLOYEE_DEFAULTS, colorForName };
