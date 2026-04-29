const express = require('express');
const { db } = require('../database/db');

const router = express.Router();

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

function nextSarId() {
  const last = db.prepare(`
    SELECT sar_id FROM sar_filings
     WHERE sar_id LIKE 'SAR-%'
     ORDER BY id DESC LIMIT 1
  `).get();
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

function applyUpdate(sarRow, body) {
  const serialized = serializeBody(body);
  const sets = [];
  const params = [];
  for (const f of FILING_FIELDS) {
    if (serialized[f] !== undefined) {
      sets.push(`${f} = ?`);
      params.push(serialized[f]);
    }
  }
  if (sets.length === 0) return sarRow;
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  if (!body.updated_at) { sets.push('updated_at = ?'); params.push(stamp); }
  if (!body.latest_activity_date) { sets.push('latest_activity_date = ?'); params.push(stamp.slice(0, 10)); }
  params.push(sarRow.sar_id);
  db.prepare(`UPDATE sar_filings SET ${sets.join(', ')} WHERE sar_id = ?`).run(...params);
  return db.prepare('SELECT * FROM sar_filings WHERE sar_id = ?').get(sarRow.sar_id);
}

router.post('/', (req, res) => {
  const { case_id, customer_id, customer_name, source_alert_id, prepared_by, alert_scenario } = req.body;
  if (!case_id) return res.status(400).json({ error: 'case_id required' });
  if (!customer_name) return res.status(400).json({ error: 'customer_name required' });

  const existing = db.prepare('SELECT * FROM sar_filings WHERE case_id = ?').get(case_id);
  if (existing) {
    const updated = applyUpdate(existing, req.body);
    return res.json(deserialize(updated));
  }

  const sarId = nextSarId();
  const today = new Date().toISOString().slice(0, 10);
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');

  db.prepare(`
    INSERT INTO sar_filings (
      sar_id, case_id, source_alert_id, customer_id, customer_name,
      alert_scenario, sar_status, prepared_by, draft_created_date,
      reporting_jurisdiction, access_classification, current_owner,
      created_at, updated_at, latest_activity_date
    ) VALUES (?, ?, ?, ?, ?, ?, 'Draft', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sarId, case_id, source_alert_id || null, customer_id || null, customer_name,
    alert_scenario || null, prepared_by || null, today,
    'FIU-IND', 'Internal', prepared_by || null,
    stamp, stamp, today
  );

  db.prepare(`
    INSERT INTO audit_trail (sar_id, action, performed_by, details)
    VALUES (?, 'SAR Draft Created', ?, ?)
  `).run(sarId, prepared_by || 'system', `Linked to case ${case_id}`);

  let row = db.prepare('SELECT * FROM sar_filings WHERE sar_id = ?').get(sarId);
  if (Object.keys(req.body).some(k => FILING_FIELDS.includes(k))) {
    row = applyUpdate(row, req.body);
  }
  res.status(201).json(deserialize(row));
});

function enrich(row) {
  if (!row) return row;
  const out = deserialize(row);
  if (out.customer_id) {
    const cust = db.prepare(`
      SELECT customer_name, customer_risk_rating, cdd_level,
             last_kyc_review_date, next_kyc_due_date, kyc_review_status, exit_status, updated_at
        FROM customers WHERE customer_id = ?
    `).get(out.customer_id);
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
  const kyc = db.prepare(`
    SELECT id FROM kyc_reviews
     WHERE triggered_by_sar_id = ?
     ORDER BY id DESC LIMIT 1
  `).get(out.sar_id);
  out.kyc_review_id = kyc ? kyc.id : null;
  return out;
}

router.get('/by-case/:case_id', (req, res) => {
  const row = db.prepare('SELECT * FROM sar_filings WHERE case_id = ?').get(req.params.case_id);
  if (!row) return res.status(404).json({ error: 'No SAR filing for case' });
  res.json(enrich(row));
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM sar_filings WHERE sar_id = ? OR id = ?')
    .get(req.params.id, req.params.id);
  if (!row) return res.status(404).json({ error: 'SAR not found' });
  res.json(enrich(row));
});

router.patch('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM sar_filings WHERE sar_id = ? OR id = ?')
    .get(req.params.id, req.params.id);
  if (!existing) return res.status(404).json({ error: 'SAR not found' });
  const updated = applyUpdate(existing, req.body);
  res.json(deserialize(updated));
});

router.post('/:id/submit', (req, res) => {
  const existing = db.prepare('SELECT * FROM sar_filings WHERE sar_id = ? OR id = ?')
    .get(req.params.id, req.params.id);
  if (!existing) return res.status(404).json({ error: 'SAR not found' });

  const dualRow = db.prepare("SELECT setting_value FROM manager_settings WHERE setting_key = 'sar.dual_approval_required'").get();
  let dual = false;
  try { dual = dualRow ? JSON.parse(dualRow.setting_value) === true : false; } catch (_e) { dual = false; }

  const today = new Date().toISOString().slice(0, 10);
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const status = dual ? 'Pending Approval' : 'Filed';
  const submittedBy = req.body.submitted_by || existing.prepared_by || 'system';
  const isResubmission = existing.sar_status === 'Returned for Revision' || existing.returned_to_analyst === 1;

  db.prepare(`
    UPDATE sar_filings
       SET sar_status = ?, submitted_by = ?, submitted_at = ?,
           filed_date = CASE WHEN ? = 'Filed' THEN ? ELSE filed_date END,
           retention_status = CASE WHEN ? = 'Filed' THEN 'Active' ELSE COALESCE(retention_status, 'Pending Filing') END,
           retention_expiry_date = CASE
             WHEN ? = 'Filed' THEN date(?, '+5 years')
             ELSE retention_expiry_date
           END,
           certification_signed = 1,
           returned_to_analyst = 0,
           updated_at = ?, latest_activity_date = ?
     WHERE sar_id = ?
  `).run(status, submittedBy, stamp,
         status, today,
         status,
         status, today,
         stamp, today,
         existing.sar_id);

  const action = dual ? (isResubmission ? 'SAR Resubmitted for Approval' : 'SAR Submitted for Approval') : 'SAR Filed';
  db.prepare(`
    INSERT INTO audit_trail (sar_id, action, performed_by, details)
    VALUES (?, ?, ?, ?)
  `).run(existing.sar_id, action, submittedBy,
         dual ? 'Awaiting supervisor approval' : 'Filed with regulator');

  if (existing.case_id) {
    db.prepare('UPDATE cases SET case_status = ?, linked_sar_id = ?, updated_date = ? WHERE case_id = ?')
      .run(dual ? 'Pending Review' : 'Filed', existing.sar_id, today, existing.case_id);
  }
  if (existing.source_alert_id) {
    db.prepare('UPDATE alerts SET linked_sar_id = ?, last_activity_date = ? WHERE alert_id = ?')
      .run(existing.sar_id, today, existing.source_alert_id);
  }

  if (dual) {
    db.prepare(`
      INSERT INTO notifications (recipient_id, recipient_role, type, title, message, related_id, related_type, tone)
      VALUES (NULL, 'manager', 'sar_pending', ?, ?, ?, 'sar', 'warning')
    `).run(
      `${isResubmission ? 'Resubmitted SAR' : 'SAR'} pending approval — ${existing.customer_name}`,
      `${existing.sar_id} filed by ${submittedBy}. Awaiting your review.`,
      existing.sar_id
    );
  }

  const row = db.prepare('SELECT * FROM sar_filings WHERE sar_id = ?').get(existing.sar_id);
  res.json({ ...deserialize(row), dual_approval_required: dual });
});

router.post('/:id/approve', (req, res) => {
  const existing = db.prepare('SELECT * FROM sar_filings WHERE sar_id = ? OR id = ?')
    .get(req.params.id, req.params.id);
  if (!existing) return res.status(404).json({ error: 'SAR not found' });

  const today = new Date().toISOString().slice(0, 10);
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const approvedBy = req.body.approved_by || 'Compliance Manager';

  db.prepare(`
    UPDATE sar_filings
       SET sar_status = 'Filed', approved_by = ?, approved_at = ?,
           filed_date = ?, retention_status = 'Active',
           retention_expiry_date = date(?, '+5 years'),
           updated_at = ?, latest_activity_date = ?
     WHERE sar_id = ?
  `).run(approvedBy, stamp, today, today, stamp, today, existing.sar_id);

  db.prepare(`
    INSERT INTO audit_trail (sar_id, action, performed_by, details)
    VALUES (?, 'SAR Approved & Filed', ?, ?)
  `).run(existing.sar_id, approvedBy, req.body.notes || 'Approved by supervisor');

  if (existing.case_id) {
    db.prepare('UPDATE cases SET case_status = ?, updated_date = ? WHERE case_id = ?')
      .run('Filed', today, existing.case_id);
  }

  res.json(deserialize(db.prepare('SELECT * FROM sar_filings WHERE sar_id = ?').get(existing.sar_id)));
});

router.get('/:id/preview', (req, res) => {
  const row = db.prepare('SELECT * FROM sar_filings WHERE sar_id = ? OR id = ?')
    .get(req.params.id, req.params.id);
  if (!row) return res.status(404).json({ error: 'SAR not found' });
  const audit = db.prepare('SELECT * FROM audit_trail WHERE sar_id = ? ORDER BY timestamp DESC').all(row.sar_id);
  res.json({ ...deserialize(row), audit_trail: audit });
});

module.exports = router;
