const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DB_DIR = path.join(__dirname);
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const DB_PATH = path.join(DB_DIR, 'aml.db');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

function ensureColumns(table, columns) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  for (const [name, decl] of columns) {
    if (!existing.includes(name)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${decl}`);
    }
  }
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS alerts (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_id              TEXT UNIQUE NOT NULL,
      customer_id           TEXT,
      customer_name         TEXT NOT NULL,
      customer_type         TEXT,
      segment               TEXT,
      scenario              TEXT NOT NULL,
      scenario_description  TEXT,
      alert_status          TEXT NOT NULL,
      priority              TEXT NOT NULL,
      risk_score            INTEGER,
      amount_flagged_inr    INTEGER NOT NULL DEFAULT 0,
      txn_count_flagged     INTEGER DEFAULT 0,
      counterparty_country  TEXT,
      channel               TEXT,
      branch                TEXT,
      assigned_to           TEXT,
      created_date          TEXT NOT NULL,
      last_activity_date    TEXT,
      closed_date           TEXT,
      age_days              INTEGER NOT NULL DEFAULT 0,
      sla_days              INTEGER NOT NULL DEFAULT 30,
      sla_deadline          TEXT,
      sla_breached          INTEGER NOT NULL DEFAULT 0,
      due_status            TEXT,
      case_converted        INTEGER NOT NULL DEFAULT 0,
      case_id               TEXT,
      disposition           TEXT,
      customer_risk_rating  TEXT,
      pep_match             INTEGER NOT NULL DEFAULT 0,
      sanctions_match       INTEGER NOT NULL DEFAULT 0,
      kyc_review_status     TEXT,
      created_by            TEXT,
      linked_sar_id         TEXT,
      narrative_seed        TEXT
    );

    CREATE TABLE IF NOT EXISTS sar_filings (
      id                        INTEGER PRIMARY KEY AUTOINCREMENT,
      sar_id                    TEXT UNIQUE NOT NULL,
      case_id                   TEXT,
      source_alert_id           TEXT,
      customer_id               TEXT,
      customer_name             TEXT NOT NULL,
      alert_scenario            TEXT,
      sar_status                TEXT NOT NULL,
      prepared_by               TEXT,
      reviewed_by               TEXT,
      approved_by               TEXT,
      detection_date            TEXT,
      incident_start_date       TEXT,
      incident_end_date         TEXT,
      draft_created_date        TEXT,
      filed_date                TEXT,
      acknowledged_date         TEXT,
      amount_involved_inr       INTEGER DEFAULT 0,
      narrative_summary         TEXT,
      reporting_jurisdiction    TEXT,
      regulator_reference       TEXT,
      retention_expiry_date     TEXT,
      retention_status          TEXT,
      documents_count           INTEGER DEFAULT 0,
      export_package_ready      INTEGER DEFAULT 0,
      export_count              INTEGER DEFAULT 0,
      last_exported_at          TEXT,
      law_enforcement_hold      INTEGER DEFAULT 0,
      access_classification     TEXT,
      current_owner             TEXT,
      latest_activity_date      TEXT,
      linked_alert_count        INTEGER DEFAULT 0,
      qa_score                  INTEGER DEFAULT 0,
      notes                     TEXT
    );

    CREATE TABLE IF NOT EXISTS cases (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id        TEXT UNIQUE NOT NULL,
      source_alert_id TEXT,
      linked_sar_id  TEXT,
      customer_id    TEXT,
      customer_name  TEXT NOT NULL,
      scenario       TEXT,
      case_status    TEXT NOT NULL,
      assigned_to    TEXT,
      created_date   TEXT,
      updated_date   TEXT
    );

    CREATE TABLE IF NOT EXISTS documents (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      sar_id          TEXT NOT NULL,
      document_name   TEXT NOT NULL,
      document_type   TEXT,
      file_path       TEXT NOT NULL,
      file_size       INTEGER NOT NULL DEFAULT 0,
      uploaded_by     TEXT,
      uploaded_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_trail (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      sar_id          TEXT NOT NULL,
      action          TEXT NOT NULL,
      performed_by    TEXT,
      timestamp       TEXT NOT NULL DEFAULT (datetime('now')),
      details         TEXT
    );

    CREATE TABLE IF NOT EXISTS customers (
      id                          INTEGER PRIMARY KEY AUTOINCREMENT,
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
      expected_monthly_value      INTEGER,
      expected_transaction_types  TEXT,
      primary_countries           TEXT,
      onboarding_notes            TEXT
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      account_number  TEXT UNIQUE NOT NULL,
      customer_id     TEXT NOT NULL,
      account_type    TEXT,
      currency        TEXT,
      status          TEXT,
      opened_date     TEXT,
      current_balance INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id   TEXT UNIQUE NOT NULL,
      account_number   TEXT NOT NULL,
      customer_id      TEXT NOT NULL,
      txn_date         TEXT NOT NULL,
      txn_time         TEXT,
      txn_type         TEXT,
      channel          TEXT,
      description      TEXT,
      counterparty     TEXT,
      counterparty_country TEXT,
      amount           INTEGER NOT NULL DEFAULT 0,
      running_balance  INTEGER NOT NULL DEFAULT 0,
      is_alerted       INTEGER NOT NULL DEFAULT 0,
      alert_id         TEXT,
      scenario_triggered TEXT,
      rule_breached    TEXT,
      risk_score       INTEGER
    );

    CREATE TABLE IF NOT EXISTS case_notes (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_id      TEXT NOT NULL,
      note_text     TEXT NOT NULL,
      analyst       TEXT,
      timestamp     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS case_documents (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_id       TEXT NOT NULL,
      file_name      TEXT NOT NULL,
      file_path      TEXT NOT NULL,
      document_type  TEXT,
      description    TEXT,
      uploaded_by    TEXT,
      uploaded_at    TEXT NOT NULL DEFAULT (datetime('now')),
      file_size      INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS user_profiles (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       TEXT UNIQUE NOT NULL,
      name          TEXT NOT NULL,
      role          TEXT NOT NULL,
      team          TEXT,
      status        TEXT NOT NULL DEFAULT 'Active',
      avatar_color  TEXT,
      email         TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS manager_settings (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      setting_key    TEXT UNIQUE NOT NULL,
      setting_value  TEXT,
      updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS employee_settings (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      analyst_id     TEXT NOT NULL,
      setting_key    TEXT NOT NULL,
      setting_value  TEXT,
      updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(analyst_id, setting_key)
    );

    CREATE INDEX IF NOT EXISTS idx_user_profiles_name ON user_profiles(name);
    CREATE INDEX IF NOT EXISTS idx_emp_settings_analyst ON employee_settings(analyst_id);

    CREATE TABLE IF NOT EXISTS retrieval_log (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      sar_id           TEXT NOT NULL,
      requested_by     TEXT NOT NULL,
      request_purpose  TEXT,
      requested_at     TEXT NOT NULL DEFAULT (datetime('now')),
      exported_at      TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_alerts_status    ON alerts(alert_status);
    CREATE INDEX IF NOT EXISTS idx_alerts_assigned  ON alerts(assigned_to);
    CREATE INDEX IF NOT EXISTS idx_alerts_case      ON alerts(case_id);
    CREATE INDEX IF NOT EXISTS idx_sar_status       ON sar_filings(sar_status);
    CREATE INDEX IF NOT EXISTS idx_sar_case         ON sar_filings(case_id);
    CREATE INDEX IF NOT EXISTS idx_sar_expiry       ON sar_filings(retention_expiry_date);
    CREATE INDEX IF NOT EXISTS idx_cases_status     ON cases(case_status);
    CREATE INDEX IF NOT EXISTS idx_cases_assigned   ON cases(assigned_to);
    CREATE INDEX IF NOT EXISTS idx_documents_sar    ON documents(sar_id);
    CREATE INDEX IF NOT EXISTS idx_audit_sar        ON audit_trail(sar_id);
    CREATE INDEX IF NOT EXISTS idx_txn_customer     ON transactions(customer_id);
    CREATE INDEX IF NOT EXISTS idx_txn_alert        ON transactions(alert_id);
    CREATE INDEX IF NOT EXISTS idx_txn_date         ON transactions(txn_date);
    CREATE INDEX IF NOT EXISTS idx_accounts_cust    ON accounts(customer_id);
    CREATE INDEX IF NOT EXISTS idx_case_notes_alert ON case_notes(alert_id);
    CREATE INDEX IF NOT EXISTS idx_case_docs_alert  ON case_documents(alert_id);

    CREATE TABLE IF NOT EXISTS sar_review_comments (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      sar_id           TEXT NOT NULL,
      manager_id       TEXT,
      comment_text     TEXT NOT NULL,
      highlighted_text TEXT,
      position_start   INTEGER,
      position_end     INTEGER,
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sar_approval_log (
      id                          INTEGER PRIMARY KEY AUTOINCREMENT,
      sar_id                      TEXT NOT NULL,
      action                      TEXT NOT NULL,
      actioned_by                 TEXT,
      reason_category             TEXT,
      comments                    TEXT,
      checklist_items_completed   TEXT,
      actioned_at                 TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient_id    TEXT,
      recipient_role  TEXT NOT NULL,
      type            TEXT NOT NULL,
      title           TEXT NOT NULL,
      message         TEXT,
      related_id      TEXT,
      related_type    TEXT,
      tone            TEXT,
      is_read         INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_review_comments_sar ON sar_review_comments(sar_id);
    CREATE INDEX IF NOT EXISTS idx_approval_log_sar    ON sar_approval_log(sar_id);
    CREATE INDEX IF NOT EXISTS idx_notif_recipient     ON notifications(recipient_id);
    CREATE INDEX IF NOT EXISTS idx_notif_role          ON notifications(recipient_role);
    CREATE INDEX IF NOT EXISTS idx_notif_read          ON notifications(is_read);

    CREATE TABLE IF NOT EXISTS kyc_reviews (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id           TEXT NOT NULL,
      review_type           TEXT NOT NULL,
      status                TEXT NOT NULL DEFAULT 'pending',
      priority              TEXT,
      due_date              TEXT,
      assigned_to           TEXT,
      assigned_by           TEXT,
      assigned_at           TEXT,
      assigned_note         TEXT,
      started_at            TEXT,
      completed_at          TEXT,
      previous_risk_rating  TEXT,
      new_risk_rating       TEXT,
      previous_cdd_level    TEXT,
      new_cdd_level         TEXT,
      review_findings       TEXT,
      checklist             TEXT,
      recommendation        TEXT,
      approved_by           TEXT,
      approved_at           TEXT,
      rejection_reason      TEXT,
      rejection_comments    TEXT,
      rejected_by           TEXT,
      rejected_at           TEXT,
      returned_to_analyst   INTEGER NOT NULL DEFAULT 0,
      created_at            TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS kyc_review_documents (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      review_id       INTEGER NOT NULL,
      document_name   TEXT NOT NULL,
      file_path       TEXT NOT NULL,
      document_type   TEXT,
      uploaded_by     TEXT,
      uploaded_at     TEXT NOT NULL DEFAULT (datetime('now')),
      file_size       INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_kyc_review_customer ON kyc_reviews(customer_id);
    CREATE INDEX IF NOT EXISTS idx_kyc_review_status   ON kyc_reviews(status);
    CREATE INDEX IF NOT EXISTS idx_kyc_review_assigned ON kyc_reviews(assigned_to);
    CREATE INDEX IF NOT EXISTS idx_kyc_review_due      ON kyc_reviews(due_date);
    CREATE INDEX IF NOT EXISTS idx_kyc_review_docs     ON kyc_review_documents(review_id);

    CREATE TABLE IF NOT EXISTS report_schedules (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      report_key    TEXT NOT NULL,
      frequency     TEXT NOT NULL,
      day_of        TEXT,
      format        TEXT NOT NULL,
      recipients    TEXT NOT NULL,
      created_by    TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_report_schedules_key ON report_schedules(report_key);
  `);

  ensureColumns('customers', [
    ['exit_status',     'TEXT'],
    ['last_review_id',  'INTEGER']
  ]);
  ensureColumns('alerts', [
    ['sla_warning_notified_at', 'TEXT'],
    ['sla_breach_notified_at',  'TEXT']
  ]);

  ensureColumns('sar_filings', [
    ['filing_type',              'TEXT'],
    ['filing_method',             'TEXT'],
    ['regulatory_agency',         'TEXT'],
    ['sar_type',                  'TEXT'],
    ['bsa_filing_institution',    'TEXT'],
    ['tin',                       'TEXT'],
    ['num_transactions',          'INTEGER'],
    ['total_amount',              'INTEGER'],
    ['currency',                  'TEXT'],
    ['structuring_indicator',     'INTEGER'],
    ['prior_sars',                'INTEGER'],
    ['prior_sar_count',           'INTEGER'],
    ['date_of_recent_sar',        'TEXT'],
    ['activity_date_from',        'TEXT'],
    ['activity_date_to',          'TEXT'],
    ['suspicious_activity_types', 'TEXT'],
    ['transaction_types',         'TEXT'],
    ['transaction_locations',     'TEXT'],
    ['ip_addresses',              'TEXT'],
    ['device_identifiers',        'TEXT'],
    ['subject_data',              'TEXT'],
    ['narrative',                 'TEXT'],
    ['certification_signed',      'INTEGER DEFAULT 0'],
    ['submitted_by',              'TEXT'],
    ['submitted_at',              'TEXT'],
    ['approved_at',               'TEXT'],
    ['draft_data',                'TEXT'],
    ['included_documents',        'TEXT'],
    ['created_at',                'TEXT'],
    ['updated_at',                'TEXT'],
    ['rejection_reason_category', 'TEXT'],
    ['rejection_comments',        'TEXT'],
    ['rejection_checklist',       'TEXT'],
    ['rejected_by',               'TEXT'],
    ['rejected_at',               'TEXT'],
    ['returned_to_analyst',       'INTEGER DEFAULT 0']
  ]);

  ensureColumns('alerts', [
    ['escalation_notes', 'TEXT'],
    ['fp_close_reason',  'TEXT']
  ]);

  ensureColumns('kyc_reviews', [
    ['triggered_by_sar_id',   'TEXT'],
    ['triggered_by_alert_id', 'TEXT']
  ]);

  ensureColumns('alerts', [
    ['escalated_to', 'TEXT']
  ]);
}

