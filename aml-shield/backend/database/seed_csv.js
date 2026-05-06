// Replace the data inside the demo tables with the CSV dataset shipped in
// backend/seed_data/. Schema is NOT touched — run database/migrate.js once
// before this if the tables don't exist yet.
//
// Usage: npm run seed:csv  (DATABASE_URL must be set in env)
//
// Order of operations:
//   1. Read every CSV into memory (papaparse, header:true)
//   2. Build lookup maps the inserts need:
//      - customerById        (for customer_name + risk enrichment)
//      - accountById         (account_id → account_number, used by
//                             transactions; alerts drop it entirely)
//      - caseToAlert         (case_id → alert_id; case_notes & sar_filings)
//      - alertById           (for cases.scenario fallback)
//   3. BEGIN transaction
//   4. DELETE in child→parent order (keeps user_profiles and settings)
//   5. INSERT in parent→child order, batching transactions/alerts at 100
//   6. COMMIT — or ROLLBACK on first failure with a clear message

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const pool = require('./db');

const SEED_DIR = path.join(__dirname, '..', 'seed_data');
const BATCH_SIZE = 100;

// ────────────────────────────────────────────── helpers

function readCsv(name) {
  const fullPath = path.join(SEED_DIR, name);
  const text = fs.readFileSync(fullPath, 'utf8');
  const result = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false   // keep everything as strings; coerce explicitly
  });
  if (result.errors.length > 0) {
    console.warn(`[seed] CSV warnings in ${name}:`, result.errors.slice(0, 3));
  }
  return result.data;
}

