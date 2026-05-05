-- Crowe ARC — PostgreSQL schema (migrated from SQLite)
-- Booleans kept as INTEGER (0/1) and timestamps kept as TEXT to match the
-- existing application contract. Monetary columns use BIGINT for headroom.

-- ── alerts ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alerts (
  id                       SERIAL PRIMARY KEY,
  alert_id                 TEXT UNIQUE NOT NULL,
  customer_id              TEXT,
  customer_name            TEXT NOT NULL,
  customer_type            TEXT,
  segment                  TEXT,
  scenario                 TEXT NOT NULL,
  scenario_description     TEXT,
  alert_status             TEXT NOT NULL,
  priority                 TEXT NOT NULL,
  risk_score               INTEGER,
  amount_flagged_inr       BIGINT NOT NULL DEFAULT 0,
  txn_count_flagged        INTEGER DEFAULT 0,
  counterparty_country     TEXT,
  channel                  TEXT,
  branch                   TEXT,
  assigned_to              TEXT,
  created_date             TEXT NOT NULL,
  last_activity_date       TEXT,
  closed_date              TEXT,
  age_days                 INTEGER NOT NULL DEFAULT 0,
  sla_days                 INTEGER NOT NULL DEFAULT 30,
  sla_deadline             TEXT,
  sla_breached             INTEGER NOT NULL DEFAULT 0,
  due_status               TEXT,
  case_converted           INTEGER NOT NULL DEFAULT 0,
  case_id                  TEXT,
  disposition              TEXT,
  customer_risk_rating     TEXT,
  pep_match                INTEGER NOT NULL DEFAULT 0,
  sanctions_match          INTEGER NOT NULL DEFAULT 0,
  kyc_review_status        TEXT,
  created_by               TEXT,
  linked_sar_id            TEXT,
  narrative_seed           TEXT,
  sla_warning_notified_at  TEXT,
  sla_breach_notified_at   TEXT,
  escalation_notes         TEXT,
  fp_close_reason          TEXT,
  escalated_to             TEXT,
  escalated_to_l2_at       TEXT,
  l2_case_id               TEXT,
  l2_analyst_id            TEXT,
  l2_decision              TEXT,
  l2_decision_at           TEXT,
  returned_from_l2_at      TEXT,
  l2_return_reason         TEXT,
  l2_return_instructions   TEXT
);

-- ── sar_filings ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sar_filings (
  id                          SERIAL PRIMARY KEY,
  sar_id                      TEXT UNIQUE NOT NULL,
  case_id                     TEXT,
  source_alert_id             TEXT,
  customer_id                 TEXT,
  customer_name               TEXT NOT NULL,
  alert_scenario              TEXT,
  sar_status                  TEXT NOT NULL,
  prepared_by                 TEXT,
  reviewed_by                 TEXT,
  approved_by                 TEXT,
  detection_date              TEXT,
  incident_start_date         TEXT,
  incident_end_date           TEXT,
  draft_created_date          TEXT,
  filed_date                  TEXT,
  acknowledged_date           TEXT,
  amount_involved_inr         BIGINT DEFAULT 0,
  narrative_summary           TEXT,
  reporting_jurisdiction      TEXT,
  regulator_reference         TEXT,
  retention_expiry_date       TEXT,
  retention_status            TEXT,
  documents_count             INTEGER DEFAULT 0,
  export_package_ready        INTEGER DEFAULT 0,
  export_count                INTEGER DEFAULT 0,
  last_exported_at            TEXT,
  law_enforcement_hold        INTEGER DEFAULT 0,
  access_classification       TEXT,
  current_owner               TEXT,
  latest_activity_date        TEXT,
  linked_alert_count          INTEGER DEFAULT 0,
  qa_score                    INTEGER DEFAULT 0,
  notes                       TEXT,
  filing_type                 TEXT,
  filing_method               TEXT,
  regulatory_agency           TEXT,
  sar_type                    TEXT,
  bsa_filing_institution      TEXT,
  tin                         TEXT,
  num_transactions            INTEGER,
  total_amount                BIGINT,
  currency                    TEXT,
  structuring_indicator       INTEGER,
  prior_sars                  INTEGER,
  prior_sar_count             INTEGER,
  date_of_recent_sar          TEXT,
  activity_date_from          TEXT,
  activity_date_to            TEXT,
  suspicious_activity_types   TEXT,
  transaction_types           TEXT,
  transaction_locations       TEXT,
  ip_addresses                TEXT,
  device_identifiers          TEXT,
  subject_data                TEXT,
  narrative                   TEXT,
  certification_signed        INTEGER DEFAULT 0,
  submitted_by                TEXT,
  submitted_at                TEXT,
  approved_at                 TEXT,
  draft_data                  TEXT,
  included_documents          TEXT,
  created_at                  TEXT,
  updated_at                  TEXT,
  rejection_reason_category   TEXT,
  rejection_comments          TEXT,
  rejection_checklist         TEXT,
  rejected_by                 TEXT,
  rejected_at                 TEXT,
  returned_to_analyst         INTEGER DEFAULT 0
);

