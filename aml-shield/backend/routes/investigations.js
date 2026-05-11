const express = require('express');
const pool = require('../database/db');
const { logAudit } = require('../utils/audit');

const router = express.Router();

const CLOSED_STATUSES_SQL = "('Completed', 'Closed', 'Filed', 'Closed — False Positive')";

function requireManager(req, res, next) {
  const role = req.headers['x-user-role'];
  if (role !== 'compliance_manager') {
    return res.status(403).json({ error: 'Manager role required' });
  }
  next();
}

router.use(requireManager);

router.get('/counterparty-links', async (_req, res, next) => {
  try {
    const sql = `
      SELECT
        c1.customer_id  AS customer_a_id,
        c1.customer_name AS customer_a_name,
        c1.customer_risk_rating AS customer_a_risk,
        c2.customer_id  AS customer_b_id,
        c2.customer_name AS customer_b_name,
        c2.customer_risk_rating AS customer_b_risk,
        t1.counterparty AS shared_counterparty,
        t1.counterparty_country AS counterparty_country,
        COUNT(DISTINCT t1.transaction_id) + COUNT(DISTINCT t2.transaction_id) AS total_shared_txns,
        COALESCE(SUM(t1.amount), 0) + COALESCE(SUM(t2.amount), 0) AS total_shared_amount,
        (SELECT COUNT(*) FROM alerts a
           WHERE a.customer_id = c1.customer_id
             AND a.alert_status NOT IN ${CLOSED_STATUSES_SQL}) AS customer_a_open_alerts,
        (SELECT COUNT(*) FROM alerts a
           WHERE a.customer_id = c2.customer_id
             AND a.alert_status NOT IN ${CLOSED_STATUSES_SQL}) AS customer_b_open_alerts,
        (SELECT COUNT(*) FROM sar_filings sf
           JOIN cases cs ON sf.case_id = cs.case_id
           WHERE cs.customer_id = c1.customer_id) AS customer_a_sars,
        (SELECT COUNT(*) FROM sar_filings sf
           JOIN cases cs ON sf.case_id = cs.case_id
           WHERE cs.customer_id = c2.customer_id) AS customer_b_sars
      FROM transactions t1
      JOIN transactions t2
        ON LOWER(TRIM(t1.counterparty)) = LOWER(TRIM(t2.counterparty))
       AND t1.customer_id < t2.customer_id
      JOIN customers c1 ON t1.customer_id = c1.customer_id
      JOIN customers c2 ON t2.customer_id = c2.customer_id
      WHERE t1.counterparty IS NOT NULL AND TRIM(t1.counterparty) != ''
        AND t2.counterparty IS NOT NULL AND TRIM(t2.counterparty) != ''
      GROUP BY c1.customer_id, c1.customer_name, c1.customer_risk_rating,
               c2.customer_id, c2.customer_name, c2.customer_risk_rating,
               t1.counterparty, t1.counterparty_country
      ORDER BY
        CASE
          WHEN c1.customer_risk_rating = 'Very High' OR c2.customer_risk_rating = 'Very High' THEN 0
          WHEN c1.customer_risk_rating = 'High'      OR c2.customer_risk_rating = 'High'      THEN 1
          WHEN c1.customer_risk_rating = 'Medium'    OR c2.customer_risk_rating = 'Medium'    THEN 2
          ELSE 3
        END ASC,
        total_shared_txns DESC
      LIMIT 500
    `;
    const result = await pool.query(sql);
    res.json({ links: result.rows });
  } catch (err) {
    next(err);
  }
});