// Empty/blank string → null. Anything else passes through trimmed.
function nullable(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

// "true" / "True" / "1" / "yes" → 1, anything else → 0
function bool01(v) {
  if (v === undefined || v === null) return 0;
  const s = String(v).trim().toLowerCase();
  return (s === 'true' || s === '1' || s === 'yes') ? 1 : 0;
}

function intOrNull(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function intOrZero(v) {
  const n = intOrNull(v);
  return n === null ? 0 : n;
}

// Build a parametrized batch INSERT for `rows` and run it `BATCH_SIZE` rows
// at a time on the supplied client. On failure logs which batch failed
// (helpful when one row violates a NOT NULL or unique constraint).
async function batchInsert(client, table, columns, rows, label) {
  if (rows.length === 0) {
    console.log(`[seed]   ${label}: 0 rows (nothing to insert)`);
    return 0;
  }
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map((_, ri) => {
      const start = ri * columns.length;
      return '(' + columns.map((_, ci) => `$${start + ci + 1}`).join(', ') + ')';
    }).join(', ');
    const values = [];
    for (const row of batch) for (const col of columns) values.push(row[col]);
    const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders}`;
    try {
      await client.query(sql, values);
      inserted += batch.length;
      console.log(`[seed]   ${label}: ${inserted} / ${rows.length}`);
    } catch (err) {
      console.error(`[seed] ❌ ${label} batch starting at row ${i} failed: ${err.message}`);
      throw err;
    }
  }
  return inserted;
}

// ────────────────────────────────────────────── main

async function run() {
  console.log('[seed] Reading CSV files from', SEED_DIR);
  const customersCsv    = readCsv('customers.csv');
  const accountsCsv     = readCsv('accounts.csv');
  const transactionsCsv = readCsv('transactions.csv');
  const alertsCsv       = readCsv('alerts.csv');
  const casesCsv        = readCsv('cases.csv');
  const caseNotesCsv    = readCsv('case_notes.csv');
  const sarsCsv         = readCsv('sar_filings.csv');

  console.log(`[seed]   customers=${customersCsv.length} accounts=${accountsCsv.length} transactions=${transactionsCsv.length} alerts=${alertsCsv.length} cases=${casesCsv.length} case_notes=${caseNotesCsv.length} sar_filings=${sarsCsv.length}`);

  // ── lookup maps ──
  const customerById = new Map();
  for (const c of customersCsv) customerById.set(c.customer_id, c);

  const accountById = new Map();
  for (const a of accountsCsv) accountById.set(a.account_id, a.account_number);

  const caseToAlert = new Map();
  for (const c of casesCsv) caseToAlert.set(c.case_id, c.alert_id);

  const alertById = new Map();
  for (const a of alertsCsv) alertById.set(a.alert_id, a);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── clear in child→parent order (keep user_profiles + settings) ──
    console.log('[seed] Clearing existing data...');
    const deleteOrder = [
      'sar_review_comments', 'sar_approval_log', 'retrieval_log',
      'audit_trail', 'notifications',
      'kyc_review_documents', 'kyc_reviews',
      'l2_documents', 'l2_notes', 'l2_cases',
      'sar_filings', 'case_documents', 'case_notes', 'cases',
      'documents', 'alerts', 'transactions', 'accounts', 'customers'
    ];
    for (const t of deleteOrder) {
      try {
        const r = await client.query(`DELETE FROM ${t}`);
        console.log(`[seed]   cleared ${t}: ${r.rowCount} row(s)`);
      } catch (err) {
        console.error(`[seed] ❌ Clear ${t} failed: ${err.message}`);
        throw err;
      }
    }

    // ── customers ──
    console.log('[seed] Inserting customers...');
    const customerCols = [
      'customer_id', 'customer_name', 'customer_type', 'date_of_birth',
      'nationality', 'residential_address', 'phone_number', 'email_address',
      'job_title', 'employer_name', 'annual_income_range',
      'source_of_funds', 'source_of_wealth',
      'customer_risk_rating', 'cdd_level', 'pep_match', 'sanctions_match',
      'customer_since_date', 'last_kyc_review_date', 'next_kyc_due_date',
      'kyc_review_status', 'expected_monthly_volume', 'expected_monthly_value'
    ];
    const customerRows = customersCsv.map(c => ({
      customer_id: c.customer_id,
      customer_name: c.customer_name,
      customer_type: nullable(c.customer_type),
      date_of_birth: nullable(c.date_of_birth),
      nationality: nullable(c.nationality),
      // Q1: concat address + city + state + zip into residential_address
      residential_address: [c.address, c.city, c.state, c.zip]
        .filter(s => s && String(s).trim()).join(', ') || null,
      phone_number: nullable(c.phone),
      email_address: nullable(c.email),
      job_title: nullable(c.occupation),
      employer_name: nullable(c.employer),
      // Q2: keep raw numeric income as a string (DB column is TEXT)
      annual_income_range: nullable(c.annual_income),
      source_of_funds: nullable(c.source_of_funds),
      source_of_wealth: nullable(c.source_of_wealth),
      customer_risk_rating: nullable(c.risk_rating),
      cdd_level: nullable(c.cdd_level),
      pep_match: bool01(c.pep_match),
      sanctions_match: bool01(c.sanctions_match),
      customer_since_date: nullable(c.customer_since),
      last_kyc_review_date: nullable(c.last_kyc_review),
      next_kyc_due_date: nullable(c.next_kyc_due),
      kyc_review_status: nullable(c.kyc_status),
      expected_monthly_volume: intOrNull(c.expected_monthly_txn_volume),
      expected_monthly_value: intOrNull(c.expected_monthly_txn_value)
    }));
    const customersInserted = await batchInsert(client, 'customers', customerCols, customerRows, 'customers');
    console.log('[seed] ✅ customers done');

    // ── accounts ──
    console.log('[seed] Inserting accounts...');
    const accountCols = [
      'account_number', 'customer_id', 'account_type',
      'currency', 'status', 'opened_date', 'current_balance'
    ];
    const accountRows = accountsCsv.map(a => ({
      account_number: a.account_number,
      customer_id: a.customer_id,
      account_type: nullable(a.account_type),
      currency: nullable(a.currency),
      status: nullable(a.status),
      opened_date: nullable(a.opened_date),
      current_balance: intOrZero(a.current_balance)
    }));
    const accountsInserted = await batchInsert(client, 'accounts', accountCols, accountRows, 'accounts');
    console.log('[seed] ✅ accounts done');

    // ── transactions (translate account_id → account_number) ──
    console.log('[seed] Inserting transactions...');
    const txnCols = [
      'transaction_id', 'account_number', 'customer_id', 'txn_date', 'txn_time',
      'txn_type', 'channel', 'description', 'counterparty', 'counterparty_country',
      'amount', 'running_balance', 'is_alerted', 'alert_id'
    ];
    let txnSkipped = 0;
    const txnRows = [];
    for (const t of transactionsCsv) {
      const accountNumber = accountById.get(t.account_id);
      if (!accountNumber) { txnSkipped++; continue; }
      txnRows.push({
        transaction_id: t.transaction_id,
        account_number: accountNumber,
        customer_id: t.customer_id,
        txn_date: nullable(t.txn_date),
        txn_time: nullable(t.txn_time),
        txn_type: nullable(t.txn_type),
        channel: nullable(t.channel),
        description: nullable(t.description),
        counterparty: nullable(t.counterparty_name),
        counterparty_country: nullable(t.counterparty_country),
        amount: intOrZero(t.amount),
        running_balance: intOrZero(t.running_balance),
        is_alerted: bool01(t.is_alerted),
        alert_id: nullable(t.alert_id)
      });
    }
    if (txnSkipped > 0) console.warn(`[seed]   ⚠ skipped ${txnSkipped} transaction(s) with unresolved account_id`);
    const txnsInserted = await batchInsert(client, 'transactions', txnCols, txnRows, 'transactions');
    console.log('[seed] ✅ transactions done');

    // ── alerts (Q3: enrich from customers map; drop account_id + team) ──
    console.log('[seed] Inserting alerts...');
    const alertCols = [
      'alert_id', 'customer_id', 'customer_name', 'customer_type',
      'scenario', 'alert_status', 'priority', 'risk_score',
      'amount_flagged_inr', 'assigned_to', 'created_date', 'closed_date',
      'sla_days', 'sla_deadline', 'disposition',
      'customer_risk_rating', 'pep_match', 'sanctions_match', 'kyc_review_status',
      'last_activity_date'
    ];
    const alertRows = alertsCsv.map(a => {
      const cust = customerById.get(a.customer_id) || {};
      return {
        alert_id: a.alert_id,
        customer_id: a.customer_id,
        // alerts.customer_name is NOT NULL — fall back to customer_id only
        // if no customers row matched (shouldn't happen with this dataset).
        customer_name: cust.customer_name || a.customer_id,
        customer_type: nullable(cust.customer_type),
        scenario: a.scenario,
        alert_status: a.alert_status,
        priority: a.priority,
        risk_score: intOrNull(a.risk_score),
        amount_flagged_inr: intOrZero(a.amount),
        assigned_to: nullable(a.assigned_to),
        created_date: nullable(a.created_at),
        closed_date: nullable(a.closed_at),
        sla_days: intOrNull(a.sla_days) ?? 30,
        sla_deadline: nullable(a.sla_due_date),
        disposition: nullable(a.disposition),
        customer_risk_rating: nullable(cust.risk_rating),
        pep_match: bool01(cust.pep_match),
        sanctions_match: bool01(cust.sanctions_match),
        kyc_review_status: nullable(cust.kyc_status),
        last_activity_date: nullable(a.closed_at) || nullable(a.created_at)
      };
    });
    const alertsInserted = await batchInsert(client, 'alerts', alertCols, alertRows, 'alerts');
    console.log('[seed] ✅ alerts done');

    // ── cases (Q3: enrich scenario from alert lookup) ──
    console.log('[seed] Inserting cases...');
    const caseCols = [
      'case_id', 'source_alert_id', 'customer_id', 'customer_name',
      'scenario', 'case_status', 'assigned_to', 'created_date', 'updated_date'
    ];
    const caseRows = casesCsv.map(c => {
      const cust = customerById.get(c.customer_id) || {};
      const linkedAlert = alertById.get(c.alert_id) || {};
      return {
        case_id: c.case_id,
        source_alert_id: nullable(c.alert_id),
        customer_id: c.customer_id,
        customer_name: cust.customer_name || c.customer_id,
        scenario: nullable(linkedAlert.scenario),
        case_status: c.status,
        assigned_to: nullable(c.assigned_to),
        created_date: nullable(c.created_at),
        updated_date: nullable(c.updated_at)
      };
    });
    const casesInserted = await batchInsert(client, 'cases', caseCols, caseRows, 'cases');
    console.log('[seed] ✅ cases done');

    // ── case_notes (CSV stores by case_id; DB stores by alert_id) ──
    console.log('[seed] Inserting case_notes...');
    const noteCols = ['alert_id', 'note_text', 'analyst', 'timestamp'];
    let notesSkipped = 0;
    const noteRows = [];
    for (const n of caseNotesCsv) {
      const alertId = caseToAlert.get(n.case_id);
      if (!alertId) { notesSkipped++; continue; }
      noteRows.push({
        alert_id: alertId,
        note_text: n.note_text,
        analyst: nullable(n.analyst),
        // timestamp column is NOT NULL with a default; never insert NULL.
        timestamp: nullable(n.timestamp) || new Date().toISOString().slice(0, 19).replace('T', ' ')
      });
    }
    if (notesSkipped > 0) console.warn(`[seed]   ⚠ skipped ${notesSkipped} case_note(s) with unresolved case_id`);
    const notesInserted = await batchInsert(client, 'case_notes', noteCols, noteRows, 'case_notes');
    console.log('[seed] ✅ case_notes done');

    // ── sar_filings ──
    // Q4: date_of_report → submitted_at. Q5: total_amount rounded to int.
    // Q6: filed_by → both prepared_by and submitted_by. Q7: drop retention_period_years.
    console.log('[seed] Inserting sar_filings...');
    const sarCols = [
      'sar_id', 'case_id', 'source_alert_id', 'customer_id', 'customer_name',
      'filing_type', 'filing_method', 'regulatory_agency', 'sar_type',
      'detection_date', 'submitted_at',
      'total_amount', 'currency',
      'structuring_indicator', 'prior_sars',
      'activity_date_from', 'activity_date_to', 'suspicious_activity_types',
      'narrative', 'sar_status', 'prepared_by', 'submitted_by',
      'filed_date', 'retention_expiry_date'
    ];
    const sarRows = sarsCsv.map(s => {
      const cust = customerById.get(s.customer_id) || {};
      const sourceAlert = caseToAlert.get(s.case_id) || null;
      return {
        sar_id: s.sar_id,
        case_id: nullable(s.case_id),
        source_alert_id: sourceAlert,
        customer_id: nullable(s.customer_id),
        customer_name: cust.customer_name || s.customer_id,
        filing_type: nullable(s.filing_type),
        filing_method: nullable(s.filing_method),
        regulatory_agency: nullable(s.regulatory_agency),
        sar_type: nullable(s.sar_type),
        detection_date: nullable(s.date_of_detection),
        submitted_at: nullable(s.date_of_report),
        total_amount: intOrNull(s.total_amount),
        currency: nullable(s.currency),
        structuring_indicator: bool01(s.structuring_indicator),
        prior_sars: bool01(s.prior_sars),
        activity_date_from: nullable(s.activity_date_from),
        activity_date_to: nullable(s.activity_date_to),
        suspicious_activity_types: nullable(s.suspicious_activity_types),
        narrative: nullable(s.narrative),
        sar_status: s.status,
        prepared_by: nullable(s.filed_by),
        submitted_by: nullable(s.filed_by),
        filed_date: nullable(s.filed_date),
        retention_expiry_date: nullable(s.retention_expiry_date)
      };
    });
    const sarsInserted = await batchInsert(client, 'sar_filings', sarCols, sarRows, 'sar_filings');
    console.log('[seed] ✅ sar_filings done');

    await client.query('COMMIT');

    console.log('[seed] Complete:', {
      customers: customersInserted,
      accounts: accountsInserted,
      transactions: txnsInserted,
      alerts: alertsInserted,
      cases: casesInserted,
      case_notes: notesInserted,
      sar_filings: sarsInserted
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_e) { /* ignore */ }
    console.error('[seed] ❌ Failed — rolled back. Error:', err.message);
    if (err.detail) console.error('[seed]    detail:', err.detail);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
