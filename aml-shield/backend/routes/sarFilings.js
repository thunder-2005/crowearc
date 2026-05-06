const express = require('express');
const pool = require('../database/db');
const { logAudit, ENTITY_TYPES } = require('../utils/audit');
const { requireL2OrManager } = require('../middleware/roleGuard');
const { generateNarrative } = require('../utils/narrativeTemplates');

const router = express.Router();

// Spec wording for the wizard step-completion audit lines.
const STEP_LABELS = [
  'SAR Details',          // Step 1
  'Subject Information',  // Step 2
  'Suspicious Activity',  // Step 3
  'Narrative',            // Step 4
  'Attachments',          // Step 5
  'Review'                // Step 6
];

const JSON_FIELDS = [
  'suspicious_activity_types', 'transaction_types', 'subject_data',
  'draft_data', 'included_documents'
];

function deserialize(row) {
  if (!row) return row;
  for (const f of JSON_FIELDS) {
    if (row[f]) {
      try { row[f] = JSON.parse(row[f]); } catch (_e) { /* keep raw */ }
    }
  }
  return row;
}

function serializeBody(body) {
  const out = { ...body };
  for (const f of JSON_FIELDS) {
    if (out[f] !== undefined && out[f] !== null && typeof out[f] !== 'string') {
      out[f] = JSON.stringify(out[f]);
    }
  }
  return out;
}

async function nextSarId() {
  const last = (await pool.query(`
    SELECT sar_id FROM sar_filings
     WHERE sar_id LIKE 'SAR-%'
     ORDER BY id DESC LIMIT 1
  `)).rows[0];
  let n = 1;
  if (last) {
    const m = String(last.sar_id).match(/(\d+)$/);
    if (m) n = parseInt(m[1], 10) + 1;
  }
  return `SAR-${String(n).padStart(5, '0')}`;
}

const FILING_FIELDS = [
  'filing_type', 'filing_method', 'regulatory_agency', 'sar_type',
  'detection_date', 'incident_start_date', 'incident_end_date',
  'bsa_filing_institution', 'tin', 'num_transactions', 'total_amount', 'currency',
  'structuring_indicator', 'prior_sars', 'prior_sar_count', 'date_of_recent_sar',
  'activity_date_from', 'activity_date_to', 'amount_involved_inr',
  'suspicious_activity_types', 'transaction_types', 'transaction_locations',
  'ip_addresses', 'device_identifiers', 'subject_data',
  'narrative', 'narrative_summary',
  'certification_signed', 'sar_status', 'prepared_by', 'reviewed_by',
  'approved_by', 'submitted_by', 'submitted_at', 'approved_at',
  'reporting_jurisdiction', 'regulator_reference', 'access_classification',
  'current_owner', 'draft_data', 'included_documents', 'updated_at',
  'filed_date', 'retention_status', 'retention_expiry_date',
  'documents_count', 'linked_alert_count', 'latest_activity_date'
];

async function applyUpdate(sarRow, body) {
  const serialized = serializeBody(body);
  const sets = [];
  const params = [];
  let n = 0;
  for (const f of FILING_FIELDS) {
    if (serialized[f] !== undefined) {
      params.push(serialized[f]);
      sets.push(`${f} = $${++n}`);
    }
  }
  if (sets.length === 0) return sarRow;
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  if (!body.updated_at) { params.push(stamp); sets.push(`updated_at = $${++n}`); }
  if (!body.latest_activity_date) { params.push(stamp.slice(0, 10)); sets.push(`latest_activity_date = $${++n}`); }
  params.push(sarRow.sar_id);
  await pool.query(`UPDATE sar_filings SET ${sets.join(', ')} WHERE sar_id = $${++n}`, params);
  const sel = await pool.query('SELECT * FROM sar_filings WHERE sar_id = $1', [sarRow.sar_id]);
  return sel.rows[0];
}

