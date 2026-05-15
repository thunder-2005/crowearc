const express = require('express');
const pool = require('../database/db');
const { requireBsaOrManager } = require('../middleware/roleGuard');

const router = express.Router();

// Manager / BSA Officer only — gate applied to every route on this router.
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

    // Measures the internal approval pipeline duration:
    //   SAR submission (draft sent to manager) → final filing.
    // NOT alert creation → filing (that anchor reflects pre-investigation
    // backlog, not the BSA officer's program performance, and inflates the
    // number by months on legacy datasets). Falls back through
    // activity_date_from → created_at when submitted_at is missing.
    // All date columns on sar_filings are TEXT — coerce with NULLIF + ::date.
    const avg = await pool.query(`
      SELECT AVG(
        NULLIF(sf.filed_date, '')::date
        - COALESCE(
            NULLIF(LEFT(sf.submitted_at, 10), '')::date,
            NULLIF(sf.activity_date_from, '')::date,
            NULLIF(LEFT(sf.created_at, 10), '')::date
          )
      )::float AS avg_days
        FROM sar_filings sf
       WHERE sf.sar_status = 'Filed'
         AND NULLIF(sf.filed_date, '') IS NOT NULL
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

// ─────────────────────────────────────────────── Regulatory Correspondence
//
// Unified log for inbound/outbound communications with regulators —
// 314(a) requests, legal holds, examinations, MRAs, subpoenas, general.
// Replaces the two "Coming soon" placeholders (Legal Holds + 314(a))
// in the BSA action queue with a single, real surface.

const REG_TYPES = new Set(['314a_request', 'legal_hold', 'examination', 'mra', 'subpoena', 'general']);
const REG_DIRECTIONS = new Set(['inbound', 'outbound']);
const REG_STATUSES = new Set(['open', 'in_progress', 'responded', 'closed']);
const REG_PRIORITIES = new Set(['urgent', 'high', 'normal', 'low']);

// GET /api/bsa/regulatory-correspondence — full log, sorted urgent-first.
router.get('/regulatory-correspondence', async (req, res, next) => {
  try {
    const { status, type, priority, direction } = req.query;
    let sql = 'SELECT * FROM regulatory_correspondence WHERE 1=1';
    const params = [];
    let n = 0;
    if (status)    { params.push(status);    sql += ` AND status = $${++n}`; }
    if (type)      { params.push(type);      sql += ` AND type = $${++n}`; }
    if (priority)  { params.push(priority);  sql += ` AND priority = $${++n}`; }
    if (direction) { params.push(direction); sql += ` AND direction = $${++n}`; }
    sql += ` ORDER BY
        CASE priority
          WHEN 'urgent' THEN 1
          WHEN 'high'   THEN 2
          WHEN 'normal' THEN 3
          WHEN 'low'    THEN 4
          ELSE 5
        END,
        received_or_sent_date DESC`;
    const r = await pool.query(sql, params);
    res.json(r.rows);
  } catch (err) { next(err); }
});

// GET /api/bsa/regulatory-correspondence/summary — counts for the BSA action queue card.
router.get('/regulatory-correspondence/summary', async (_req, res, next) => {
  try {
    const r = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('open','in_progress'))::int                                              AS total_open,
        COUNT(*) FILTER (WHERE status IN ('open','in_progress') AND priority = 'urgent')::int                      AS urgent_count,
        COUNT(*) FILTER (WHERE status IN ('open','in_progress') AND response_due_date IS NOT NULL
                          AND response_due_date < CURRENT_DATE)::int                                                AS overdue_count,
        COUNT(*) FILTER (WHERE status = 'closed' AND closed_at IS NOT NULL
                          AND EXTRACT(YEAR FROM closed_at) = EXTRACT(YEAR FROM NOW()))::int                          AS closed_this_year
        FROM regulatory_correspondence
    `);

    // Next-due record (earliest response_due_date among open/in_progress).
    const nx = await pool.query(`
      SELECT subject, response_due_date
        FROM regulatory_correspondence
       WHERE status IN ('open','in_progress')
         AND response_due_date IS NOT NULL
       ORDER BY response_due_date ASC
       LIMIT 1
    `);

    res.json({
      total_open:        r.rows[0].total_open || 0,
      urgent_count:      r.rows[0].urgent_count || 0,
      overdue_count:     r.rows[0].overdue_count || 0,
      closed_this_year:  r.rows[0].closed_this_year || 0,
      next_due:          nx.rows[0] || null
    });
  } catch (err) { next(err); }
});

