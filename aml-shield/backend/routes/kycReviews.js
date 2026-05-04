const express = require('express');
const path = require('path');
const fs = require('fs');
const pool = require('../database/db');
const { upload } = require('../middleware/upload');
const { intervalDaysForRating } = require('../jobs/kycReviewMonitor');

const router = express.Router();

const CHECKLIST_KEYS = [
  'id.govId', 'id.address', 'id.dob', 'id.tin',
  'sof.consistent', 'sof.income', 'sof.unexplained',
  'screen.sanctions', 'screen.pep', 'screen.media',
  'tx.patterns', 'tx.spikes', 'tx.geography',
  'acc.active', 'acc.dormant'
];

function deserialize(row) {
  if (!row) return row;
  if (row.checklist) {
    try { row.checklist = JSON.parse(row.checklist); } catch (_e) { /* keep raw */ }
  }
  return row;
}

async function notify({ recipient_id, recipient_role, type, title, message, related_id, tone = 'info' }) {
  await pool.query(`
    INSERT INTO notifications (recipient_id, recipient_role, type, title, message, related_id, related_type, tone)
    VALUES ($1, $2, $3, $4, $5, $6, 'kyc_review', $7)
  `, [recipient_id || null, recipient_role, type, title, message, related_id, tone]);
}

function ymd(d) { return d.toISOString().slice(0, 10); }
function nowStamp() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }

router.get('/stats', async (_req, res, next) => {
  try {
    const today = ymd(new Date());
    const thirty = ymd(new Date(Date.now() + 30 * 86400000));
    const num = (q, p = []) => pool.query(q, p).then(r => Number(r.rows[0].c));
    const stats = {
      total:         await num("SELECT COUNT(*) AS c FROM kyc_reviews WHERE status NOT IN ('completed','rejected')"),
      overdue:       await num("SELECT COUNT(*) AS c FROM kyc_reviews WHERE status = 'overdue' OR (due_date < $1 AND status NOT IN ('completed','rejected'))", [today]),
      due_this_month:await num("SELECT COUNT(*) AS c FROM kyc_reviews WHERE due_date BETWEEN $1 AND $2 AND status NOT IN ('completed','rejected')", [today, thirty]),
      in_progress:   await num("SELECT COUNT(*) AS c FROM kyc_reviews WHERE status IN ('assigned','in_progress')"),
      completed_this_month: await num("SELECT COUNT(*) AS c FROM kyc_reviews WHERE status = 'completed' AND substr(completed_at, 1, 7) = to_char(CURRENT_DATE, 'YYYY-MM')"),
      triggered:     await num("SELECT COUNT(*) AS c FROM kyc_reviews WHERE review_type IN ('triggered_sar','triggered_alerts') AND status NOT IN ('completed','rejected')"),
      pending_approval: await num("SELECT COUNT(*) AS c FROM kyc_reviews WHERE status = 'pending_approval'")
    };
    res.json(stats);
  } catch (err) { next(err); }
});

router.get('/', async (req, res, next) => {
  try {
    const { status, assigned_to, customer_id, type, q } = req.query;
    let sql = `
      SELECT r.*,
             c.customer_name,
             c.customer_risk_rating,
             c.cdd_level,
             c.last_kyc_review_date
        FROM kyc_reviews r
        LEFT JOIN customers c ON c.customer_id = r.customer_id
       WHERE 1=1
    `;
    const params = [];
    let n = 0;
    if (status === 'overdue') {
      sql += " AND (r.status = 'overdue' OR (r.due_date < CURRENT_DATE::text AND r.status NOT IN ('completed','rejected')))";
    } else if (status === 'due_soon') {
      sql += " AND r.due_date BETWEEN CURRENT_DATE::text AND (CURRENT_DATE + INTERVAL '30 days')::date::text AND r.status NOT IN ('completed','rejected')";
    } else if (status === 'in_progress') {
      sql += " AND r.status IN ('assigned', 'in_progress', 'pending_approval', 'returned')";
    } else if (status === 'completed') {
      sql += " AND r.status = 'completed'";
    } else if (status) {
      params.push(status);
      sql += ` AND r.status = $${++n}`;
    }
    if (assigned_to)  { params.push(assigned_to); sql += ` AND r.assigned_to = $${++n}`; }
    if (customer_id)  { params.push(customer_id); sql += ` AND r.customer_id = $${++n}`; }
    if (type)         { params.push(type);        sql += ` AND r.review_type = $${++n}`; }
    if (q) {
      params.push(`%${q}%`, `%${q}%`);
      sql += ` AND (c.customer_name LIKE $${++n} OR r.customer_id LIKE $${++n})`;
    }
    sql += ' ORDER BY r.due_date::date ASC';
    const result = await pool.query(sql, params);
    res.json(result.rows.map(deserialize));
  } catch (err) { next(err); }
});