const { MANAGER_DEFAULTS, EMPLOYEE_DEFAULTS, colorForName } = require('./admin_defaults');

const USER_ROLE_MAP = {
  'Rohit Sharma':  { role: 'AML Analyst L2', team: 'T2 Investigations' },
  'Priya Nair':    { role: 'AML Analyst L2', team: 'T2 Investigations' },
  'Amit Verma':    { role: 'AML Analyst L1', team: 'T1 Monitoring' },
  'Neha Iyer':     { role: 'AML Analyst L1', team: 'T1 Monitoring' },
  'Sanjay Patil':  { role: 'AML Analyst L1', team: 'T1 Monitoring' },
  'Ananya Sen':    { role: 'Team Lead',         team: 'T2 Investigations' },
  'Vikram Mehta':  { role: 'Team Lead',         team: 'T2 Investigations' },
  'Farah Khan':    { role: 'Team Lead',         team: 'T2 Investigations' },
  'Arjun Malhotra':{ role: 'Compliance Manager', team: 'Oversight' },
  'Nisha Rao':     { role: 'Compliance Manager', team: 'Oversight' }
};

function collectUserNames() {
  const names = new Set();
  const addFrom = (rows, col) => rows.forEach(r => { if (r[col]) names.add(r[col]); });
  const alertNames = db.prepare("SELECT DISTINCT assigned_to FROM alerts WHERE assigned_to IS NOT NULL AND TRIM(assigned_to) <> ''").all();
  addFrom(alertNames, 'assigned_to');
  const preparedNames = db.prepare("SELECT DISTINCT prepared_by FROM sar_filings WHERE prepared_by IS NOT NULL").all();
  addFrom(preparedNames, 'prepared_by');
  const reviewedNames = db.prepare("SELECT DISTINCT reviewed_by FROM sar_filings WHERE reviewed_by IS NOT NULL").all();
  addFrom(reviewedNames, 'reviewed_by');
  const approvedNames = db.prepare("SELECT DISTINCT approved_by FROM sar_filings WHERE approved_by IS NOT NULL").all();
  addFrom(approvedNames, 'approved_by');
  return [...names].sort();
}