router.post('/', requireL2OrManager, async (req, res, next) => {
  try {
    const { case_id, customer_id, customer_name, source_alert_id, prepared_by, alert_scenario } = req.body;
    if (!case_id) return res.status(400).json({ error: 'case_id required' });
    if (!customer_name) return res.status(400).json({ error: 'customer_name required' });

    const existingResult = await pool.query('SELECT * FROM sar_filings WHERE case_id = $1', [case_id]);
    const existing = existingResult.rows[0];
    if (existing) {
      const updated = await applyUpdate(existing, req.body);
      return res.json(deserialize(updated));
    }

    const sarId = await nextSarId();
    const today = new Date().toISOString().slice(0, 10);
    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');

    await pool.query(`
      INSERT INTO sar_filings (
        sar_id, case_id, source_alert_id, customer_id, customer_name,
        alert_scenario, sar_status, prepared_by, draft_created_date,
        reporting_jurisdiction, access_classification, current_owner,
        created_at, updated_at, latest_activity_date
      ) VALUES ($1, $2, $3, $4, $5, $6, 'Draft', $7, $8, $9, $10, $11, $12, $13, $14)
    `, [
      sarId, case_id, source_alert_id || null, customer_id || null, customer_name,
      alert_scenario || null, prepared_by || null, today,
      'FIU-IND', 'Internal', prepared_by || null,
      stamp, stamp, today
    ]);

    await logAudit({
      entity_type: ENTITY_TYPES.SAR, entity_id: sarId,
      action: `SAR draft created by ${prepared_by || 'system'}`,
      performed_by: prepared_by || 'system',
      details: `Linked to case ${case_id}`
    });

    let row = (await pool.query('SELECT * FROM sar_filings WHERE sar_id = $1', [sarId])).rows[0];
    if (Object.keys(req.body).some(k => FILING_FIELDS.includes(k))) {
      row = await applyUpdate(row, req.body);
    }
    res.status(201).json(deserialize(row));
  } catch (err) { next(err); }
});

async function enrich(row) {
  if (!row) return row;
  const out = deserialize(row);
  if (out.customer_id) {
    const cust = (await pool.query(`
      SELECT customer_name, customer_risk_rating, cdd_level,
             last_kyc_review_date, next_kyc_due_date, kyc_review_status, exit_status
        FROM customers WHERE customer_id = $1
    `, [out.customer_id])).rows[0];
    if (cust) {
      out.customer_risk_rating = cust.customer_risk_rating;
      out.customer_cdd_level   = cust.cdd_level;
      out.customer_kyc_status  = cust.kyc_review_status;
      out.customer_exit_status = cust.exit_status;
      const draftAt = out.created_at || out.draft_created_date;
      const lastKyc = cust.last_kyc_review_date;
      out.kyc_data_changed = !!(draftAt && lastKyc && lastKyc > draftAt.slice(0, 10));
    }
  }
  const kyc = (await pool.query(`
    SELECT id FROM kyc_reviews
     WHERE triggered_by_sar_id = $1
     ORDER BY id DESC LIMIT 1
  `, [out.sar_id])).rows[0];
  out.kyc_review_id = kyc ? kyc.id : null;
  return out;
}

router.get('/by-case/:case_id', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM sar_filings WHERE case_id = $1', [req.params.case_id]);
    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: 'No SAR filing for case' });
    res.json(await enrich(row));
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const idParam = req.params.id;
    const idAsInt = /^\d+$/.test(idParam) ? Number(idParam) : -1;
    const result = await pool.query(
      'SELECT * FROM sar_filings WHERE sar_id = $1 OR id = $2', [idParam, idAsInt]
    );
    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: 'SAR not found' });
    res.json(await enrich(row));
  } catch (err) { next(err); }
});

router.patch('/:id', requireL2OrManager, async (req, res, next) => {
  try {
    const idParam = req.params.id;
    const idAsInt = /^\d+$/.test(idParam) ? Number(idParam) : -1;
    const result = await pool.query(
      'SELECT * FROM sar_filings WHERE sar_id = $1 OR id = $2', [idParam, idAsInt]
    );
    const existing = result.rows[0];
    if (!existing) return res.status(404).json({ error: 'SAR not found' });
    const updated = await applyUpdate(existing, req.body);

    // Wizard fires { step_completed: 1..6 } when the user clicks "Next" on a
    // step. We log per-step so the SAR Audit Trail tab shows the full path.
    const sc = req.body?.step_completed;
    if (sc != null) {
      const idx = Number(sc);
      if (idx >= 1 && idx <= STEP_LABELS.length) {
        await logAudit({
          entity_type: ENTITY_TYPES.SAR, entity_id: existing.sar_id,
          action: `Step ${idx} completed — ${STEP_LABELS[idx - 1]}`,
          performed_by: req.body.performed_by || existing.prepared_by || 'system'
        });
      }
    }

    res.json(deserialize(updated));
  } catch (err) { next(err); }
});

