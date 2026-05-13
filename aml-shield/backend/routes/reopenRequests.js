const express = require('express');
const pool = require('../database/db');
const { logAudit, ENTITY_TYPES } = require('../utils/audit');
const {
  requireAnyAnalyst, requireManager, requireBsaOfficer
} = require('../middleware/roleGuard');

const router = express.Router();

const CLOSED_STATUSES = ['Completed', 'Closed — False Positive', 'False Positive'];

// Helper — write a notification row. Mirrors the sarApprovals pattern.
async function notify({ recipient_id, recipient_role, type, title, message, related_id, tone }) {
  try {
    await pool.query(`
      INSERT INTO notifications
        (recipient_id, recipient_role, type, title, message, related_id, related_type, tone)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [recipient_id || null, recipient_role, type, title, message, related_id || null, 'alert', tone || 'info']);
  } catch (_e) { /* best-effort */ }
}

// ─────────────────────────────────────────────── POST /  (L1 raises request)
//
// Body: { alert_id, reason_code, reason_detail, requested_by, requested_by_role,
//          evidence_document_id? }
//
// Guard: any analyst can raise. Backend re-validates that the alert is in a
// closed status and that no non-terminal request already exists for it.

router.post('/', requireAnyAnalyst, async (req, res, next) => {
  try {
    const { alert_id, reason_code, reason_detail, requested_by, requested_by_role, evidence_document_id } = req.body || {};
    if (!alert_id || !reason_code || !reason_detail || !requested_by || !requested_by_role) {
      return res.status(400).json({ error: 'alert_id, reason_code, reason_detail, requested_by, requested_by_role are required' });
    }
    if (String(reason_detail).trim().length < 100) {
      return res.status(400).json({ error: 'reason_detail must be at least 100 characters' });
    }

    const alert = (await pool.query(
      'SELECT alert_id, alert_status, customer_name, disposition, assigned_to, closed_date FROM alerts WHERE alert_id = $1',
      [alert_id]
    )).rows[0];
    if (!alert) return res.status(404).json({ error: 'Alert not found' });
    if (!CLOSED_STATUSES.includes(alert.alert_status)) {
      return res.status(400).json({ error: `Alert must be in a closed status (currently '${alert.alert_status}')` });
    }

    const existing = (await pool.query(`
      SELECT request_id, status FROM alert_reopen_requests
       WHERE alert_id = $1
         AND status NOT IN ('manager_rejected', 'bsa_rejected')
       LIMIT 1
    `, [alert_id])).rows[0];
    if (existing) {
      return res.status(409).json({
        error: 'A reopen request for this alert is already pending',
        existing_request_id: existing.request_id,
        existing_status: existing.status
      });
    }

    const request_id = 'RRQ-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const ins = await pool.query(`
      INSERT INTO alert_reopen_requests
        (request_id, alert_id, customer_name, original_disposition, original_closed_by, original_closed_at,
         requested_by, requested_by_role, requested_at, reason_code, reason_detail, evidence_document_id, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, $10, $11, 'pending_manager')
      RETURNING *
    `, [
      request_id, alert_id, alert.customer_name,
      alert.disposition || alert.alert_status,
      alert.assigned_to,
      alert.closed_date ? alert.closed_date + ' 00:00:00' : null,
      requested_by, requested_by_role, reason_code, String(reason_detail).trim(),
      evidence_document_id || null
    ]);

    await logAudit({
      entity_type: ENTITY_TYPES.ALERT, entity_id: alert_id,
      action: `alert.reopen_requested — Reason: ${reason_code}`,
      performed_by: requested_by,
      details: JSON.stringify({ request_id, reason_code, reason_detail: String(reason_detail).slice(0, 200) })
    });

    await notify({
      recipient_role: 'manager',
      type: 'reopen_request_pending',
      title: 'Alert Reopen Request',
      message: `${requested_by} requested to reopen ${alert_id} — ${alert.customer_name}. Reason: ${reason_code}`,
      related_id: alert_id,
      tone: 'warning'
    });

    res.status(201).json(ins.rows[0]);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────── PATCH /:id/manager  (Manager decision)

router.patch('/:id/manager', requireManager, async (req, res, next) => {
  try {
    const { decision, notes } = req.body || {};
    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({ error: 'decision must be "approve" or "reject"' });
    }
    if (decision === 'reject' && (!notes || String(notes).trim().length < 20)) {
      return res.status(400).json({ error: 'notes >= 20 characters required for rejection' });
    }
    const managerName = req.headers['x-user-name'] || 'Compliance Manager';

    const existing = (await pool.query(
      'SELECT * FROM alert_reopen_requests WHERE request_id = $1',
      [req.params.id]
    )).rows[0];
    if (!existing) return res.status(404).json({ error: 'Request not found' });
    if (existing.status !== 'pending_manager') {
      return res.status(400).json({ error: `Request is in '${existing.status}', not eligible for manager review` });
    }

    const newStatus = decision === 'approve' ? 'pending_bsa' : 'manager_rejected';
    await pool.query(`
      UPDATE alert_reopen_requests
         SET status = $1,
             manager_reviewed_by = $2,
             manager_reviewed_at = NOW(),
             manager_decision = $3,
             manager_notes = $4,
             updated_at = NOW()
       WHERE request_id = $5
    `, [newStatus, managerName, decision, notes || null, req.params.id]);

    await logAudit({
      entity_type: ENTITY_TYPES.ALERT, entity_id: existing.alert_id,
      action: decision === 'approve'
        ? `alert.reopen_manager_approved by ${managerName}`
        : `alert.reopen_manager_rejected by ${managerName}`,
      performed_by: managerName,
      details: notes || null
    });

    if (decision === 'approve') {
      await notify({
        recipient_role: 'bsa_officer',
        type: 'reopen_request_bsa',
        title: 'Alert Reopen — Awaiting Your Authorization',
        message: `Manager ${managerName} approved reopen request for ${existing.alert_id}. Your authorization required.`,
        related_id: existing.alert_id,
        tone: 'warning'
      });
      await notify({
        recipient_id: existing.requested_by,
        recipient_role: existing.requested_by_role,
        type: 'reopen_request_manager_approved',
        title: 'Reopen approved by Manager',
        message: `Your reopen request for ${existing.alert_id} has been approved by ${managerName} — awaiting BSA Officer authorization.`,
        related_id: existing.alert_id,
        tone: 'info'
      });
    } else {
      await notify({
        recipient_id: existing.requested_by,
        recipient_role: existing.requested_by_role,
        type: 'reopen_request_manager_rejected',
        title: 'Reopen rejected',
        message: `Your reopen request for ${existing.alert_id} was not approved. Reason: ${notes}`,
        related_id: existing.alert_id,
        tone: 'error'
      });
    }

    const updated = (await pool.query(
      'SELECT * FROM alert_reopen_requests WHERE request_id = $1', [req.params.id]
    )).rows[0];
    res.json(updated);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────── PATCH /:id/bsa  (BSA decision)
//
// On approve: flips the alert back to 'In Progress', stamps reopened_at /
// reopened_by / reopen_request_id, and writes the alert.reopened audit row.
// On reject: locks the request out — bsa_rejected is terminal.

router.patch('/:id/bsa', requireBsaOfficer, async (req, res, next) => {
  try {
    const { decision, notes } = req.body || {};
    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({ error: 'decision must be "approve" or "reject"' });
    }
    if (!notes || String(notes).trim().length < 20) {
      return res.status(400).json({ error: 'notes >= 20 characters required (this decision is permanently recorded)' });
    }
    const bsaName = req.headers['x-user-name'] || 'BSA Officer';

    const existing = (await pool.query(
      'SELECT * FROM alert_reopen_requests WHERE request_id = $1',
      [req.params.id]
    )).rows[0];
    if (!existing) return res.status(404).json({ error: 'Request not found' });
    if (existing.status !== 'pending_bsa') {
      return res.status(400).json({ error: `Request is in '${existing.status}', not eligible for BSA review` });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const newStatus = decision === 'approve' ? 'bsa_approved' : 'bsa_rejected';
      await client.query(`
        UPDATE alert_reopen_requests
           SET status = $1,
               bsa_reviewed_by = $2,
               bsa_reviewed_at = NOW(),
               bsa_decision = $3,
               bsa_notes = $4,
               updated_at = NOW()
         WHERE request_id = $5
      `, [newStatus, bsaName, decision, notes.trim(), req.params.id]);

      if (decision === 'approve') {
        // Flip the alert itself back to In Progress and stamp the reopen
        // provenance fields. Activity-log row written separately below.
        await client.query(`
          UPDATE alerts
             SET alert_status = 'In Progress',
                 reopened_at = NOW(),
                 reopened_by = $1,
                 reopen_request_id = $2,
                 last_activity_date = $3
           WHERE alert_id = $4
        `, [bsaName, existing.request_id, new Date().toISOString().slice(0, 10), existing.alert_id]);
      }

      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_e) { /* swallow */ }
      client.release();
      throw err;
    }
    client.release();

    if (decision === 'approve') {
      await logAudit({
        entity_type: ENTITY_TYPES.ALERT, entity_id: existing.alert_id,
        action: `alert.reopened — authorized by ${bsaName}`,
        performed_by: bsaName,
        details: JSON.stringify({
          original_disposition: existing.original_disposition,
          request_id: existing.request_id,
          reason_code: existing.reason_code,
          authorized_by: bsaName
        })
      });
      await notify({
        recipient_id: existing.requested_by,
        recipient_role: existing.requested_by_role,
        type: 'alert_reopened',
        title: '🔄 Alert reopened',
        message: `${existing.alert_id} has been authorized for reopening by ${bsaName}. Please review and investigate.`,
        related_id: existing.alert_id,
        tone: 'warning'
      });
      await notify({
        recipient_role: 'manager',
        type: 'alert_reopened_notice',
        title: 'Alert reopened',
        message: `${existing.alert_id} reopened — authorized by ${bsaName}.`,
        related_id: existing.alert_id,
        tone: 'info'
      });
    } else {
      await logAudit({
        entity_type: ENTITY_TYPES.ALERT, entity_id: existing.alert_id,
        action: `alert.reopen_bsa_rejected by ${bsaName} — final decision`,
        performed_by: bsaName,
        details: notes.trim()
      });
      await notify({
        recipient_id: existing.requested_by,
        recipient_role: existing.requested_by_role,
        type: 'reopen_request_bsa_rejected',
        title: 'Reopen denied — final',
        message: `Your reopen request for ${existing.alert_id} was denied by BSA Officer ${bsaName}. This is a final decision. Reason: ${notes.trim()}`,
        related_id: existing.alert_id,
        tone: 'error'
      });
    }

    const updated = (await pool.query(
      'SELECT * FROM alert_reopen_requests WHERE request_id = $1', [req.params.id]
    )).rows[0];
    res.json(updated);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────── GET /  (list)

router.get('/', async (req, res, next) => {
  try {
    const { status, alert_id, requested_by } = req.query;
    let sql = 'SELECT * FROM alert_reopen_requests WHERE 1=1';
    const params = [];
    let n = 0;
    if (status)       { params.push(status);       sql += ` AND status = $${++n}`; }
    if (alert_id)     { params.push(alert_id);     sql += ` AND alert_id = $${++n}`; }
    if (requested_by) { params.push(requested_by); sql += ` AND requested_by = $${++n}`; }
    sql += ' ORDER BY requested_at DESC';
    const r = await pool.query(sql, params);
    res.json({ count: r.rows.length, requests: r.rows });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────── GET /:id

router.get('/:id', async (req, res, next) => {
  try {
    const r = await pool.query(
      'SELECT * FROM alert_reopen_requests WHERE request_id = $1',
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Request not found' });
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
