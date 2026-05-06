const express = require('express');
const pool = require('../database/db');
const { requireL2OrManager, requireAnyAnalyst } = require('../middleware/roleGuard');
const { upload } = require('../middleware/upload');
const { uploadFile, deleteFile, getSignedUrl } = require('../utils/supabaseStorage');

const router = express.Router();

// ─────────────────────────────────────────────── helpers

function nowIso() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }

async function nextL2CaseId() {
  const row = (await pool.query('SELECT l2_case_id FROM l2_cases ORDER BY id DESC LIMIT 1')).rows[0];
  if (!row) return 'L2-2026-0001';
  const m = (row.l2_case_id || '').match(/L2-(\d{4})-(\d{4})/);
  if (!m) return `L2-${new Date().getFullYear()}-0001`;
  return `L2-${m[1]}-${String(parseInt(m[2], 10) + 1).padStart(4, '0')}`;
}

async function pushNotification({ recipient_id, recipient_role, type, title, message, related_id, related_type, tone }) {
  await pool.query(`
    INSERT INTO notifications (recipient_id, recipient_role, type, title, message, related_id, related_type, tone)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `, [recipient_id || null, recipient_role, type, title, message || '', related_id || null, related_type || null, tone || 'info']);
}

async function logAudit(sarLikeId, action, performed_by, details) {
  // L2 audit events all attach to an alert (the alert flowed L1 → L2).
  // entity_type='alert' makes them visible in the alert's Activity Log.
  await pool.query(`
    INSERT INTO audit_trail (entity_type, sar_id, action, performed_by, timestamp, details)
    VALUES ('alert', $1, $2, $3, NOW(), $4)
  `, [sarLikeId, action, performed_by || 'system', details || null]);
}

// ─────────────────────────────────────────────── L2 queue

const L2_SELECT = `
  SELECT lc.*,
         a.priority           AS alert_priority,
         a.amount_flagged_inr AS amount,
         a.disposition        AS l1_disposition,
         a.assigned_to        AS l1_analyst,
         a.created_date       AS alert_created_date,
         a.scenario           AS alert_scenario,
         a.customer_risk_rating,
         a.case_id            AS sar_case_id,
         a.linked_sar_id
    FROM l2_cases lc
    LEFT JOIN alerts a ON a.alert_id = lc.alert_id
`;

