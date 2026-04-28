const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { db } = require('../database/db');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'l2');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 25 * 1024 * 1024 } });

// ─────────────────────────────────────────────── helpers

function nowIso() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }

function nextL2CaseId() {
  const row = db.prepare(`SELECT l2_case_id FROM l2_cases ORDER BY id DESC LIMIT 1`).get();
  if (!row) return 'L2-2026-0001';
  const m = (row.l2_case_id || '').match(/L2-(\d{4})-(\d{4})/);
  if (!m) return `L2-${new Date().getFullYear()}-0001`;
  return `L2-${m[1]}-${String(parseInt(m[2], 10) + 1).padStart(4, '0')}`;
}

function pushNotification({ recipient_id, recipient_role, type, title, message, related_id, related_type, tone }) {
  db.prepare(`
    INSERT INTO notifications (recipient_id, recipient_role, type, title, message, related_id, related_type, tone)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(recipient_id || null, recipient_role, type, title, message || '', related_id || null, related_type || null, tone || 'info');
}

function logAudit(sarLikeId, action, performed_by, details) {
  db.prepare(`
    INSERT INTO audit_trail (sar_id, action, performed_by, timestamp, details)
    VALUES (?, ?, ?, datetime('now'), ?)
  `).run(sarLikeId, action, performed_by || 'system', details || null);
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

router.get('/queue', (_req, res) => {
  res.json(db.prepare(L2_SELECT + ' ORDER BY datetime(lc.escalated_at) DESC').all());
});

router.get('/queue/:analystId', (req, res) => {
  const id = decodeURIComponent(req.params.analystId);
  const rows = db.prepare(L2_SELECT + `
     WHERE lc.assigned_to = ?
        OR lc.assigned_to IS NULL
        OR TRIM(lc.assigned_to) = ''
     ORDER BY datetime(lc.escalated_at) DESC
  `).all(id);
  res.json(rows);
});

// ─────────────────────────────────────────────── L2 case detail

router.get('/:id', (req, res) => {
  const row = db.prepare(L2_SELECT + ' WHERE lc.l2_case_id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'L2 case not found' });
  // Parse JSON fields
  if (row.risk_factors) try { row.risk_factors = JSON.parse(row.risk_factors); } catch { /* keep raw */ }
  if (row.counterparty_analysis) try { row.counterparty_analysis = JSON.parse(row.counterparty_analysis); } catch { /* keep raw */ }
  res.json(row);
});

// ─────────────────────────────────────────────── Create L2 case (called by L1 escalation)

router.post('/', (req, res) => {
  const { alert_id, escalated_by, escalation_reason, assigned_to } = req.body || {};
  if (!alert_id || !escalated_by) {
    return res.status(400).json({ error: 'alert_id and escalated_by are required' });
  }
  const alert = db.prepare('SELECT * FROM alerts WHERE alert_id = ?').get(alert_id);
  if (!alert) return res.status(404).json({ error: 'Alert not found' });

  // Idempotent: if already an L2 case exists, return it
  const existing = db.prepare('SELECT * FROM l2_cases WHERE alert_id = ? ORDER BY id DESC LIMIT 1').get(alert_id);
  if (existing && !['Returned to L1'].includes(existing.status)) {
    return res.status(200).json(existing);
  }

  const l2CaseId = nextL2CaseId();
  const now = nowIso();
  db.prepare(`
    INSERT INTO l2_cases (
      l2_case_id, alert_id, customer_id, customer_name, scenario, priority,
      escalated_by, escalated_at, escalation_reason, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending Assignment', ?, ?)
  `).run(
    l2CaseId, alert.alert_id, alert.customer_id, alert.customer_name, alert.scenario, alert.priority,
    escalated_by, now, escalation_reason || null, now, now
  );

  // Update the alert
  db.prepare(`
    UPDATE alerts
       SET alert_status = 'Escalated - L2',
           disposition = 'Escalated to L2',
           escalated_to_l2_at = ?,
           l2_case_id = ?,
           l2_analyst_id = ?,
           returned_from_l2_at = NULL,
           l2_return_reason = NULL,
           l2_return_instructions = NULL,
           last_activity_date = date('now')
     WHERE alert_id = ?
  `).run(now, l2CaseId, assigned_to || null, alert_id);

  // Notify all L2 analysts (broadcast via recipient_role='employee' tagged as 'l2_new')
  const l2Analysts = db.prepare(`SELECT name FROM user_profiles WHERE role = 'AML Analyst L2' AND status = 'Active'`).all();
  for (const a of l2Analysts) {
    pushNotification({
      recipient_id: a.name, recipient_role: 'employee', type: 'l2_new',
      title: 'New alert escalated to L2',
      message: `${alert.alert_id} from ${escalated_by} — ${alert.scenario} — ${alert.priority} priority — ${alert.customer_name}`,
      related_id: alert.alert_id, related_type: 'alert', tone: 'warning'
    });
  }
  // Notify manager
  pushNotification({
    recipient_role: 'manager', type: 'l1_to_l2',
    title: 'Alert escalated L1 → L2',
    message: `${alert.alert_id} — ${alert.customer_name} — by ${escalated_by}`,
    related_id: alert.alert_id, related_type: 'alert', tone: 'info'
  });

  logAudit(alert.alert_id, 'Escalated to L2', escalated_by, `L2 case ${l2CaseId} created. Reason: ${escalation_reason || '(no reason given)'}`);

  res.status(201).json(db.prepare('SELECT * FROM l2_cases WHERE l2_case_id = ?').get(l2CaseId));
});

// ─────────────────────────────────────────────── Accept L2 case

router.patch('/:id/accept', (req, res) => {
  const { analyst_id } = req.body || {};
  if (!analyst_id) return res.status(400).json({ error: 'analyst_id required' });
  const lc = db.prepare('SELECT * FROM l2_cases WHERE l2_case_id = ?').get(req.params.id);
  if (!lc) return res.status(404).json({ error: 'L2 case not found' });

  const now = nowIso();
  db.prepare(`
    UPDATE l2_cases
       SET assigned_to = ?, assigned_at = ?, status = 'Under L2 Review', updated_at = ?
     WHERE l2_case_id = ?
  `).run(analyst_id, now, now, req.params.id);

  db.prepare('UPDATE alerts SET l2_analyst_id = ? WHERE alert_id = ?').run(analyst_id, lc.alert_id);

  // Notify the L1 analyst
  pushNotification({
    recipient_id: lc.escalated_by, recipient_role: 'employee', type: 'l2_accepted',
    title: 'Your alert has been accepted by L2',
    message: `${lc.alert_id} accepted by ${analyst_id}`,
    related_id: lc.alert_id, related_type: 'alert', tone: 'info'
  });

  logAudit(lc.alert_id, 'L2 Investigation Started', analyst_id, `${lc.l2_case_id} accepted`);
  res.json(db.prepare('SELECT * FROM l2_cases WHERE l2_case_id = ?').get(req.params.id));
});

// ─────────────────────────────────────────────── Reassign

router.patch('/:id/reassign', (req, res) => {
  const { analyst_id, performed_by } = req.body || {};
  if (!analyst_id) return res.status(400).json({ error: 'analyst_id required' });
  const lc = db.prepare('SELECT * FROM l2_cases WHERE l2_case_id = ?').get(req.params.id);
  if (!lc) return res.status(404).json({ error: 'L2 case not found' });

  db.prepare(`
    UPDATE l2_cases
       SET assigned_to = ?, status = 'Assigned', updated_at = ?
     WHERE l2_case_id = ?
  `).run(analyst_id, nowIso(), req.params.id);
  db.prepare('UPDATE alerts SET l2_analyst_id = ? WHERE alert_id = ?').run(analyst_id, lc.alert_id);

  pushNotification({
    recipient_id: analyst_id, recipient_role: 'employee', type: 'l2_reassigned',
    title: 'L2 case reassigned to you',
    message: `${lc.alert_id} (${lc.customer_name}) reassigned by ${performed_by || 'system'}`,
    related_id: lc.alert_id, related_type: 'alert', tone: 'info'
  });

  res.json(db.prepare('SELECT * FROM l2_cases WHERE l2_case_id = ?').get(req.params.id));
});

// ─────────────────────────────────────────────── Risk score / counterparty analysis

router.patch('/:id/risk-score', (req, res) => {
  const { risk_score, risk_factors, counterparty_analysis, l2_narrative } = req.body || {};
  const lc = db.prepare('SELECT * FROM l2_cases WHERE l2_case_id = ?').get(req.params.id);
  if (!lc) return res.status(404).json({ error: 'L2 case not found' });
  db.prepare(`
    UPDATE l2_cases
       SET risk_score = COALESCE(?, risk_score),
           risk_factors = COALESCE(?, risk_factors),
           counterparty_analysis = COALESCE(?, counterparty_analysis),
           l2_narrative = COALESCE(?, l2_narrative),
           updated_at = ?
     WHERE l2_case_id = ?
  `).run(
    risk_score != null ? Number(risk_score) : null,
    risk_factors ? JSON.stringify(risk_factors) : null,
    counterparty_analysis ? JSON.stringify(counterparty_analysis) : null,
    l2_narrative != null ? l2_narrative : null,
    nowIso(), req.params.id
  );
  res.json(db.prepare('SELECT * FROM l2_cases WHERE l2_case_id = ?').get(req.params.id));
});

// ─────────────────────────────────────────────── L2 notes

router.get('/:id/notes', (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM l2_notes WHERE l2_case_id = ? ORDER BY datetime(created_at) DESC
  `).all(req.params.id);
  res.json(rows);
});