-- ── cases ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cases (
  id              SERIAL PRIMARY KEY,
  case_id         TEXT UNIQUE NOT NULL,
  source_alert_id TEXT,
  linked_sar_id   TEXT,
  customer_id     TEXT,
  customer_name   TEXT NOT NULL,
  scenario        TEXT,
  case_status     TEXT NOT NULL,
  assigned_to     TEXT,
  created_date    TEXT,
  updated_date    TEXT
);

-- ── documents ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
  id            SERIAL PRIMARY KEY,
  sar_id        TEXT NOT NULL,
  document_name TEXT NOT NULL,
  document_type TEXT,
  file_path     TEXT NOT NULL,
  file_size     BIGINT NOT NULL DEFAULT 0,
  uploaded_by   TEXT,
  uploaded_at   TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

-- ── audit_trail ───────────────────────────────────────────
-- The sar_id column is reused as a polymorphic key (the entity's natural id —
-- alert_id for alert events, sar_id for SAR events, kyc_review.id for KYC
-- events). entity_type ('alert' | 'sar' | 'kyc_review' | 'case') tells you
-- which one this row is about. Both columns together let queries scope cleanly.
CREATE TABLE IF NOT EXISTS audit_trail (
  id           SERIAL PRIMARY KEY,
  entity_type  TEXT,
  sar_id       TEXT NOT NULL,
  action       TEXT NOT NULL,
  performed_by TEXT,
  timestamp    TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  details      TEXT
);

-- ── customers ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id                          SERIAL PRIMARY KEY,
  customer_id                 TEXT UNIQUE NOT NULL,
  customer_name               TEXT NOT NULL,
  customer_type               TEXT,
  segment                     TEXT,
  customer_risk_rating        TEXT,
  pep_match                   INTEGER DEFAULT 0,
  sanctions_match             INTEGER DEFAULT 0,
  kyc_review_status           TEXT,
  date_of_birth               TEXT,
  nationality                 TEXT,
  government_id_type          TEXT,
  government_id_number        TEXT,
  customer_since_date         TEXT,
  residential_address         TEXT,
  mailing_address             TEXT,
  country_of_residence        TEXT,
  phone_number                TEXT,
  email_address               TEXT,
  last_kyc_review_date        TEXT,
  next_kyc_due_date           TEXT,
  cdd_level                   TEXT,
  trading_name                TEXT,
  registration_number         TEXT,
  date_of_incorporation       TEXT,
  country_of_incorporation    TEXT,
  business_type               TEXT,
  industry                    TEXT,
  naics_code                  TEXT,
  annual_turnover_range       TEXT,
  number_of_employees         INTEGER,
  beneficial_owners           TEXT,
  directors                   TEXT,
  employer_name               TEXT,
  job_title                   TEXT,
  employment_type             TEXT,
  annual_income_range         TEXT,
  source_of_funds             TEXT,
  source_of_wealth            TEXT,
  expected_monthly_volume     INTEGER,
  expected_monthly_value      BIGINT,
  expected_transaction_types  TEXT,
  primary_countries           TEXT,
  onboarding_notes            TEXT,
  exit_status                 TEXT,
  last_review_id              INTEGER
);

-- ── accounts ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts (
  id              SERIAL PRIMARY KEY,
  account_number  TEXT UNIQUE NOT NULL,
  customer_id     TEXT NOT NULL,
  account_type    TEXT,
  currency        TEXT,
  status          TEXT,
  opened_date     TEXT,
  current_balance BIGINT DEFAULT 0
);

-- ── transactions ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
  id                   SERIAL PRIMARY KEY,
  transaction_id       TEXT UNIQUE NOT NULL,
  account_number       TEXT NOT NULL,
  customer_id          TEXT NOT NULL,
  txn_date             TEXT NOT NULL,
  txn_time             TEXT,
  txn_type             TEXT,
  channel              TEXT,
  description          TEXT,
  counterparty         TEXT,
  counterparty_country TEXT,
  amount               BIGINT NOT NULL DEFAULT 0,
  running_balance      BIGINT NOT NULL DEFAULT 0,
  is_alerted           INTEGER NOT NULL DEFAULT 0,
  alert_id             TEXT,
  scenario_triggered   TEXT,
  rule_breached        TEXT,
  risk_score           INTEGER
);