router.get('/beneficial-owner-links', async (_req, res, next) => {
  try {
    const checkSql = `
      SELECT COUNT(*) AS cnt
      FROM customers
      WHERE beneficial_owners IS NOT NULL
        AND TRIM(beneficial_owners) != ''
        AND TRIM(beneficial_owners) != 'null'
        AND TRIM(beneficial_owners) != '[]'
    `;
    const check = await pool.query(checkSql);
    if (Number(check.rows[0].cnt) === 0) {
      return res.json({ links: [], message: 'No beneficial owner data available' });
    }

    const linkSql = `
      WITH owner_expand AS (
        SELECT
          c.customer_id,
          c.customer_name,
          c.customer_risk_rating,
          LOWER(TRIM(o->>'name')) AS owner_key,
          o->>'name' AS owner_name,
          NULLIF(o->>'pct', '')::numeric AS ownership_pct
        FROM customers c,
             LATERAL jsonb_array_elements(c.beneficial_owners::jsonb) AS o
        WHERE c.beneficial_owners IS NOT NULL
          AND TRIM(c.beneficial_owners) != ''
          AND TRIM(c.beneficial_owners) != 'null'
          AND TRIM(c.beneficial_owners) != '[]'
      )
      SELECT
        oe1.customer_id  AS customer_a_id,
        oe1.customer_name AS customer_a_name,
        oe1.customer_risk_rating AS customer_a_risk,
        oe1.ownership_pct AS customer_a_pct,
        oe2.customer_id  AS customer_b_id,
        oe2.customer_name AS customer_b_name,
        oe2.customer_risk_rating AS customer_b_risk,
        oe2.ownership_pct AS customer_b_pct,
        oe1.owner_name   AS shared_owner,
        (SELECT COUNT(*) FROM alerts a
           WHERE a.customer_id = oe1.customer_id
             AND a.alert_status NOT IN ${CLOSED_STATUSES_SQL}) AS customer_a_open_alerts,
        (SELECT COUNT(*) FROM alerts a
           WHERE a.customer_id = oe2.customer_id
             AND a.alert_status NOT IN ${CLOSED_STATUSES_SQL}) AS customer_b_open_alerts
      FROM owner_expand oe1
      JOIN owner_expand oe2
        ON oe1.owner_key = oe2.owner_key
       AND oe1.customer_id < oe2.customer_id
      WHERE oe1.owner_key IS NOT NULL AND oe1.owner_key != ''
      ORDER BY
        CASE
          WHEN oe1.customer_risk_rating = 'Very High' OR oe2.customer_risk_rating = 'Very High' THEN 0
          WHEN oe1.customer_risk_rating = 'High'      OR oe2.customer_risk_rating = 'High'      THEN 1
          WHEN oe1.customer_risk_rating = 'Medium'    OR oe2.customer_risk_rating = 'Medium'    THEN 2
          ELSE 3
        END ASC
      LIMIT 500
    `;
    try {
      const result = await pool.query(linkSql);
      return res.json({ links: result.rows });
    } catch (err) {
      console.warn('[investigations] beneficial-owner-links parse failed:', err.message);
      return res.json({ links: [], message: 'No beneficial owner data available' });
    }
  } catch (err) {
    next(err);
  }
});

