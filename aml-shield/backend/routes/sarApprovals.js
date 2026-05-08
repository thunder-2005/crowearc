const express = require('express');
const pool = require('../database/db');
const { logAudit, ENTITY_TYPES } = require('../utils/audit');
const { getManagerSetting } = require('../utils/getManagerSetting');

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

router.get('/', async (req, res, next) => {
  try {
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
    let n = 0;
    if (sar_status)   { params.push(sar_status);  sql += ` AND s.sar_status = $${++n}`; }
    if (prepared_by)  { params.push(prepared_by); sql += ` AND s.prepared_by = $${++n}`; }
    if (priority)     { params.push(priority);    sql += ` AND a.priority = $${++n}`; }
    if (from) { params.push(from); sql += ` AND s.submitted_at >= $${++n}`; }
    if (to)   { params.push(to);   sql += ` AND s.submitted_at <= $${++n}`; }
    if (q) {
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
      sql += ` AND (s.sar_id LIKE $${++n} OR s.case_id LIKE $${++n} OR s.customer_name LIKE $${++n})`;
    }
    sql += ' ORDER BY s.submitted_at ASC';
    const rows = (await pool.query(sql, params)).rows;
    res.json(rows.map(deserialize));
  } catch (err) { next(err); }
});

router.get('/stats', async (_req, res, next) => {
  try {
    const pending = Number((await pool.query(`
      SELECT COUNT(*) AS c FROM sar_filings WHERE sar_status IN ('Pending Approval', 'Under Manager Review')
    `)).rows[0].c);
    const approvedThisMonth = Number((await pool.query(`
      SELECT COUNT(*) AS c FROM sar_approval_log
       WHERE action = 'approved'
         AND substr(actioned_at, 1, 7) = to_char(CURRENT_DATE, 'YYYY-MM')
    `)).rows[0].c);
    const rejectedThisMonth = Number((await pool.query(`
      SELECT COUNT(*) AS c FROM sar_approval_log
       WHERE action = 'rejected'
         AND substr(actioned_at, 1, 7) = to_char(CURRENT_DATE, 'YYYY-MM')
    `)).rows[0].c);
    const avgRow = (await pool.query(`
      SELECT AVG(EXTRACT(EPOCH FROM (l.actioned_at::timestamp - s.submitted_at::timestamp)) / 3600) AS hrs
      FROM sar_approval_log l
      JOIN sar_filings s ON s.sar_id = l.sar_id
      WHERE l.action IN ('approved', 'rejected')
        AND s.submitted_at IS NOT NULL
        AND substr(l.actioned_at, 1, 7) = to_char(CURRENT_DATE, 'YYYY-MM')
    `)).rows[0];
    const avg = avgRow && avgRow.hrs ? Number(avgRow.hrs).toFixed(1) : null;
    res.json({ pending, approved_this_month: approvedThisMonth, rejected_this_month: rejectedThisMonth, avg_review_hours: avg });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const idParam = req.params.id;
    const idAsInt = /^\d+$/.test(idParam) ? Number(idParam) : -1;
    const sarResult = await pool.query(
      'SELECT * FROM sar_filings WHERE sar_id = $1 OR id = $2', [idParam, idAsInt]
    );
    const sar = sarResult.rows[0];
    if (!sar) return res.status(404).json({ error: 'SAR not found' });

    const sourceAlert = sar.source_alert_id
      ? (await pool.query('SELECT * FROM alerts WHERE alert_id = $1', [sar.source_alert_id])).rows[0] || null
      : null;
    const customer = sar.customer_id
      ? (await pool.query('SELECT * FROM customers WHERE customer_id = $1', [sar.customer_id])).rows[0] || null
      : null;

    const includedIdsRaw = sar.included_documents ? (() => {
      try { return JSON.parse(sar.included_documents); } catch (_e) { return []; }
    })() : [];
    const includedIds = Array.isArray(includedIdsRaw) ? includedIdsRaw : [];

    let documents = [];
    if (sar.source_alert_id) {
      documents = (await pool.query(
        'SELECT * FROM case_documents WHERE alert_id = $1 ORDER BY uploaded_at DESC',
        [sar.source_alert_id]
      )).rows;
    }
    documents = documents.map(d => ({ ...d, included: includedIds.includes(d.id) }));

    const caseNotes = sar.source_alert_id
      ? (await pool.query(
          'SELECT * FROM case_notes WHERE alert_id = $1 ORDER BY timestamp ASC',
          [sar.source_alert_id]
        )).rows
      : [];

    const customerSars = sar.customer_id
      ? (await pool.query(`
          SELECT sar_id, sar_status, filed_date, draft_created_date
            FROM sar_filings
           WHERE customer_id = $1 AND sar_id <> $2
           ORDER BY COALESCE(filed_date, draft_created_date) DESC
        `, [sar.customer_id, sar.sar_id])).rows
      : [];

    const customerAlerts = sar.customer_id
      ? (await pool.query(`
          SELECT alert_id, scenario, alert_status, priority, created_date, amount_flagged_inr
            FROM alerts
           WHERE customer_id = $1
           ORDER BY created_date DESC
           LIMIT 5
        `, [sar.customer_id])).rows
      : [];

    const reviewComments = (await pool.query(`
      SELECT * FROM sar_review_comments WHERE sar_id = $1 ORDER BY created_at ASC
    `, [sar.sar_id])).rows;

    const approvalLog = (await pool.query(`
      SELECT * FROM sar_approval_log WHERE sar_id = $1 ORDER BY actioned_at ASC
    `, [sar.sar_id])).rows.map(r => {
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
  } catch (err) { next(err); }
});

router.post('/:id/start-review', async (req, res, next) => {
  try {
    const idParam = req.params.id;
    const idAsInt = /^\d+$/.test(idParam) ? Number(idParam) : -1;
    const result = await pool.query(
      'SELECT * FROM sar_filings WHERE sar_id = $1 OR id = $2', [idParam, idAsInt]
    );
    const existing = result.rows[0];
    if (!existing) return res.status(404).json({ error: 'SAR not found' });
    if (existing.sar_status !== 'Pending Approval') {
      return res.json(existing);
    }
    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await pool.query(
      'UPDATE sar_filings SET sar_status = $1, updated_at = $2 WHERE sar_id = $3',
      ['Under Manager Review', stamp, existing.sar_id]
    );
    const reviewer = req.body?.manager_id || 'Compliance Manager';
    await logAudit({
      entity_type: ENTITY_TYPES.SAR, entity_id: existing.sar_id,
      action: `Opened for review by ${reviewer}`, performed_by: reviewer
    });
    const sel = await pool.query('SELECT * FROM sar_filings WHERE sar_id = $1', [existing.sar_id]);
    res.json(sel.rows[0]);
  } catch (err) { next(err); }
});

router.post('/:id/approve', async (req, res, next) => {
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
    const note       = req.body.notes || '';
    const checklist  = req.body.checklist || {};

    if (!existing.regulator_reference) {
      const stampSlug = today.replace(/-/g, '');
      const ref = `FIU-${stampSlug}-${existing.sar_id.replace(/[^0-9]/g, '').padStart(5, '0').slice(-5)}`;
      await pool.query(
        "UPDATE sar_filings SET regulator_reference = $1 WHERE sar_id = $2 AND (regulator_reference IS NULL OR regulator_reference = '')",
        [ref, existing.sar_id]
      );
    }

    const retentionYears = Number(await getManagerSetting('sar.retention_years', 5)) || 5;
    await pool.query(`
      UPDATE sar_filings
         SET sar_status = 'Filed', approved_by = $1, approved_at = $2,
             filed_date = $3, retention_status = 'Active',
             retention_expiry_date = ($4::date + ($8 || ' years')::INTERVAL)::date::text,
             updated_at = $5, latest_activity_date = $6,
             returned_to_analyst = 0
       WHERE sar_id = $7
    `, [approvedBy, stamp, today, today, stamp, today, existing.sar_id, String(retentionYears)]);

    await pool.query(`
      INSERT INTO sar_approval_log (sar_id, action, actioned_by, comments, checklist_items_completed)
      VALUES ($1, 'approved', $2, $3, $4)
    `, [existing.sar_id, approvedBy, note, JSON.stringify(checklist)]);

    await logAudit({
      entity_type: ENTITY_TYPES.SAR, entity_id: existing.sar_id,
      action: `Approved by ${approvedBy}`, performed_by: approvedBy,
      details: note || 'Approved by supervisor'
    });
    if (existing.regulator_reference || existing.sar_id) {
      await logAudit({
        entity_type: ENTITY_TYPES.SAR, entity_id: existing.sar_id,
        action: `Filed — BSA Reference: ${existing.regulator_reference || existing.sar_id}`,
        performed_by: approvedBy
      });
    }

    if (existing.case_id) {
      await pool.query(
        'UPDATE cases SET case_status = $1, updated_date = $2 WHERE case_id = $3',
        ['Filed', today, existing.case_id]
      );
    }

    if (existing.prepared_by) {
      await pool.query(`
        INSERT INTO notifications (recipient_id, recipient_role, type, title, message, related_id, related_type, tone)
        VALUES ($1, 'employee', 'sar_approved', $2, $3, $4, 'sar', 'success')
      `, [
        existing.prepared_by,
        `Your SAR ${existing.sar_id} was approved and filed`,
        `${existing.sar_id} for ${existing.customer_name} was approved by ${approvedBy}.`,
        existing.sar_id
      ]);
    }

    if (existing.customer_id) {
      const cust = (await pool.query(
        'SELECT customer_risk_rating, cdd_level FROM customers WHERE customer_id = $1',
        [existing.customer_id]
      )).rows[0];
      const openExisting = (await pool.query(`
        SELECT id FROM kyc_reviews
         WHERE customer_id = $1
           AND review_type = 'triggered_sar'
           AND status NOT IN ('completed', 'rejected')
         ORDER BY id DESC LIMIT 1
      `, [existing.customer_id])).rows[0];
      if (!openExisting) {
        await pool.query(`
          INSERT INTO kyc_reviews
            (customer_id, review_type, status, priority, due_date,
             previous_risk_rating, previous_cdd_level,
             triggered_by_sar_id, triggered_by_alert_id)
          VALUES ($1, 'triggered_sar', 'pending', 'Urgent', $2, $3, $4, $5, $6)
        `, [
          existing.customer_id, today,
          cust?.customer_risk_rating || null,
          cust?.cdd_level || null,
          existing.sar_id,
          existing.source_alert_id || null
        ]);
        await pool.query(`
          INSERT INTO notifications (recipient_id, recipient_role, type, title, message, related_id, related_type, tone)
          VALUES (NULL, 'manager', 'kyc_triggered_sar', $1, $2, $3, 'kyc_review', 'error')
        `, [
          `SAR-triggered KYC review — ${existing.customer_name}`,
          `${existing.sar_id} was just filed for ${existing.customer_name}; assign an analyst to the new KYC review.`,
          existing.customer_id
        ]);
      } else {
        await pool.query(`
          UPDATE kyc_reviews
             SET triggered_by_sar_id = COALESCE(triggered_by_sar_id, $1),
                 triggered_by_alert_id = COALESCE(triggered_by_alert_id, $2),
                 updated_at = NOW()
           WHERE id = $3
        `, [existing.sar_id, existing.source_alert_id || null, openExisting.id]);
      }
    }

    const sel = await pool.query('SELECT * FROM sar_filings WHERE sar_id = $1', [existing.sar_id]);
    res.json(sel.rows[0]);
  } catch (err) { next(err); }
});

router.post('/:id/reject', async (req, res, next) => {
  try {
    const idParam = req.params.id;
    const idAsInt = /^\d+$/.test(idParam) ? Number(idParam) : -1;
    const existingResult = await pool.query(
      'SELECT * FROM sar_filings WHERE sar_id = $1 OR id = $2', [idParam, idAsInt]
    );
    const existing = existingResult.rows[0];
    if (!existing) return res.status(404).json({ error: 'SAR not found' });

    const reasonCategory = req.body.reason_category;
    const comments = req.body.comments;
    const checklist = req.body.checklist || {};
    const rejectedBy = req.body.rejected_by || 'Compliance Manager';
    if (!reasonCategory) return res.status(400).json({ error: 'reason_category required' });
    if (!comments || comments.length < 50) return res.status(400).json({ error: 'comments must be at least 50 characters' });

    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const today = new Date().toISOString().slice(0, 10);

    await pool.query(`
      UPDATE sar_filings
         SET sar_status = 'Returned for Revision',
             rejection_reason_category = $1,
             rejection_comments = $2,
             rejection_checklist = $3,
             rejected_by = $4,
             rejected_at = $5,
             returned_to_analyst = 1,
             updated_at = $6, latest_activity_date = $7
       WHERE sar_id = $8
    `, [reasonCategory, comments, JSON.stringify(checklist), rejectedBy, stamp, stamp, today, existing.sar_id]);

    await pool.query(`
      INSERT INTO sar_approval_log (sar_id, action, actioned_by, reason_category, comments, checklist_items_completed)
      VALUES ($1, 'rejected', $2, $3, $4, $5)
    `, [existing.sar_id, rejectedBy, reasonCategory, comments, JSON.stringify(checklist)]);

    await logAudit({
      entity_type: ENTITY_TYPES.SAR, entity_id: existing.sar_id,
      action: `Rejected — Reason category: ${reasonCategory} — Comments: ${comments.slice(0, 100)}${comments.length > 100 ? '…' : ''}`,
      performed_by: rejectedBy
    });

    if (existing.case_id) {
      await pool.query(
        'UPDATE cases SET case_status = $1, updated_date = $2 WHERE case_id = $3',
        ['Work In Progress', today, existing.case_id]
      );
    }

    if (existing.prepared_by) {
      await pool.query(`
        INSERT INTO notifications (recipient_id, recipient_role, type, title, message, related_id, related_type, tone)
        VALUES ($1, 'employee', 'sar_rejected', $2, $3, $4, 'sar', 'warning')
      `, [
        existing.prepared_by,
        `Your SAR ${existing.sar_id} was returned for revision`,
        `${rejectedBy} flagged: ${reasonCategory}. Open the SAR to read full feedback and resubmit.`,
        existing.sar_id
      ]);
    }

    const sel = await pool.query('SELECT * FROM sar_filings WHERE sar_id = $1', [existing.sar_id]);
    res.json(sel.rows[0]);
  } catch (err) { next(err); }
});

router.get('/:id/comments', async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT * FROM sar_review_comments WHERE sar_id = $1 ORDER BY created_at ASC
    `, [req.params.id]);
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.post('/comments', async (req, res, next) => {
  try {
    const { sar_id, manager_id, comment_text, highlighted_text, position_start, position_end } = req.body;
    if (!sar_id || !comment_text) return res.status(400).json({ error: 'sar_id and comment_text required' });
    const reviewer = manager_id || 'Compliance Manager';
    const result = await pool.query(`
      INSERT INTO sar_review_comments (sar_id, manager_id, comment_text, highlighted_text, position_start, position_end)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
    `, [sar_id, reviewer, comment_text,
        highlighted_text || null,
        position_start ?? null, position_end ?? null]);
    await logAudit({
      entity_type: ENTITY_TYPES.SAR, entity_id: sar_id,
      action: `Review comment added by ${reviewer}`,
      performed_by: reviewer,
      details: comment_text.slice(0, 100) + (comment_text.length > 100 ? '…' : '')
    });
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

router.delete('/comments/:id', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM sar_review_comments WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
