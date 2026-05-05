const express = require('express');
const pool = require('../database/db');

const router = express.Router();

// Generic listing endpoints, scoped by entity_type. Each returns newest-first.
//
//   GET /api/audit-trail/sar/:id     — SAR audit log
//   GET /api/audit-trail/alert/:id   — alert/case lifecycle log
//   GET /api/audit-trail/kyc/:id     — KYC review activity log
//
// Plus the legacy GET /:sar_id which keeps working for SAR-only consumers
// (returns rows where sar_id matches AND entity_type IS NULL OR 'sar').

router.get('/sar/:id', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT * FROM audit_trail
        WHERE sar_id = $1
          AND (entity_type = 'sar' OR entity_type IS NULL)
        ORDER BY timestamp DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.get('/alert/:id', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT * FROM audit_trail
        WHERE sar_id = $1 AND entity_type IN ('alert', 'case')
        ORDER BY timestamp DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.get('/kyc/:id', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT * FROM audit_trail
        WHERE sar_id = $1 AND entity_type = 'kyc_review'
        ORDER BY timestamp DESC`,
      [String(req.params.id)]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// Legacy endpoint — preserves existing SAR Audit Trail tab behaviour.
router.get('/:sar_id', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT * FROM audit_trail
        WHERE sar_id = $1
          AND (entity_type = 'sar' OR entity_type IS NULL)
        ORDER BY timestamp DESC`,
      [req.params.sar_id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { sar_id, action, performed_by, details, entity_type } = req.body;
    if (!sar_id || !action) return res.status(400).json({ error: 'sar_id and action required' });
    const result = await pool.query(`
      INSERT INTO audit_trail (entity_type, sar_id, action, performed_by, details)
      VALUES ($1, $2, $3, $4, $5) RETURNING *
    `, [entity_type || 'sar', sar_id, action, performed_by || 'system', details || null]);
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