router.get('/link-detail', async (req, res, next) => {
  try {
    const { customer_a_id, customer_b_id } = req.query;
    if (!customer_a_id || !customer_b_id) {
      return res.status(400).json({ error: 'customer_a_id and customer_b_id required' });
    }

    const custRes = await pool.query(
      `SELECT customer_id, customer_name, customer_type, segment, customer_risk_rating,
              pep_match, sanctions_match, kyc_review_status, country_of_residence,
              customer_since_date, cdd_level, business_type, industry,
              email_address, phone_number, beneficial_owners
       FROM customers
       WHERE customer_id IN ($1, $2)`,
      [customer_a_id, customer_b_id]
    );
    const customer_a = custRes.rows.find(c => c.customer_id === customer_a_id) || null;
    const customer_b = custRes.rows.find(c => c.customer_id === customer_b_id) || null;

    const sharedCpRes = await pool.query(
      `WITH shared AS (
         SELECT DISTINCT LOWER(TRIM(t1.counterparty)) AS cp_key,
                t1.counterparty AS counterparty,
                t1.counterparty_country AS counterparty_country
         FROM transactions t1
         JOIN transactions t2
           ON LOWER(TRIM(t1.counterparty)) = LOWER(TRIM(t2.counterparty))
         WHERE t1.customer_id = $1 AND t2.customer_id = $2
           AND t1.counterparty IS NOT NULL AND TRIM(t1.counterparty) != ''
       )
       SELECT
         s.counterparty AS name,
         s.counterparty_country AS country,
         (SELECT json_agg(json_build_object(
             'transaction_id', tx.transaction_id,
             'txn_date',       tx.txn_date,
             'amount',         tx.amount,
             'channel',        tx.channel,
             'txn_type',       tx.txn_type
           ) ORDER BY tx.txn_date DESC)
            FROM transactions tx
           WHERE tx.customer_id = $1
             AND LOWER(TRIM(tx.counterparty)) = s.cp_key) AS customer_a_transactions,
         (SELECT json_agg(json_build_object(
             'transaction_id', tx.transaction_id,
             'txn_date',       tx.txn_date,
             'amount',         tx.amount,
             'channel',        tx.channel,
             'txn_type',       tx.txn_type
           ) ORDER BY tx.txn_date DESC)
            FROM transactions tx
           WHERE tx.customer_id = $2
             AND LOWER(TRIM(tx.counterparty)) = s.cp_key) AS customer_b_transactions
       FROM shared s
       ORDER BY s.counterparty ASC`,
      [customer_a_id, customer_b_id]
    );

    let shared_beneficial_owners = [];
    try {
      const boRes = await pool.query(
        `WITH owners AS (
           SELECT c.customer_id,
                  LOWER(TRIM(o->>'name')) AS owner_key,
                  o->>'name' AS owner_name,
                  NULLIF(o->>'pct', '')::numeric AS pct
           FROM customers c,
                LATERAL jsonb_array_elements(c.beneficial_owners::jsonb) AS o
           WHERE c.customer_id IN ($1, $2)
             AND c.beneficial_owners IS NOT NULL
             AND TRIM(c.beneficial_owners) != ''
             AND TRIM(c.beneficial_owners) != 'null'
             AND TRIM(c.beneficial_owners) != '[]'
         )
         SELECT a.owner_name AS name, a.pct AS customer_a_pct, b.pct AS customer_b_pct
         FROM owners a
         JOIN owners b ON a.owner_key = b.owner_key
         WHERE a.customer_id = $1 AND b.customer_id = $2`,
        [customer_a_id, customer_b_id]
      );
      shared_beneficial_owners = boRes.rows;
    } catch (err) {
      console.warn('[investigations] shared owners parse failed:', err.message);
    }

    const alertsRes = await pool.query(
      `SELECT alert_id, customer_id, customer_name, scenario, priority,
              alert_status, sla_deadline, created_date, age_days
       FROM alerts
       WHERE customer_id IN ($1, $2)
         AND alert_status NOT IN ${CLOSED_STATUSES_SQL}
       ORDER BY created_date DESC`,
      [customer_a_id, customer_b_id]
    );
    const customer_a_alerts = alertsRes.rows.filter(a => a.customer_id === customer_a_id);
    const customer_b_alerts = alertsRes.rows.filter(a => a.customer_id === customer_b_id);

    const sarsRes = await pool.query(
      `SELECT sf.sar_id, sf.customer_id, sf.customer_name, sf.sar_status,
              sf.filed_date, sf.amount_involved_inr, sf.alert_scenario
       FROM sar_filings sf
       LEFT JOIN cases cs ON sf.case_id = cs.case_id
       WHERE sf.customer_id IN ($1, $2)
          OR cs.customer_id IN ($1, $2)
       ORDER BY sf.filed_date DESC NULLS LAST`,
      [customer_a_id, customer_b_id]
    );
    const customer_a_sars = sarsRes.rows.filter(s => s.customer_id === customer_a_id);
    const customer_b_sars = sarsRes.rows.filter(s => s.customer_id === customer_b_id);

    res.json({
      customer_a,
      customer_b,
      shared_counterparties: sharedCpRes.rows,
      shared_beneficial_owners,
      customer_a_alerts,
      customer_b_alerts,
      customer_a_sars,
      customer_b_sars
    });
  } catch (err) {
    next(err);
  }
});