-- ── case_notes ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS case_notes (
  id        SERIAL PRIMARY KEY,
  alert_id  TEXT NOT NULL,
  note_text TEXT NOT NULL,
  analyst   TEXT,
  timestamp TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

-- ── case_documents ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS case_documents (
  id            SERIAL PRIMARY KEY,
  alert_id      TEXT NOT NULL,
  file_name     TEXT NOT NULL,
  file_path     TEXT NOT NULL,
  document_type TEXT,
  description   TEXT,
  uploaded_by   TEXT,
  uploaded_at   TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  file_size     BIGINT DEFAULT 0
);

-- ── user_profiles ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_profiles (
  id           SERIAL PRIMARY KEY,
  user_id      TEXT UNIQUE NOT NULL,
  name         TEXT NOT NULL,
  role         TEXT NOT NULL,
  team         TEXT,
  status       TEXT NOT NULL DEFAULT 'Active',
  avatar_color TEXT,
  email        TEXT,
  username     TEXT,
  password     TEXT,
  created_at   TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

-- ── manager_settings ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS manager_settings (
  id            SERIAL PRIMARY KEY,
  setting_key   TEXT UNIQUE NOT NULL,
  setting_value TEXT,
  updated_at    TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

-- ── employee_settings ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_settings (
  id            SERIAL PRIMARY KEY,
  analyst_id    TEXT NOT NULL,
  setting_key   TEXT NOT NULL,
  setting_value TEXT,
  updated_at    TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  UNIQUE(analyst_id, setting_key)
);

-- ── retrieval_log ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS retrieval_log (
  id              SERIAL PRIMARY KEY,
  sar_id          TEXT NOT NULL,
  requested_by    TEXT NOT NULL,
  request_purpose TEXT,
  requested_at    TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  exported_at     TEXT
);

-- ── sar_review_comments ───────────────────────────────────
CREATE TABLE IF NOT EXISTS sar_review_comments (
  id               SERIAL PRIMARY KEY,
  sar_id           TEXT NOT NULL,
  manager_id       TEXT,
  comment_text     TEXT NOT NULL,
  highlighted_text TEXT,
  position_start   INTEGER,
  position_end     INTEGER,
  created_at       TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

-- ── sar_approval_log ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS sar_approval_log (
  id                        SERIAL PRIMARY KEY,
  sar_id                    TEXT NOT NULL,
  action                    TEXT NOT NULL,
  actioned_by               TEXT,
  reason_category           TEXT,
  comments                  TEXT,
  checklist_items_completed TEXT,
  actioned_at               TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

-- ── notifications ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id             SERIAL PRIMARY KEY,
  recipient_id   TEXT,
  recipient_role TEXT NOT NULL,
  type           TEXT NOT NULL,
  title          TEXT NOT NULL,
  message        TEXT,
  related_id     TEXT,
  related_type   TEXT,
  tone           TEXT,
  is_read        INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

-- ── kyc_reviews ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kyc_reviews (
  id                      SERIAL PRIMARY KEY,
  customer_id             TEXT NOT NULL,
  review_type             TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'pending',
  priority                TEXT,
  due_date                TEXT,
  assigned_to             TEXT,
  assigned_by             TEXT,
  assigned_at             TEXT,
  assigned_note           TEXT,
  started_at              TEXT,
  completed_at            TEXT,
  previous_risk_rating    TEXT,
  new_risk_rating         TEXT,
  previous_cdd_level      TEXT,
  new_cdd_level           TEXT,
  review_findings         TEXT,
  checklist               TEXT,
  recommendation          TEXT,
  approved_by             TEXT,
  approved_at             TEXT,
  rejection_reason        TEXT,
  rejection_comments      TEXT,
  rejected_by             TEXT,
  rejected_at             TEXT,
  returned_to_analyst     INTEGER NOT NULL DEFAULT 0,
  triggered_by_sar_id     TEXT,
  triggered_by_alert_id   TEXT,
  created_at              TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at              TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

-- ── kyc_review_documents ──────────────────────────────────
CREATE TABLE IF NOT EXISTS kyc_review_documents (
  id            SERIAL PRIMARY KEY,
  review_id     INTEGER NOT NULL,
  document_name TEXT NOT NULL,
  file_path     TEXT NOT NULL,
  document_type TEXT,
  uploaded_by   TEXT,
  uploaded_at   TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  file_size     BIGINT NOT NULL DEFAULT 0
);

-- ── report_schedules ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS report_schedules (
  id         SERIAL PRIMARY KEY,
  report_key TEXT NOT NULL,
  frequency  TEXT NOT NULL,
  day_of     TEXT,
  format     TEXT NOT NULL,
  recipients TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

-- ── l2_cases ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS l2_cases (
  id                    SERIAL PRIMARY KEY,
  l2_case_id            TEXT UNIQUE NOT NULL,
  alert_id              TEXT NOT NULL,
  customer_id           TEXT,
  customer_name         TEXT,
  scenario              TEXT,
  priority              TEXT,
  escalated_by          TEXT,
  escalated_at          TEXT NOT NULL,
  escalation_reason     TEXT,
  assigned_to           TEXT,
  assigned_at           TEXT,
  status                TEXT NOT NULL DEFAULT 'Pending Assignment',
  risk_score            INTEGER,
  risk_factors          TEXT,
  counterparty_analysis TEXT,
  l2_narrative          TEXT,
  decision              TEXT,
  decision_made_at      TEXT,
  decision_by           TEXT,
  return_reason         TEXT,
  return_instructions   TEXT,
  sar_priority          TEXT,
  created_at            TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at            TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

-- ── l2_notes ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS l2_notes (
  id          SERIAL PRIMARY KEY,
  l2_case_id  TEXT NOT NULL,
  note_text   TEXT NOT NULL,
  analyst_id  TEXT,
  created_at  TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

-- ── l2_documents ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS l2_documents (
  id            SERIAL PRIMARY KEY,
  l2_case_id    TEXT NOT NULL,
  document_name TEXT NOT NULL,
  file_path     TEXT NOT NULL,
  document_type TEXT,
  uploaded_by   TEXT,
  uploaded_at   TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  file_size     BIGINT DEFAULT 0
);

-- ── Indexes ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_user_profiles_name   ON user_profiles(name);
CREATE INDEX IF NOT EXISTS idx_emp_settings_analyst ON employee_settings(analyst_id);
CREATE INDEX IF NOT EXISTS idx_alerts_status        ON alerts(alert_status);
CREATE INDEX IF NOT EXISTS idx_alerts_assigned      ON alerts(assigned_to);
CREATE INDEX IF NOT EXISTS idx_alerts_case          ON alerts(case_id);
CREATE INDEX IF NOT EXISTS idx_sar_status           ON sar_filings(sar_status);
CREATE INDEX IF NOT EXISTS idx_sar_case             ON sar_filings(case_id);
CREATE INDEX IF NOT EXISTS idx_sar_expiry           ON sar_filings(retention_expiry_date);
CREATE INDEX IF NOT EXISTS idx_cases_status         ON cases(case_status);
CREATE INDEX IF NOT EXISTS idx_cases_assigned       ON cases(assigned_to);
CREATE INDEX IF NOT EXISTS idx_documents_sar        ON documents(sar_id);
CREATE INDEX IF NOT EXISTS idx_audit_sar            ON audit_trail(sar_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity          ON audit_trail(entity_type, sar_id);
CREATE INDEX IF NOT EXISTS idx_txn_customer         ON transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_txn_alert            ON transactions(alert_id);
CREATE INDEX IF NOT EXISTS idx_txn_date             ON transactions(txn_date);
CREATE INDEX IF NOT EXISTS idx_accounts_cust        ON accounts(customer_id);
CREATE INDEX IF NOT EXISTS idx_case_notes_alert     ON case_notes(alert_id);
CREATE INDEX IF NOT EXISTS idx_case_docs_alert      ON case_documents(alert_id);
CREATE INDEX IF NOT EXISTS idx_review_comments_sar  ON sar_review_comments(sar_id);
CREATE INDEX IF NOT EXISTS idx_approval_log_sar     ON sar_approval_log(sar_id);
CREATE INDEX IF NOT EXISTS idx_notif_recipient      ON notifications(recipient_id);
CREATE INDEX IF NOT EXISTS idx_notif_role           ON notifications(recipient_role);
CREATE INDEX IF NOT EXISTS idx_notif_read           ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_kyc_review_customer  ON kyc_reviews(customer_id);
CREATE INDEX IF NOT EXISTS idx_kyc_review_status    ON kyc_reviews(status);
CREATE INDEX IF NOT EXISTS idx_kyc_review_assigned  ON kyc_reviews(assigned_to);
CREATE INDEX IF NOT EXISTS idx_kyc_review_due       ON kyc_reviews(due_date);
CREATE INDEX IF NOT EXISTS idx_kyc_review_docs      ON kyc_review_documents(review_id);
CREATE INDEX IF NOT EXISTS idx_report_schedules_key ON report_schedules(report_key);
CREATE INDEX IF NOT EXISTS idx_l2_cases_alert       ON l2_cases(alert_id);
CREATE INDEX IF NOT EXISTS idx_l2_cases_assigned    ON l2_cases(assigned_to);
CREATE INDEX IF NOT EXISTS idx_l2_cases_status      ON l2_cases(status);
CREATE INDEX IF NOT EXISTS idx_l2_notes_case        ON l2_notes(l2_case_id);
CREATE INDEX IF NOT EXISTS idx_l2_docs_case         ON l2_documents(l2_case_id);
