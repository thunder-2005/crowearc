require('dotenv').config();
const path = require('path');
const fs = require('fs');
const pool = require('./db');
const { MANAGER_DEFAULTS, colorForName } = require('./admin_defaults');

const REFERENCE_DATE = '2026-04-23';
const SEED_DIR = path.join(__dirname, 'seed_data');
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const USER_ROLE_MAP = {
  'Olivia Brown':  { role: 'analyst_l2',         team: 'T2 Investigations' },
  'Cassian Jude':  { role: 'analyst_l2',         team: 'T2 Investigations' },
  'Marie Davis':   { role: 'analyst_l2',         team: 'T2 Investigations' },
  'Hannah Louise': { role: 'analyst_l2',         team: 'T2 Investigations' },
  'Robert Wright': { role: 'analyst_l1',         team: 'T1 Monitoring' },
  'Arjun Sharma':  { role: 'analyst_l1',         team: 'T1 Monitoring' },
  'Priya Nair':    { role: 'analyst_l1',         team: 'T1 Monitoring' },
  'Rohit Mehta':   { role: 'analyst_l1',         team: 'T1 Monitoring' },
  'Neha Iyer':     { role: 'analyst_l1',         team: 'T1 Monitoring' },
  'Vikram Sinha':  { role: 'analyst_l1',         team: 'T1 Monitoring' },
  'Henry Morgan':  { role: 'compliance_manager', team: 'Management' }
};

// Demo credentials. Keep in sync with migrate.js CREDENTIALS.
const CREDENTIALS_BY_NAME = {
  'Henry Morgan':  { username: 'henry.morgan',  password: 'Henry@123'   },
  'Olivia Brown':  { username: 'olivia.brown',  password: 'Olivia@123'  },
  'Cassian Jude':  { username: 'cassian.jude',  password: 'Cassian@123' },
  'Marie Davis':   { username: 'marie.davis',   password: 'Marie@123'   },
  'Hannah Louise': { username: 'hannah.louise', password: 'Hannah@123'  },
  'Robert Wright': { username: 'robert.wright', password: 'Robert@123'  },
  'Arjun Sharma':  { username: 'arjun.sharma',  password: 'Arjun@123'   },
  'Priya Nair':    { username: 'priya.nair',    password: 'Priya@123'   },
  'Rohit Mehta':   { username: 'rohit.mehta',   password: 'Rohit@123'   },
  'Neha Iyer':     { username: 'neha.iyer',     password: 'Neha@123'    },
  'Vikram Sinha':  { username: 'vikram.sinha',  password: 'Vikram@123'  }
};