router.get('/summary', async (_req, res, next) => {
  try {
    const cpPairsRes = await pool.query(
      `WITH pairs AS (
         SELECT DISTINCT t1.customer_id AS a, t2.customer_id AS b
         FROM transactions t1
         JOIN transactions t2
           ON LOWER(TRIM(t1.counterparty)) = LOWER(TRIM(t2.counterparty))
          AND t1.customer_id < t2.customer_id
         WHERE t1.counterparty IS NOT NULL AND TRIM(t1.counterparty) != ''
       ),
       enriched AS (
         SELECT p.a, p.b, c1.customer_risk_rating AS a_risk, c2.customer_risk_rating AS b_risk
         FROM pairs p
         JOIN customers c1 ON p.a = c1.customer_id
         JOIN customers c2 ON p.b = c2.customer_id
       )
       SELECT
         (SELECT COUNT(*) FROM enriched) AS total_pairs,
         (SELECT COUNT(*) FROM enriched
           WHERE a_risk IN ('High', 'Very High')
              OR b_risk IN ('High', 'Very High')) AS high_risk_pairs,
         (SELECT COUNT(DISTINCT cid) FROM (
            SELECT a AS cid FROM enriched
            UNION
            SELECT b AS cid FROM enriched
          ) u) AS customers_in_network`
    );

    const cpRes = await pool.query(
      `SELECT counterparty AS name,
              counterparty_country AS country,
              COUNT(DISTINCT customer_id) AS linked_customers
       FROM transactions
       WHERE counterparty IS NOT NULL AND TRIM(counterparty) != ''
       GROUP BY counterparty, counterparty_country
       HAVING COUNT(DISTINCT customer_id) > 1
       ORDER BY linked_customers DESC
       LIMIT 1`
    );

    const sharedCpCountRes = await pool.query(
      `SELECT COUNT(*) AS cnt
       FROM (
         SELECT counterparty
         FROM transactions
         WHERE counterparty IS NOT NULL AND TRIM(counterparty) != ''
         GROUP BY counterparty
         HAVING COUNT(DISTINCT customer_id) > 1
       ) sub`
    );

    let total_beneficial_owner_links = 0;
    try {
      const boRes = await pool.query(
        `WITH owner_expand AS (
           SELECT c.customer_id,
                  LOWER(TRIM(o->>'name')) AS owner_key
           FROM customers c,
                LATERAL jsonb_array_elements(c.beneficial_owners::jsonb) AS o
           WHERE c.beneficial_owners IS NOT NULL
             AND TRIM(c.beneficial_owners) != ''
             AND TRIM(c.beneficial_owners) != 'null'
             AND TRIM(c.beneficial_owners) != '[]'
         )
         SELECT COUNT(*) AS cnt
         FROM owner_expand oe1
         JOIN owner_expand oe2
           ON oe1.owner_key = oe2.owner_key
          AND oe1.customer_id < oe2.customer_id
         WHERE oe1.owner_key IS NOT NULL AND oe1.owner_key != ''`
      );
      total_beneficial_owner_links = Number(boRes.rows[0]?.cnt || 0);
    } catch (_err) {
      total_beneficial_owner_links = 0;
    }

    const row = cpPairsRes.rows[0] || {};
    res.json({
      total_counterparty_links: Number(row.total_pairs || 0),
      total_beneficial_owner_links,
      high_risk_links: Number(row.high_risk_pairs || 0),
      customers_in_network: Number(row.customers_in_network || 0),
      shared_counterparties: Number(sharedCpCountRes.rows[0]?.cnt || 0),
      highest_risk_counterparty: cpRes.rows[0]
        ? {
            name: cpRes.rows[0].name,
            country: cpRes.rows[0].country,
            linked_customers: Number(cpRes.rows[0].linked_customers)
          }
        : null
    });
  } catch (err) {
    next(err);
  }
});

router.post('/note', async (req, res, next) => {
  try {
    const { customer_a_id, customer_b_id, customer_a_name, customer_b_name, shared_via, note } = req.body || {};
    if (!customer_a_id || !customer_b_id || !note || !String(note).trim()) {
      return res.status(400).json({ error: 'customer_a_id, customer_b_id and note required' });
    }
    const performed_by = req.headers['x-user-name'] || 'Compliance Manager';
    const entity_id = `${customer_a_id}<>${customer_b_id}`;
    const details = `Manager noted connection between ${customer_a_name || customer_a_id} and ${customer_b_name || customer_b_id}` +
      (shared_via ? ` via ${shared_via}` : '') + `: ${String(note).trim()}`;
    await logAudit({
      entity_type: 'investigation',
      entity_id,
      action: 'Connection note added',
      performed_by,
      details
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
