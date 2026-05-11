// One-shot loader for the BSA extension dataset:
//   - counterparties.csv          (60 rows, # comments stripped)
//   - scenario_versions.csv       (12 rows, parameters_json parsed)
//   - alert_transactions.csv      (123 rows, alert_id remapped from BSA-ALERT-XXXX)
//   - rule_explanations.csv       (24 rows, alert_id remapped)
//
// Also:
//   - ensures the alerts.rule_explanation JSONB column exists
//   - rewrites any sar_filings.regulator_reference 'FIU-' prefix to 'BSA-'
//   - inserts the BSA Officer user (James Carter) if missing
//
// Run with: DATABASE_URL=... node scripts/load-bsa-extension.js
//
// Safe to re-run: every insert is ON CONFLICT DO NOTHING or guarded by
// WHERE NOT EXISTS / IF NOT EXISTS.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const { Pool } = require('pg');

const SEED = path.join(__dirname, '..', 'seed_data');

function parseCsv(file, { cleanFields = false } = {}) {
  const raw = fs.readFileSync(path.join(SEED, file), 'utf8');
  const out = Papa.parse(raw, { header: true, skipEmptyLines: true });
  if (out.errors?.length) {
    out.errors.slice(0, 3).forEach(e => console.warn(`[parse] ${file}: ${e.message}`));
  }
  if (cleanFields) {
    return out.data.map(row => {
      const cleaned = {};
      for (const k of Object.keys(row)) {
        const v = row[k];
        if (typeof v === 'string') {
          // Strip everything from the first '#' onwards, then trim.
          cleaned[k] = v.split('#')[0].trim();
        } else {
          cleaned[k] = v;
        }
      }
      return cleaned;
    });
  }
  return out.data;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required.');
    process.exit(1);
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  const counters = {
    counterparties_inserted: 0,
    scenario_versions_inserted: 0,
    alert_transactions_inserted: 0,
    alert_transactions_skipped: 0,
    alerts_updated_with_rule_explanation: 0,
    sars_with_fiu_prefix_fixed: 0,
    bsa_officer_added: false
  };

  try {
    // ───────────────────────── Pre-flight schema
    await pool.query(`
      CREATE TABLE IF NOT EXISTS counterparties (
        id SERIAL PRIMARY KEY,
        counterparty_id TEXT UNIQUE NOT NULL,
        canonical_name TEXT NOT NULL,
        country TEXT,
        industry TEXT,
        risk_score INTEGER DEFAULT 0,
        sanctions_screening_status TEXT DEFAULT 'not_screened',
        first_seen_at TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS scenario_versions (
        id SERIAL PRIMARY KEY,
        scenario_code TEXT NOT NULL,
        version_number TEXT NOT NULL,
        effective_from DATE,
        effective_to DATE,
        status TEXT DEFAULT 'active',
        created_by TEXT,
        approved_by TEXT,
        justification TEXT,
        parameters_json JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(scenario_code, version_number)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS alert_transactions (
        id SERIAL PRIMARY KEY,
        alert_id TEXT NOT NULL,
        transaction_id TEXT NOT NULL,
        role TEXT DEFAULT 'triggering',
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(alert_id, transaction_id)
      )
    `);
    await pool.query(`ALTER TABLE alerts ADD COLUMN IF NOT EXISTS rule_explanation JSONB`);

    // ───────────────────────── Build BSA-ALERT-XXXX → real alert_id map
    const realAlerts = (await pool.query(
      `SELECT alert_id FROM alerts ORDER BY id ASC`
    )).rows.map(r => r.alert_id);
    const bsaMap = new Map();
    for (let i = 0; i < realAlerts.length; i++) {
      const synth = `BSA-ALERT-${String(i + 1).padStart(4, '0')}`;
      bsaMap.set(synth, realAlerts[i]);
    }
    console.log(`[map] Built BSA-ALERT-XXXX → real alert_id map. Total alerts: ${realAlerts.length}`);
    console.log(`[map] BSA-ALERT-0001 → ${bsaMap.get('BSA-ALERT-0001')}`);
    console.log(`[map] BSA-ALERT-0002 → ${bsaMap.get('BSA-ALERT-0002')}`);

    // ───────────────────────── 1. counterparties
    const cpRows = parseCsv('counterparties.csv', { cleanFields: true });
    for (const r of cpRows) {
      if (!r.counterparty_id || !r.canonical_name) continue;
      const res = await pool.query(`
        INSERT INTO counterparties
          (counterparty_id, canonical_name, country, industry, risk_score, sanctions_screening_status)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (counterparty_id) DO NOTHING
      `, [
        r.counterparty_id,
        r.canonical_name,
        r.country || null,
        r.industry || null,
        r.risk_score ? Number(r.risk_score) : 0,
        r.sanctions_screening_status || 'not_screened'
      ]);
      counters.counterparties_inserted += res.rowCount;
    }
    console.log(`[counterparties] inserted ${counters.counterparties_inserted}/${cpRows.length}`);

    // ───────────────────────── 2. scenario_versions
    const svRows = parseCsv('scenario_versions.csv');
    for (const r of svRows) {
      if (!r.scenario_code || !r.version_number) continue;
      let parsedJson = null;
      try {
        parsedJson = r.parameters_json ? JSON.parse(r.parameters_json) : null;
      } catch (_e) {
        console.warn(`[scenario_versions] bad JSON on ${r.scenario_code} v${r.version_number}`);
      }
      const res = await pool.query(`
        INSERT INTO scenario_versions
          (scenario_code, version_number, effective_from, effective_to,
           status, created_by, approved_by, justification, parameters_json)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
        ON CONFLICT (scenario_code, version_number) DO NOTHING
      `, [
        r.scenario_code,
        String(r.version_number),
        r.effective_from || null,
        r.effective_to && String(r.effective_to).trim() ? r.effective_to : null,
        r.status || 'active',
        r.created_by || null,
        r.approved_by || null,
        r.justification || null,
        parsedJson === null ? null : JSON.stringify(parsedJson)
      ]);
      counters.scenario_versions_inserted += res.rowCount;
    }
    console.log(`[scenario_versions] inserted ${counters.scenario_versions_inserted}/${svRows.length}`);

    // ───────────────────────── 3. alert_transactions  (FK-validated)
    const txnIdSet = new Set(
      (await pool.query(`SELECT transaction_id FROM transactions`)).rows.map(r => r.transaction_id)
    );
    const alertIdSet = new Set(realAlerts);
    const atRows = parseCsv('alert_transactions.csv');
    for (const r of atRows) {
      if (!r.alert_id || !r.transaction_id) { counters.alert_transactions_skipped++; continue; }
      const realAlertId = bsaMap.get(r.alert_id) || r.alert_id;
      if (!alertIdSet.has(realAlertId) || !txnIdSet.has(r.transaction_id)) {
        counters.alert_transactions_skipped++;
        continue;
      }
      const res = await pool.query(`
        INSERT INTO alert_transactions (alert_id, transaction_id, role)
        VALUES ($1, $2, $3)
        ON CONFLICT (alert_id, transaction_id) DO NOTHING
      `, [realAlertId, r.transaction_id, r.role || 'triggering']);
      counters.alert_transactions_inserted += res.rowCount;
    }
    console.log(`[alert_transactions] inserted ${counters.alert_transactions_inserted}, skipped ${counters.alert_transactions_skipped}`);

    // ───────────────────────── 4. rule_explanations (UPDATE alerts)
    const reRows = parseCsv('rule_explanations.csv');
    for (const r of reRows) {
      if (!r.alert_id || !r.rule_explanation) continue;
      const realAlertId = bsaMap.get(r.alert_id) || r.alert_id;
      if (!alertIdSet.has(realAlertId)) continue;
      // Sanity-parse the JSON before sending it
      try { JSON.parse(r.rule_explanation); }
      catch (_e) { console.warn(`[rule_explanations] bad JSON on ${r.alert_id}, skipped`); continue; }
      const res = await pool.query(`
        UPDATE alerts SET rule_explanation = $1::jsonb WHERE alert_id = $2
      `, [r.rule_explanation, realAlertId]);
      counters.alerts_updated_with_rule_explanation += res.rowCount;
    }
    console.log(`[rule_explanations] updated ${counters.alerts_updated_with_rule_explanation} alerts`);

    // ───────────────────────── 5. FIU → BSA prefix fix on sar_filings
    const fix = await pool.query(`
      UPDATE sar_filings
         SET regulator_reference = REPLACE(regulator_reference, 'FIU-', 'BSA-')
       WHERE regulator_reference LIKE 'FIU-%'
    `);
    counters.sars_with_fiu_prefix_fixed = fix.rowCount;
    console.log(`[sar_filings] FIU→BSA rewritten on ${fix.rowCount} row(s)`);

    // ───────────────────────── 6. BSA Officer user (James Carter)
    // user_profiles.user_id is UNIQUE NOT NULL, username has no unique
    // constraint, so we guard with WHERE NOT EXISTS rather than ON CONFLICT.
    const nextUid = (await pool.query(`
      SELECT COALESCE(
        'USR-' || LPAD((MAX(SUBSTRING(user_id FROM 5)::int) + 1)::text, 4, '0'),
        'USR-0012'
      ) AS next_uid
      FROM user_profiles
      WHERE user_id ~ '^USR-[0-9]+$'
    `)).rows[0].next_uid;
    const ins = await pool.query(`
      INSERT INTO user_profiles
        (user_id, name, role, team, status, avatar_color, email, username, password)
      SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9
       WHERE NOT EXISTS (
         SELECT 1 FROM user_profiles WHERE username = $8
       )
    `, [
      nextUid, 'James Carter', 'bsa_officer', 'Compliance',
      'Active', '#0EA5E9', 'james.carter@bank.in', 'james.carter', 'James@123'
    ]);
    counters.bsa_officer_added = ins.rowCount > 0;
    console.log(`[bsa_officer] ${ins.rowCount > 0 ? `added as ${nextUid}` : 'already present'}`);

    // ───────────────────────── Final report
    console.log('\n────────── FINAL REPORT ──────────');
    console.log(JSON.stringify(counters, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
