const express = require('express');
const { db } = require('../database/db');

const router = express.Router();

router.get('/analysts', (_req, res) => {
  const rows = db.prepare(`
    SELECT assigned_to AS analyst, COUNT(*) AS total
      FROM alerts
     WHERE assigned_to IS NOT NULL AND TRIM(assigned_to) <> ''
     GROUP BY assigned_to
     ORDER BY assigned_to ASC
  `).all();
  res.json(rows);
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

router.get('/', (req, res) => {
  const { alert_status, priority, scenario, assigned_to, q, include_unassigned_for } = req.query;
  let sql = ALERT_SELECT + ' WHERE 1=1';
  const params = [];
  if (alert_status) { sql += ' AND a.alert_status = ?'; params.push(alert_status); }
  if (priority)     { sql += ' AND a.priority = ?';     params.push(priority); }
  if (scenario)     { sql += ' AND a.scenario = ?';     params.push(scenario); }
  if (assigned_to) {
    if (include_unassigned_for === '1') {
      sql += " AND (a.assigned_to = ? OR a.assigned_to IS NULL OR a.assigned_to = '')";
      params.push(assigned_to);
    } else {
      sql += ' AND a.assigned_to = ?';
      params.push(assigned_to);
    }
  }
  if (q) {
    sql += ' AND (a.alert_id LIKE ? OR a.customer_name LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY a.created_date DESC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', (req, res) => {
  const row = db.prepare(ALERT_SELECT + ' WHERE a.alert_id = ? OR a.id = ?')
    .get(req.params.id, req.params.id);
  if (!row) return res.status(404).json({ error: 'Alert not found' });
  res.json(row);
});

router.get('/:id/transactions', (req, res) => {
  const alert = db.prepare('SELECT alert_id, customer_id FROM alerts WHERE alert_id = ? OR id = ?')
    .get(req.params.id, req.params.id);
  if (!alert) return res.status(404).json({ error: 'Alert not found' });
  const { from, to, txn_type, min_amount, max_amount, alerted_only } = req.query;
  let sql = `
    SELECT *, (is_alerted = 1 AND alert_id = ?) AS is_this_alert
      FROM transactions
     WHERE customer_id = ?
  `;
  const params = [alert.alert_id, alert.customer_id];
  if (alerted_only === '1') {
    sql += ' AND is_alerted = 1';
  } else {
    if (from) { sql += ' AND (txn_date >= ? OR is_alerted = 1)'; params.push(from); }
    if (to)   { sql += ' AND (txn_date <= ? OR is_alerted = 1)'; params.push(to); }
    if (txn_type)   { sql += ' AND (txn_type = ? OR is_alerted = 1)';   params.push(txn_type); }
    if (min_amount) { sql += ' AND (amount >= ? OR is_alerted = 1)';    params.push(Number(min_amount)); }
    if (max_amount) { sql += ' AND (amount <= ? OR is_alerted = 1)';    params.push(Number(max_amount)); }
  }
  sql += ' ORDER BY txn_date DESC, txn_time DESC';
  const rows = db.prepare(sql).all(...params);
  const alertedTotal = rows.filter(r => r.is_alerted).reduce((s, r) => s + r.amount, 0);
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
});

router.patch('/:id/disposition', (req, res) => {
  const { disposition, performed_by } = req.body;
  if (!disposition) return res.status(400).json({ error: 'disposition required' });
  const info = db.prepare(
    'UPDATE alerts SET disposition = ?, last_activity_date = ? WHERE alert_id = ? OR id = ?'
  ).run(disposition, new Date().toISOString().slice(0, 10), req.params.id, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Alert not found' });
  const alert = db.prepare('SELECT alert_id FROM alerts WHERE alert_id = ? OR id = ?')
    .get(req.params.id, req.params.id);
  db.prepare(`
    INSERT INTO case_notes (alert_id, note_text, analyst, timestamp)
    VALUES (?, ?, ?, datetime('now'))
  `).run(alert.alert_id, `Disposition set to "${disposition}"`, performed_by || 'system');
  res.json(db.prepare('SELECT * FROM alerts WHERE alert_id = ?').get(alert.alert_id));
});

router.patch('/:id/status', (req, res) => {
  const { alert_status, assigned_to } = req.body;
  if (!alert_status) return res.status(400).json({ error: 'alert_status required' });
  const info = db.prepare(
    'UPDATE alerts SET alert_status = ?, assigned_to = COALESCE(?, assigned_to), last_activity_date = ? WHERE alert_id = ? OR id = ?'
  ).run(alert_status, assigned_to || null, new Date().toISOString().slice(0, 10),
        req.params.id, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Alert not found' });
  const row = db.prepare('SELECT * FROM alerts WHERE alert_id = ? OR id = ?')
    .get(req.params.id, req.params.id);
  res.json(row);
});

router.patch('/:id/assign', (req, res) => {
  const { assigned_to } = req.body;
  if (!assigned_to) return res.status(400).json({ error: 'assigned_to required' });
  const existing = db.prepare('SELECT * FROM alerts WHERE alert_id = ? OR id = ?')
    .get(req.params.id, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Alert not found' });
  const nextStatus = existing.alert_status === 'Unassigned' ? 'Not Started' : existing.alert_status;
  db.prepare(
    'UPDATE alerts SET assigned_to = ?, alert_status = ?, last_activity_date = ? WHERE alert_id = ?'
  ).run(assigned_to, nextStatus, new Date().toISOString().slice(0, 10), existing.alert_id);
  res.json(db.prepare('SELECT * FROM alerts WHERE alert_id = ?').get(existing.alert_id));
});

const CLOSED_ALERT_STATUSES = new Set([
  'Completed', 'Closed', 'Filed', 'False Positive',
  'Closed - L2 Review', 'Closed by L2',
  'Escalated - L2', 'Escalated - SAR'
]);

router.patch('/bulk-close', (req, res) => {
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

  const selectStmt = db.prepare('SELECT * FROM alerts WHERE alert_id = ?');
  const updateStmt = db.prepare(`
    UPDATE alerts
       SET alert_status = ?,
           disposition = ?,
           closed_date = ?,
           last_activity_date = ?
     WHERE alert_id = ?
  `);
  const insertAuditStmt = db.prepare(`
    INSERT INTO audit_trail (sar_id, action, performed_by, timestamp, details)
    VALUES (?, ?, ?, datetime('now'), ?)
  `);
  const insertNoteStmt = db.prepare(`
    INSERT INTO case_notes (alert_id, note_text, analyst, timestamp)
    VALUES (?, ?, ?, datetime('now'))
  `);

  let closed = 0;
  let skipped = 0;
  let failed = 0;

  db.exec('BEGIN');
  try {
    for (const id of alert_ids) {
      const row = selectStmt.get(id);
      if (!row) { failed++; continue; }
      if (CLOSED_ALERT_STATUSES.has(row.alert_status) || row.closed_date) {
        skipped++;
        continue;
      }
      updateStmt.run(
        'Completed',
        'False Positive — Closed',
        today,
        today,
        row.alert_id
      );
      insertAuditStmt.run(
        row.alert_id,
        'Bulk closed as False Positive',
        performedBy,
        detailsLine
      );
      insertNoteStmt.run(
        row.alert_id,
        `Closed as False Positive (bulk action). Reason: ${reasonText}` +
          (noteText ? `\nNotes: ${noteText}` : ''),
        performedBy
      );
      closed++;
    }
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_e) { /* ignore */ }
    return res.status(500).json({ error: e.message || 'bulk-close failed' });
  }

  res.json({ closed, skipped, failed });
});

module.exports = router;
