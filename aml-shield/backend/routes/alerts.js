const express = require('express');
const pool = require('../database/db');
const { logAudit, ENTITY_TYPES } = require('../utils/audit');
const { requireManager, requireAnyAnalyst } = require('../middleware/roleGuard');

const router = express.Router();

router.get('/analysts', async (_req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT assigned_to AS analyst, COUNT(*) AS total
        FROM alerts
       WHERE assigned_to IS NOT NULL AND TRIM(assigned_to) <> ''
       GROUP BY assigned_to
       ORDER BY assigned_to ASC
    `);
    res.json(result.rows.map(r => ({ ...r, total: Number(r.total) })));
  } catch (err) { next(err); }
});

const ALERT_SELECT = `
  SELECT a.*,
         COALESCE(c.customer_risk_rating, a.customer_risk_rating) AS customer_risk_rating,
         COALESCE(c.kyc_review_status,    a.kyc_review_status)    AS kyc_review_status,
         COALESCE(c.pep_match,            a.pep_match)            AS pep_match,
         COALESCE(c.sanctions_match,      a.sanctions_match)      AS sanctions_match,
         c.cdd_level                                              AS customer_cdd_level,
         c.exit_status                                            AS customer_exit_status,
         cs.case_id                                               AS linked_case_id,
         cs.case_status                                           AS linked_case_status,
         sf.sar_id                                                AS linked_sar_id,
         sf.sar_status                                            AS linked_sar_status
    FROM alerts a
    LEFT JOIN customers   c  ON c.customer_id = a.customer_id
    LEFT JOIN cases       cs ON cs.source_alert_id = a.alert_id
    LEFT JOIN sar_filings sf ON sf.source_alert_id = a.alert_id
`;

router.get('/', async (req, res, next) => {
  try {
    const { alert_status, priority, scenario, assigned_to, q, include_unassigned_for, priority_bucket_sort } = req.query;
    let sql = ALERT_SELECT + ' WHERE 1=1';
    const params = [];
    let n = 0;
    if (alert_status) { params.push(alert_status); sql += ` AND a.alert_status = $${++n}`; }
    if (priority)     { params.push(priority);     sql += ` AND a.priority = $${++n}`; }
    if (scenario)     { params.push(scenario);     sql += ` AND a.scenario = $${++n}`; }
    if (assigned_to) {
      if (include_unassigned_for === '1') {
        params.push(assigned_to);
        sql += ` AND (a.assigned_to = $${++n} OR a.assigned_to IS NULL OR a.assigned_to = '')`;
      } else {
        params.push(assigned_to);
        sql += ` AND a.assigned_to = $${++n}`;
      }
    }
    if (q) {
      params.push(`%${q}%`, `%${q}%`);
      sql += ` AND (a.alert_id LIKE $${++n} OR a.customer_name LIKE $${++n})`;
    }
    // priority_bucket_sort: manager-table sort that bands alerts by lifecycle
    // status (Unassigned → Not Started → In Progress → Escalated → Closed),
    // newest first within each band. Kanban-driven /alerts calls don't pass
    // this flag, so the original `created_date DESC` is preserved for them.
    if (priority_bucket_sort === '1' || priority_bucket_sort === 'true') {
      sql += ` ORDER BY
        CASE a.alert_status
          WHEN 'Unassigned'         THEN 1
          WHEN 'Not Started'        THEN 2
          WHEN 'Work in Progress'   THEN 3
          WHEN 'In Progress'        THEN 3
          WHEN 'Escalated - L2'     THEN 4
          WHEN 'Escalated - SAR'    THEN 4
          WHEN 'Completed'          THEN 5
          WHEN 'Closed'             THEN 5
          WHEN 'False Positive'     THEN 5
          ELSE 6
        END ASC,
        a.created_date DESC`;
    } else {
      sql += ' ORDER BY a.created_date DESC';
    }
    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const idParam = req.params.id;
    const idAsInt = /^\d+$/.test(idParam) ? Number(idParam) : -1;
    const result = await pool.query(ALERT_SELECT + ' WHERE a.alert_id = $1 OR a.id = $2', [idParam, idAsInt]);
    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: 'Alert not found' });
    res.json(row);
  } catch (err) { next(err); }
});

router.get('/:id/transactions', async (req, res, next) => {
  try {
    const idParam = req.params.id;
    const idAsInt = /^\d+$/.test(idParam) ? Number(idParam) : -1;
    const alertResult = await pool.query(
      'SELECT alert_id, customer_id FROM alerts WHERE alert_id = $1 OR id = $2',
      [idParam, idAsInt]
    );
    const alert = alertResult.rows[0];
    if (!alert) return res.status(404).json({ error: 'Alert not found' });
    const { from, to, txn_type, min_amount, max_amount, alerted_only } = req.query;
    // Cast BIGINT money columns to float so they arrive as JS numbers,
    // not strings. The pg driver returns BIGINT as a string by default
    // to preserve precision; without the cast the frontend's reduce()
    // would do string concatenation and produce astronomical totals.
    let sql = `
      SELECT id, transaction_id, account_number, customer_id,
             txn_date, txn_time, txn_type, channel, description,
             counterparty, counterparty_country,
             amount::float AS amount,
             running_balance::float AS running_balance,
             is_alerted, alert_id, scenario_triggered, rule_breached, risk_score,
             (is_alerted = 1 AND alert_id = $1) AS is_this_alert
        FROM transactions
       WHERE customer_id = $2
    `;
    const params = [alert.alert_id, alert.customer_id];
    let n = 2;
    if (alerted_only === '1') {
      sql += ' AND is_alerted = 1';
    } else {
      if (from)       { params.push(from);              sql += ` AND (txn_date >= $${++n} OR is_alerted = 1)`; }
      if (to)         { params.push(to);                sql += ` AND (txn_date <= $${++n} OR is_alerted = 1)`; }
      if (txn_type)   { params.push(txn_type);          sql += ` AND (txn_type = $${++n} OR is_alerted = 1)`; }
      if (min_amount) { params.push(Number(min_amount));sql += ` AND (amount >= $${++n} OR is_alerted = 1)`; }
      if (max_amount) { params.push(Number(max_amount));sql += ` AND (amount <= $${++n} OR is_alerted = 1)`; }
    }
    sql += ' ORDER BY txn_date DESC, txn_time DESC';
    const rows = (await pool.query(sql, params)).rows;
    const alertedTotal = rows.filter(r => r.is_alerted).reduce((s, r) => s + Number(r.amount), 0);
    res.json({
      alert_id: alert.alert_id,
      customer_id: alert.customer_id,
      summary: {
        shown: rows.length,
        alerted_count: rows.filter(r => r.is_alerted).length,
        this_alert_count: rows.filter(r => r.is_this_alert).length,
        alerted_total_amount: alertedTotal
      },
      transactions: rows
    });
  } catch (err) { next(err); }
});

router.patch('/:id/disposition', requireAnyAnalyst, async (req, res, next) => {
  try {
    const { disposition, performed_by, reason } = req.body;
    if (!disposition) return res.status(400).json({ error: 'disposition required' });
    const idParam = req.params.id;
    const idAsInt = /^\d+$/.test(idParam) ? Number(idParam) : -1;
    const upd = await pool.query(
      'UPDATE alerts SET disposition = $1, last_activity_date = $2 WHERE alert_id = $3 OR id = $4',
      [disposition, new Date().toISOString().slice(0, 10), idParam, idAsInt]
    );
    if (upd.rowCount === 0) return res.status(404).json({ error: 'Alert not found' });
    const alert = (await pool.query(
      'SELECT alert_id FROM alerts WHERE alert_id = $1 OR id = $2',
      [idParam, idAsInt]
    )).rows[0];
    await pool.query(`
      INSERT INTO case_notes (alert_id, note_text, analyst, timestamp)
      VALUES ($1, $2, $3, NOW())
    `, [alert.alert_id, `Disposition set to "${disposition}"`, performed_by || 'system']);

    // Audit: classify by disposition text so analyst-driven False Positive
    // closures and L2-driven Closed-No-Suspicion cases are distinguishable
    // in the alert's Activity Log.
    const dispLower = String(disposition).toLowerCase();
    let action = `Disposition set: ${disposition}`;
    if (dispLower.includes('false positive')) {
      action = reason
        ? `Alert closed as False Positive — Reason: ${reason}`
        : 'Alert closed as False Positive';
    } else if (dispLower.includes('no suspicion') || dispLower.includes('no suspicious')) {
      action = 'Alert closed — No Suspicious Activity';
    }
    await logAudit({
      entity_type: ENTITY_TYPES.ALERT, entity_id: alert.alert_id,
      action, performed_by: performed_by || 'system'
    });

    const sel = await pool.query('SELECT * FROM alerts WHERE alert_id = $1', [alert.alert_id]);
    res.json(sel.rows[0]);
  } catch (err) { next(err); }
});

router.patch('/:id/status', requireAnyAnalyst, async (req, res, next) => {
  try {
    const { alert_status, assigned_to, performed_by } = req.body;
    if (!alert_status) return res.status(400).json({ error: 'alert_status required' });
    const idParam = req.params.id;
    const idAsInt = /^\d+$/.test(idParam) ? Number(idParam) : -1;

    // Capture the previous status so the audit entry can show "from X to Y".
    const before = (await pool.query(
      'SELECT alert_id, alert_status FROM alerts WHERE alert_id = $1 OR id = $2',
      [idParam, idAsInt]
    )).rows[0];
    if (!before) return res.status(404).json({ error: 'Alert not found' });

    await pool.query(
      'UPDATE alerts SET alert_status = $1, assigned_to = COALESCE($2, assigned_to), last_activity_date = $3 WHERE alert_id = $4',
      [alert_status, assigned_to || null, new Date().toISOString().slice(0, 10), before.alert_id]
    );

    // Audit: differentiate "Investigation started" (Not Started → Work in
    // Progress when the L1 opens the workspace) from a generic status change.
    if (before.alert_status !== alert_status) {
      const wasNotStarted = (before.alert_status || '').toLowerCase() === 'not started';
      const nowInProgress = (alert_status || '').toLowerCase() === 'work in progress';
      const action = (wasNotStarted && nowInProgress)
        ? 'Investigation started'
        : `Status changed from ${before.alert_status} to ${alert_status}`;
      await logAudit({
        entity_type: ENTITY_TYPES.ALERT, entity_id: before.alert_id,
        action, performed_by: performed_by || 'system'
      });
    }

    const sel = await pool.query('SELECT * FROM alerts WHERE alert_id = $1', [before.alert_id]);
    res.json(sel.rows[0]);
  } catch (err) { next(err); }
});

router.patch('/:id/assign', requireManager, async (req, res, next) => {
  try {
    const { assigned_to, performed_by } = req.body;
    if (!assigned_to) return res.status(400).json({ error: 'assigned_to required' });
    const idParam = req.params.id;
    const idAsInt = /^\d+$/.test(idParam) ? Number(idParam) : -1;
    const existing = (await pool.query(
      'SELECT * FROM alerts WHERE alert_id = $1 OR id = $2', [idParam, idAsInt]
    )).rows[0];
    if (!existing) return res.status(404).json({ error: 'Alert not found' });
    const nextStatus = existing.alert_status === 'Unassigned' ? 'Not Started' : existing.alert_status;
    await pool.query(
      'UPDATE alerts SET assigned_to = $1, alert_status = $2, last_activity_date = $3 WHERE alert_id = $4',
      [assigned_to, nextStatus, new Date().toISOString().slice(0, 10), existing.alert_id]
    );
    await logAudit({
      entity_type: ENTITY_TYPES.ALERT, entity_id: existing.alert_id,
      action: `Alert assigned to ${assigned_to}`,
      performed_by: performed_by || (assigned_to === existing.assigned_to ? assigned_to : 'system'),
      details: existing.assigned_to ? `Reassigned from ${existing.assigned_to}` : null
    });

    // Notify the assignee. Skip on no-op self-reassign (where assigned_to
    // didn't change) so a status PATCH doesn't double-fire. Manager is not
    // notified — they're the one assigning, they already know.
    if (assigned_to !== existing.assigned_to) {
      const slaLabel = existing.sla_days != null ? `${existing.sla_days} days` : 'set by priority';
      await pool.query(`
        INSERT INTO notifications (recipient_id, recipient_role, type, title, message, related_id, related_type, tone)
        VALUES ($1, 'employee', 'alert_assigned', $2, $3, $4, 'alert', 'info')
      `, [
        assigned_to,
        'New Alert Assigned',
        `${existing.alert_id} — ${existing.scenario} — ${existing.priority} priority — SLA: ${slaLabel}`,
        existing.alert_id
      ]);
    }

    const sel = await pool.query('SELECT * FROM alerts WHERE alert_id = $1', [existing.alert_id]);
    res.json(sel.rows[0]);
  } catch (err) { next(err); }
});

// Bulk-assign N alerts to one analyst in a single transaction. Audit-logs
// each row separately, but inserts ONE consolidated notification for the
// assignee at the end so the analyst's bell doesn't get spammed when a
// manager hands them 50 alerts at once.
//
// Body: { alert_ids: string[], assigned_to: string, assigned_by?: string }
// Response: { assigned, skipped, failed }
router.patch('/bulk-assign', requireManager, async (req, res, next) => {
  const { alert_ids, assigned_to, assigned_by } = req.body || {};
  if (!Array.isArray(alert_ids) || alert_ids.length === 0) {
    return res.status(400).json({ error: 'alert_ids array required' });
  }
  if (!assigned_to) return res.status(400).json({ error: 'assigned_to required' });

  const today = new Date().toISOString().slice(0, 10);
  const performedBy = (assigned_by && String(assigned_by).trim()) || 'Compliance Manager';
  let assigned = 0;
  let skipped = 0;
  let failed = 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const id of alert_ids) {
      const sel = await client.query('SELECT * FROM alerts WHERE alert_id = $1', [id]);
      const row = sel.rows[0];
      if (!row) { failed++; continue; }
      if (row.assigned_to === assigned_to) { skipped++; continue; }
      const nextStatus = row.alert_status === 'Unassigned' ? 'Not Started' : row.alert_status;
      await client.query(
        'UPDATE alerts SET assigned_to = $1, alert_status = $2, last_activity_date = $3 WHERE alert_id = $4',
        [assigned_to, nextStatus, today, row.alert_id]
      );
      await logAudit({
        entity_type: ENTITY_TYPES.ALERT, entity_id: row.alert_id,
        action: `Alert assigned to ${assigned_to}`,
        performed_by: performedBy,
        details: row.assigned_to ? `Reassigned from ${row.assigned_to} (bulk)` : 'Bulk assignment',
        client
      });
      assigned++;
    }

    // ONE consolidated notification, regardless of count. Manager not notified.
    if (assigned > 0) {
      await client.query(`
        INSERT INTO notifications (recipient_id, recipient_role, type, title, message, related_id, related_type, tone)
        VALUES ($1, 'employee', 'alert_assigned', $2, $3, NULL, 'alert', 'info')
      `, [
        assigned_to,
        `${assigned} new alert${assigned === 1 ? '' : 's'} assigned to you`,
        `${performedBy} assigned ${assigned} alert${assigned === 1 ? '' : 's'} to you. Open My Alerts to begin.`
      ]);
    }

    await client.query('COMMIT');
    res.json({ assigned, skipped, failed });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_e) { /* ignore */ }
    next(err);
  } finally {
    client.release();
  }
});

const CLOSED_ALERT_STATUSES = new Set([
  'Completed', 'Closed', 'Filed', 'False Positive',
  'Closed - L2 Review', 'Closed by L2',
  'Escalated - L2', 'Escalated - SAR'
]);

router.patch('/bulk-close', requireManager, async (req, res, next) => {
  const { alert_ids, disposition, reason, notes, closed_by } = req.body || {};
  if (!Array.isArray(alert_ids) || alert_ids.length === 0) {
    return res.status(400).json({ error: 'alert_ids array required' });
  }
  if (disposition !== 'False Positive') {
    return res.status(400).json({ error: 'disposition must be "False Positive"' });
  }
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ error: 'reason required' });
  }

  const today = new Date().toISOString().slice(0, 10);
  const performedBy = (closed_by && String(closed_by).trim()) || 'Compliance Manager';
  const reasonText = String(reason).trim();
  const noteText = notes ? String(notes).trim() : '';
  const detailsLine = noteText ? `${reasonText} — ${noteText}` : reasonText;

  const client = await pool.connect();
  let closed = 0;
  let skipped = 0;
  let failed = 0;
  try {
    await client.query('BEGIN');
    for (const id of alert_ids) {
      const sel = await client.query('SELECT * FROM alerts WHERE alert_id = $1', [id]);
      const row = sel.rows[0];
      if (!row) { failed++; continue; }
      if (CLOSED_ALERT_STATUSES.has(row.alert_status) || row.closed_date) {
        skipped++;
        continue;
      }
      await client.query(`
        UPDATE alerts
           SET alert_status = $1,
               disposition = $2,
               closed_date = $3,
               last_activity_date = $4
         WHERE alert_id = $5
      `, ['Completed', 'False Positive — Closed', today, today, row.alert_id]);
      await logAudit({
        entity_type: ENTITY_TYPES.ALERT, entity_id: row.alert_id,
        action: `Alert closed as False Positive — Reason: ${reasonText}`,
        performed_by: performedBy,
        details: noteText || null,
        client
      });
      await client.query(`
        INSERT INTO case_notes (alert_id, note_text, analyst, timestamp)
        VALUES ($1, $2, $3, NOW())
      `, [
        row.alert_id,
        `Closed as False Positive (bulk action). Reason: ${reasonText}` +
          (noteText ? `\nNotes: ${noteText}` : ''),
        performedBy
      ]);
      closed++;
    }
    await client.query('COMMIT');
    res.json({ closed, skipped, failed });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_e) { /* ignore */ }
    next(e);
  } finally {
    client.release();
  }
});

module.exports = router;