router.post('/:id/notes', (req, res) => {
  const { note_text, analyst_id } = req.body || {};
  if (!note_text?.trim()) return res.status(400).json({ error: 'note_text required' });
  const lc = db.prepare('SELECT * FROM l2_cases WHERE l2_case_id = ?').get(req.params.id);
  if (!lc) return res.status(404).json({ error: 'L2 case not found' });
  const info = db.prepare(`
    INSERT INTO l2_notes (l2_case_id, note_text, analyst_id, created_at)
    VALUES (?, ?, ?, datetime('now'))
  `).run(req.params.id, note_text.trim(), analyst_id || null);
  res.status(201).json(db.prepare('SELECT * FROM l2_notes WHERE id = ?').get(info.lastInsertRowid));
});

// ─────────────────────────────────────────────── L2 documents

router.get('/:id/documents', (req, res) => {
  res.json(db.prepare(`SELECT * FROM l2_documents WHERE l2_case_id = ? ORDER BY datetime(uploaded_at) DESC`).all(req.params.id));
});

router.post('/:id/documents', upload.single('file'), (req, res) => {
  const { document_type, uploaded_by } = req.body || {};
  if (!req.file) return res.status(400).json({ error: 'file required' });
  const lc = db.prepare('SELECT * FROM l2_cases WHERE l2_case_id = ?').get(req.params.id);
  if (!lc) {
    try { fs.unlinkSync(req.file.path); } catch (_e) {}
    return res.status(404).json({ error: 'L2 case not found' });
  }
  const filename = req.file.originalname;
  const relPath = path.relative(path.join(__dirname, '..'), req.file.path).replace(/\\/g, '/');
  const info = db.prepare(`
    INSERT INTO l2_documents (l2_case_id, document_name, file_path, document_type, uploaded_by, uploaded_at, file_size)
    VALUES (?, ?, ?, ?, ?, datetime('now'), ?)
  `).run(req.params.id, filename, relPath, document_type || 'Other', uploaded_by || null, req.file.size || 0);
  res.status(201).json(db.prepare('SELECT * FROM l2_documents WHERE id = ?').get(info.lastInsertRowid));
});

