const express = require('express');
const { db } = require('../database/db');

const router = express.Router();

router.post('/', (req, res) => {
  const { alert_id, note_text, analyst } = req.body;
  if (!alert_id || !note_text) {
    return res.status(400).json({ error: 'alert_id and note_text are required' });
  }
  const info = db.prepare(`
    INSERT INTO case_notes (alert_id, note_text, analyst, timestamp)
    VALUES (?, ?, ?, datetime('now'))
  `).run(alert_id, note_text, analyst || 'system');
  const row = db.prepare('SELECT * FROM case_notes WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(row);
});

router.get('/:alert_id', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM case_notes WHERE alert_id = ? ORDER BY timestamp DESC'
  ).all(req.params.alert_id);
  res.json(rows);
});

module.exports = router;
