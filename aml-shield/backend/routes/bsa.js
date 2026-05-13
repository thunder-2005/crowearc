const express = require('express');
const pool = require('../database/db');

const router = express.Router();

// Manager / BSA Officer only. Mirrors the requireManager pattern used in
// other routes — keeps the guard inline since this is a small module.
function requireBsaOrManager(req, res, next) {
  const role = req.headers['x-user-role'];
  if (role !== 'bsa_officer' && role !== 'compliance_manager') {
    return res.status(403).json({ error: 'BSA Officer or Manager role required' });
  }
  next();
}

router.use(requireBsaOrManager);

// GET /api/bsa/program-metrics
// Four headline numbers for the BSA dashboard SAR Program Metrics row:
//   - sars_filed_ytd      : COUNT(Filed SARs with filed_date this calendar year)
//   - avg_filing_days     : avg days from alert.created_date → sar_filings.filed_date for Filed SARs
//   - sars_in_flight      : SARs not yet 'Filed' and not 'Draft' (the BSA-visible pipeline)
//   - retention_expiring_90d : Filed SARs whose retention_expiry_date falls inside today + 90 days
router.get('/program-metrics', async (_req, res, next) => {
  try {
    const ytd = await pool.query(`
      SELECT COUNT(*)::int AS c
        FROM sar_filings
       WHERE sar_status = 'Filed'
         AND filed_date IS NOT NULL
         AND filed_date::date >= DATE_TRUNC('year', NOW())::date
    `);

    const avg = await pool.query(`
      SELECT AVG(sf.filed_date::date - a.created_date::date)::float AS avg_days
        FROM sar_filings sf
        JOIN cases c  ON sf.case_id = c.case_id
        JOIN alerts a ON c.source_alert_id = a.alert_id
       WHERE sf.sar_status = 'Filed'
         AND sf.filed_date IS NOT NULL
         AND a.created_date IS NOT NULL
    `);

    const inFlight = await pool.query(`
      SELECT COUNT(*)::int AS c
        FROM sar_filings
       WHERE sar_status NOT IN ('Filed', 'Draft')
    `);

    const expiring = await pool.query(`
      SELECT COUNT(*)::int AS c
        FROM sar_filings
       WHERE sar_status = 'Filed'
         AND retention_expiry_date IS NOT NULL
         AND retention_expiry_date::date <= (NOW() + INTERVAL '90 days')::date
         AND retention_expiry_date::date >= NOW()::date
    `);

    res.json({
      sars_filed_ytd:        Number(ytd.rows[0].c) || 0,
      avg_filing_days:       avg.rows[0].avg_days != null
                              ? Math.round(Number(avg.rows[0].avg_days) * 10) / 10
                              : null,
      sars_in_flight:        Number(inFlight.rows[0].c) || 0,
      retention_expiring_90d: Number(expiring.rows[0].c) || 0
    });
  } catch (err) { next(err); }
});

// GET /api/bsa/reopen-requests
// Live count of reopen requests awaiting BSA Officer authorization
// (status = 'pending_bsa'). Drives the BSA dashboard action queue card.
router.get('/reopen-requests', async (_req, res, next) => {
  try {
    const r = await pool.query(`
      SELECT request_id, alert_id, customer_name, requested_by, requested_at,
             reason_code, manager_reviewed_by, manager_reviewed_at,
             (NOW()::date - manager_reviewed_at::date) AS days_waiting
        FROM alert_reopen_requests
       WHERE status = 'pending_bsa'
       ORDER BY manager_reviewed_at ASC NULLS LAST
    `);
    res.json({
      count: r.rows.length,
      oldest_days: r.rows.length ? Number(r.rows[0].days_waiting) : null,
      requests: r.rows
    });
  } catch (err) { next(err); }
});

// GET /api/bsa/awaiting-signoff
// SARs that the manager has approved (sar_status = 'Filed') but the BSA
// Officer has NOT yet co-signed. Drives the BSA Final Sign-off queue.
router.get('/awaiting-signoff', async (_req, res, next) => {
  try {
    const r = await pool.query(`
      SELECT sf.sar_id, sf.case_id, sf.customer_id, sf.customer_name,
             sf.sar_status, sf.filed_date, sf.approved_at, sf.approved_by,
             sf.bsa_officer_id, sf.bsa_approved_at, sf.regulator_reference,
             sf.alert_scenario, sf.amount_involved_inr,
             (NOW()::date - sf.filed_date::date) AS days_since_filed
        FROM sar_filings sf
       WHERE sf.sar_status = 'Filed'
         AND sf.bsa_approved_at IS NULL
       ORDER BY sf.filed_date ASC NULLS LAST
    `);
    res.json({
      count: r.rows.length,
      oldest_days: r.rows.length ? Number(r.rows[0].days_since_filed) : null,
      items: r.rows
    });
  } catch (err) { next(err); }
});

module.exports = router;