// GET /api/bsa/regulatory-correspondence/:id — single record detail.
router.get('/regulatory-correspondence/:id', async (req, res, next) => {
  try {
    const r = await pool.query(
      'SELECT * FROM regulatory_correspondence WHERE correspondence_id = $1 OR id::text = $1',
      [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Correspondence not found' });
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

// POST /api/bsa/regulatory-correspondence — create new record.
// Generates correspondence_id as RC-YYYY-NNN after INSERT (uses returned id).
router.post('/regulatory-correspondence', async (req, res, next) => {
  try {
    const {
      type, direction, agency, subject, reference_number,
      received_or_sent_date, response_due_date, priority,
      notes, linked_sar_id, linked_alert_id, handled_by, created_by
    } = req.body || {};

    if (!type || !REG_TYPES.has(type))           return res.status(400).json({ error: `type must be one of: ${[...REG_TYPES].join(', ')}` });
    if (!direction || !REG_DIRECTIONS.has(direction)) return res.status(400).json({ error: 'direction must be inbound or outbound' });
    if (!agency || !String(agency).trim())       return res.status(400).json({ error: 'agency required' });
    if (!subject || !String(subject).trim())     return res.status(400).json({ error: 'subject required' });
    if (!received_or_sent_date)                  return res.status(400).json({ error: 'received_or_sent_date required' });
    if (priority && !REG_PRIORITIES.has(priority)) return res.status(400).json({ error: `priority must be one of: ${[...REG_PRIORITIES].join(', ')}` });

    // Insert with a placeholder correspondence_id, then overwrite with the
    // formatted RC-YYYY-NNN string once we know the auto-incremented id.
    const ins = await pool.query(`
      INSERT INTO regulatory_correspondence (
        correspondence_id, type, direction, agency, subject, reference_number,
        received_or_sent_date, response_due_date, status, priority,
        notes, linked_sar_id, linked_alert_id, handled_by, created_by, created_at, updated_at
      ) VALUES ('PENDING', $1, $2, $3, $4, $5, $6, $7, 'open', $8, $9, $10, $11, $12, $13, NOW(), NOW())
      RETURNING *
    `, [
      type, direction, agency, subject, reference_number || null,
      received_or_sent_date, response_due_date || null,
      priority || 'normal',
      notes || null, linked_sar_id || null, linked_alert_id || null,
      handled_by || null, created_by || req.headers['x-user-name'] || 'BSA Officer'
    ]);
    const row = ins.rows[0];
    const year = new Date().getFullYear();
    const formattedId = `RC-${year}-${String(row.id).padStart(3, '0')}`;
    await pool.query(
      'UPDATE regulatory_correspondence SET correspondence_id = $1 WHERE id = $2',
      [formattedId, row.id]
    );
    const final = (await pool.query('SELECT * FROM regulatory_correspondence WHERE id = $1', [row.id])).rows[0];
    res.status(201).json(final);
  } catch (err) { next(err); }
});

// PATCH /api/bsa/regulatory-correspondence/:id — update status, notes, handled_by, response_due_date, priority.
router.patch('/regulatory-correspondence/:id', async (req, res, next) => {
  try {
    const existing = (await pool.query(
      'SELECT * FROM regulatory_correspondence WHERE correspondence_id = $1 OR id::text = $1',
      [req.params.id]
    )).rows[0];
    if (!existing) return res.status(404).json({ error: 'Correspondence not found' });

    const { status, notes, handled_by, response_due_date, priority } = req.body || {};
    if (status && !REG_STATUSES.has(status))       return res.status(400).json({ error: `status must be one of: ${[...REG_STATUSES].join(', ')}` });
    if (priority && !REG_PRIORITIES.has(priority)) return res.status(400).json({ error: `priority must be one of: ${[...REG_PRIORITIES].join(', ')}` });

    const sets = [];
    const params = [];
    let n = 0;
    if (status !== undefined)             { params.push(status);             sets.push(`status = $${++n}`); }
    if (notes !== undefined)              { params.push(notes);              sets.push(`notes = $${++n}`); }
    if (handled_by !== undefined)         { params.push(handled_by);         sets.push(`handled_by = $${++n}`); }
    if (response_due_date !== undefined)  { params.push(response_due_date);  sets.push(`response_due_date = $${++n}`); }
    if (priority !== undefined)           { params.push(priority);           sets.push(`priority = $${++n}`); }

    // closed_at stamp transition — set when moving INTO 'closed', clear when moving back out.
    if (status === 'closed' && existing.status !== 'closed') {
      sets.push('closed_at = NOW()');
    } else if (status && status !== 'closed' && existing.status === 'closed') {
      sets.push('closed_at = NULL');
    }
    sets.push('updated_at = NOW()');
    if (sets.length === 1) return res.json(existing); // only updated_at — nothing real changed

    params.push(existing.id);
    await pool.query(`UPDATE regulatory_correspondence SET ${sets.join(', ')} WHERE id = $${++n}`, params);
    const row = (await pool.query('SELECT * FROM regulatory_correspondence WHERE id = $1', [existing.id])).rows[0];
    res.json(row);
  } catch (err) { next(err); }
});

module.exports = router;
