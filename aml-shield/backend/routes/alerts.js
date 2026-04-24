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

router.get('/', (req, res) => {
  const { alert_status, priority, scenario, assigned_to, q, include_unassigned_for } = req.query;
  let sql = 'SELECT * FROM alerts WHERE 1=1';
  const params = [];
  if (alert_status) { sql += ' AND alert_status = ?'; params.push(alert_status); }
  if (priority)     { sql += ' AND priority = ?';     params.push(priority); }
  if (scenario)     { sql += ' AND scenario = ?';     params.push(scenario); }
  if (assigned_to) {
    if (include_unassigned_for === '1') {
      sql += " AND (assigned_to = ? OR assigned_to IS NULL OR assigned_to = '')";
      params.push(assigned_to);
    } else {
      sql += ' AND assigned_to = ?';
      params.push(assigned_to);
    }
  }
  if (q) {
    sql += ' AND (alert_id LIKE ? OR customer_name LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY created_date DESC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM alerts WHERE alert_id = ? OR id = ?')
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

module.exports = router;
