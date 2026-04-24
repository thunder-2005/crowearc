const express = require('express');
const { db } = require('../database/db');

const router = express.Router();

router.get('/', (req, res) => {
  const { sar_id, requested_by, from, to, action } = req.query;
  let sql = 'SELECT * FROM retrieval_log WHERE 1=1';
  const params = [];
  if (sar_id) { sql += ' AND sar_id = ?'; params.push(sar_id); }
  if (requested_by) { sql += ' AND requested_by = ?'; params.push(requested_by); }
  if (from) { sql += ' AND requested_at >= ?'; params.push(from); }
  if (to) { sql += ' AND requested_at <= ?'; params.push(to); }
  sql += ' ORDER BY requested_at DESC';
  const rows = db.prepare(sql).all(...params);

  let auditSql = 'SELECT * FROM audit_trail WHERE 1=1';
  const ap = [];
  if (sar_id) { auditSql += ' AND sar_id = ?'; ap.push(sar_id); }
  if (action) { auditSql += ' AND action = ?'; ap.push(action); }
  if (from) { auditSql += ' AND timestamp >= ?'; ap.push(from); }
  if (to) { auditSql += ' AND timestamp <= ?'; ap.push(to); }
  auditSql += ' ORDER BY timestamp DESC LIMIT 500';
  const audit = db.prepare(auditSql).all(...ap);

  res.json({ retrievals: rows, audit });
});

router.post('/', (req, res) => {
  const { sar_id, requested_by, request_purpose } = req.body;
  if (!sar_id || !requested_by) {
    return res.status(400).json({ error: 'sar_id and requested_by required' });
  }
  const info = db.prepare(`
    INSERT INTO retrieval_log (sar_id, requested_by, request_purpose)
    VALUES (?, ?, ?)
  `).run(sar_id, requested_by, request_purpose || null);
  db.prepare(`
    INSERT INTO audit_trail (sar_id, action, performed_by, details)
    VALUES (?, 'Retrieval Requested', ?, ?)
  `).run(sar_id, requested_by, request_purpose || null);
  const row = db.prepare('SELECT * FROM retrieval_log WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(row);
});

module.exports = router;
