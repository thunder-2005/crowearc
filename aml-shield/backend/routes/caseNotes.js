const express = require('express');
const pool = require('../database/db');

const router = express.Router();

router.post('/', async (req, res, next) => {
  try {
    const { alert_id, note_text, analyst } = req.body;
    if (!alert_id || !note_text) {
      return res.status(400).json({ error: 'alert_id and note_text are required' });
    }
    const result = await pool.query(`
      INSERT INTO case_notes (alert_id, note_text, analyst, timestamp)
      VALUES ($1, $2, $3, NOW()) RETURNING *
    `, [alert_id, note_text, analyst || 'system']);
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

router.get('/:alert_id', async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT * FROM case_notes WHERE alert_id = $1 ORDER BY timestamp DESC',
      [req.params.alert_id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

module.exports = router;
