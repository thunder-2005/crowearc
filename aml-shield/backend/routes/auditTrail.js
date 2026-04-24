const express = require('express');
const { db } = require('../database/db');

const router = express.Router();

router.get('/:sar_id', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM audit_trail WHERE sar_id = ? ORDER BY timestamp DESC'
  ).all(req.params.sar_id);
  res.json(rows);
});

router.post('/', (req, res) => {
  const { sar_id, action, performed_by, details } = req.body;
  if (!sar_id || !action) return res.status(400).json({ error: 'sar_id and action required' });
  const info = db.prepare(`
    INSERT INTO audit_trail (sar_id, action, performed_by, details)
    VALUES (?, ?, ?, ?)
  `).run(sar_id, action, performed_by || 'system', details || null);
  const row = db.prepare('SELECT * FROM audit_trail WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(row);
});

module.exports = router;
