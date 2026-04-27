const express = require('express');
const { db } = require('../database/db');

const router = express.Router();

const JSON_FIELDS = [
  'suspicious_activity_types', 'transaction_types', 'subject_data',
  'draft_data', 'included_documents', 'rejection_checklist'
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

router.get('/', (req, res) => {
  const { sar_status, prepared_by, q, from, to, priority } = req.query;
  let sql = `
    SELECT s.*,
      a.priority AS alert_priority,
      a.scenario AS alert_scenario_full,
      a.amount_flagged_inr AS alert_amount,
      a.customer_risk_rating AS customer_risk_rating
    FROM sar_filings s
    LEFT JOIN alerts a ON a.alert_id = s.source_alert_id
    WHERE s.sar_status IN ('Pending Approval', 'Under Manager Review', 'Returned for Revision')
  `;
  const params = [];
  if (sar_status)   { sql += ' AND s.sar_status = ?';     params.push(sar_status); }
  if (prepared_by)  { sql += ' AND s.prepared_by = ?';    params.push(prepared_by); }
  if (priority)     { sql += ' AND a.priority = ?';       params.push(priority); }
  if (from) { sql += ' AND s.submitted_at >= ?'; params.push(from); }
  if (to)   { sql += ' AND s.submitted_at <= ?'; params.push(to); }
  if (q) {
    sql += ' AND (s.sar_id LIKE ? OR s.case_id LIKE ? OR s.customer_name LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY datetime(s.submitted_at) ASC';
  res.json(db.prepare(sql).all(...params).map(deserialize));
});

router.get('/stats', (_req, res) => {
  const pending = db.prepare(`
    SELECT COUNT(*) AS c FROM sar_filings WHERE sar_status IN ('Pending Approval', 'Under Manager Review')
  `).get().c;
  const approvedThisMonth = db.prepare(`
    SELECT COUNT(*) AS c FROM sar_approval_log
     WHERE action = 'approved'
       AND substr(actioned_at, 1, 7) = strftime('%Y-%m', 'now')
  `).get().c;
  const rejectedThisMonth = db.prepare(`
    SELECT COUNT(*) AS c FROM sar_approval_log
     WHERE action = 'rejected'
       AND substr(actioned_at, 1, 7) = strftime('%Y-%m', 'now')
  `).get().c;
  const avgRow = db.prepare(`
    SELECT AVG(
      (julianday(l.actioned_at) - julianday(s.submitted_at)) * 24
    ) AS hrs
    FROM sar_approval_log l
    JOIN sar_filings s ON s.sar_id = l.sar_id
    WHERE l.action IN ('approved', 'rejected')
      AND s.submitted_at IS NOT NULL
      AND substr(l.actioned_at, 1, 7) = strftime('%Y-%m', 'now')
  `).get();
  const avg = avgRow && avgRow.hrs ? Number(avgRow.hrs).toFixed(1) : null;
  res.json({ pending, approved_this_month: approvedThisMonth, rejected_this_month: rejectedThisMonth, avg_review_hours: avg });
});

router.get('/:id', (req, res) => {
  const sar = db.prepare('SELECT * FROM sar_filings WHERE sar_id = ? OR id = ?')
    .get(req.params.id, req.params.id);
  if (!sar) return res.status(404).json({ error: 'SAR not found' });

  const sourceAlert = sar.source_alert_id
    ? db.prepare('SELECT * FROM alerts WHERE alert_id = ?').get(sar.source_alert_id)
    : null;
  const customer = sar.customer_id
    ? db.prepare('SELECT * FROM customers WHERE customer_id = ?').get(sar.customer_id)
    : null;

  const includedIdsRaw = sar.included_documents ? (() => {
    try { return JSON.parse(sar.included_documents); } catch (_e) { return []; }
  })() : [];
  const includedIds = Array.isArray(includedIdsRaw) ? includedIdsRaw : [];

  let documents = [];
  if (sar.source_alert_id) {
    documents = db.prepare('SELECT * FROM case_documents WHERE alert_id = ? ORDER BY uploaded_at DESC')
      .all(sar.source_alert_id);
  }
  documents = documents.map(d => ({ ...d, included: includedIds.includes(d.id) }));

  const caseNotes = sar.source_alert_id
    ? db.prepare('SELECT * FROM case_notes WHERE alert_id = ? ORDER BY datetime(timestamp) ASC').all(sar.source_alert_id)
    : [];

  const customerSars = sar.customer_id
    ? db.prepare(`
        SELECT sar_id, sar_status, filed_date, draft_created_date
          FROM sar_filings
         WHERE customer_id = ? AND sar_id <> ?
         ORDER BY datetime(COALESCE(filed_date, draft_created_date)) DESC
      `).all(sar.customer_id, sar.sar_id)
    : [];

  const customerAlerts = sar.customer_id
    ? db.prepare(`
        SELECT alert_id, scenario, alert_status, priority, created_date, amount_flagged_inr
          FROM alerts
         WHERE customer_id = ?
         ORDER BY datetime(created_date) DESC
         LIMIT 5
      `).all(sar.customer_id)
    : [];

  const reviewComments = db.prepare(`
    SELECT * FROM sar_review_comments WHERE sar_id = ? ORDER BY datetime(created_at) ASC
  `).all(sar.sar_id);

  const approvalLog = db.prepare(`
    SELECT * FROM sar_approval_log WHERE sar_id = ? ORDER BY datetime(actioned_at) ASC
  `).all(sar.sar_id).map(r => {
    if (r.checklist_items_completed) {
      try { r.checklist_items_completed = JSON.parse(r.checklist_items_completed); } catch (_e) { /* keep raw */ }
    }
    return r;
  });

  res.json({
    ...deserialize(sar),
    source_alert: sourceAlert,
    customer,
    documents,
    case_notes: caseNotes,
    customer_sars: customerSars,
    customer_alerts: customerAlerts,
    review_comments: reviewComments,
    approval_log: approvalLog
  });
});

router.post('/:id/start-review', (req, res) => {
  const existing = db.prepare('SELECT * FROM sar_filings WHERE sar_id = ? OR id = ?')
    .get(req.params.id, req.params.id);
  if (!existing) return res.status(404).json({ error: 'SAR not found' });
  if (existing.sar_status !== 'Pending Approval') {
    return res.json(existing);
  }
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  db.prepare('UPDATE sar_filings SET sar_status = ?, updated_at = ? WHERE sar_id = ?')
    .run('Under Manager Review', stamp, existing.sar_id);
  res.json(db.prepare('SELECT * FROM sar_filings WHERE sar_id = ?').get(existing.sar_id));
});

router.post('/:id/approve', (req, res) => {
  const existing = db.prepare('SELECT * FROM sar_filings WHERE sar_id = ? OR id = ?')
    .get(req.params.id, req.params.id);
  if (!existing) return res.status(404).json({ error: 'SAR not found' });

  const today = new Date().toISOString().slice(0, 10);
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const approvedBy = req.body.approved_by || 'Compliance Manager';
  const note       = req.body.notes || '';
  const checklist  = req.body.checklist || {};

  if (!existing.regulator_reference) {
    const stampSlug = today.replace(/-/g, '');
    const ref = `FIU-${stampSlug}-${existing.sar_id.replace(/[^0-9]/g, '').padStart(5, '0').slice(-5)}`;
    db.prepare('UPDATE sar_filings SET regulator_reference = ? WHERE sar_id = ? AND (regulator_reference IS NULL OR regulator_reference = \'\')')
      .run(ref, existing.sar_id);
  }

  db.prepare(`
    UPDATE sar_filings
       SET sar_status = 'Filed', approved_by = ?, approved_at = ?,
           filed_date = ?, retention_status = 'Active',
           retention_expiry_date = date(?, '+5 years'),
           updated_at = ?, latest_activity_date = ?,
           returned_to_analyst = 0
     WHERE sar_id = ?
  `).run(approvedBy, stamp, today, today, stamp, today, existing.sar_id);

  db.prepare(`
    INSERT INTO sar_approval_log (sar_id, action, actioned_by, comments, checklist_items_completed)
    VALUES (?, 'approved', ?, ?, ?)
  `).run(existing.sar_id, approvedBy, note, JSON.stringify(checklist));

  db.prepare(`
    INSERT INTO audit_trail (sar_id, action, performed_by, details)
    VALUES (?, 'SAR Approved & Filed', ?, ?)
  `).run(existing.sar_id, approvedBy, note || 'Approved by supervisor');

  if (existing.case_id) {
    db.prepare('UPDATE cases SET case_status = ?, updated_date = ? WHERE case_id = ?')
      .run('Filed', today, existing.case_id);
  }

  if (existing.prepared_by) {
    db.prepare(`
      INSERT INTO notifications (recipient_id, recipient_role, type, title, message, related_id, related_type, tone)
      VALUES (?, 'employee', 'sar_approved', ?, ?, ?, 'sar', 'success')
    `).run(
      existing.prepared_by,
      `Your SAR ${existing.sar_id} was approved and filed`,
      `${existing.sar_id} for ${existing.customer_name} was approved by ${approvedBy}.`,
      existing.sar_id
    );
  }

  res.json(db.prepare('SELECT * FROM sar_filings WHERE sar_id = ?').get(existing.sar_id));
});

router.post('/:id/reject', (req, res) => {
  const existing = db.prepare('SELECT * FROM sar_filings WHERE sar_id = ? OR id = ?')
    .get(req.params.id, req.params.id);
  if (!existing) return res.status(404).json({ error: 'SAR not found' });

  const reasonCategory = req.body.reason_category;
  const comments = req.body.comments;
  const checklist = req.body.checklist || {};
  const rejectedBy = req.body.rejected_by || 'Compliance Manager';
  if (!reasonCategory) return res.status(400).json({ error: 'reason_category required' });
  if (!comments || comments.length < 50) return res.status(400).json({ error: 'comments must be at least 50 characters' });

  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const today = new Date().toISOString().slice(0, 10);

  db.prepare(`
    UPDATE sar_filings
       SET sar_status = 'Returned for Revision',
           rejection_reason_category = ?,
           rejection_comments = ?,
           rejection_checklist = ?,
           rejected_by = ?,
           rejected_at = ?,
           returned_to_analyst = 1,
           updated_at = ?, latest_activity_date = ?
     WHERE sar_id = ?
  `).run(reasonCategory, comments, JSON.stringify(checklist), rejectedBy, stamp, stamp, today, existing.sar_id);

  db.prepare(`
    INSERT INTO sar_approval_log (sar_id, action, actioned_by, reason_category, comments, checklist_items_completed)
    VALUES (?, 'rejected', ?, ?, ?, ?)
  `).run(existing.sar_id, rejectedBy, reasonCategory, comments, JSON.stringify(checklist));

  db.prepare(`
    INSERT INTO audit_trail (sar_id, action, performed_by, details)
    VALUES (?, 'SAR Rejected & Returned', ?, ?)
  `).run(existing.sar_id, rejectedBy, `${reasonCategory}: ${comments}`);

  if (existing.case_id) {
    db.prepare('UPDATE cases SET case_status = ?, updated_date = ? WHERE case_id = ?')
      .run('Work In Progress', today, existing.case_id);
  }

  if (existing.prepared_by) {
    db.prepare(`
      INSERT INTO notifications (recipient_id, recipient_role, type, title, message, related_id, related_type, tone)
      VALUES (?, 'employee', 'sar_rejected', ?, ?, ?, 'sar', 'warning')
    `).run(
      existing.prepared_by,
      `Your SAR ${existing.sar_id} was returned for revision`,
      `${rejectedBy} flagged: ${reasonCategory}. Open the SAR to read full feedback and resubmit.`,
      existing.sar_id
    );
  }

  res.json(db.prepare('SELECT * FROM sar_filings WHERE sar_id = ?').get(existing.sar_id));
});

router.get('/:id/comments', (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM sar_review_comments WHERE sar_id = ? ORDER BY datetime(created_at) ASC
  `).all(req.params.id);
  res.json(rows);
});

router.post('/comments', (req, res) => {
  const { sar_id, manager_id, comment_text, highlighted_text, position_start, position_end } = req.body;
  if (!sar_id || !comment_text) return res.status(400).json({ error: 'sar_id and comment_text required' });
  const info = db.prepare(`
    INSERT INTO sar_review_comments (sar_id, manager_id, comment_text, highlighted_text, position_start, position_end)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sar_id, manager_id || 'Compliance Manager', comment_text,
         highlighted_text || null,
         position_start ?? null, position_end ?? null);
  res.status(201).json(db.prepare('SELECT * FROM sar_review_comments WHERE id = ?').get(info.lastInsertRowid));
});

router.delete('/comments/:id', (req, res) => {
  db.prepare('DELETE FROM sar_review_comments WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
