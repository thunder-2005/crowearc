const express = require('express');
const { db } = require('../database/db');

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

router.get('/', (req, res) => {
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
  if (q) {
    sql += ` AND (c.customer_id LIKE ? OR c.customer_name LIKE ?)`;
    params.push(`%${q}%`, `%${q}%`);
  }
  if (customer_risk_rating) { sql += ' AND c.customer_risk_rating = ?'; params.push(customer_risk_rating); }
  if (cdd_level)            { sql += ' AND c.cdd_level = ?';            params.push(cdd_level); }
  if (kyc_review_status)    { sql += ' AND c.kyc_review_status = ?';    params.push(kyc_review_status); }
  if (pep_match !== undefined && pep_match !== '') {
    sql += ' AND c.pep_match = ?'; params.push(Number(pep_match));
  }
  if (sanctions_match !== undefined && sanctions_match !== '') {
    sql += ' AND c.sanctions_match = ?'; params.push(Number(sanctions_match));
  }
  sql += ' ORDER BY c.customer_name ASC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM customers WHERE customer_id = ? OR id = ?')
    .get(req.params.id, req.params.id);
  if (!row) return res.status(404).json({ error: 'Customer not found' });
  const accounts = db.prepare('SELECT * FROM accounts WHERE customer_id = ? ORDER BY opened_date ASC')
    .all(row.customer_id);
  parseJsonField(row, ['beneficial_owners', 'directors', 'expected_transaction_types', 'primary_countries']);
  res.json({ ...row, accounts });
});

router.get('/:id/transactions', (req, res) => {
  const { from, to, txn_type, min_amount, max_amount, alerted_only } = req.query;
  let sql = 'SELECT * FROM transactions WHERE customer_id = ?';
  const params = [req.params.id];
  if (from) { sql += ' AND txn_date >= ?'; params.push(from); }
  if (to)   { sql += ' AND txn_date <= ?'; params.push(to); }
  if (txn_type) { sql += ' AND txn_type = ?'; params.push(txn_type); }
  if (min_amount) { sql += ' AND amount >= ?'; params.push(Number(min_amount)); }
  if (max_amount) { sql += ' AND amount <= ?'; params.push(Number(max_amount)); }
  if (alerted_only === '1') { sql += ' AND is_alerted = 1'; }
  sql += ' ORDER BY txn_date DESC, txn_time DESC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id/alerts', (req, res) => {
  res.json(db.prepare('SELECT * FROM alerts WHERE customer_id = ? ORDER BY created_date DESC')
    .all(req.params.id));
});

router.get('/:id/sars', (req, res) => {
  res.json(db.prepare('SELECT * FROM sar_filings WHERE customer_id = ? ORDER BY detection_date DESC')
    .all(req.params.id));
});

module.exports = router;