router.post('/:id/submit', requireL2OrManager, async (req, res, next) => {
  try {
    const idParam = req.params.id;
    const idAsInt = /^\d+$/.test(idParam) ? Number(idParam) : -1;
    const existingResult = await pool.query(
      'SELECT * FROM sar_filings WHERE sar_id = $1 OR id = $2', [idParam, idAsInt]
    );
    const existing = existingResult.rows[0];
    if (!existing) return res.status(404).json({ error: 'SAR not found' });

    const dualResult = await pool.query(
      "SELECT setting_value FROM manager_settings WHERE setting_key = 'sar.dual_approval_required'"
    );
    const dualRow = dualResult.rows[0];
    let dual = false;
    try { dual = dualRow ? JSON.parse(dualRow.setting_value) === true : false; } catch (_e) { dual = false; }

    const today = new Date().toISOString().slice(0, 10);
    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const status = dual ? 'Pending Approval' : 'Filed';
    const submittedBy = req.body.submitted_by || existing.prepared_by || 'system';
    const isResubmission = existing.sar_status === 'Returned for Revision' || existing.returned_to_analyst === 1;

    await pool.query(`
      UPDATE sar_filings
         SET sar_status = $1, submitted_by = $2, submitted_at = $3,
             filed_date = CASE WHEN $4 = 'Filed' THEN $5 ELSE filed_date END,
             retention_status = CASE WHEN $6 = 'Filed' THEN 'Active' ELSE COALESCE(retention_status, 'Pending Filing') END,
             retention_expiry_date = CASE
               WHEN $7 = 'Filed' THEN ($8::date + INTERVAL '5 years')::date::text
               ELSE retention_expiry_date
             END,
             certification_signed = 1,
             returned_to_analyst = 0,
             updated_at = $9, latest_activity_date = $10
       WHERE sar_id = $11
    `, [status, submittedBy, stamp,
        status, today,
        status,
        status, today,
        stamp, today,
        existing.sar_id]);

    const action = dual
      ? (isResubmission ? 'Resubmitted for manager approval' : 'Submitted for manager approval')
      : 'SAR Filed';
    await logAudit({
      entity_type: ENTITY_TYPES.SAR, entity_id: existing.sar_id,
      action, performed_by: submittedBy,
      details: dual ? 'Awaiting supervisor approval' : 'Filed with regulator'
    });

    if (existing.case_id) {
      await pool.query(
        'UPDATE cases SET case_status = $1, linked_sar_id = $2, updated_date = $3 WHERE case_id = $4',
        [dual ? 'Pending Review' : 'Filed', existing.sar_id, today, existing.case_id]
      );
    }
    if (existing.source_alert_id) {
      await pool.query(
        'UPDATE alerts SET linked_sar_id = $1, last_activity_date = $2 WHERE alert_id = $3',
        [existing.sar_id, today, existing.source_alert_id]
      );
    }

    if (dual) {
      await pool.query(`
        INSERT INTO notifications (recipient_id, recipient_role, type, title, message, related_id, related_type, tone)
        VALUES (NULL, 'manager', 'sar_pending', $1, $2, $3, 'sar', 'warning')
      `, [
        `${isResubmission ? 'Resubmitted SAR' : 'SAR'} pending approval — ${existing.customer_name}`,
        `${existing.sar_id} filed by ${submittedBy}. Awaiting your review.`,
        existing.sar_id
      ]);
    }

    const row = (await pool.query('SELECT * FROM sar_filings WHERE sar_id = $1', [existing.sar_id])).rows[0];
    res.json({ ...deserialize(row), dual_approval_required: dual });
  } catch (err) { next(err); }
});

router.post('/:id/approve', requireL2OrManager, async (req, res, next) => {
  try {
    const idParam = req.params.id;
    const idAsInt = /^\d+$/.test(idParam) ? Number(idParam) : -1;
    const existingResult = await pool.query(
      'SELECT * FROM sar_filings WHERE sar_id = $1 OR id = $2', [idParam, idAsInt]
    );
    const existing = existingResult.rows[0];
    if (!existing) return res.status(404).json({ error: 'SAR not found' });

    const today = new Date().toISOString().slice(0, 10);
    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const approvedBy = req.body.approved_by || 'Compliance Manager';

    await pool.query(`
      UPDATE sar_filings
         SET sar_status = 'Filed', approved_by = $1, approved_at = $2,
             filed_date = $3, retention_status = 'Active',
             retention_expiry_date = ($4::date + INTERVAL '5 years')::date::text,
             updated_at = $5, latest_activity_date = $6
       WHERE sar_id = $7
    `, [approvedBy, stamp, today, today, stamp, today, existing.sar_id]);

    await logAudit({
      entity_type: ENTITY_TYPES.SAR, entity_id: existing.sar_id,
      action: `Approved by ${approvedBy}`,
      performed_by: approvedBy,
      details: req.body.notes || 'Approved by supervisor'
    });

    if (existing.case_id) {
      await pool.query(
        'UPDATE cases SET case_status = $1, updated_date = $2 WHERE case_id = $3',
        ['Filed', today, existing.case_id]
      );
    }

    const row = (await pool.query('SELECT * FROM sar_filings WHERE sar_id = $1', [existing.sar_id])).rows[0];
    res.json(deserialize(row));
  } catch (err) { next(err); }
});