// ─────────────────────────────────────────────── Decision: Return to L1

router.patch('/:id/return', (req, res) => {
  const { reason, instructions, performed_by } = req.body || {};
  if (!reason || !instructions) return res.status(400).json({ error: 'reason and instructions required' });
  const lc = db.prepare('SELECT * FROM l2_cases WHERE l2_case_id = ?').get(req.params.id);
  if (!lc) return res.status(404).json({ error: 'L2 case not found' });

  const now = nowIso();
  db.prepare(`
    UPDATE l2_cases
       SET status = 'Returned to L1',
           decision = 'returned',
           decision_made_at = ?,
           decision_by = ?,
           return_reason = ?,
           return_instructions = ?,
           updated_at = ?
     WHERE l2_case_id = ?
  `).run(now, performed_by || lc.assigned_to, reason, instructions, now, req.params.id);

  // Move alert back to Work in Progress, restore L1 ownership
  db.prepare(`
    UPDATE alerts
       SET alert_status = 'Work in Progress',
           assigned_to = COALESCE(?, assigned_to),
           returned_from_l2_at = ?,
           l2_return_reason = ?,
           l2_return_instructions = ?,
           l2_decision = 'returned',
           l2_decision_at = ?,
           last_activity_date = date('now')
     WHERE alert_id = ?
  `).run(lc.escalated_by, now, reason, instructions, now, lc.alert_id);

  pushNotification({
    recipient_id: lc.escalated_by, recipient_role: 'employee', type: 'l2_returned',
    title: 'Alert returned by L2',
    message: `${lc.alert_id} returned: ${reason}. ${instructions}`,
    related_id: lc.alert_id, related_type: 'alert', tone: 'warning'
  });
  pushNotification({
    recipient_role: 'manager', type: 'l2_decision',
    title: 'L2 decision: returned',
    message: `${lc.alert_id} (${lc.customer_name}) returned to L1`,
    related_id: lc.alert_id, related_type: 'alert', tone: 'info'
  });
  logAudit(lc.alert_id, 'Returned by L2 to L1', performed_by || lc.assigned_to,
    `Reason: ${reason}. Instructions: ${instructions}`);

  res.json(db.prepare('SELECT * FROM l2_cases WHERE l2_case_id = ?').get(req.params.id));
});