function parseCsv(text) {
  const rows = [];
  let i = 0, field = '', row = [], inQuotes = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (c === '"') { inQuotes = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter(r => r.length > 1 || (r.length === 1 && r[0] !== ''));
  return body.map(r => Object.fromEntries(header.map((h, k) => [h, r[k] ?? ''])));
}

function readCsv(name) {
  const abs = path.join(SEED_DIR, name);
  if (!fs.existsSync(abs)) throw new Error(`Missing seed CSV: ${abs}`);
  return parseCsv(fs.readFileSync(abs, 'utf8'));
}

const toInt = (v) => (v === '' || v === null || v === undefined ? null : parseInt(v, 10));
const toIntOr0 = (v) => (v === '' || v === null || v === undefined ? 0 : parseInt(v, 10));
const nz = (v) => (v === '' ? null : v);

function hashInt(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}
function rng(seedStr) {
  let s = hashInt(seedStr);
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return (s & 0x7fffffff) / 0x7fffffff; };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const iso  = (d) => d.toISOString().slice(0, 10);
const addDays = (base, days) => { const d = new Date(base); d.setDate(d.getDate() + days); return d; };

const CITIES = ['Mumbai', 'Delhi', 'Bengaluru', 'Hyderabad', 'Chennai', 'Pune', 'Kolkata', 'Ahmedabad', 'Jaipur', 'Kochi', 'Indore'];
const DIRECTOR_FIRSTS = ['Arjun', 'Priya', 'Rahul', 'Sneha', 'Vikram', 'Anjali', 'Rohan', 'Meera', 'Karan', 'Divya', 'Aditya', 'Kavya'];
const DIRECTOR_LASTS  = ['Sharma', 'Iyer', 'Menon', 'Desai', 'Kapoor', 'Reddy', 'Patel', 'Bose', 'Agarwal', 'Chopra', 'Pillai', 'Saxena'];
const BUSINESS_TYPES  = ['LLC', 'Private Limited', 'Partnership', 'LLP'];
const TURNOVER_RANGES = ['$1M – $10M', '$10M – $50M', '$50M – $250M', '$250M – $500M', '$500M +'];
const CDD_BY_RISK     = { 'Low': 'Standard', 'Medium': 'Standard', 'High': 'Enhanced', 'Very High': 'Enhanced' };
const SRC_OF_FUNDS    = ['Trading receipts', 'Export proceeds', 'Contract revenues', 'Investment income', 'Working capital credit line'];
const SRC_OF_WEALTH   = ['Founders capital + retained earnings', 'Family office holdings', 'Promoter group investments', 'Public listing proceeds'];

const COUNTERPARTIES_BY_SCENARIO = {
  'Structuring':       ['Individual Depositor', 'Related Entity', 'Unknown Counter', 'Sister Concern'],
  'High Risk Country': ['HK Holdings Ltd', 'Global Trade FZE (Dubai)', 'Lagos Partners', 'Istanbul Consortium'],
  'Watchlist Hit':     ['Novus Offshore Ltd', 'Adverse-Media Subject', 'Sanctions List Match'],
  'Cash Intensive':    ['Branch Cash Deposit', 'Agent Deposit', 'Retail Till'],
  'Trade Based ML':    ['SEA Shipping Lines', 'Arabian Gulf Traders', 'Pearl Exports Pte']
};
const RULE_BY_SCENARIO = {
  'Structuring':       'R-STR-03 · Smurfing / near-threshold',
  'High Risk Country': 'R-GEO-11 · High-risk jurisdiction',
  'Watchlist Hit':     'R-SCR-01 · Watchlist / adverse media',
  'Cash Intensive':    'R-CSH-07 · Cash intensity vs profile',
  'Trade Based ML':    'R-TBM-04 · Trade document anomaly'
};
const DOC_TYPES_BY_SCENARIO = {
  'Structuring':       ['Transaction Report', 'Bank Statement', 'Internal Memo'],
  'High Risk Country': ['Wire Instruction', 'KYC Document', 'Correspondent Memo'],
  'Watchlist Hit':     ['Screening Hit', 'KYC Document', 'Due Diligence'],
  'Cash Intensive':    ['Deposit Slip', 'Branch Log', 'Cash Activity Report'],
  'Trade Based ML':    ['Invoice', 'Bill of Lading', 'Trade Finance Memo']
};
const RETRIEVAL_PURPOSES = [
  'Regulator request — FIU-IND',
  'Internal audit sampling',
  'Law enforcement subpoena response',
  'Quality review — compliance office',
  'Linked case refresh'
];

function caseStatusFromSar(sarStatus, hasSar, disposition) {
  if (!hasSar) {
    if (!disposition || disposition === 'Awaiting Triage') return 'Unassigned';
    return 'Not Started';
  }
  switch (sarStatus) {
    case 'Draft':        return 'Work In Progress';
    case 'Under Review': return 'Pending Review';
    case 'Filed':        return 'Filed';
    case 'Acknowledged': return 'Closed';
    default:             return 'Work In Progress';
  }
}

async function seed() {
  const client = await pool.connect();
  try {
    console.log('[seed] starting…');
    await client.query('BEGIN');

    // Wipe
    await client.query(`
      DELETE FROM retrieval_log;
      DELETE FROM audit_trail;
      DELETE FROM documents;
      DELETE FROM case_documents;
      DELETE FROM case_notes;
      DELETE FROM transactions;
      DELETE FROM accounts;
      DELETE FROM customers;
      DELETE FROM cases;
      DELETE FROM sar_filings;
      DELETE FROM alerts;
      DELETE FROM employee_settings;
      DELETE FROM manager_settings;
      DELETE FROM user_profiles;
    `);

    for (const f of fs.readdirSync(UPLOAD_DIR)) {
      if (f === '.gitkeep') continue;
      try { fs.unlinkSync(path.join(UPLOAD_DIR, f)); } catch (_e) {}
    }

    const alertRows = readCsv('aml_shield_alerts.csv');
    const sarRows   = readCsv('aml_shield_sar_filings.csv');

    // Alerts
    for (const a of alertRows) {
      await client.query(`
        INSERT INTO alerts (
          alert_id, customer_id, customer_name, customer_type, segment,
          scenario, scenario_description, alert_status, priority, risk_score,
          amount_flagged_inr, txn_count_flagged, counterparty_country, channel, branch,
          assigned_to, created_date, last_activity_date, closed_date,
          age_days, sla_days, sla_deadline, sla_breached, due_status,
          case_converted, case_id, disposition, customer_risk_rating,
          pep_match, sanctions_match, kyc_review_status, created_by,
          linked_sar_id, narrative_seed
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15,
          $16, $17, $18, $19,
          $20, $21, $22, $23, $24,
          $25, $26, $27, $28,
          $29, $30, $31, $32,
          $33, $34
        )
      `, [
        a.alert_id, nz(a.customer_id), a.customer_name, nz(a.customer_type), nz(a.segment),
        a.scenario, nz(a.scenario_description), a.alert_status, a.priority, toInt(a.risk_score),
        toIntOr0(a.amount_flagged_inr), toIntOr0(a.txn_count_flagged), nz(a.counterparty_country), nz(a.channel), nz(a.branch),
        nz(a.assigned_to), a.created_date, nz(a.last_activity_date), nz(a.closed_date),
        toIntOr0(a.age_days), toIntOr0(a.sla_days), nz(a.sla_deadline), toIntOr0(a.sla_breached), nz(a.due_status),
        toIntOr0(a.case_converted), nz(a.case_id), nz(a.disposition), nz(a.customer_risk_rating),
        toIntOr0(a.pep_match), toIntOr0(a.sanctions_match), nz(a.kyc_review_status), nz(a.created_by),
        nz(a.linked_sar_id), nz(a.narrative_seed)
      ]);
    }

    // SAR filings
    for (const s of sarRows) {
      await client.query(`
        INSERT INTO sar_filings (
          sar_id, case_id, source_alert_id, customer_id, customer_name,
          alert_scenario, sar_status, prepared_by, reviewed_by, approved_by,
          detection_date, incident_start_date, incident_end_date, draft_created_date,
          filed_date, acknowledged_date, amount_involved_inr, narrative_summary,
          reporting_jurisdiction, regulator_reference, retention_expiry_date, retention_status,
          documents_count, export_package_ready, export_count, last_exported_at,
          law_enforcement_hold, access_classification, current_owner, latest_activity_date,
          linked_alert_count, qa_score, notes
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10,
          $11, $12, $13, $14,
          $15, $16, $17, $18,
          $19, $20, $21, $22,
          $23, $24, $25, $26,
          $27, $28, $29, $30,
          $31, $32, $33
        )
      `, [
        s.sar_id, nz(s.case_id), nz(s.source_alert_id), nz(s.customer_id), s.customer_name,
        nz(s.alert_scenario), s.sar_status, nz(s.prepared_by), nz(s.reviewed_by), nz(s.approved_by),
        nz(s.detection_date), nz(s.incident_start_date), nz(s.incident_end_date), nz(s.draft_created_date),
        nz(s.filed_date), nz(s.acknowledged_date), toIntOr0(s.amount_involved_inr), nz(s.narrative_summary),
        nz(s.reporting_jurisdiction), nz(s.regulator_reference), nz(s.retention_expiry_date), nz(s.retention_status),
        toIntOr0(s.documents_count), toIntOr0(s.export_package_ready), toIntOr0(s.export_count), nz(s.last_exported_at),
        toIntOr0(s.law_enforcement_hold), nz(s.access_classification), nz(s.current_owner), nz(s.latest_activity_date),
        toIntOr0(s.linked_alert_count), toIntOr0(s.qa_score), nz(s.notes)
      ]);
    }

    // Cases
    const sarByCase = Object.fromEntries(sarRows.map(s => [s.case_id, s]));
    const seenCases = new Set();
    for (const a of alertRows) {
      if (!a.case_id || seenCases.has(a.case_id)) continue;
      seenCases.add(a.case_id);
      const linkedSar = sarByCase[a.case_id];
      const status = caseStatusFromSar(linkedSar?.sar_status, !!linkedSar, a.disposition);
      await client.query(`
        INSERT INTO cases (
          case_id, source_alert_id, linked_sar_id, customer_id, customer_name,
          scenario, case_status, assigned_to, created_date, updated_date
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [
        a.case_id, a.alert_id, linkedSar?.sar_id || null,
        nz(a.customer_id), a.customer_name, a.scenario,
        status, nz(a.assigned_to), a.created_date,
        linkedSar?.latest_activity_date || a.last_activity_date || a.created_date
      ]);
    }

    // SAR documents
    for (const s of sarRows) {
      const count = toIntOr0(s.documents_count);
      const types = DOC_TYPES_BY_SCENARIO[s.alert_scenario] || ['Evidence', 'Memo', 'Statement'];
      for (let d = 1; d <= count; d++) {
        const docType = types[(d - 1) % types.length];
        const filename = `${s.sar_id}_${docType.replace(/\s+/g, '_')}_${String(d).padStart(2,'0')}.pdf`;
        const diskName = `seed_${s.sar_id}_${d}.pdf`;
        const absPath  = path.join(UPLOAD_DIR, diskName);
        const body = `AML SHIELD — SUPPORTING DOCUMENT
SAR ID:         ${s.sar_id}
Case ID:        ${s.case_id}
Customer:       ${s.customer_name}
Scenario:       ${s.alert_scenario}
Document Type:  ${docType}
Prepared by:    ${s.prepared_by}
Regulator Ref:  ${s.regulator_reference || '(not yet assigned)'}
Amount (USD):   ${s.amount_involved_inr}

${s.narrative_summary}
`;
        fs.writeFileSync(absPath, body);
        const size = fs.statSync(absPath).size;
        const uploadedAt = `${s.draft_created_date || s.detection_date} 09:${String(d % 60).padStart(2,'0')}:00`;
        await client.query(`
          INSERT INTO documents (sar_id, document_name, document_type, file_path, file_size, uploaded_by, uploaded_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [s.sar_id, filename, docType, path.join('uploads', diskName), size, s.prepared_by, uploadedAt]);
      }
    }

    // Audit trail
    for (const s of sarRows) {
      const insertAudit = (action, by, at, details) => client.query(`
        INSERT INTO audit_trail (sar_id, action, performed_by, timestamp, details)
        VALUES ($1, $2, $3, $4, $5)
      `, [s.sar_id, action, by, at, details]);

      if (s.detection_date) {
        await insertAudit('Detection Logged', s.prepared_by, `${s.detection_date} 09:00:00`,
          `Detection from source alert ${s.source_alert_id}`);
      }
      if (s.draft_created_date) {
        await insertAudit('Draft Created', s.prepared_by, `${s.draft_created_date} 10:00:00`,
          `Draft SAR created; ${s.documents_count} supporting document(s) attached`);
      }
      if (s.reviewed_by) {
        await insertAudit('Submitted for Review', s.prepared_by, `${s.draft_created_date} 14:00:00`,
          `Routed to reviewer: ${s.reviewed_by}`);
      }
      if (s.filed_date) {
        await insertAudit('SAR Filed', s.approved_by || s.reviewed_by, `${s.filed_date} 11:30:00`,
          `Filed with ${s.reporting_jurisdiction}${s.regulator_reference ? ` (ref: ${s.regulator_reference})` : ''}`);
      }
      if (s.acknowledged_date) {
        await insertAudit('Regulator Acknowledged', s.approved_by || s.reviewed_by, `${s.acknowledged_date} 09:45:00`,
          `${s.reporting_jurisdiction} acknowledged filing`);
      }
      if (s.law_enforcement_hold && Number(s.law_enforcement_hold)) {
        await insertAudit('Legal Hold Applied', s.approved_by || s.reviewed_by, `${s.latest_activity_date} 12:00:00`,
          'Law enforcement hold — retention extended');
      }
      const exportCount = toIntOr0(s.export_count);
      if (exportCount > 0 && s.last_exported_at) {
        const when = `${s.last_exported_at} 15:00:00`;
        await insertAudit('Export Package Generated', s.current_owner || s.prepared_by, when,
          `${exportCount} export(s) generated; latest on ${s.last_exported_at}`);
      }
    }

    // Retrieval log
    for (const s of sarRows) {
      const n = toIntOr0(s.export_count);
      if (n === 0) continue;
      for (let r = 0; r < n; r++) {
        const requester = r === 0 ? s.current_owner : (r === 1 ? s.approved_by : s.reviewed_by);
        const purpose   = RETRIEVAL_PURPOSES[r % RETRIEVAL_PURPOSES.length];
        const when      = r === n - 1
          ? `${s.last_exported_at} 15:00:00`
          : `${s.filed_date || s.draft_created_date} ${String(10 + r).padStart(2, '0')}:00:00`;
        await client.query(`
          INSERT INTO retrieval_log (sar_id, requested_by, request_purpose, requested_at, exported_at)
          VALUES ($1, $2, $3, $4, $5)
        `, [s.sar_id, requester || 'system', purpose, when, when]);
      }
    }

    // Customers / accounts / transactions (derived deterministically)
    const firstAlertByCustomer = new Map();
    for (const a of alertRows) {
      if (a.customer_id && !firstAlertByCustomer.has(a.customer_id)) {
        firstAlertByCustomer.set(a.customer_id, a);
      }
    }

    const customerRows = [...firstAlertByCustomer.entries()].map(([cid, a]) => {
      const r = rng(cid);
      const riskRating = a.customer_risk_rating || 'Medium';
      const cddLevel   = CDD_BY_RISK[riskRating] || 'Standard';
      const regMonth   = 1 + Math.floor(r() * 12);
      const regYear    = 1998 + Math.floor(r() * 22);
      const incorp     = `${regYear}-${String(regMonth).padStart(2, '0')}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}`;
      const lastKyc    = addDays(new Date(REFERENCE_DATE), -Math.floor(r() * 540)).toISOString().slice(0, 10);
      const nextKyc    = addDays(new Date(lastKyc), (cddLevel === 'Enhanced' ? 365 : 730)).toISOString().slice(0, 10);
      const city       = pick(r, CITIES);
      const phone      = `+91 ${90 + Math.floor(r() * 10)}${String(Math.floor(r() * 100000000)).padStart(8, '0').slice(0, 8)}`;
      const email      = `compliance@${a.customer_name.toLowerCase().replace(/[^a-z0-9]+/g, '')}.in`;
      const directors  = Array.from({ length: 2 + Math.floor(r() * 3) }, () =>
        `${pick(r, DIRECTOR_FIRSTS)} ${pick(r, DIRECTOR_LASTS)}`);
      const owners     = directors.slice(0, Math.min(3, directors.length)).map((name, i) => ({
        name, pct: i === 0 ? 51 + Math.floor(r() * 20) : 10 + Math.floor(r() * 15), nationality: 'Indian'
      }));
      const empMedian  = a.segment?.includes('NBFC') || a.segment?.includes('Real Estate') ? 80 : 250;
      const empCount   = empMedian + Math.floor(r() * 400);
      const expVolume  = 120 + Math.floor(r() * 400);
      const expValue   = 600000 + Math.floor(r() * 6000000);
      return {
        customer_id: cid,
        customer_name: a.customer_name,
        customer_type: a.customer_type || 'Corporate',
        segment: a.segment,
        customer_risk_rating: riskRating,
        pep_match: Number(a.pep_match || 0),
        sanctions_match: Number(a.sanctions_match || 0),
        kyc_review_status: a.kyc_review_status,
        date_of_birth: null,
        nationality: 'Indian',
        government_id_type: 'PAN',
        government_id_number: `${a.customer_name.replace(/[^A-Z]/g, '').slice(0, 3).padEnd(3, 'X')}${Math.floor(r() * 90000 + 10000)}${String.fromCharCode(65 + Math.floor(r() * 26))}`,
        customer_since_date: incorp,
        residential_address: `${Math.floor(r() * 900) + 100}, ${pick(r, ['Park St', 'MG Road', 'Indl Estate', 'Trade Centre', 'Tech Park', 'Commerce Plaza'])}, ${city}, India`,
        mailing_address: null,
        country_of_residence: 'India',
        phone_number: phone,
        email_address: email,
        last_kyc_review_date: lastKyc,
        next_kyc_due_date: nextKyc,
        cdd_level: cddLevel,
        trading_name: a.customer_name,
        registration_number: `U${Math.floor(r() * 90000 + 10000)}${['MH','DL','KA','TN','GJ','WB'][Math.floor(r() * 6)]}${regYear}PLC${Math.floor(r() * 900000 + 100000)}`,
        date_of_incorporation: incorp,
        country_of_incorporation: 'India',
        business_type: pick(r, BUSINESS_TYPES),
        industry: a.segment,
        naics_code: String(Math.floor(r() * 9000 + 1000)),
        annual_turnover_range: pick(r, TURNOVER_RANGES),
        number_of_employees: empCount,
        beneficial_owners: JSON.stringify(owners),
        directors: JSON.stringify(directors),
        employer_name: null,
        job_title: null,
        employment_type: null,
        annual_income_range: null,
        source_of_funds: pick(r, SRC_OF_FUNDS),
        source_of_wealth: pick(r, SRC_OF_WEALTH),
        expected_monthly_volume: expVolume,
        expected_monthly_value: expValue,
        expected_transaction_types: JSON.stringify(['Wire transfer (inbound)', 'Wire transfer (outbound)', 'Cash deposit', 'RTGS / NEFT']),
        primary_countries: JSON.stringify(['India', 'UAE', 'Singapore', 'United Kingdom']),
        onboarding_notes: `Onboarded ${incorp} through ${pick(r, ['Mumbai Main', 'Delhi Corporate', 'Bengaluru South', 'Chennai Port Branch'])} as a ${a.segment || 'corporate'} client.`
      };
    });

    for (const c of customerRows) {
      await client.query(`
        INSERT INTO customers (
          customer_id, customer_name, customer_type, segment, customer_risk_rating,
          pep_match, sanctions_match, kyc_review_status,
          date_of_birth, nationality, government_id_type, government_id_number, customer_since_date,
          residential_address, mailing_address, country_of_residence, phone_number, email_address,
          last_kyc_review_date, next_kyc_due_date, cdd_level,
          trading_name, registration_number, date_of_incorporation, country_of_incorporation,
          business_type, industry, naics_code, annual_turnover_range, number_of_employees,
          beneficial_owners, directors,
          employer_name, job_title, employment_type, annual_income_range,
          source_of_funds, source_of_wealth,
          expected_monthly_volume, expected_monthly_value, expected_transaction_types,
          primary_countries, onboarding_notes
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8,
          $9, $10, $11, $12, $13,
          $14, $15, $16, $17, $18,
          $19, $20, $21,
          $22, $23, $24, $25,
          $26, $27, $28, $29, $30,
          $31, $32,
          $33, $34, $35, $36,
          $37, $38,
          $39, $40, $41,
          $42, $43
        )
      `, [
        c.customer_id, c.customer_name, c.customer_type, c.segment, c.customer_risk_rating,
        c.pep_match, c.sanctions_match, c.kyc_review_status,
        c.date_of_birth, c.nationality, c.government_id_type, c.government_id_number, c.customer_since_date,
        c.residential_address, c.mailing_address, c.country_of_residence, c.phone_number, c.email_address,
        c.last_kyc_review_date, c.next_kyc_due_date, c.cdd_level,
        c.trading_name, c.registration_number, c.date_of_incorporation, c.country_of_incorporation,
        c.business_type, c.industry, c.naics_code, c.annual_turnover_range, c.number_of_employees,
        c.beneficial_owners, c.directors,
        c.employer_name, c.job_title, c.employment_type, c.annual_income_range,
        c.source_of_funds, c.source_of_wealth,
        c.expected_monthly_volume, c.expected_monthly_value, c.expected_transaction_types,
        c.primary_countries, c.onboarding_notes
      ]);
    }

    // Accounts
    const accountByCustomer = new Map();
    for (const c of customerRows) {
      const r = rng(c.customer_id + '_acct');
      const accountNumber = `ACC${c.customer_id.replace('CUS-', '')}001`;
      const balance = 60000 + Math.floor(r() * 1800000);
      await client.query(
        `INSERT INTO accounts (account_number, customer_id, account_type, currency, status, opened_date, current_balance)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [accountNumber, c.customer_id, 'Current Account', 'USD', 'Active', c.date_of_incorporation, balance]
      );
      accountByCustomer.set(c.customer_id, { account_number: accountNumber, currency: 'USD', current_balance: balance });

      if (r() > 0.5) {
        const escrow = `ACC${c.customer_id.replace('CUS-', '')}002`;
        await client.query(
          `INSERT INTO accounts (account_number, customer_id, account_type, currency, status, opened_date, current_balance)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [escrow, c.customer_id, 'Escrow', 'USD', 'Active', c.date_of_incorporation, Math.floor(balance * 0.3)]
        );
      }
    }

    // Transactions
    const alertsByCustomer = new Map();
    for (const a of alertRows) {
      if (!a.customer_id) continue;
      if (!alertsByCustomer.has(a.customer_id)) alertsByCustomer.set(a.customer_id, []);
      alertsByCustomer.get(a.customer_id).push(a);
    }

    let txnCounter = 1;
    for (const c of customerRows) {
      const account = accountByCustomer.get(c.customer_id);
      const customerAlerts = alertsByCustomer.get(c.customer_id) || [];
      const r = rng(c.customer_id + '_txn');
      const txns = [];

      for (const a of customerAlerts) {
        const flagged = Math.max(1, Number(a.txn_count_flagged || 1));
        const total   = Number(a.amount_flagged_inr || 0);
        const anchor  = a.created_date;
        const counters = COUNTERPARTIES_BY_SCENARIO[a.scenario] || ['Counterparty'];
        const channel  = a.channel || 'RTGS';
        const direction = ['Cash Intensive', 'Structuring'].includes(a.scenario) ? 'Credit' : 'Debit';

        for (let k = 0; k < flagged; k++) {
          const share = flagged === 1 ? 1 : (0.6 / flagged) + r() * 0.8 / flagged;
          const amount = Math.round(total * share);
          const daysBefore = k === 0 ? 0 : Math.floor(r() * 12) + 1;
          const txnDate = iso(addDays(anchor, -daysBefore));
          const txnTime = `${String(9 + Math.floor(r() * 9)).padStart(2, '0')}:${String(Math.floor(r() * 60)).padStart(2, '0')}`;
          txns.push({
            transaction_id: `TXN${String(txnCounter++).padStart(8, '0')}`,
            txn_date: txnDate, txn_time: txnTime,
            txn_type: direction, channel,
            description: `${a.scenario}-related ${direction === 'Debit' ? 'outbound' : 'inbound'} via ${channel}`,
            counterparty: pick(r, counters),
            counterparty_country: a.counterparty_country || 'India',
            amount, is_alerted: 1, alert_id: a.alert_id,
            scenario_triggered: a.scenario,
            rule_breached: RULE_BY_SCENARIO[a.scenario] || 'R-GEN-01',
            risk_score: Number(a.risk_score || 70)
          });
        }
      }

      const baseRefDate = new Date(REFERENCE_DATE);
      const normalCount = 40 + Math.floor(r() * 35);
      for (let k = 0; k < normalCount; k++) {
        const days = Math.floor(r() * 120);
        const txnDate = iso(addDays(baseRefDate, -days));
        const txnTime = `${String(9 + Math.floor(r() * 9)).padStart(2, '0')}:${String(Math.floor(r() * 60)).padStart(2, '0')}`;
        const isCredit = r() > 0.5;
        const amount = Math.round(50000 + r() * 1500000);
        const counterpartyPool = ['Invoice Settlement', 'Salary Payout', 'Vendor Payment', 'Utility Bill',
          'Tax Deposit', 'Interest Credit', 'Refund', 'Office Supplies Pvt Ltd', 'Prime Logistics',
          'Corporate Loans Co', 'Regulatory Levy', 'Audit Fee', 'Dividend Payment'];
        const channelPool = ['NEFT', 'RTGS', 'UPI', 'Cheque', 'Online', 'Branch'];
        txns.push({
          transaction_id: `TXN${String(txnCounter++).padStart(8, '0')}`,
          txn_date: txnDate, txn_time: txnTime,
          txn_type: isCredit ? 'Credit' : 'Debit',
          channel: pick(r, channelPool),
          description: pick(r, counterpartyPool),
          counterparty: pick(r, counterpartyPool),
          counterparty_country: 'India',
          amount, is_alerted: 0, alert_id: null,
          scenario_triggered: null, rule_breached: null, risk_score: null
        });
      }

      txns.sort((a, b) => (a.txn_date + a.txn_time).localeCompare(b.txn_date + b.txn_time));

      let running = Math.max(12000, account.current_balance - txns.reduce((s, t) => s + (t.txn_type === 'Credit' ? t.amount : -t.amount), 0));
      for (const t of txns) {
        running = running + (t.txn_type === 'Credit' ? t.amount : -t.amount);
        await client.query(`
          INSERT INTO transactions (
            transaction_id, account_number, customer_id, txn_date, txn_time,
            txn_type, channel, description, counterparty, counterparty_country,
            amount, running_balance, is_alerted, alert_id,
            scenario_triggered, rule_breached, risk_score
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        `, [
          t.transaction_id, account.account_number, c.customer_id,
          t.txn_date, t.txn_time, t.txn_type, t.channel, t.description,
          t.counterparty, t.counterparty_country, t.amount, running,
          t.is_alerted, t.alert_id, t.scenario_triggered, t.rule_breached, t.risk_score
        ]);
      }

      await client.query('UPDATE accounts SET current_balance = $1 WHERE account_number = $2',
        [running, account.account_number]);
    }

    // Users + manager defaults (replaces seedAdminDataIfEmpty)
    const namesSet = new Set();
    for (const a of alertRows) if (a.assigned_to) namesSet.add(a.assigned_to);
    for (const s of sarRows) {
      if (s.prepared_by) namesSet.add(s.prepared_by);
      if (s.reviewed_by) namesSet.add(s.reviewed_by);
      if (s.approved_by) namesSet.add(s.approved_by);
    }
    const names = [...namesSet].sort();
    let i = 1;
    for (const name of names) {
      const mapping = USER_ROLE_MAP[name] || { role: 'AML Analyst L1', team: 'T1 Monitoring' };
      const cred = CREDENTIALS_BY_NAME[name] || { username: null, password: null };
      const uid = `USR-${String(i++).padStart(4, '0')}`;
      const email = `${name.toLowerCase().replace(/\s+/g, '.')}@bank.in`;
      await client.query(`
        INSERT INTO user_profiles (user_id, name, role, team, status, avatar_color, email, username, password)
        VALUES ($1, $2, $3, $4, 'Active', $5, $6, $7, $8)
      `, [uid, name, mapping.role, mapping.team, colorForName(name), email, cred.username, cred.password]);
    }

    for (const [k, v] of Object.entries(MANAGER_DEFAULTS)) {
      await client.query(
        'INSERT INTO manager_settings (setting_key, setting_value) VALUES ($1, $2)',
        [k, JSON.stringify(v)]
      );
    }

    await client.query('COMMIT');

    // Counts
    const num = async (q) => Number((await client.query(q)).rows[0].c);
    const counts = {
      alerts:               await num('SELECT COUNT(*) AS c FROM alerts'),
      user_profiles:        await num('SELECT COUNT(*) AS c FROM user_profiles'),
      manager_settings:     await num('SELECT COUNT(*) AS c FROM manager_settings'),
      sar_filings:          await num('SELECT COUNT(*) AS c FROM sar_filings'),
      cases:                await num('SELECT COUNT(*) AS c FROM cases'),
      documents:            await num('SELECT COUNT(*) AS c FROM documents'),
      audit_trail:          await num('SELECT COUNT(*) AS c FROM audit_trail'),
      retrieval_log:        await num('SELECT COUNT(*) AS c FROM retrieval_log'),
      customers:            await num('SELECT COUNT(*) AS c FROM customers'),
      accounts:             await num('SELECT COUNT(*) AS c FROM accounts'),
      transactions:         await num('SELECT COUNT(*) AS c FROM transactions'),
      transactions_alerted: await num('SELECT COUNT(*) AS c FROM transactions WHERE is_alerted = 1')
    };

    console.log('[seed] reference_date =', REFERENCE_DATE);
    console.log('[seed] counts         =', counts);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_e) {}
    console.error('[seed] FAILED:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