router.get('/queue', async (_req, res, next) => {
  try {
    const result = await pool.query(L2_SELECT + ' ORDER BY lc.escalated_at DESC');
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.get('/queue/:analystId', async (req, res, next) => {
  try {
    const id = decodeURIComponent(req.params.analystId);
    const result = await pool.query(L2_SELECT + `
       WHERE lc.assigned_to = $1
          OR lc.assigned_to IS NULL
          OR TRIM(lc.assigned_to) = ''
       ORDER BY lc.escalated_at DESC
    `, [id]);
    res.json(result.rows);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────── L2 case detail

router.get('/:id', async (req, res, next) => {
  try {
    const result = await pool.query(L2_SELECT + ' WHERE lc.l2_case_id = $1', [req.params.id]);
    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: 'L2 case not found' });
    if (row.risk_factors) try { row.risk_factors = JSON.parse(row.risk_factors); } catch { /* keep raw */ }
    if (row.counterparty_analysis) try { row.counterparty_analysis = JSON.parse(row.counterparty_analysis); } catch { /* keep raw */ }
    res.json(row);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────── Create L2 case

// POST /api/l2 — creates an L2 case. L1 analysts must be able to call this
// when they click "Escalate to L2" on their alert workspace, so the guard
// is requireAnyAnalyst (not requireL2OrManager). Only L1/L2/manager roles
// can create. All downstream L2 lifecycle routes (accept, return, close,
// escalate-sar, etc.) remain L2-or-manager-only.
router.post('/', requireAnyAnalyst, async (req, res, next) => {
  try {
    const { alert_id, escalated_by, escalation_reason, assigned_to } = req.body || {};
    if (!alert_id || !escalated_by) {
      return res.status(400).json({ error: 'alert_id and escalated_by are required' });
    }
    const alert = (await pool.query('SELECT * FROM alerts WHERE alert_id = $1', [alert_id])).rows[0];
    if (!alert) return res.status(404).json({ error: 'Alert not found' });

    const existing = (await pool.query(
      'SELECT * FROM l2_cases WHERE alert_id = $1 ORDER BY id DESC LIMIT 1', [alert_id]
    )).rows[0];
    if (existing && !['Returned to L1'].includes(existing.status)) {
      return res.status(200).json(existing);
    }

    const l2CaseId = await nextL2CaseId();
    const now = nowIso();
    await pool.query(`
      INSERT INTO l2_cases (
        l2_case_id, alert_id, customer_id, customer_name, scenario, priority,
        escalated_by, escalated_at, escalation_reason, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Pending Assignment', $10, $11)
    `, [
      l2CaseId, alert.alert_id, alert.customer_id, alert.customer_name, alert.scenario, alert.priority,
      escalated_by, now, escalation_reason || null, now, now
    ]);

    await pool.query(`
      UPDATE alerts
         SET alert_status = 'Escalated - L2',
             disposition = 'Escalated to L2',
             escalated_to_l2_at = $1,
             l2_case_id = $2,
             l2_analyst_id = $3,
             returned_from_l2_at = NULL,
             l2_return_reason = NULL,
             l2_return_instructions = NULL,
             last_activity_date = CURRENT_DATE::text
       WHERE alert_id = $4
    `, [now, l2CaseId, assigned_to || null, alert_id]);

    const l2Analysts = (await pool.query(
      "SELECT name FROM user_profiles WHERE role = 'AML Analyst L2' AND status = 'Active'"
    )).rows;
    for (const a of l2Analysts) {
      await pushNotification({
        recipient_id: a.name, recipient_role: 'employee', type: 'l2_new',
        title: 'New alert escalated to L2',
        message: `${alert.alert_id} from ${escalated_by} — ${alert.scenario} — ${alert.priority} priority — ${alert.customer_name}`,
        related_id: alert.alert_id, related_type: 'alert', tone: 'warning'
      });
    }
    await pushNotification({
      recipient_role: 'manager', type: 'l1_to_l2',
      title: 'Alert escalated L1 → L2',
      message: `${alert.alert_id} — ${alert.customer_name} — by ${escalated_by}`,
      related_id: alert.alert_id, related_type: 'alert', tone: 'info'
    });

    await logAudit(
      alert.alert_id,
      `Escalated to L2 — Reason: ${escalation_reason || '(no reason given)'}`,
      escalated_by,
      `L2 case ${l2CaseId} created`
    );

    const sel = await pool.query('SELECT * FROM l2_cases WHERE l2_case_id = $1', [l2CaseId]);
    res.status(201).json(sel.rows[0]);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────── Accept

router.patch('/:id/accept', requireL2OrManager, async (req, res, next) => {
  try {
    const { analyst_id } = req.body || {};
    if (!analyst_id) return res.status(400).json({ error: 'analyst_id required' });
    const lc = (await pool.query('SELECT * FROM l2_cases WHERE l2_case_id = $1', [req.params.id])).rows[0];
    if (!lc) return res.status(404).json({ error: 'L2 case not found' });

    const now = nowIso();
    await pool.query(`
      UPDATE l2_cases
         SET assigned_to = $1, assigned_at = $2, status = 'Under L2 Review', updated_at = $3
       WHERE l2_case_id = $4
    `, [analyst_id, now, now, req.params.id]);

    await pool.query('UPDATE alerts SET l2_analyst_id = $1 WHERE alert_id = $2', [analyst_id, lc.alert_id]);

    await pushNotification({
      recipient_id: lc.escalated_by, recipient_role: 'employee', type: 'l2_accepted',
      title: 'Your alert has been accepted by L2',
      message: `${lc.alert_id} accepted by ${analyst_id}`,
      related_id: lc.alert_id, related_type: 'alert', tone: 'info'
    });

    await logAudit(lc.alert_id, `L2 accepted by ${analyst_id}`, analyst_id, lc.l2_case_id);
    const sel = await pool.query('SELECT * FROM l2_cases WHERE l2_case_id = $1', [req.params.id]);
    res.json(sel.rows[0]);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────── Reassign

router.patch('/:id/reassign', requireL2OrManager, async (req, res, next) => {
  try {
    const { analyst_id, performed_by } = req.body || {};
    if (!analyst_id) return res.status(400).json({ error: 'analyst_id required' });
    const lc = (await pool.query('SELECT * FROM l2_cases WHERE l2_case_id = $1', [req.params.id])).rows[0];
    if (!lc) return res.status(404).json({ error: 'L2 case not found' });

    await pool.query(`
      UPDATE l2_cases
         SET assigned_to = $1, status = 'Assigned', updated_at = $2
       WHERE l2_case_id = $3
    `, [analyst_id, nowIso(), req.params.id]);
    await pool.query('UPDATE alerts SET l2_analyst_id = $1 WHERE alert_id = $2', [analyst_id, lc.alert_id]);

    await pushNotification({
      recipient_id: analyst_id, recipient_role: 'employee', type: 'l2_reassigned',
      title: 'L2 case reassigned to you',
      message: `${lc.alert_id} (${lc.customer_name}) reassigned by ${performed_by || 'system'}`,
      related_id: lc.alert_id, related_type: 'alert', tone: 'info'
    });

    const sel = await pool.query('SELECT * FROM l2_cases WHERE l2_case_id = $1', [req.params.id]);
    res.json(sel.rows[0]);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────── Risk score / counterparty analysis

router.patch('/:id/risk-score', requireL2OrManager, async (req, res, next) => {
  try {
    const { risk_score, risk_factors, counterparty_analysis, l2_narrative } = req.body || {};
    const lc = (await pool.query('SELECT * FROM l2_cases WHERE l2_case_id = $1', [req.params.id])).rows[0];
    if (!lc) return res.status(404).json({ error: 'L2 case not found' });
    await pool.query(`
      UPDATE l2_cases
         SET risk_score = COALESCE($1, risk_score),
             risk_factors = COALESCE($2, risk_factors),
             counterparty_analysis = COALESCE($3, counterparty_analysis),
             l2_narrative = COALESCE($4, l2_narrative),
             updated_at = $5
       WHERE l2_case_id = $6
    `, [
      risk_score != null ? Number(risk_score) : null,
      risk_factors ? JSON.stringify(risk_factors) : null,
      counterparty_analysis ? JSON.stringify(counterparty_analysis) : null,
      l2_narrative != null ? l2_narrative : null,
      nowIso(), req.params.id
    ]);
    const sel = await pool.query('SELECT * FROM l2_cases WHERE l2_case_id = $1', [req.params.id]);
    res.json(sel.rows[0]);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────── L2 notes

router.get('/:id/notes', async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT * FROM l2_notes WHERE l2_case_id = $1 ORDER BY created_at DESC
    `, [req.params.id]);
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.post('/:id/notes', requireL2OrManager, async (req, res, next) => {
  try {
    const { note_text, analyst_id } = req.body || {};
    if (!note_text?.trim()) return res.status(400).json({ error: 'note_text required' });
    const lc = (await pool.query('SELECT * FROM l2_cases WHERE l2_case_id = $1', [req.params.id])).rows[0];
    if (!lc) return res.status(404).json({ error: 'L2 case not found' });
    const ins = await pool.query(`
      INSERT INTO l2_notes (l2_case_id, note_text, analyst_id, created_at)
      VALUES ($1, $2, $3, NOW()) RETURNING *
    `, [req.params.id, note_text.trim(), analyst_id || null]);
    const preview = note_text.trim().slice(0, 50);
    await logAudit(lc.alert_id, `L2 note added — ${preview}${note_text.length > 50 ? '…' : ''}`, analyst_id);
    res.status(201).json(ins.rows[0]);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────── L2 documents

router.get('/:id/documents', async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT * FROM l2_documents WHERE l2_case_id = $1 ORDER BY uploaded_at DESC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.post('/:id/documents', requireL2OrManager, upload.single('file'), async (req, res, next) => {
  try {
    const { document_type, uploaded_by } = req.body || {};
    if (!req.file) return res.status(400).json({ error: 'file required' });
    const lc = (await pool.query('SELECT * FROM l2_cases WHERE l2_case_id = $1', [req.params.id])).rows[0];
    if (!lc) return res.status(404).json({ error: 'L2 case not found' });

    const filename = req.file.originalname;
    const { filePath } = await uploadFile(
      req.file.buffer, filename, req.file.mimetype, 'l2'
    );
    const ins = await pool.query(`
      INSERT INTO l2_documents (l2_case_id, document_name, file_path, document_type, uploaded_by, uploaded_at, file_size)
      VALUES ($1, $2, $3, $4, $5, NOW(), $6) RETURNING *
    `, [req.params.id, filename, filePath, document_type || 'Other', uploaded_by || null, req.file.size || 0]);
    await logAudit(lc.alert_id, `L2 document uploaded — ${filename}`, uploaded_by, document_type || null);
    res.status(201).json(ins.rows[0]);
  } catch (err) { next(err); }
});

// Download an L2 case document. Same redirect-to-signed-URL pattern as the
// other document routes — bare <a href> and <iframe src> work in the
// browser. The frontend currently doesn't link to this anywhere (L2
// workspace points at /api/case-documents/file/:id for cross-case docs)
// but the route is here for completeness and future use.
router.get('/:id/documents/:docId/file', async (req, res, next) => {
  try {
    const doc = (await pool.query(
      'SELECT * FROM l2_documents WHERE id = $1 AND l2_case_id = $2',
      [req.params.docId, req.params.id]
    )).rows[0];
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    if (!doc.file_path) return res.status(404).json({ error: 'File missing' });
    const url = await getSignedUrl(doc.file_path);
    res.redirect(url);
  } catch (err) { next(err); }
});

router.delete('/:id/documents/:docId', requireL2OrManager, async (req, res, next) => {
  try {
    const doc = (await pool.query(
      'SELECT * FROM l2_documents WHERE id = $1 AND l2_case_id = $2',
      [req.params.docId, req.params.id]
    )).rows[0];
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const requesterRole = req.headers['x-user-role'];
    const requesterName = req.headers['x-user-name'];
    if (requesterRole !== 'compliance_manager' && doc.uploaded_by && requesterName !== doc.uploaded_by) {
      return res.status(403).json({ error: 'Only the uploader or a manager can delete this document' });
    }

    if (doc.file_path) {
      try { await deleteFile(doc.file_path); } catch (e) { console.warn('[l2-docs] supabase delete failed:', e.message); }
    }
    await pool.query('DELETE FROM l2_documents WHERE id = $1', [doc.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────── Decision: Return to L1

router.patch('/:id/return', requireL2OrManager, async (req, res, next) => {
  try {
    const { reason, instructions, performed_by } = req.body || {};
    if (!reason || !instructions) return res.status(400).json({ error: 'reason and instructions required' });
    const lc = (await pool.query('SELECT * FROM l2_cases WHERE l2_case_id = $1', [req.params.id])).rows[0];
    if (!lc) return res.status(404).json({ error: 'L2 case not found' });

    const now = nowIso();
    await pool.query(`
      UPDATE l2_cases
         SET status = 'Returned to L1',
             decision = 'returned',
             decision_made_at = $1,
             decision_by = $2,
             return_reason = $3,
             return_instructions = $4,
             updated_at = $5
       WHERE l2_case_id = $6
    `, [now, performed_by || lc.assigned_to, reason, instructions, now, req.params.id]);

    await pool.query(`
      UPDATE alerts
         SET alert_status = 'Work in Progress',
             assigned_to = COALESCE($1, assigned_to),
             returned_from_l2_at = $2,
             l2_return_reason = $3,
             l2_return_instructions = $4,
             l2_decision = 'returned',
             l2_decision_at = $5,
             last_activity_date = CURRENT_DATE::text
       WHERE alert_id = $6
    `, [lc.escalated_by, now, reason, instructions, now, lc.alert_id]);

    await pushNotification({
      recipient_id: lc.escalated_by, recipient_role: 'employee', type: 'l2_returned',
      title: 'Alert returned by L2',
      message: `${lc.alert_id} returned: ${reason}. ${instructions}`,
      related_id: lc.alert_id, related_type: 'alert', tone: 'warning'
    });
    await pushNotification({
      recipient_role: 'manager', type: 'l2_decision',
      title: 'L2 decision: returned',
      message: `${lc.alert_id} (${lc.customer_name}) returned to L1`,
      related_id: lc.alert_id, related_type: 'alert', tone: 'info'
    });
    await logAudit(lc.alert_id, 'L2 decision: returned to L1', performed_by || lc.assigned_to,
      `Reason: ${reason}. Instructions: ${instructions}`);

    const sel = await pool.query('SELECT * FROM l2_cases WHERE l2_case_id = $1', [req.params.id]);
    res.json(sel.rows[0]);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────── Decision: Close

router.patch('/:id/close', requireL2OrManager, async (req, res, next) => {
  try {
    const { narrative, performed_by } = req.body || {};
    if (!narrative || narrative.trim().length < 150) {
      return res.status(400).json({ error: 'closing narrative (min 150 chars) required' });
    }
    const lc = (await pool.query('SELECT * FROM l2_cases WHERE l2_case_id = $1', [req.params.id])).rows[0];
    if (!lc) return res.status(404).json({ error: 'L2 case not found' });

    const now = nowIso();
    await pool.query(`
      UPDATE l2_cases
         SET status = 'Decision Made — Closed',
             decision = 'closed',
             decision_made_at = $1,
             decision_by = $2,
             l2_narrative = $3,
             updated_at = $4
       WHERE l2_case_id = $5
    `, [now, performed_by || lc.assigned_to, narrative, now, req.params.id]);

    await pool.query(`
      UPDATE alerts
         SET alert_status = 'Completed',
             disposition = 'Closed by L2 — No Suspicious Activity',
             l2_decision = 'closed',
             l2_decision_at = $1,
             closed_date = CURRENT_DATE::text,
             last_activity_date = CURRENT_DATE::text
       WHERE alert_id = $2
    `, [now, lc.alert_id]);

    await pushNotification({
      recipient_id: lc.escalated_by, recipient_role: 'employee', type: 'l2_closed',
      title: 'L2 decision: Closed',
      message: `${lc.alert_id} closed by L2 — no suspicious activity found`,
      related_id: lc.alert_id, related_type: 'alert', tone: 'info'
    });
    await pushNotification({
      recipient_role: 'manager', type: 'l2_decision',
      title: 'L2 decision: Closed',
      message: `${lc.alert_id} (${lc.customer_name}) closed without SAR`,
      related_id: lc.alert_id, related_type: 'alert', tone: 'info'
    });
    await logAudit(lc.alert_id, 'L2 decision: closed — no suspicious activity', performed_by || lc.assigned_to,
      `Narrative: ${narrative.slice(0, 200)}${narrative.length > 200 ? '…' : ''}`);

    const sel = await pool.query('SELECT * FROM l2_cases WHERE l2_case_id = $1', [req.params.id]);
    res.json(sel.rows[0]);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────── Decision: Escalate to SAR

async function nextSarCaseId() {
  // Take the MAX trailing number from existing CAS-YYYY-XXXX cases for the
  // current year, increment, then verify uniqueness in a small loop. The
  // previous implementation read the latest case overall and reset to
  // CAS-YYYY-0001 whenever the latest case happened to be a CASE-XXXXX
  // (which is the more common prefix), causing duplicate-key errors on
  // subsequent L2 escalations.
  const year = new Date().getFullYear();
  const prefix = `CAS-${year}-`;
  const r = await pool.query(
    `SELECT MAX(CAST(SUBSTRING(case_id FROM '^CAS-[0-9]{4}-([0-9]+)$') AS INTEGER)) AS max_num
       FROM cases
      WHERE case_id LIKE $1`,
    [`${prefix}%`]
  );
  let n = (Number(r.rows[0]?.max_num) || 0) + 1;
  for (let attempts = 0; attempts < 10000; attempts++) {
    const candidate = `${prefix}${String(n).padStart(4, '0')}`;
    const dup = await pool.query('SELECT 1 FROM cases WHERE case_id = $1 LIMIT 1', [candidate]);
    if (dup.rows.length === 0) return candidate;
    n++;
  }
  throw new Error('Could not generate unique L2 SAR case_id after 10000 attempts');
}

router.patch('/:id/escalate-sar', requireL2OrManager, async (req, res, next) => {
  try {
    const { sar_priority, summary, performed_by } = req.body || {};
    if (!summary?.trim()) return res.status(400).json({ error: 'summary required' });
    const lc = (await pool.query('SELECT * FROM l2_cases WHERE l2_case_id = $1', [req.params.id])).rows[0];
    if (!lc) return res.status(404).json({ error: 'L2 case not found' });
    const alert = (await pool.query('SELECT * FROM alerts WHERE alert_id = $1', [lc.alert_id])).rows[0];
    if (!alert) return res.status(404).json({ error: 'Alert not found' });

    const now = nowIso();
    const today = new Date().toISOString().slice(0, 10);

    let caseId = alert.case_id;
    if (!caseId) {
      caseId = await nextSarCaseId();
      await pool.query(`
        INSERT INTO cases (case_id, source_alert_id, linked_sar_id, customer_id, customer_name, scenario, case_status, assigned_to, created_date, updated_date)
        VALUES ($1, $2, NULL, $3, $4, $5, 'Work In Progress', $6, $7, $8)
      `, [caseId, alert.alert_id, alert.customer_id, alert.customer_name, alert.scenario,
          lc.assigned_to || performed_by, today, today]);
    }

    await pool.query(`
      UPDATE l2_cases
         SET status = 'Decision Made — SAR Filed',
             decision = 'escalated_sar',
             decision_made_at = $1,
             decision_by = $2,
             sar_priority = $3,
             l2_narrative = $4,
             updated_at = $5
       WHERE l2_case_id = $6
    `, [now, performed_by || lc.assigned_to, sar_priority || 'Standard', summary, now, req.params.id]);

    await pool.query(`
      UPDATE alerts
         SET alert_status = 'Escalated - SAR',
             disposition = 'Escalated to SAR Filing (by L2)',
             case_id = $1,
             l2_decision = 'escalated_sar',
             l2_decision_at = $2,
             last_activity_date = CURRENT_DATE::text
       WHERE alert_id = $3
    `, [caseId, now, lc.alert_id]);

    await pushNotification({
      recipient_id: lc.escalated_by, recipient_role: 'employee', type: 'l2_to_sar',
      title: 'L2 decision: Escalated to SAR',
      message: `${lc.alert_id} → SAR case ${caseId}`,
      related_id: lc.alert_id, related_type: 'alert', tone: 'warning'
    });
    await pushNotification({
      recipient_role: 'manager', type: 'l2_to_sar',
      title: 'New SAR case created by L2',
      message: `${lc.assigned_to || performed_by} escalated ${lc.customer_name} (${lc.alert_id}) to SAR — ${sar_priority || 'Standard'} priority`,
      related_id: caseId, related_type: 'case', tone: 'warning'
    });
    await logAudit(lc.alert_id, 'L2 decision: escalated to SAR', performed_by || lc.assigned_to,
      `Case ${caseId}. Priority ${sar_priority || 'Standard'}. ${summary.slice(0, 200)}${summary.length > 200 ? '…' : ''}`);
    await logAudit(lc.alert_id, 'SAR case created', performed_by || lc.assigned_to, `Case ${caseId}`);

    const sel = await pool.query('SELECT * FROM l2_cases WHERE l2_case_id = $1', [req.params.id]);
    res.json({ l2_case: sel.rows[0], case_id: caseId });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────── L1 summary

router.get('/l1-summary/:alertId', async (req, res, next) => {
  try {
    const alert = (await pool.query(`
      SELECT a.*, c.customer_name AS cust_name
        FROM alerts a
        LEFT JOIN customers c ON c.customer_id = a.customer_id
       WHERE a.alert_id = $1
    `, [req.params.alertId])).rows[0];
    if (!alert) return res.status(404).json({ error: 'Alert not found' });

    const notes = (await pool.query(
      'SELECT * FROM case_notes WHERE alert_id = $1 ORDER BY timestamp ASC',
      [req.params.alertId]
    )).rows;

    const documents = (await pool.query(
      'SELECT * FROM case_documents WHERE alert_id = $1 ORDER BY uploaded_at ASC',
      [req.params.alertId]
    )).rows;

    const escalatedAt = alert.escalated_to_l2_at || alert.last_activity_date;
    let timeSpentDays = null;
    try {
      if (alert.created_date && escalatedAt) {
        const a = new Date(alert.created_date);
        const b = new Date(escalatedAt.length <= 10 ? escalatedAt : escalatedAt.replace(' ', 'T'));
        timeSpentDays = Math.max(0, Math.round((b - a) / 86400000));
      }
    } catch (_e) {}

    const checklist = {
      transactions_reviewed: true,
      customer_kyc_checked: true,
      notes_added: notes.length > 0,
      documents_uploaded: documents.length > 0,
      counterparty_research: documents.some(d => /counterparty|screening|adverse/i.test(d.description || '') || /counterparty/i.test(d.document_type || ''))
    };

    const l2 = (await pool.query(
      'SELECT * FROM l2_cases WHERE alert_id = $1 ORDER BY id DESC LIMIT 1',
      [req.params.alertId]
    )).rows[0] || null;

    res.json({
      alert,
      l1_analyst: alert.assigned_to,
      assigned_at: alert.created_date,
      escalated_at: escalatedAt,
      time_spent_days: timeSpentDays,
      final_disposition: alert.disposition,
      notes, documents, checklist,
      escalation_reason: l2?.escalation_reason || null,
      l2_case: l2
    });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────── Counterparty analysis

router.get('/:id/counterparties', async (req, res, next) => {
  try {
    const lc = (await pool.query('SELECT * FROM l2_cases WHERE l2_case_id = $1', [req.params.id])).rows[0];
    if (!lc) return res.status(404).json({ error: 'L2 case not found' });
    const result = await pool.query(`
      SELECT counterparty AS name,
             counterparty_country AS country,
             COUNT(*) AS total_transactions,
             SUM(amount) AS total_amount,
             MIN(txn_date) AS first_seen,
             MAX(txn_date) AS last_seen,
             SUM(is_alerted) AS alerted_count
        FROM transactions
       WHERE customer_id = $1
         AND counterparty IS NOT NULL AND TRIM(counterparty) <> ''
       GROUP BY counterparty, counterparty_country
       ORDER BY total_amount DESC
       LIMIT 50
    `, [lc.customer_id]);
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.get('/:id/linked-entities', async (req, res, next) => {
  try {
    const lc = (await pool.query('SELECT * FROM l2_cases WHERE l2_case_id = $1', [req.params.id])).rows[0];
    if (!lc) return res.status(404).json({ error: 'L2 case not found' });
    const result = await pool.query(`
      SELECT DISTINCT t.customer_id, t.counterparty AS shared_counterparty,
             c.customer_name, c.customer_risk_rating,
             (SELECT COUNT(*) FROM alerts a WHERE a.customer_id = t.customer_id AND a.alert_status NOT IN ('Completed','Closed')) AS open_alerts,
             (SELECT COUNT(*) FROM sar_filings s WHERE s.customer_id = t.customer_id) AS sar_history
        FROM transactions t
        JOIN customers c ON c.customer_id = t.customer_id
       WHERE t.counterparty IN (
         SELECT DISTINCT counterparty FROM transactions
          WHERE customer_id = $1 AND counterparty IS NOT NULL
       )
         AND t.customer_id <> $2
       LIMIT 20
    `, [lc.customer_id, lc.customer_id]);
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.get('/:id/patterns', async (req, res, next) => {
  try {
    const lc = (await pool.query('SELECT * FROM l2_cases WHERE l2_case_id = $1', [req.params.id])).rows[0];
    if (!lc) return res.status(404).json({ error: 'L2 case not found' });

    const txns = (await pool.query(`
      SELECT * FROM transactions WHERE customer_id = $1 ORDER BY txn_date DESC, txn_time DESC
    `, [lc.customer_id])).rows.map(t => ({ ...t, amount: Number(t.amount) }));
    const patterns = [];

    const inBand = txns.filter(t => t.amount >= 9000 && t.amount <= 9999);
    if (inBand.length >= 5) {
      inBand.sort((a, b) => a.txn_date.localeCompare(b.txn_date));
      let bestStart = 0, bestCount = 0;
      for (let i = 0; i < inBand.length; i++) {
        let count = 1;
        for (let j = i + 1; j < inBand.length; j++) {
          const d = (new Date(inBand[j].txn_date) - new Date(inBand[i].txn_date)) / 86400000;
          if (d <= 14) count++;
        }
        if (count > bestCount) { bestCount = count; bestStart = i; }
      }
      if (bestCount >= 5) {
        patterns.push({
          kind: 'Structuring Pattern',
          message: `${bestCount} transactions between $9,000–$9,999 detected in a 14 day window`,
          severity: 'high'
        });
      }
    }

    const today = new Date();
    const last30 = txns.filter(t => (today - new Date(t.txn_date)) <= 30 * 86400000);
    const prior90 = txns.filter(t => {
      const d = (today - new Date(t.txn_date));
      return d > 30 * 86400000 && d <= 120 * 86400000;
    });
    const last30Sum = last30.reduce((s, t) => s + t.amount, 0);
    const prior90Avg30 = prior90.length ? prior90.reduce((s, t) => s + t.amount, 0) / 3 : 0;
    if (prior90Avg30 > 0 && last30Sum > prior90Avg30 * 2) {
      const pct = Math.round(((last30Sum - prior90Avg30) / prior90Avg30) * 100);
      patterns.push({
        kind: 'Velocity Pattern',
        message: `Transaction volume increased ${pct}% compared to prior 90 day average`,
        severity: 'medium'
      });
    }

    const rounds = txns.filter(t => t.amount > 0 && t.amount % 5000 === 0);
    if (rounds.length >= 5) {
      const distinct = new Set(rounds.map(t => t.amount));
      patterns.push({
        kind: 'Round Amount Pattern',
        message: `${rounds.length} transactions in exact round amounts (${[...distinct].sort((a,b)=>a-b).slice(0,5).map(a => '$' + a.toLocaleString()).join(', ')}${distinct.size > 5 ? '…' : ''})`,
        severity: 'medium'
      });
    }

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const outWires = txns.filter(t => t.txn_type === 'Debit' && /wire/i.test(t.channel || '') && new Date(t.txn_date) >= sixMonthsAgo);
    if (outWires.length >= 3) {
      const totals = {};
      for (const t of outWires) totals[t.counterparty || 'Unknown'] = (totals[t.counterparty || 'Unknown'] || 0) + t.amount;
      const sumAll = Object.values(totals).reduce((s, v) => s + v, 0);
      const [topName, topAmt] = Object.entries(totals).sort((a, b) => b[1] - a[1])[0] || [];
      if (topAmt && sumAll && topAmt / sumAll >= 0.6) {
        patterns.push({
          kind: 'Counterparty Concentration',
          message: `${Math.round((topAmt / sumAll) * 100)}% of outbound wires go to "${topName}" in the last 6 months`,
          severity: 'high'
        });
      }
    }

    const HIGH_RISK = ['Myanmar','Syria','Yemen','Iran','Russia','North Korea','Pakistan','Haiti','Cyprus','Panama','British Virgin Islands','Cayman Islands'];
    const intl = txns.filter(t => HIGH_RISK.includes(t.counterparty_country) && /wire/i.test(t.channel || ''));
    if (intl.length >= 1) {
      patterns.push({
        kind: 'Geographic Anomaly',
        message: `${intl.length} international wire(s) to high risk jurisdictions detected (${[...new Set(intl.map(t => t.counterparty_country))].join(', ')})`,
        severity: 'high'
      });
    }

    res.json({ patterns, transaction_count: txns.length });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────── Manager stats

router.get('/stats/manager', async (_req, res, next) => {
  try {
    const total = Number((await pool.query(
      "SELECT COUNT(*) AS c FROM l2_cases WHERE status NOT LIKE 'Decision Made%' AND status <> 'Returned to L1'"
    )).rows[0].c);
    const avgDaysRow = (await pool.query(`
      SELECT AVG(EXTRACT(EPOCH FROM (NOW() - escalated_at::timestamp)) / 86400) AS d
        FROM l2_cases
       WHERE status NOT LIKE 'Decision Made%' AND status <> 'Returned to L1'
    `)).rows[0];
    const avgDays = avgDaysRow?.d != null ? Math.round(Number(avgDaysRow.d) * 10) / 10 : 0;
    const workload = (await pool.query(`
      SELECT assigned_to AS analyst, COUNT(*) AS open_cases
        FROM l2_cases
       WHERE assigned_to IS NOT NULL AND TRIM(assigned_to) <> ''
         AND status NOT LIKE 'Decision Made%' AND status <> 'Returned to L1'
       GROUP BY assigned_to
       ORDER BY open_cases DESC
    `)).rows.map(r => ({ ...r, open_cases: Number(r.open_cases) }));
    const recent = (await pool.query(`
      SELECT lc.*, a.customer_name
        FROM l2_cases lc
        LEFT JOIN alerts a ON a.alert_id = lc.alert_id
       WHERE lc.decision IS NOT NULL
       ORDER BY lc.decision_made_at DESC
       LIMIT 5
    `)).rows;
    res.json({ total_open: total, avg_days_open: avgDays, workload, recent_decisions: recent });
  } catch (err) { next(err); }
});

module.exports = router;