// ─────────────────────────────────────────────── Decision: Close

router.patch('/:id/close', (req, res) => {
  const { narrative, performed_by } = req.body || {};
  if (!narrative || narrative.trim().length < 150) {
    return res.status(400).json({ error: 'closing narrative (min 150 chars) required' });
  }
  const lc = db.prepare('SELECT * FROM l2_cases WHERE l2_case_id = ?').get(req.params.id);
  if (!lc) return res.status(404).json({ error: 'L2 case not found' });

  const now = nowIso();
  db.prepare(`
    UPDATE l2_cases
       SET status = 'Decision Made — Closed',
           decision = 'closed',
           decision_made_at = ?,
           decision_by = ?,
           l2_narrative = ?,
           updated_at = ?
     WHERE l2_case_id = ?
  `).run(now, performed_by || lc.assigned_to, narrative, now, req.params.id);

  db.prepare(`
    UPDATE alerts
       SET alert_status = 'Completed',
           disposition = 'Closed by L2 — No Suspicious Activity',
           l2_decision = 'closed',
           l2_decision_at = ?,
           closed_date = date('now'),
           last_activity_date = date('now')
     WHERE alert_id = ?
  `).run(now, lc.alert_id);

  pushNotification({
    recipient_id: lc.escalated_by, recipient_role: 'employee', type: 'l2_closed',
    title: 'L2 decision: Closed',
    message: `${lc.alert_id} closed by L2 — no suspicious activity found`,
    related_id: lc.alert_id, related_type: 'alert', tone: 'info'
  });
  pushNotification({
    recipient_role: 'manager', type: 'l2_decision',
    title: 'L2 decision: Closed',
    message: `${lc.alert_id} (${lc.customer_name}) closed without SAR`,
    related_id: lc.alert_id, related_type: 'alert', tone: 'info'
  });
  logAudit(lc.alert_id, 'Closed by L2', performed_by || lc.assigned_to,
    `No suspicious activity. Narrative: ${narrative.slice(0, 200)}${narrative.length > 200 ? '…' : ''}`);

  res.json(db.prepare('SELECT * FROM l2_cases WHERE l2_case_id = ?').get(req.params.id));
});

