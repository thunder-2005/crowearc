const express = require('express');
const pool = require('../database/db');

const router = express.Router();

router.get('/:sar_id', async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT * FROM audit_trail WHERE sar_id = $1 ORDER BY timestamp DESC',
      [req.params.sar_id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { sar_id, action, performed_by, details } = req.body;
    if (!sar_id || !action) return res.status(400).json({ error: 'sar_id and action required' });
    const result = await pool.query(`
      INSERT INTO audit_trail (sar_id, action, performed_by, details)
      VALUES ($1, $2, $3, $4) RETURNING *
    `, [sar_id, action, performed_by || 'system', details || null]);
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