router.get('/customer/:customer_id/history', async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT * FROM kyc_reviews WHERE customer_id = $1 ORDER BY id DESC
    `, [req.params.customer_id]);
    res.json(result.rows.map(deserialize));
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT r.*, c.customer_name, c.customer_risk_rating, c.cdd_level,
             c.customer_type, c.segment, c.last_kyc_review_date, c.next_kyc_due_date,
             c.kyc_review_status, c.exit_status
        FROM kyc_reviews r
        LEFT JOIN customers c ON c.customer_id = r.customer_id
       WHERE r.id = $1
    `, [req.params.id]);
    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: 'Review not found' });

    const customer = row.customer_id
      ? (await pool.query('SELECT * FROM customers WHERE customer_id = $1', [row.customer_id])).rows[0] || null
      : null;
    if (customer) {
      for (const f of ['beneficial_owners', 'directors', 'expected_transaction_types', 'primary_countries']) {
        if (customer[f]) { try { customer[f] = JSON.parse(customer[f]); } catch (_e) { /* keep */ } }
      }
    }
    const accounts = customer
      ? (await pool.query('SELECT * FROM accounts WHERE customer_id = $1', [customer.customer_id])).rows
      : [];
    const alerts = customer
      ? (await pool.query(`
          SELECT alert_id, scenario, alert_status, priority, created_date, disposition, amount_flagged_inr
            FROM alerts WHERE customer_id = $1 ORDER BY created_date::date DESC LIMIT 20
        `, [customer.customer_id])).rows
      : [];
    const sars = customer
      ? (await pool.query(`
          SELECT sar_id, alert_scenario, sar_status, filed_date, draft_created_date, prepared_by, amount_involved_inr
            FROM sar_filings WHERE customer_id = $1 ORDER BY COALESCE(filed_date, draft_created_date)::date DESC LIMIT 20
        `, [customer.customer_id])).rows
      : [];
    const documents = (await pool.query(
      'SELECT * FROM kyc_review_documents WHERE review_id = $1 ORDER BY uploaded_at DESC',
      [row.id]
    )).rows;
    const previousReviews = customer
      ? (await pool.query(`
          SELECT id, review_type, status, due_date, completed_at, previous_risk_rating, new_risk_rating, recommendation, assigned_to, approved_by
            FROM kyc_reviews WHERE customer_id = $1 AND id <> $2 ORDER BY id DESC LIMIT 10
        `, [customer.customer_id, row.id])).rows
      : [];

    let triggeredBySar = null;
    if (row.triggered_by_sar_id) {
      triggeredBySar = (await pool.query(`
        SELECT sar_id, sar_status, filed_date, prepared_by, customer_name, alert_scenario
          FROM sar_filings WHERE sar_id = $1
      `, [row.triggered_by_sar_id])).rows[0] || null;
    }
    let triggeredByAlert = null;
    if (row.triggered_by_alert_id) {
      triggeredByAlert = (await pool.query(`
        SELECT alert_id, scenario, alert_status, priority, created_date
          FROM alerts WHERE alert_id = $1
      `, [row.triggered_by_alert_id])).rows[0] || null;
    }

    res.json({
      ...deserialize(row),
      customer: customer ? { ...customer, accounts } : null,
      alerts, sars, documents, previous_reviews: previousReviews,
      triggered_by_sar: triggeredBySar,
      triggered_by_alert: triggeredByAlert
    });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { customer_id, review_type, due_date, priority, assigned_to, assigned_by, assigned_note } = req.body;
    if (!customer_id) return res.status(400).json({ error: 'customer_id required' });
    const customer = (await pool.query(
      'SELECT * FROM customers WHERE customer_id = $1', [customer_id]
    )).rows[0];
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const due = due_date || ymd(new Date());
    const status = assigned_to ? 'assigned' : 'pending';
    const ins = await pool.query(`
      INSERT INTO kyc_reviews
        (customer_id, review_type, status, priority, due_date, assigned_to, assigned_by, assigned_at, assigned_note,
         previous_risk_rating, previous_cdd_level)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *
    `, [
      customer_id, review_type || 'manual', status, priority || 'Normal', due,
      assigned_to || null, assigned_by || null, assigned_to ? nowStamp() : null, assigned_note || null,
      customer.customer_risk_rating, customer.cdd_level
    ]);
    const row = ins.rows[0];
    if (assigned_to) {
      await notify({
        recipient_id: assigned_to, recipient_role: 'employee', type: 'kyc_review_assigned',
        title: `KYC review assigned — ${customer.customer_name}`,
        message: `Due ${due}. ${assigned_note || ''}`.trim(),
        related_id: String(row.id), tone: 'info'
      });
    }
    res.status(201).json(row);
  } catch (err) { next(err); }
});