// ─────────────────────────────────────────────── Decision: Escalate to SAR

router.patch('/:id/escalate-sar', (req, res) => {
  const { sar_priority, summary, performed_by } = req.body || {};
  if (!summary?.trim()) return res.status(400).json({ error: 'summary required' });
  const lc = db.prepare('SELECT * FROM l2_cases WHERE l2_case_id = ?').get(req.params.id);
  if (!lc) return res.status(404).json({ error: 'L2 case not found' });
  const alert = db.prepare('SELECT * FROM alerts WHERE alert_id = ?').get(lc.alert_id);
  if (!alert) return res.status(404).json({ error: 'Alert not found' });

  const now = nowIso();
  const today = new Date().toISOString().slice(0, 10);

  // Reuse existing case if already linked, else create one
  let caseId = alert.case_id;
  if (!caseId) {
    caseId = nextSarCaseId();
    db.prepare(`
      INSERT INTO cases (case_id, source_alert_id, linked_sar_id, customer_id, customer_name, scenario, case_status, assigned_to, created_date, updated_date)
      VALUES (?, ?, NULL, ?, ?, ?, 'Work In Progress', ?, ?, ?)
    `).run(caseId, alert.alert_id, alert.customer_id, alert.customer_name, alert.scenario,
      lc.assigned_to || performed_by, today, today);
  }

  db.prepare(`
    UPDATE l2_cases
       SET status = 'Decision Made — SAR Filed',
           decision = 'escalated_sar',
           decision_made_at = ?,
           decision_by = ?,
           sar_priority = ?,
           l2_narrative = ?,
           updated_at = ?
     WHERE l2_case_id = ?
  `).run(now, performed_by || lc.assigned_to, sar_priority || 'Standard', summary, now, req.params.id);

  db.prepare(`
    UPDATE alerts
       SET alert_status = 'Escalated - SAR',
           disposition = 'Escalated to SAR Filing (by L2)',
           case_id = ?,
           l2_decision = 'escalated_sar',
           l2_decision_at = ?,
           last_activity_date = date('now')
     WHERE alert_id = ?
  `).run(caseId, now, lc.alert_id);

  pushNotification({
    recipient_id: lc.escalated_by, recipient_role: 'employee', type: 'l2_to_sar',
    title: 'L2 decision: Escalated to SAR',
    message: `${lc.alert_id} → SAR case ${caseId}`,
    related_id: lc.alert_id, related_type: 'alert', tone: 'warning'
  });
  pushNotification({
    recipient_role: 'manager', type: 'l2_to_sar',
    title: 'New SAR case created by L2',
    message: `${lc.assigned_to || performed_by} escalated ${lc.customer_name} (${lc.alert_id}) to SAR — ${sar_priority || 'Standard'} priority`,
    related_id: caseId, related_type: 'case', tone: 'warning'
  });
  logAudit(lc.alert_id, 'Escalated to SAR by L2', performed_by || lc.assigned_to,
    `Case ${caseId}. Priority ${sar_priority || 'Standard'}. ${summary.slice(0, 200)}${summary.length > 200 ? '…' : ''}`);

  res.json({
    l2_case: db.prepare('SELECT * FROM l2_cases WHERE l2_case_id = ?').get(req.params.id),
    case_id: caseId
  });
});

