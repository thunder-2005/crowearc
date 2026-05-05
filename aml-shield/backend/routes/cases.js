const express = require('express');
const pool = require('../database/db');
const { logAudit, ENTITY_TYPES } = require('../utils/audit');

const router = express.Router();

router.post('/', async (req, res, next) => {
  try {
    const { source_alert_id, customer_id, customer_name, scenario, assigned_to, case_status, case_id } = req.body;
    if (!customer_name) return res.status(400).json({ error: 'customer_name required' });

    let cid = case_id;
    if (!cid) {
      // Use MAX of the trailing number across all CASE-XXXXX rows, then
      // verify uniqueness in a safety loop. The previous version used
      // ORDER BY id DESC which could collide if cases were deleted and
      // recreated, or if two requests raced.
      const r = await pool.query(
        `SELECT MAX(CAST(SUBSTRING(case_id FROM '^CASE-([0-9]+)$') AS INTEGER)) AS max_num
           FROM cases
          WHERE case_id ~ '^CASE-[0-9]+$'`
      );
      let n = (Number(r.rows[0]?.max_num) || 0) + 1;
      for (let attempts = 0; attempts < 10000; attempts++) {
        const candidate = `CASE-${String(n).padStart(5, '0')}`;
        const dup = await pool.query('SELECT 1 FROM cases WHERE case_id = $1 LIMIT 1', [candidate]);
        if (dup.rows.length === 0) { cid = candidate; break; }
        n++;
      }
      if (!cid) throw new Error('Could not generate unique case_id after 10000 attempts');
    }

    const today = new Date().toISOString().slice(0, 10);
    await pool.query(`
      INSERT INTO cases (case_id, source_alert_id, customer_id, customer_name, scenario, case_status, assigned_to, created_date, updated_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [cid, source_alert_id || null, customer_id || null, customer_name,
        scenario || null, case_status || 'Not Started', assigned_to || null, today, today]);

    if (source_alert_id) {
      await pool.query(
        'UPDATE alerts SET case_id = $1, case_converted = 1, last_activity_date = $2 WHERE alert_id = $3',
        [cid, today, source_alert_id]
      );
      // Audit on the source alert so it shows up in the alert's Activity Log
      await logAudit({
        entity_type: ENTITY_TYPES.ALERT, entity_id: source_alert_id,
        action: 'SAR case created',
        performed_by: assigned_to || 'system',
        details: cid
      });
    }

    const sel = await pool.query('SELECT * FROM cases WHERE case_id = $1', [cid]);
    res.status(201).json(sel.rows[0]);
  } catch (err) { next(err); }
});

const CASE_SELECT = `
  SELECT cs.*,
         COALESCE(cs.linked_sar_id, sf.sar_id)         AS linked_sar_id,
         sf.sar_status                                  AS linked_sar_status,
         a.alert_status                                 AS alert_status,
         a.priority                                     AS alert_priority,
         COALESCE(c.customer_risk_rating, a.customer_risk_rating) AS customer_risk_rating,
         c.cdd_level                                    AS customer_cdd_level,
         c.kyc_review_status                            AS kyc_review_status,
         c.exit_status                                  AS customer_exit_status
    FROM cases cs
    LEFT JOIN alerts      a  ON a.alert_id = cs.source_alert_id
    LEFT JOIN sar_filings sf ON sf.case_id = cs.case_id
    LEFT JOIN customers   c  ON c.customer_id = cs.customer_id
`;

router.get('/', async (req, res, next) => {
  try {
    const { case_status, assigned_to, q, include_unassigned_for } = req.query;
    let sql = CASE_SELECT + ' WHERE 1=1';
    const params = [];
    let n = 0;
    if (case_status) { params.push(case_status); sql += ` AND cs.case_status = $${++n}`; }
    if (assigned_to) {
      if (include_unassigned_for === '1') {
        params.push(assigned_to);
        sql += ` AND (cs.assigned_to = $${++n} OR cs.assigned_to IS NULL OR cs.assigned_to = '')`;
      } else {
        params.push(assigned_to);
        sql += ` AND cs.assigned_to = $${++n}`;
      }
    }
    if (q) {
      params.push(`%${q}%`, `%${q}%`);
      sql += ` AND (cs.case_id LIKE $${++n} OR cs.customer_name LIKE $${++n})`;
    }
    sql += ' ORDER BY cs.updated_date DESC';
    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const idParam = req.params.id;
    const idAsInt = /^\d+$/.test(idParam) ? Number(idParam) : -1;
    const result = await pool.query(CASE_SELECT + ' WHERE cs.case_id = $1 OR cs.id = $2', [idParam, idAsInt]);
    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: 'Case not found' });
    const sourceAlert = row.source_alert_id
      ? (await pool.query('SELECT * FROM alerts WHERE alert_id = $1', [row.source_alert_id])).rows[0]
      : null;
    const linkedSar = row.linked_sar_id
      ? (await pool.query('SELECT * FROM sar_filings WHERE sar_id = $1', [row.linked_sar_id])).rows[0]
      : null;
    res.json({ ...row, source_alert: sourceAlert || null, linked_sar: linkedSar || null });
  } catch (err) { next(err); }
});

router.patch('/:id/assign', async (req, res, next) => {
  try {
    const { assigned_to } = req.body;
    if (!assigned_to) return res.status(400).json({ error: 'assigned_to required' });
    const idParam = req.params.id;
    const idAsInt = /^\d+$/.test(idParam) ? Number(idParam) : -1;
    const existingResult = await pool.query(
      'SELECT * FROM cases WHERE case_id = $1 OR id = $2', [idParam, idAsInt]
    );
    const existing = existingResult.rows[0];
    if (!existing) return res.status(404).json({ error: 'Case not found' });
    const nextStatus = existing.case_status === 'Unassigned' ? 'Not Started' : existing.case_status;
    await pool.query(
      'UPDATE cases SET assigned_to = $1, case_status = $2, updated_date = $3 WHERE case_id = $4',
      [assigned_to, nextStatus, new Date().toISOString().slice(0, 10), existing.case_id]
    );
    const sel = await pool.query('SELECT * FROM cases WHERE case_id = $1', [existing.case_id]);
    res.json(sel.rows[0]);
  } catch (err) { next(err); }
});

router.patch('/:id/status', async (req, res, next) => {
  try {
    const { case_status } = req.body;
    if (!case_status) return res.status(400).json({ error: 'case_status required' });
    const idParam = req.params.id;
    const idAsInt = /^\d+$/.test(idParam) ? Number(idParam) : -1;
    const upd = await pool.query(
      'UPDATE cases SET case_status = $1, updated_date = $2 WHERE case_id = $3 OR id = $4',
      [case_status, new Date().toISOString().slice(0, 10), idParam, idAsInt]
    );
    if (upd.rowCount === 0) return res.status(404).json({ error: 'Case not found' });
    const sel = await pool.query('SELECT * FROM cases WHERE case_id = $1 OR id = $2', [idParam, idAsInt]);
    res.json(sel.rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
