const express = require('express');
const pool = require('../database/db');

const router = express.Router();

const ALERT_MAX = 4;     // alerts shown
const OTHER_MAX = 3;     // customers/cases/sars shown
const PROBE_EXTRA = 1;   // fetch one extra to detect overflow

router.get('/', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const role = req.query.role === 'employee' ? 'employee' : 'manager';
    const analystId = req.query.analyst_id ? String(req.query.analyst_id) : null;
    const restrict = role === 'employee' && !!analystId;

    if (q.length < 2) {
      return res.json({
        alerts: [], customers: [], cases: [], sars: [],
        alerts_more: false, customers_more: false, cases_more: false, sars_more: false
      });
    }

    const like = `%${q}%`;

    // Alerts — match alert_id, customer_name, scenario
    let alertsSql = `
      SELECT a.alert_id, a.customer_name, a.scenario, a.alert_status,
             a.priority, a.sla_deadline, a.due_status, a.assigned_to
        FROM alerts a
       WHERE (a.alert_id LIKE $1 OR a.customer_name LIKE $2 OR a.scenario LIKE $3)
    `;
    const alertParams = [like, like, like];
    let an = 3;
    if (restrict) { alertParams.push(analystId); alertsSql += ` AND a.assigned_to = $${++an}`; }
    alertParams.push(ALERT_MAX + PROBE_EXTRA);
    alertsSql += ` ORDER BY a.created_date DESC LIMIT $${++an}`;
    const alertsRaw = (await pool.query(alertsSql, alertParams)).rows;
    const alerts = alertsRaw.slice(0, ALERT_MAX);
    const alerts_more = alertsRaw.length > ALERT_MAX;

    // Customers — match customer_id, customer_name, account_number
    let custSql = `
      SELECT c.customer_id, c.customer_name, c.customer_risk_rating,
             c.kyc_review_status, c.cdd_level
        FROM customers c
       WHERE (c.customer_id LIKE $1 OR c.customer_name LIKE $2
              OR EXISTS (SELECT 1 FROM accounts ac
                          WHERE ac.customer_id = c.customer_id
                            AND ac.account_number LIKE $3))
    `;
    const custParams = [like, like, like];
    let cn = 3;
    if (restrict) {
      custParams.push(analystId);
      custSql += ` AND EXISTS (
        SELECT 1 FROM alerts ax
         WHERE ax.customer_id = c.customer_id AND ax.assigned_to = $${++cn}
      )`;
    }
    custParams.push(OTHER_MAX + PROBE_EXTRA);
    custSql += ` ORDER BY c.customer_name ASC LIMIT $${++cn}`;
    const customersRaw = (await pool.query(custSql, custParams)).rows;
    const customers = customersRaw.slice(0, OTHER_MAX);
    const customers_more = customersRaw.length > OTHER_MAX;

    // Cases — match case_id, customer_name, source_alert_id
    let caseSql = `
      SELECT cs.case_id, cs.customer_name, cs.source_alert_id,
             cs.case_status, cs.assigned_to
        FROM cases cs
       WHERE (cs.case_id LIKE $1 OR cs.customer_name LIKE $2 OR cs.source_alert_id LIKE $3)
    `;
    const caseParams = [like, like, like];
    let kn = 3;
    if (restrict) { caseParams.push(analystId); caseSql += ` AND cs.assigned_to = $${++kn}`; }
    caseParams.push(OTHER_MAX + PROBE_EXTRA);
    caseSql += ` ORDER BY cs.updated_date DESC LIMIT $${++kn}`;
    const casesRaw = (await pool.query(caseSql, caseParams)).rows;
    const cases = casesRaw.slice(0, OTHER_MAX);
    const cases_more = casesRaw.length > OTHER_MAX;

    // SAR filings — match sar_id, customer_name, case_id
    let sarSql = `
      SELECT sf.sar_id, sf.customer_name, sf.case_id, sf.sar_status,
             sf.filed_date, sf.draft_created_date, sf.prepared_by, sf.reviewed_by
        FROM sar_filings sf
       WHERE (sf.sar_id LIKE $1 OR sf.customer_name LIKE $2 OR sf.case_id LIKE $3)
    `;
    const sarParams = [like, like, like];
    let sn = 3;
    if (restrict) {
      sarParams.push(analystId, analystId);
      sarSql += ` AND (sf.prepared_by = $${++sn} OR sf.reviewed_by = $${++sn})`;
    }
    sarParams.push(OTHER_MAX + PROBE_EXTRA);
    sarSql += ` ORDER BY COALESCE(sf.filed_date, sf.draft_created_date) DESC LIMIT $${++sn}`;
    const sarsRaw = (await pool.query(sarSql, sarParams)).rows;
    const sars = sarsRaw.slice(0, OTHER_MAX);
    const sars_more = sarsRaw.length > OTHER_MAX;

    res.json({
      alerts, customers, cases, sars,
      alerts_more, customers_more, cases_more, sars_more
    });
  } catch (err) { next(err); }
});

module.exports = router;