function nextSarCaseId() {
  const row = db.prepare(`SELECT case_id FROM cases ORDER BY id DESC LIMIT 1`).get();
  if (!row) return `CAS-${new Date().getFullYear()}-0001`;
  const m = (row.case_id || '').match(/CAS-(\d{4})-(\d{4})/);
  if (!m) return `CAS-${new Date().getFullYear()}-0001`;
  return `CAS-${m[1]}-${String(parseInt(m[2], 10) + 1).padStart(4, '0')}`;
}

// ─────────────────────────────────────────────── L1 summary (for L2 to review)

router.get('/l1-summary/:alertId', (req, res) => {
  const alert = db.prepare(`
    SELECT a.*, c.customer_name AS cust_name
      FROM alerts a
      LEFT JOIN customers c ON c.customer_id = a.customer_id
     WHERE a.alert_id = ?
  `).get(req.params.alertId);
  if (!alert) return res.status(404).json({ error: 'Alert not found' });

  const notes = db.prepare(`
    SELECT * FROM case_notes WHERE alert_id = ? ORDER BY datetime(timestamp) ASC
  `).all(req.params.alertId);

  const documents = db.prepare(`
    SELECT * FROM case_documents WHERE alert_id = ? ORDER BY datetime(uploaded_at) ASC
  `).all(req.params.alertId);

  // Time L1 spent: from created_date to escalated_at (or last_activity_date)
  const escalatedAt = alert.escalated_to_l2_at || alert.last_activity_date;
  let timeSpentDays = null;
  try {
    if (alert.created_date && escalatedAt) {
      const a = new Date(alert.created_date);
      const b = new Date(escalatedAt.length <= 10 ? escalatedAt : escalatedAt.replace(' ', 'T'));
      timeSpentDays = Math.max(0, Math.round((b - a) / 86400000));
    }
  } catch (_e) {}

  // Checklist completion derived from artefacts
  const checklist = {
    transactions_reviewed: true,
    customer_kyc_checked: true,
    notes_added: notes.length > 0,
    documents_uploaded: documents.length > 0,
    counterparty_research: documents.some(d => /counterparty|screening|adverse/i.test(d.description || '') || /counterparty/i.test(d.document_type || ''))
  };

  // L2 case linked
  const l2 = db.prepare('SELECT * FROM l2_cases WHERE alert_id = ? ORDER BY id DESC LIMIT 1').get(req.params.alertId);

  res.json({
    alert,
    l1_analyst: alert.assigned_to,
    assigned_at: alert.created_date,
    escalated_at: escalatedAt,
    time_spent_days: timeSpentDays,
    final_disposition: alert.disposition,
    notes, documents, checklist,
    escalation_reason: l2?.escalation_reason || null,
    l2_case: l2 || null
  });
});

// ─────────────────────────────────────────────── Counterparty analysis (for L2 Deep Analysis)

router.get('/:id/counterparties', (req, res) => {
  const lc = db.prepare('SELECT * FROM l2_cases WHERE l2_case_id = ?').get(req.params.id);
  if (!lc) return res.status(404).json({ error: 'L2 case not found' });
  const cust = lc.customer_id;
  const rows = db.prepare(`
    SELECT counterparty AS name,
           counterparty_country AS country,
           COUNT(*) AS total_transactions,
           SUM(amount) AS total_amount,
           MIN(txn_date) AS first_seen,
           MAX(txn_date) AS last_seen,
           SUM(is_alerted) AS alerted_count
      FROM transactions
     WHERE customer_id = ?
       AND counterparty IS NOT NULL AND TRIM(counterparty) <> ''
     GROUP BY counterparty, counterparty_country
     ORDER BY total_amount DESC
     LIMIT 50
  `).all(cust);
  res.json(rows);
});