router.patch('/:id/assign', async (req, res, next) => {
  try {
    const { assigned_to, assigned_by, assigned_note, due_date, priority } = req.body;
    if (!assigned_to) return res.status(400).json({ error: 'assigned_to required' });
    const existing = (await pool.query(`
      SELECT r.*, c.customer_name FROM kyc_reviews r LEFT JOIN customers c ON c.customer_id = r.customer_id WHERE r.id = $1
    `, [req.params.id])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Review not found' });

    await pool.query(`
      UPDATE kyc_reviews
         SET assigned_to = $1, assigned_by = $2, assigned_at = $3, assigned_note = $4,
             due_date = COALESCE($5, due_date), priority = COALESCE($6, priority),
             status = CASE WHEN status IN ('pending', 'overdue') THEN 'assigned' ELSE status END,
             updated_at = $7
       WHERE id = $8
    `, [assigned_to, assigned_by || null, nowStamp(), assigned_note || null,
        due_date || null, priority || null, nowStamp(), req.params.id]);

    await notify({
      recipient_id: assigned_to, recipient_role: 'employee', type: 'kyc_review_assigned',
      title: `KYC review assigned — ${existing.customer_name}`,
      message: `Due ${due_date || existing.due_date}. ${assigned_note || ''}`.trim(),
      related_id: String(req.params.id), tone: 'info'
    });
    const sel = await pool.query('SELECT * FROM kyc_reviews WHERE id = $1', [req.params.id]);
    res.json(sel.rows[0]);
  } catch (err) { next(err); }
});

router.patch('/:id/start', async (req, res, next) => {
  try {
    const existing = (await pool.query('SELECT * FROM kyc_reviews WHERE id = $1', [req.params.id])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Review not found' });
    if (existing.status === 'in_progress') return res.json(existing);
    await pool.query(`
      UPDATE kyc_reviews SET status = 'in_progress', started_at = COALESCE(started_at, $1), updated_at = $2 WHERE id = $3
    `, [nowStamp(), nowStamp(), req.params.id]);
    const sel = await pool.query('SELECT * FROM kyc_reviews WHERE id = $1', [req.params.id]);
    res.json(sel.rows[0]);
  } catch (err) { next(err); }
});

router.patch('/:id/save', async (req, res, next) => {
  try {
    const existing = (await pool.query('SELECT * FROM kyc_reviews WHERE id = $1', [req.params.id])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Review not found' });
    const { checklist, review_findings, new_risk_rating, new_cdd_level, recommendation } = req.body;
    await pool.query(`
      UPDATE kyc_reviews
         SET checklist = COALESCE($1, checklist),
             review_findings = COALESCE($2, review_findings),
             new_risk_rating = COALESCE($3, new_risk_rating),
             new_cdd_level   = COALESCE($4, new_cdd_level),
             recommendation  = COALESCE($5, recommendation),
             updated_at = $6
       WHERE id = $7
    `, [checklist ? JSON.stringify(checklist) : null,
        review_findings ?? null, new_risk_rating ?? null, new_cdd_level ?? null,
        recommendation ?? null, nowStamp(), req.params.id]);
    const sel = await pool.query('SELECT * FROM kyc_reviews WHERE id = $1', [req.params.id]);
    res.json(deserialize(sel.rows[0]));
  } catch (err) { next(err); }
});

router.patch('/:id/complete', async (req, res, next) => {
  try {
    const existing = (await pool.query(`
      SELECT r.*, c.customer_name FROM kyc_reviews r LEFT JOIN customers c ON c.customer_id = r.customer_id WHERE r.id = $1
    `, [req.params.id])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Review not found' });

    const { checklist, review_findings, new_risk_rating, new_cdd_level, recommendation, completed_by } = req.body;
    if (!review_findings || review_findings.length < 100) return res.status(400).json({ error: 'review_findings >= 100 chars required' });
    if (!recommendation) return res.status(400).json({ error: 'recommendation required' });
    if (!checklist) return res.status(400).json({ error: 'checklist required' });
    for (const k of CHECKLIST_KEYS) {
      if (!checklist[k]) return res.status(400).json({ error: `Checklist incomplete: ${k}` });
    }
    const docCount = Number((await pool.query(
      'SELECT COUNT(*) AS c FROM kyc_review_documents WHERE review_id = $1', [req.params.id]
    )).rows[0].c);
    if (docCount === 0) return res.status(400).json({ error: 'At least one supporting document required' });

    await pool.query(`
      UPDATE kyc_reviews
         SET status = 'pending_approval',
             checklist = $1, review_findings = $2, recommendation = $3,
             new_risk_rating = $4, new_cdd_level = $5,
             completed_at = $6, returned_to_analyst = 0, updated_at = $7
       WHERE id = $8
    `, [JSON.stringify(checklist), review_findings, recommendation,
        new_risk_rating || existing.previous_risk_rating,
        new_cdd_level   || existing.previous_cdd_level,
        nowStamp(), nowStamp(), req.params.id]);

    const ratingChanged = (new_risk_rating && new_risk_rating !== existing.previous_risk_rating);
    await notify({
      recipient_id: null, recipient_role: 'manager', type: 'kyc_review_submitted',
      title: `KYC review submitted — ${existing.customer_name}${ratingChanged ? ' (rating change)' : ''}`,
      message: `${completed_by || existing.assigned_to} submitted a ${recommendation} recommendation. Awaiting your approval.`,
      related_id: String(req.params.id), tone: ratingChanged ? 'warning' : 'info'
    });

    const sel = await pool.query('SELECT * FROM kyc_reviews WHERE id = $1', [req.params.id]);
    res.json(deserialize(sel.rows[0]));
  } catch (err) { next(err); }
});

router.patch('/:id/approve', async (req, res, next) => {
  try {
    const existing = (await pool.query(`
      SELECT r.*, c.customer_name FROM kyc_reviews r LEFT JOIN customers c ON c.customer_id = r.customer_id WHERE r.id = $1
    `, [req.params.id])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Review not found' });
    const approvedBy = req.body.approved_by || 'Compliance Manager';

    const cust = (await pool.query(
      'SELECT * FROM customers WHERE customer_id = $1', [existing.customer_id]
    )).rows[0];
    const newRating = existing.new_risk_rating || cust?.customer_risk_rating;
    const newCdd    = existing.new_cdd_level   || cust?.cdd_level;
    const interval  = intervalDaysForRating(newRating);
    const today     = ymd(new Date());
    const nextDue   = ymd(new Date(Date.now() + interval * 86400000));

    let exitStatus = cust?.exit_status || null;
    if (existing.recommendation === 'exit_customer') exitStatus = 'Pending Exit';

    if (cust) {
      await pool.query(`
        UPDATE customers
           SET customer_risk_rating = $1, cdd_level = $2, last_kyc_review_date = $3,
               next_kyc_due_date = $4, kyc_review_status = 'Current',
               last_review_id = $5, exit_status = $6
         WHERE customer_id = $7
      `, [newRating, newCdd, today, nextDue, existing.id, exitStatus, existing.customer_id]);
    }

    await pool.query(`
      UPDATE kyc_reviews
         SET status = 'completed', approved_by = $1, approved_at = $2, updated_at = $3
       WHERE id = $4
    `, [approvedBy, nowStamp(), nowStamp(), existing.id]);

    if (existing.recommendation === 'escalate_sar') {
      const last = (await pool.query(
        "SELECT case_id FROM cases WHERE case_id LIKE 'CASE-%' ORDER BY id DESC LIMIT 1"
      )).rows[0];
      let n = 1;
      if (last) {
        const m = String(last.case_id).match(/(\d+)$/);
        if (m) n = parseInt(m[1], 10) + 1;
      }
      const caseId = `CASE-${String(n).padStart(5, '0')}`;
      await pool.query(`
        INSERT INTO cases (case_id, customer_id, customer_name, scenario, case_status, assigned_to, created_date, updated_date)
        VALUES ($1, $2, $3, 'KYC Review Escalation', 'Work In Progress', $4, $5, $6)
      `, [caseId, existing.customer_id, existing.customer_name, existing.assigned_to || null, today, today]);
      await notify({
        recipient_id: existing.assigned_to, recipient_role: 'employee', type: 'kyc_review_sar_case',
        title: `SAR case opened from KYC review — ${existing.customer_name}`,
        message: `${caseId} created. Open the case to begin the SAR filing.`,
        related_id: caseId, tone: 'warning'
      });
    }

    if (existing.assigned_to) {
      await notify({
        recipient_id: existing.assigned_to, recipient_role: 'employee', type: 'kyc_review_approved',
        title: `Your KYC review was approved — ${existing.customer_name}`,
        message: `${approvedBy} approved your review. Next review due ${nextDue}.`,
        related_id: String(existing.id), tone: 'success'
      });
    }

    const sel = await pool.query('SELECT * FROM kyc_reviews WHERE id = $1', [existing.id]);
    res.json(sel.rows[0]);
  } catch (err) { next(err); }
});

router.patch('/:id/reject', async (req, res, next) => {
  try {
    const existing = (await pool.query(`
      SELECT r.*, c.customer_name FROM kyc_reviews r LEFT JOIN customers c ON c.customer_id = r.customer_id WHERE r.id = $1
    `, [req.params.id])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Review not found' });
    const { reason, comments, rejected_by } = req.body;
    if (!reason) return res.status(400).json({ error: 'reason required' });
    if (!comments || comments.length < 30) return res.status(400).json({ error: 'comments >= 30 chars required' });

    await pool.query(`
      UPDATE kyc_reviews
         SET status = 'returned', rejection_reason = $1, rejection_comments = $2,
             rejected_by = $3, rejected_at = $4, returned_to_analyst = 1, updated_at = $5
       WHERE id = $6
    `, [reason, comments, rejected_by || 'Compliance Manager', nowStamp(), nowStamp(), existing.id]);

    if (existing.assigned_to) {
      await notify({
        recipient_id: existing.assigned_to, recipient_role: 'employee', type: 'kyc_review_rejected',
        title: `Your KYC review was returned — ${existing.customer_name}`,
        message: `${reason}: ${comments.slice(0, 120)}`,
        related_id: String(existing.id), tone: 'warning'
      });
    }
    const sel = await pool.query('SELECT * FROM kyc_reviews WHERE id = $1', [existing.id]);
    res.json(sel.rows[0]);
  } catch (err) { next(err); }
});

router.post('/:id/documents', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const review = (await pool.query(
      'SELECT * FROM kyc_reviews WHERE id = $1', [req.params.id]
    )).rows[0];
    if (!review) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Review not found' });
    }
    const relPath = path.join('uploads', req.file.filename);
    const ins = await pool.query(`
      INSERT INTO kyc_review_documents (review_id, document_name, file_path, document_type, uploaded_by, file_size)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
    `, [req.params.id, req.file.originalname, relPath,
        req.body.document_type || 'Supporting',
        req.body.uploaded_by || review.assigned_to || 'system',
        req.file.size]);
    res.status(201).json(ins.rows[0]);
  } catch (err) { next(err); }
});

router.delete('/:id/documents/:docId', async (req, res, next) => {
  try {
    const doc = (await pool.query(
      'SELECT * FROM kyc_review_documents WHERE id = $1 AND review_id = $2',
      [req.params.docId, req.params.id]
    )).rows[0];
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    const abs = path.isAbsolute(doc.file_path) ? doc.file_path : path.join(__dirname, '..', doc.file_path);
    if (fs.existsSync(abs)) { try { fs.unlinkSync(abs); } catch (_e) {} }
    await pool.query('DELETE FROM kyc_review_documents WHERE id = $1', [doc.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/:id/documents/:docId/file', async (req, res, next) => {
  try {
    const doc = (await pool.query(
      'SELECT * FROM kyc_review_documents WHERE id = $1 AND review_id = $2',
      [req.params.docId, req.params.id]
    )).rows[0];
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    const abs = path.isAbsolute(doc.file_path) ? doc.file_path : path.join(__dirname, '..', doc.file_path);
    if (!fs.existsSync(abs)) return res.status(404).json({ error: 'File missing' });
    if (req.query.preview === '1') return res.sendFile(abs);
    res.download(abs, doc.document_name);
  } catch (err) { next(err); }
});

module.exports = router;