// Assemble a draft SAR narrative from the case data using a scenario-specific
// regulatory template. Returns the assembled text plus a small `data_used`
// summary so the UI can show what fed into the draft. The analyst still
// has to review and edit before submission — this is a starting point, not
// a final document.
router.get('/:id/generate-narrative', async (req, res, next) => {
  try {
    const idParam = req.params.id;
    const idAsInt = /^\d+$/.test(idParam) ? Number(idParam) : -1;
    const sar = (await pool.query(
      'SELECT * FROM sar_filings WHERE sar_id = $1 OR id = $2', [idParam, idAsInt]
    )).rows[0];
    if (!sar) return res.status(404).json({ error: 'SAR not found' });

    const alert = sar.source_alert_id
      ? (await pool.query('SELECT * FROM alerts WHERE alert_id = $1', [sar.source_alert_id])).rows[0] || null
      : null;

    const customer = sar.customer_id
      ? (await pool.query('SELECT * FROM customers WHERE customer_id = $1', [sar.customer_id])).rows[0] || null
      : null;

    let alertedTxns = [];
    if (alert) {
      alertedTxns = (await pool.query(`
        SELECT transaction_id, txn_date, txn_type, channel, amount,
               counterparty, counterparty_country, description
          FROM transactions
         WHERE customer_id = $1 AND is_alerted = 1
         ORDER BY txn_date ASC, txn_time ASC
      `, [alert.customer_id])).rows.map(t => ({ ...t, amount: Number(t.amount) }));
    }

    const ts = (() => {
      if (alertedTxns.length === 0) {
        return {
          total_alerted_amount: 0, alerted_count: 0,
          date_range_start: null, date_range_end: null,
          min_amount: 0, max_amount: 0,
          unique_counterparties: 0, countries_involved: []
        };
      }
      const amounts = alertedTxns.map(t => t.amount);
      const dates = alertedTxns.map(t => t.txn_date).filter(Boolean).sort();
      const cps = new Set(alertedTxns.map(t => t.counterparty).filter(Boolean));
      const countries = new Set(alertedTxns.map(t => t.counterparty_country).filter(Boolean));
      return {
        total_alerted_amount: amounts.reduce((s, a) => s + a, 0),
        alerted_count: alertedTxns.length,
        date_range_start: dates[0],
        date_range_end: dates[dates.length - 1],
        min_amount: Math.min(...amounts),
        max_amount: Math.max(...amounts),
        unique_counterparties: cps.size,
        countries_involved: [...countries]
      };
    })();

    const caseNotes = alert
      ? (await pool.query(
          'SELECT note_text, analyst, timestamp FROM case_notes WHERE alert_id = $1 ORDER BY timestamp ASC',
          [alert.alert_id]
        )).rows
      : [];

    const l2 = alert
      ? (await pool.query(
          'SELECT risk_score, risk_factors, l2_narrative FROM l2_cases WHERE alert_id = $1 ORDER BY id DESC LIMIT 1',
          [alert.alert_id]
        )).rows[0] || null
      : null;

    const result = generateNarrative({
      alert, customer, sar,
      alerted_transactions: alertedTxns,
      transaction_summary: ts,
      case_notes: caseNotes,
      l2
    });

    res.json({
      narrative: result.text,
      data_used: {
        case_notes_count: caseNotes.length,
        alerted_transactions_count: alertedTxns.length,
        template_used: result.template,
        scenario: alert?.scenario || null,
        generated_at: new Date().toISOString()
      }
    });
  } catch (err) { next(err); }
});

router.get('/:id/preview', async (req, res, next) => {
  try {
    const idParam = req.params.id;
    const idAsInt = /^\d+$/.test(idParam) ? Number(idParam) : -1;
    const result = await pool.query(
      'SELECT * FROM sar_filings WHERE sar_id = $1 OR id = $2', [idParam, idAsInt]
    );
    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: 'SAR not found' });
    const audit = (await pool.query(
      'SELECT * FROM audit_trail WHERE sar_id = $1 ORDER BY timestamp DESC', [row.sar_id]
    )).rows;
    res.json({ ...deserialize(row), audit_trail: audit });
  } catch (err) { next(err); }
});

module.exports = router;