// Linked entities — other customers who transacted with same counterparties
router.get('/:id/linked-entities', (req, res) => {
  const lc = db.prepare('SELECT * FROM l2_cases WHERE l2_case_id = ?').get(req.params.id);
  if (!lc) return res.status(404).json({ error: 'L2 case not found' });
  const rows = db.prepare(`
    SELECT DISTINCT t.customer_id, t.counterparty AS shared_counterparty,
           c.customer_name, c.customer_risk_rating,
           (SELECT COUNT(*) FROM alerts a WHERE a.customer_id = t.customer_id AND a.alert_status NOT IN ('Completed','Closed')) AS open_alerts,
           (SELECT COUNT(*) FROM sar_filings s WHERE s.customer_id = t.customer_id) AS sar_history
      FROM transactions t
      JOIN customers c ON c.customer_id = t.customer_id
     WHERE t.counterparty IN (
       SELECT DISTINCT counterparty FROM transactions
        WHERE customer_id = ? AND counterparty IS NOT NULL
     )
       AND t.customer_id <> ?
     LIMIT 20
  `).all(lc.customer_id, lc.customer_id);
  res.json(rows);
});

// Pattern detection — calculated from real transaction data
router.get('/:id/patterns', (req, res) => {
  const lc = db.prepare('SELECT * FROM l2_cases WHERE l2_case_id = ?').get(req.params.id);
  if (!lc) return res.status(404).json({ error: 'L2 case not found' });

  const txns = db.prepare(`
    SELECT * FROM transactions WHERE customer_id = ? ORDER BY txn_date DESC, txn_time DESC
  `).all(lc.customer_id);
  const patterns = [];

  // 1. Structuring: txns between $9,000-$9,999 in 14-day windows
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

  // 2. Velocity: recent 30 days vs prior 90 days average
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

  // 3. Round amounts
  const rounds = txns.filter(t => t.amount > 0 && t.amount % 5000 === 0);
  if (rounds.length >= 5) {
    const distinct = new Set(rounds.map(t => t.amount));
    patterns.push({
      kind: 'Round Amount Pattern',
      message: `${rounds.length} transactions in exact round amounts (${[...distinct].sort((a,b)=>a-b).slice(0,5).map(a => '$' + a.toLocaleString()).join(', ')}${distinct.size > 5 ? '…' : ''})`,
      severity: 'medium'
    });
  }

  // 4. Counterparty concentration on outbound wires (last 6 months)
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

  // 5. Geographic anomaly — high risk jurisdictions
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
});

// ─────────────────────────────────────────────── Manager stats

router.get('/stats/manager', (_req, res) => {
  const total = db.prepare(`SELECT COUNT(*) AS c FROM l2_cases WHERE status NOT LIKE 'Decision Made%' AND status <> 'Returned to L1'`).get().c;
  const avgDaysRow = db.prepare(`
    SELECT AVG(julianday('now') - julianday(escalated_at)) AS d
      FROM l2_cases
     WHERE status NOT LIKE 'Decision Made%' AND status <> 'Returned to L1'
  `).get();
  const avgDays = avgDaysRow?.d != null ? Math.round(avgDaysRow.d * 10) / 10 : 0;
  const workload = db.prepare(`
    SELECT assigned_to AS analyst, COUNT(*) AS open_cases
      FROM l2_cases
     WHERE assigned_to IS NOT NULL AND TRIM(assigned_to) <> ''
       AND status NOT LIKE 'Decision Made%' AND status <> 'Returned to L1'
     GROUP BY assigned_to
     ORDER BY open_cases DESC
  `).all();
  const recent = db.prepare(`
    SELECT lc.*, a.customer_name
      FROM l2_cases lc
      LEFT JOIN alerts a ON a.alert_id = lc.alert_id
     WHERE lc.decision IS NOT NULL
     ORDER BY datetime(lc.decision_made_at) DESC
     LIMIT 5
  `).all();
  res.json({ total_open: total, avg_days_open: avgDays, workload, recent_decisions: recent });
});

module.exports = router;
