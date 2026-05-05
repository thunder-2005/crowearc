const express = require('express');
const pool = require('../database/db');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const { sar_id, requested_by, from, to, action } = req.query;
    let sql = 'SELECT * FROM retrieval_log WHERE 1=1';
    const params = [];
    let n = 0;
    if (sar_id)       { params.push(sar_id);       sql += ` AND sar_id = $${++n}`; }
    if (requested_by) { params.push(requested_by); sql += ` AND requested_by = $${++n}`; }
    if (from)         { params.push(from);         sql += ` AND requested_at >= $${++n}`; }
    if (to)           { params.push(to);           sql += ` AND requested_at <= $${++n}`; }
    sql += ' ORDER BY requested_at DESC';
    const rows = (await pool.query(sql, params)).rows;

    let auditSql = 'SELECT * FROM audit_trail WHERE 1=1';
    const ap = [];
    let m = 0;
    if (sar_id) { ap.push(sar_id); auditSql += ` AND sar_id = $${++m}`; }
    if (action) { ap.push(action); auditSql += ` AND action = $${++m}`; }
    if (from)   { ap.push(from);   auditSql += ` AND timestamp >= $${++m}`; }
    if (to)     { ap.push(to);     auditSql += ` AND timestamp <= $${++m}`; }
    auditSql += ' ORDER BY timestamp DESC LIMIT 500';
    const audit = (await pool.query(auditSql, ap)).rows;

    res.json({ retrievals: rows, audit });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { sar_id, requested_by, request_purpose } = req.body;
    if (!sar_id || !requested_by) {
      return res.status(400).json({ error: 'sar_id and requested_by required' });
    }
    const ins = await pool.query(`
      INSERT INTO retrieval_log (sar_id, requested_by, request_purpose)
      VALUES ($1, $2, $3) RETURNING *
    `, [sar_id, requested_by, request_purpose || null]);
    await pool.query(`
      INSERT INTO audit_trail (entity_type, sar_id, action, performed_by, details)
      VALUES ('sar', $1, 'Retrieval Requested', $2, $3)
    `, [sar_id, requested_by, request_purpose || null]);
    res.status(201).json(ins.rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