function seedAdminDataIfEmpty() {
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM user_profiles').get().c;
  if (userCount === 0) {
    const names = collectUserNames();
    const insert = db.prepare(`
      INSERT INTO user_profiles (user_id, name, role, team, status, avatar_color, email)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    let i = 1;
    for (const name of names) {
      const mapping = USER_ROLE_MAP[name] || { role: 'AML Analyst L1', team: 'T1 Monitoring' };
      const uid = `USR-${String(i++).padStart(4, '0')}`;
      const email = `${name.toLowerCase().replace(/\s+/g, '.')}@bank.in`;
      insert.run(uid, name, mapping.role, mapping.team, 'Active', colorForName(name), email);
    }
  }

  const mgrCount = db.prepare('SELECT COUNT(*) AS c FROM manager_settings').get().c;
  if (mgrCount === 0) {
    const insert = db.prepare(`
      INSERT INTO manager_settings (setting_key, setting_value) VALUES (?, ?)
    `);
    for (const [k, v] of Object.entries(MANAGER_DEFAULTS)) {
      insert.run(k, JSON.stringify(v));
    }
  }
}

function migrateInrToUsd() {
  const userVersion = db.prepare('PRAGMA user_version').get().user_version;
  if (userVersion >= 1) return;

  const RATE = 0.012;
  const round = (n) => Math.max(0, Math.round(Number(n || 0) * RATE));

  const convertText = (s) => {
    if (!s) return s;
    return s.replace(/INR\s+([0-9,]+)/g, (_, num) => {
      const n = Number(String(num).replace(/,/g, ''));
      if (!isFinite(n)) return _;
      return '$' + Math.round(n * RATE).toLocaleString('en-US');
    });
  };

  // Numeric amount columns
  const updates = [
    ['UPDATE alerts SET amount_flagged_inr = ROUND(amount_flagged_inr * ?) WHERE amount_flagged_inr IS NOT NULL'],
    ['UPDATE sar_filings SET amount_involved_inr = ROUND(amount_involved_inr * ?) WHERE amount_involved_inr IS NOT NULL'],
    ['UPDATE sar_filings SET total_amount = ROUND(total_amount * ?) WHERE total_amount IS NOT NULL'],
    ['UPDATE transactions SET amount = ROUND(amount * ?) WHERE amount IS NOT NULL'],
    ['UPDATE transactions SET running_balance = ROUND(running_balance * ?) WHERE running_balance IS NOT NULL'],
    ['UPDATE accounts SET current_balance = ROUND(current_balance * ?) WHERE current_balance IS NOT NULL'],
    ['UPDATE customers SET expected_monthly_value = ROUND(expected_monthly_value * ?) WHERE expected_monthly_value IS NOT NULL']
  ];
  for (const [sql] of updates) db.prepare(sql).run(RATE);

  // Account currency label
  db.prepare("UPDATE accounts SET currency = 'USD' WHERE currency = 'INR'").run();

  // Customer turnover labels
  const turnoverMap = {
    'INR 5 Cr – 25 Cr':    '$1M – $10M',
    'INR 25 Cr – 100 Cr':  '$10M – $50M',
    'INR 100 Cr – 500 Cr': '$50M – $250M',
    'INR 500 Cr – 1000 Cr':'$250M – $500M',
    'INR 1000 Cr +':       '$500M +'
  };
  const updTurnover = db.prepare('UPDATE customers SET annual_turnover_range = ? WHERE annual_turnover_range = ?');
  for (const [oldVal, newVal] of Object.entries(turnoverMap)) updTurnover.run(newVal, oldVal);

  // Narrative text — replace "INR X,XXX,XXX" with "$Y"
  const alertRows = db.prepare('SELECT alert_id, scenario_description, narrative_seed FROM alerts').all();
  const updAlertText = db.prepare('UPDATE alerts SET scenario_description = ?, narrative_seed = ? WHERE alert_id = ?');
  for (const a of alertRows) {
    const sd = convertText(a.scenario_description);
    const ns = convertText(a.narrative_seed);
    if (sd !== a.scenario_description || ns !== a.narrative_seed) {
      updAlertText.run(sd, ns, a.alert_id);
    }
  }
  const sarRows = db.prepare('SELECT sar_id, narrative_summary, narrative FROM sar_filings').all();
  const updSarText = db.prepare('UPDATE sar_filings SET narrative_summary = ?, narrative = ? WHERE sar_id = ?');
  for (const s of sarRows) {
    const ns = convertText(s.narrative_summary);
    const n2 = convertText(s.narrative);
    if (ns !== s.narrative_summary || n2 !== s.narrative) {
      updSarText.run(ns, n2, s.sar_id);
    }
  }

  // Bank name on existing draft SAR filings
  db.prepare(`
    UPDATE sar_filings
       SET bsa_filing_institution = 'First National Bank - US (FEIN: 12-3456789)'
     WHERE bsa_filing_institution LIKE '%Crowe%'
        OR bsa_filing_institution LIKE '%Bharat%'
  `).run();

  db.exec('PRAGMA user_version = 1');
  console.log('[db] INR → USD migration complete');
}

function backfillKycTriggerLinks() {
  const userVersion = db.prepare('PRAGMA user_version').get().user_version;
  if (userVersion >= 2) return;

  // Link every existing triggered_sar review to its customer's most recent SAR
  const sarReviews = db.prepare(`
    SELECT id, customer_id FROM kyc_reviews
     WHERE review_type = 'triggered_sar' AND triggered_by_sar_id IS NULL
  `).all();
  let linkedSar = 0;
  const lookupSar = db.prepare(`
    SELECT sar_id FROM sar_filings
     WHERE customer_id = ?
     ORDER BY datetime(COALESCE(filed_date, draft_created_date)) DESC
     LIMIT 1
  `);
  const updReview = db.prepare('UPDATE kyc_reviews SET triggered_by_sar_id = ? WHERE id = ?');
  for (const r of sarReviews) {
    const s = lookupSar.get(r.customer_id);
    if (s) { updReview.run(s.sar_id, r.id); linkedSar++; }
  }

  // Link triggered_alerts reviews to most recent alert for that customer
  const alertReviews = db.prepare(`
    SELECT id, customer_id FROM kyc_reviews
     WHERE review_type = 'triggered_alerts' AND triggered_by_alert_id IS NULL
  `).all();
  let linkedAlerts = 0;
  const lookupAlert = db.prepare(`
    SELECT alert_id FROM alerts
     WHERE customer_id = ?
     ORDER BY date(created_date) DESC
     LIMIT 1
  `);
  const updAlertRef = db.prepare('UPDATE kyc_reviews SET triggered_by_alert_id = ? WHERE id = ?');
  for (const r of alertReviews) {
    const a = lookupAlert.get(r.customer_id);
    if (a) { updAlertRef.run(a.alert_id, r.id); linkedAlerts++; }
  }

  db.exec('PRAGMA user_version = 2');
  console.log(`[db] backfilled trigger refs: ${linkedSar} SAR, ${linkedAlerts} alert`);
}

module.exports = { db, initSchema, seedAdminDataIfEmpty, migrateInrToUsd, backfillKycTriggerLinks, DB_PATH };
