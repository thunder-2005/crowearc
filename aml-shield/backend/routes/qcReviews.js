const express = require('express');
const pool = require('../database/db');
const { logAudit, ENTITY_TYPES } = require('../utils/audit');
const { requireL2OrManager } = require('../middleware/roleGuard');

const router = express.Router();

// QC (Quality Check) workflow for L1 False Positive closures.
//
// Lifecycle:
//   1. L1 closes alert as FP → /api/alerts/:id/close-fp creates a qc_reviews
//      row (status='pending') and flips the alert to alert_status='Pending QC'.
//      All active L2 analysts get a notification.
//   2. An L2 (or manager) accepts the review → status='in_review'.
//   3. L2 submits a checklist + overall decision:
//      pass → alert moves to 'Closed — False Positive' (final close), qc passed.
//      fail → reopen request inserted directly, alert stays 'Pending QC' until
//             the existing Manager → BSA chain authorizes the reopen.
//
// All write routes are L2-or-Manager only. The original L1 analyst can see
// QC status via a card badge on their Completed column but cannot act here.

const FAILURE_REASONS = new Set([
  'insufficient_investigation',
  'missed_red_flags',
  'inadequate_notes',
  'risk_not_considered',
  'new_information',
  'other'
]);

async function notify({ recipient_id, recipient_role, type, title, message, related_id, tone }) {
  try {
    await pool.query(`
      INSERT INTO notifications
        (recipient_id, recipient_role, type, title, message, related_id, related_type, tone)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [recipient_id || null, recipient_role, type, title, message, related_id || null, 'alert', tone || 'info']);
  } catch (_e) { /* best-effort */ }
}

// ─────────────────────────────────────────────── GET / — QC queue

router.get('/', async (req, res, next) => {
  try {
    const { status, assigned_to } = req.query;
    let sql = `
      SELECT qr.*,
             a.scenario,
             a.priority,
             a.amount_flagged_inr,
             a.customer_risk_rating,
             a.risk_score,
             a.rule_explanation,
             a.sanctions_match,
             a.pep_match,
             a.sla_deadline,
             a.created_date AS alert_created_date,
             a.customer_id
        FROM qc_reviews qr
        JOIN alerts a ON qr.alert_id = a.alert_id
       WHERE 1=1
    `;
    const params = [];
    let n = 0;
    if (status)      { params.push(status);      sql += ` AND qr.status = $${++n}`; }
    if (assigned_to) { params.push(assigned_to); sql += ` AND qr.assigned_to = $${++n}`; }
    sql += `
       ORDER BY
         CASE a.priority WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 WHEN 'Low' THEN 3 ELSE 4 END,
         qr.created_at ASC
    `;
    const r = await pool.query(sql, params);
    res.json(r.rows);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────── GET /stats — manager + sidebar

router.get('/stats', async (_req, res, next) => {
  try {
    const counts = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending')::int                                            AS pending_count,
        COUNT(*) FILTER (WHERE status = 'in_review')::int                                          AS in_review_count,
        COUNT(*) FILTER (WHERE status = 'passed'
                          AND reviewed_at IS NOT NULL
                          AND EXTRACT(YEAR FROM reviewed_at) = EXTRACT(YEAR FROM NOW())
                          AND EXTRACT(MONTH FROM reviewed_at) = EXTRACT(MONTH FROM NOW()))::int    AS passed_this_month,
        COUNT(*) FILTER (WHERE status = 'failed'
                          AND reviewed_at IS NOT NULL
                          AND EXTRACT(YEAR FROM reviewed_at) = EXTRACT(YEAR FROM NOW())
                          AND EXTRACT(MONTH FROM reviewed_at) = EXTRACT(MONTH FROM NOW()))::int    AS failed_this_month
        FROM qc_reviews
    `);
    const c = counts.rows[0];
    const totalDecided = (c.passed_this_month || 0) + (c.failed_this_month || 0);
    const passRate = totalDecided > 0
      ? Math.round((c.passed_this_month / totalDecided) * 100)
      : null;

    const byAnalyst = await pool.query(`
      SELECT original_analyst                                                        AS analyst,
             COUNT(*) FILTER (WHERE status IN ('passed','failed'))::int             AS total,
             COUNT(*) FILTER (WHERE status = 'passed')::int                         AS passed,
             COUNT(*) FILTER (WHERE status = 'failed')::int                         AS failed
        FROM qc_reviews
       GROUP BY original_analyst
       ORDER BY total DESC
    `);
    const by_analyst = byAnalyst.rows.map(r => ({
      ...r,
      pass_rate: r.total > 0 ? Math.round((r.passed / r.total) * 100) : null
    }));

    res.json({
      pending_count:     c.pending_count || 0,
      in_review_count:   c.in_review_count || 0,
      passed_this_month: c.passed_this_month || 0,
      failed_this_month: c.failed_this_month || 0,
      pass_rate_pct:     passRate,
      by_analyst
    });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────── GET /:qcId — single review

router.get('/:qcId', async (req, res, next) => {
  try {
    const r = await pool.query(`
      SELECT qr.*,
             a.scenario,
             a.priority,
             a.amount_flagged_inr,
             a.customer_id,
             a.customer_risk_rating,
             a.risk_score,
             a.rule_explanation,
             a.sanctions_match,
             a.pep_match,
             a.sla_deadline,
             a.disposition,
             a.alert_status,
             a.created_date AS alert_created_date
        FROM qc_reviews qr
        JOIN alerts a ON qr.alert_id = a.alert_id
       WHERE qr.qc_id = $1
    `, [req.params.qcId]);
    if (!r.rows[0]) return res.status(404).json({ error: 'QC review not found' });
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────── PATCH /:qcId/accept

router.patch('/:qcId/accept', requireL2OrManager, async (req, res, next) => {
  try {
    const { reviewed_by } = req.body || {};
    if (!reviewed_by) return res.status(400).json({ error: 'reviewed_by required' });

    const existing = (await pool.query(
      'SELECT qc_id, status FROM qc_reviews WHERE qc_id = $1', [req.params.qcId]
    )).rows[0];
    if (!existing) return res.status(404).json({ error: 'QC review not found' });
    if (existing.status === 'passed' || existing.status === 'failed') {
      return res.status(400).json({ error: `QC review already ${existing.status}` });
    }

    await pool.query(`
      UPDATE qc_reviews
         SET status = 'in_review',
             assigned_to = $1,
             assigned_at = NOW(),
             updated_at = NOW()
       WHERE qc_id = $2
    `, [reviewed_by, req.params.qcId]);
    const row = (await pool.query('SELECT * FROM qc_reviews WHERE qc_id = $1', [req.params.qcId])).rows[0];
    res.json(row);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────── PATCH /:qcId/decision

router.patch('/:qcId/decision', requireL2OrManager, async (req, res, next) => {
  try {
    const { reviewed_by, overall_decision, checklist, failure_reason, failure_notes } = req.body || {};
    if (!reviewed_by) return res.status(400).json({ error: 'reviewed_by required' });
    if (!['pass', 'fail'].includes(overall_decision)) {
      return res.status(400).json({ error: 'overall_decision must be "pass" or "fail"' });
    }
    if (!checklist || typeof checklist !== 'object') {
      return res.status(400).json({ error: 'checklist (object) required' });
    }
    const requiredChecks = ['fp_justified', 'notes_adequate', 'risk_considered', 'customer_profile_reviewed', 'no_new_red_flags'];
    for (const k of requiredChecks) {
      if (typeof checklist[k] !== 'boolean') {
        return res.status(400).json({ error: `checklist.${k} must be a boolean` });
      }
    }
    if (overall_decision === 'fail') {
      if (!failure_reason || !FAILURE_REASONS.has(failure_reason)) {
        return res.status(400).json({ error: `failure_reason must be one of: ${[...FAILURE_REASONS].join(', ')}` });
      }
      if (!failure_notes || String(failure_notes).trim().length < 50) {
        return res.status(400).json({ error: 'failure_notes required and must be at least 50 characters' });
      }
    }

    const qc = (await pool.query('SELECT * FROM qc_reviews WHERE qc_id = $1', [req.params.qcId])).rows[0];
    if (!qc) return res.status(404).json({ error: 'QC review not found' });
    if (qc.status === 'passed' || qc.status === 'failed') {
      return res.status(400).json({ error: `QC review already ${qc.status}` });
    }

    const alert = (await pool.query(
      'SELECT alert_id, customer_name, assigned_to, disposition, closed_date FROM alerts WHERE alert_id = $1',
      [qc.alert_id]
    )).rows[0];

    if (overall_decision === 'pass') {
      // Final close — flip alert to canonical FP-closed status.
      await pool.query(`
        UPDATE qc_reviews
           SET status = 'passed',
               reviewed_by = $1,
               reviewed_at = NOW(),
               checklist = $2::jsonb,
               overall_decision = 'pass',
               updated_at = NOW()
         WHERE qc_id = $3
      `, [reviewed_by, JSON.stringify(checklist), qc.qc_id]);

      await pool.query(`
        UPDATE alerts
           SET alert_status = 'Closed — False Positive',
               qc_status = 'passed',
               last_activity_date = CURRENT_DATE::text
         WHERE alert_id = $1
      `, [qc.alert_id]);

      await logAudit({
        entity_type: ENTITY_TYPES.ALERT, entity_id: qc.alert_id,
        action: 'alert.qc_passed',
        performed_by: reviewed_by,
        details: JSON.stringify({ qc_id: qc.qc_id, original_analyst: qc.original_analyst })
      });

      await notify({
        recipient_id: qc.original_analyst,
        recipient_role: 'employee',
        type: 'qc_passed',
        title: 'QC Review Passed',
        message: `Your FP closure on ${qc.alert_id} passed QC review by ${reviewed_by}. Alert is now closed.`,
        related_id: qc.alert_id,
        tone: 'success'
      });

      const updated = (await pool.query('SELECT * FROM qc_reviews WHERE qc_id = $1', [qc.qc_id])).rows[0];
      return res.json({ qc_review: updated, alert_status: 'Closed — False Positive' });
    }

    // FAIL path — direct INSERT into alert_reopen_requests (bypasses the public
    // POST validation which expects a closed status; ours is 'Pending QC').
    const requestId = 'RRQ-QC-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const reasonDetailRaw = `QC review failed by ${reviewed_by}. Reason: ${failure_reason}. ${failure_notes.trim()}`;
    // alert_reopen_requests has no min-length CHECK at DB level; the public
    // POST endpoint enforces 100 chars. Pad if necessary so any cross-flow
    // consumer that re-validates won't choke.
    const reasonDetail = reasonDetailRaw.length >= 100
      ? reasonDetailRaw
      : reasonDetailRaw + ' '.repeat(100 - reasonDetailRaw.length);

    const ins = await pool.query(`
      INSERT INTO alert_reopen_requests
        (request_id, alert_id, customer_name, original_disposition, original_closed_by, original_closed_at,
         requested_by, requested_by_role, requested_at, reason_code, reason_detail, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, $10, 'pending_manager')
      RETURNING *
    `, [
      requestId,
      qc.alert_id,
      qc.customer_name || alert?.customer_name || null,
      qc.original_disposition || 'False Positive',
      qc.original_analyst,
      qc.original_closed_at,
      reviewed_by,
      'analyst_l2',
      'qc_review_failed',
      reasonDetail
    ]);

    await pool.query(`
      UPDATE qc_reviews
         SET status = 'failed',
             reviewed_by = $1,
             reviewed_at = NOW(),
             checklist = $2::jsonb,
             overall_decision = 'fail',
             failure_reason = $3,
             failure_notes = $4,
             reopen_request_id = $5,
             updated_at = NOW()
       WHERE qc_id = $6
    `, [reviewed_by, JSON.stringify(checklist), failure_reason, failure_notes.trim(), requestId, qc.qc_id]);

    await pool.query(`
      UPDATE alerts SET qc_status = 'failed', last_activity_date = CURRENT_DATE::text WHERE alert_id = $1
    `, [qc.alert_id]);

    await logAudit({
      entity_type: ENTITY_TYPES.ALERT, entity_id: qc.alert_id,
      action: 'alert.qc_failed',
      performed_by: reviewed_by,
      details: JSON.stringify({ qc_id: qc.qc_id, failure_reason, reopen_request_id: requestId })
    });

    await notify({
      recipient_role: 'manager',
      type: 'qc_failed_reopen',
      title: 'QC Failed — Reopen Approval Required',
      message: `${qc.alert_id} FP closure failed QC by ${reviewed_by}. Reopen request requires your approval.`,
      related_id: qc.alert_id,
      tone: 'warning'
    });
    await notify({
      recipient_id: qc.original_analyst,
      recipient_role: 'employee',
      type: 'qc_failed',
      title: 'QC Review Failed',
      message: `Your FP closure on ${qc.alert_id} failed QC review. A reopen request has been submitted. You will be notified if the alert is reopened.`,
      related_id: qc.alert_id,
      tone: 'warning'
    });

    const updated = (await pool.query('SELECT * FROM qc_reviews WHERE qc_id = $1', [qc.qc_id])).rows[0];
    res.json({ qc_review: updated, reopen_request: ins.rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
