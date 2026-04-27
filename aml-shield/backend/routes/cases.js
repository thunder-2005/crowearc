const express = require('express');
const { db } = require('../database/db');

const router = express.Router();

router.post('/', (req, res) => {
  const { source_alert_id, customer_id, customer_name, scenario, assigned_to, case_status, case_id } = req.body;
  if (!customer_name) return res.status(400).json({ error: 'customer_name required' });

  let cid = case_id;
  if (!cid) {
    const last = db.prepare(`
      SELECT case_id FROM cases
       WHERE case_id LIKE 'CASE-%'
       ORDER BY id DESC LIMIT 1
    `).get();
    let n = 1;
    if (last) {
      const m = String(last.case_id).match(/(\d+)$/);
      if (m) n = parseInt(m[1], 10) + 1;
    }
    cid = `CASE-${String(n).padStart(5, '0')}`;
  }

  const today = new Date().toISOString().slice(0, 10);
  db.prepare(`
    INSERT INTO cases (case_id, source_alert_id, customer_id, customer_name, scenario, case_status, assigned_to, created_date, updated_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(cid, source_alert_id || null, customer_id || null, customer_name,
         scenario || null, case_status || 'Not Started', assigned_to || null, today, today);

  if (source_alert_id) {
    db.prepare('UPDATE alerts SET case_id = ?, case_converted = 1, last_activity_date = ? WHERE alert_id = ?')
      .run(cid, today, source_alert_id);
  }

  const row = db.prepare('SELECT * FROM cases WHERE case_id = ?').get(cid);
  res.status(201).json(row);
});

router.get('/', (req, res) => {
  const { case_status, assigned_to, q, include_unassigned_for } = req.query;
  let sql = 'SELECT * FROM cases WHERE 1=1';
  const params = [];
  if (case_status) { sql += ' AND case_status = ?'; params.push(case_status); }
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
    sql += ' AND (case_id LIKE ? OR customer_name LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY updated_date DESC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM cases WHERE case_id = ? OR id = ?')
    .get(req.params.id, req.params.id);
  if (!row) return res.status(404).json({ error: 'Case not found' });
  const sourceAlert = row.source_alert_id
    ? db.prepare('SELECT * FROM alerts WHERE alert_id = ?').get(row.source_alert_id)
    : null;
  const linkedSar = row.linked_sar_id
    ? db.prepare('SELECT * FROM sar_filings WHERE sar_id = ?').get(row.linked_sar_id)
    : null;
  res.json({ ...row, source_alert: sourceAlert, linked_sar: linkedSar });
});

router.patch('/:id/assign', (req, res) => {
  const { assigned_to } = req.body;
  if (!assigned_to) return res.status(400).json({ error: 'assigned_to required' });
  const existing = db.prepare('SELECT * FROM cases WHERE case_id = ? OR id = ?')
    .get(req.params.id, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Case not found' });
  const nextStatus = existing.case_status === 'Unassigned' ? 'Not Started' : existing.case_status;
  db.prepare(
    'UPDATE cases SET assigned_to = ?, case_status = ?, updated_date = ? WHERE case_id = ?'
  ).run(assigned_to, nextStatus, new Date().toISOString().slice(0, 10), existing.case_id);
  res.json(db.prepare('SELECT * FROM cases WHERE case_id = ?').get(existing.case_id));
});

router.patch('/:id/status', (req, res) => {
  const { case_status } = req.body;
  if (!case_status) return res.status(400).json({ error: 'case_status required' });
  const info = db.prepare(
    'UPDATE cases SET case_status = ?, updated_date = ? WHERE case_id = ? OR id = ?'
  ).run(case_status, new Date().toISOString().slice(0, 10), req.params.id, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Case not found' });
  const row = db.prepare('SELECT * FROM cases WHERE case_id = ? OR id = ?')
    .get(req.params.id, req.params.id);
  res.json(row);
});

module.exports = router;
