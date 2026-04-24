const MANAGER_DEFAULTS = {
  'sla.high_days': 3,
  'sla.medium_days': 7,
  'sla.low_days': 15,
  'sla.warning_threshold_pct': 80,
  'sla.auto_escalate_days_overdue': 5,
  'max_alerts_per_analyst': 35,
  'alert_aging_highlight_days': 30,

  'scenarios.active': {
    'Structuring': true,
    'High Risk Country': true,
    'Watchlist Hit': true,
    'Cash Intensive': true,
    'Trade Based ML': true
  },
  'scenarios.config': {
    'Structuring':       { risk_weight: 'Medium',   auto_assign_team: 'T1 Monitoring',     auto_priority_override: false },
    'High Risk Country': { risk_weight: 'High',     auto_assign_team: 'T2 Investigations', auto_priority_override: false },
    'Watchlist Hit':     { risk_weight: 'High',     auto_assign_team: 'T1 Monitoring',     auto_priority_override: true  },
    'Cash Intensive':    { risk_weight: 'Medium',   auto_assign_team: 'T1 Monitoring',     auto_priority_override: false },
    'Trade Based ML':    { risk_weight: 'Critical', auto_assign_team: 'T2 Investigations', auto_priority_override: true  }
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
  'audit.export_requires_confirm': true
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
