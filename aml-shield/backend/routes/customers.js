const express = require('express');
const pool = require('../database/db');

const router = express.Router();

function parseJsonField(row, fields) {
  for (const f of fields) {
    if (row[f]) {
      try { row[f] = JSON.parse(row[f]); } catch (_e) { /* keep raw */ }
    } else {
      row[f] = null;
    }
  }
  return row;
}

router.get('/', async (req, res, next) => {
  try {
    const { q, customer_risk_rating, cdd_level, kyc_review_status, pep_match, sanctions_match } = req.query;
    let sql = `
      SELECT c.*, (
        SELECT COUNT(*) FROM alerts a
         WHERE a.customer_id = c.customer_id
           AND a.alert_status <> 'Completed'
      ) AS open_alerts
      FROM customers c WHERE 1=1
    `;
    const params = [];
    let n = 0;
    if (q) {
      params.push(`%${q}%`, `%${q}%`);
      sql += ` AND (c.customer_id LIKE $${++n} OR c.customer_name LIKE $${++n})`;
    }
    if (customer_risk_rating) { params.push(customer_risk_rating); sql += ` AND c.customer_risk_rating = $${++n}`; }
    if (cdd_level)            { params.push(cdd_level);            sql += ` AND c.cdd_level = $${++n}`; }
    if (kyc_review_status)    { params.push(kyc_review_status);    sql += ` AND c.kyc_review_status = $${++n}`; }
    if (pep_match !== undefined && pep_match !== '') {
      params.push(Number(pep_match)); sql += ` AND c.pep_match = $${++n}`;
    }
    if (sanctions_match !== undefined && sanctions_match !== '') {
      params.push(Number(sanctions_match)); sql += ` AND c.sanctions_match = $${++n}`;
    }
    sql += ' ORDER BY c.customer_name ASC';
    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const idParam = req.params.id;
    const idAsInt = /^\d+$/.test(idParam) ? Number(idParam) : -1;
    const result = await pool.query(
      'SELECT * FROM customers WHERE customer_id = $1 OR id = $2',
      [idParam, idAsInt]
    );
    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: 'Customer not found' });
    const accounts = (await pool.query(
      'SELECT * FROM accounts WHERE customer_id = $1 ORDER BY opened_date ASC',
      [row.customer_id]
    )).rows;
    parseJsonField(row, ['beneficial_owners', 'directors', 'expected_transaction_types', 'primary_countries']);
    res.json({ ...row, accounts });
  } catch (err) { next(err); }
});

router.get('/:id/transactions', async (req, res, next) => {
  try {
    const { from, to, txn_type, min_amount, max_amount, alerted_only } = req.query;
    let sql = 'SELECT * FROM transactions WHERE customer_id = $1';
    const params = [req.params.id];
    let n = 1;
    if (from)       { params.push(from);              sql += ` AND txn_date >= $${++n}`; }
    if (to)         { params.push(to);                sql += ` AND txn_date <= $${++n}`; }
    if (txn_type)   { params.push(txn_type);          sql += ` AND txn_type = $${++n}`; }
    if (min_amount) { params.push(Number(min_amount));sql += ` AND amount >= $${++n}`; }
    if (max_amount) { params.push(Number(max_amount));sql += ` AND amount <= $${++n}`; }
    if (alerted_only === '1') { sql += ' AND is_alerted = 1'; }
    sql += ' ORDER BY txn_date DESC, txn_time DESC';
    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.get('/:id/alerts', async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT * FROM alerts WHERE customer_id = $1 ORDER BY created_date DESC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.get('/:id/sars', async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT * FROM sar_filings WHERE customer_id = $1 ORDER BY detection_date DESC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

module.exports = router;
