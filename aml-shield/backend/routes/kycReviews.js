const express = require('express');
const path = require('path');
const fs = require('fs');
const { db } = require('../database/db');
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

function notify({ recipient_id, recipient_role, type, title, message, related_id, tone = 'info' }) {
  db.prepare(`
    INSERT INTO notifications (recipient_id, recipient_role, type, title, message, related_id, related_type, tone)
    VALUES (?, ?, ?, ?, ?, ?, 'kyc_review', ?)
  `).run(recipient_id || null, recipient_role, type, title, message, related_id, tone);
}

function ymd(d) { return d.toISOString().slice(0, 10); }
function nowStamp() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }

router.get('/stats', (_req, res) => {
  const today = ymd(new Date());
  const thirty = ymd(new Date(Date.now() + 30 * 86400000));
  const stats = {
    total:        db.prepare("SELECT COUNT(*) AS c FROM kyc_reviews WHERE status NOT IN ('completed','rejected')").get().c,
    overdue:      db.prepare("SELECT COUNT(*) AS c FROM kyc_reviews WHERE status = 'overdue' OR (due_date < ? AND status NOT IN ('completed','rejected'))").get(today).c,
    due_this_month: db.prepare("SELECT COUNT(*) AS c FROM kyc_reviews WHERE due_date BETWEEN ? AND ? AND status NOT IN ('completed','rejected')").get(today, thirty).c,
    in_progress:  db.prepare("SELECT COUNT(*) AS c FROM kyc_reviews WHERE status IN ('assigned','in_progress')").get().c,
    completed_this_month: db.prepare("SELECT COUNT(*) AS c FROM kyc_reviews WHERE status = 'completed' AND substr(completed_at, 1, 7) = strftime('%Y-%m', 'now')").get().c,
    triggered:    db.prepare("SELECT COUNT(*) AS c FROM kyc_reviews WHERE review_type IN ('triggered_sar','triggered_alerts') AND status NOT IN ('completed','rejected')").get().c,
    pending_approval: db.prepare("SELECT COUNT(*) AS c FROM kyc_reviews WHERE status = 'pending_approval'").get().c
  };
  res.json(stats);
});

router.get('/', (req, res) => {
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
  if (status === 'overdue') {
    sql += " AND (r.status = 'overdue' OR (r.due_date < date('now') AND r.status NOT IN ('completed','rejected')))";
  } else if (status === 'due_soon') {
    sql += " AND r.due_date BETWEEN date('now') AND date('now', '+30 days') AND r.status NOT IN ('completed','rejected')";
  } else if (status === 'in_progress') {
    sql += " AND r.status IN ('assigned', 'in_progress', 'pending_approval', 'returned')";
  } else if (status === 'completed') {
    sql += " AND r.status = 'completed'";
  } else if (status) {
    sql += ' AND r.status = ?';
    params.push(status);
  }
  if (assigned_to)  { sql += ' AND r.assigned_to = ?';   params.push(assigned_to); }
  if (customer_id)  { sql += ' AND r.customer_id = ?';   params.push(customer_id); }
  if (type)         { sql += ' AND r.review_type = ?';   params.push(type); }
  if (q) {
    sql += ' AND (c.customer_name LIKE ? OR r.customer_id LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY date(r.due_date) ASC';
  res.json(db.prepare(sql).all(...params).map(deserialize));
});

router.get('/customer/:customer_id/history', (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM kyc_reviews WHERE customer_id = ? ORDER BY id DESC
  `).all(req.params.customer_id);
  res.json(rows.map(deserialize));
});

router.get('/:id', (req, res) => {
  const row = db.prepare(`
    SELECT r.*, c.customer_name, c.customer_risk_rating, c.cdd_level,
           c.customer_type, c.segment, c.last_kyc_review_date, c.next_kyc_due_date,
           c.kyc_review_status, c.exit_status
      FROM kyc_reviews r
      LEFT JOIN customers c ON c.customer_id = r.customer_id
     WHERE r.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Review not found' });

  const customer = row.customer_id ? db.prepare('SELECT * FROM customers WHERE customer_id = ?').get(row.customer_id) : null;
  if (customer) {
    for (const f of ['beneficial_owners', 'directors', 'expected_transaction_types', 'primary_countries']) {
      if (customer[f]) { try { customer[f] = JSON.parse(customer[f]); } catch (_e) { /* keep */ } }
    }
  }
  const accounts = customer ? db.prepare('SELECT * FROM accounts WHERE customer_id = ?').all(customer.customer_id) : [];
  const alerts   = customer ? db.prepare(`
    SELECT alert_id, scenario, alert_status, priority, created_date, disposition, amount_flagged_inr
      FROM alerts WHERE customer_id = ? ORDER BY date(created_date) DESC LIMIT 20
  `).all(customer.customer_id) : [];
  const sars     = customer ? db.prepare(`
    SELECT sar_id, alert_scenario, sar_status, filed_date, draft_created_date, prepared_by, amount_involved_inr
      FROM sar_filings WHERE customer_id = ? ORDER BY date(COALESCE(filed_date, draft_created_date)) DESC LIMIT 20
  `).all(customer.customer_id) : [];
  const documents = db.prepare('SELECT * FROM kyc_review_documents WHERE review_id = ? ORDER BY uploaded_at DESC').all(row.id);
  const previousReviews = customer ? db.prepare(`
    SELECT id, review_type, status, due_date, completed_at, previous_risk_rating, new_risk_rating, recommendation, assigned_to, approved_by
      FROM kyc_reviews WHERE customer_id = ? AND id <> ? ORDER BY id DESC LIMIT 10
  `).all(customer.customer_id, row.id) : [];

  res.json({
    ...deserialize(row),
    customer: customer ? { ...customer, accounts } : null,
    alerts, sars, documents, previous_reviews: previousReviews
  });
});

router.post('/', (req, res) => {
  const { customer_id, review_type, due_date, priority, assigned_to, assigned_by, assigned_note } = req.body;
  if (!customer_id) return res.status(400).json({ error: 'customer_id required' });
  const customer = db.prepare('SELECT * FROM customers WHERE customer_id = ?').get(customer_id);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  const due = due_date || ymd(new Date());
  const status = assigned_to ? 'assigned' : 'pending';
  const info = db.prepare(`
    INSERT INTO kyc_reviews
      (customer_id, review_type, status, priority, due_date, assigned_to, assigned_by, assigned_at, assigned_note,
       previous_risk_rating, previous_cdd_level)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    customer_id, review_type || 'manual', status, priority || 'Normal', due,
    assigned_to || null, assigned_by || null, assigned_to ? nowStamp() : null, assigned_note || null,
    customer.customer_risk_rating, customer.cdd_level
  );
  const row = db.prepare('SELECT * FROM kyc_reviews WHERE id = ?').get(info.lastInsertRowid);
  if (assigned_to) {
    notify({
      recipient_id: assigned_to, recipient_role: 'employee', type: 'kyc_review_assigned',
      title: `KYC review assigned — ${customer.customer_name}`,
      message: `Due ${due}. ${assigned_note || ''}`.trim(),
      related_id: String(row.id), tone: 'info'
    });
  }
  res.status(201).json(row);
});

router.patch('/:id/assign', (req, res) => {
  const { assigned_to, assigned_by, assigned_note, due_date, priority } = req.body;
  if (!assigned_to) return res.status(400).json({ error: 'assigned_to required' });
  const existing = db.prepare(`
    SELECT r.*, c.customer_name FROM kyc_reviews r LEFT JOIN customers c ON c.customer_id = r.customer_id WHERE r.id = ?
  `).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Review not found' });

  db.prepare(`
    UPDATE kyc_reviews
       SET assigned_to = ?, assigned_by = ?, assigned_at = ?, assigned_note = ?,
           due_date = COALESCE(?, due_date), priority = COALESCE(?, priority),
           status = CASE WHEN status IN ('pending', 'overdue') THEN 'assigned' ELSE status END,
           updated_at = ?
     WHERE id = ?
  `).run(assigned_to, assigned_by || null, nowStamp(), assigned_note || null,
         due_date || null, priority || null, nowStamp(), req.params.id);

  notify({
    recipient_id: assigned_to, recipient_role: 'employee', type: 'kyc_review_assigned',
    title: `KYC review assigned — ${existing.customer_name}`,
    message: `Due ${due_date || existing.due_date}. ${assigned_note || ''}`.trim(),
    related_id: String(req.params.id), tone: 'info'
  });
  res.json(db.prepare('SELECT * FROM kyc_reviews WHERE id = ?').get(req.params.id));
});

router.patch('/:id/start', (req, res) => {
  const existing = db.prepare('SELECT * FROM kyc_reviews WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Review not found' });
  if (existing.status === 'in_progress') return res.json(existing);
  db.prepare(`
    UPDATE kyc_reviews SET status = 'in_progress', started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?
  `).run(nowStamp(), nowStamp(), req.params.id);
  res.json(db.prepare('SELECT * FROM kyc_reviews WHERE id = ?').get(req.params.id));
});

router.patch('/:id/save', (req, res) => {
  const existing = db.prepare('SELECT * FROM kyc_reviews WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Review not found' });
  const { checklist, review_findings, new_risk_rating, new_cdd_level, recommendation } = req.body;
  db.prepare(`
    UPDATE kyc_reviews
       SET checklist = COALESCE(?, checklist),
           review_findings = COALESCE(?, review_findings),
           new_risk_rating = COALESCE(?, new_risk_rating),
           new_cdd_level   = COALESCE(?, new_cdd_level),
           recommendation  = COALESCE(?, recommendation),
           updated_at = ?
     WHERE id = ?
  `).run(checklist ? JSON.stringify(checklist) : null,
         review_findings ?? null, new_risk_rating ?? null, new_cdd_level ?? null,
         recommendation ?? null, nowStamp(), req.params.id);
  res.json(deserialize(db.prepare('SELECT * FROM kyc_reviews WHERE id = ?').get(req.params.id)));
});

router.patch('/:id/complete', (req, res) => {
  const existing = db.prepare(`
    SELECT r.*, c.customer_name FROM kyc_reviews r LEFT JOIN customers c ON c.customer_id = r.customer_id WHERE r.id = ?
  `).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Review not found' });

  const { checklist, review_findings, new_risk_rating, new_cdd_level, recommendation, completed_by } = req.body;
  if (!review_findings || review_findings.length < 100) return res.status(400).json({ error: 'review_findings >= 100 chars required' });
  if (!recommendation) return res.status(400).json({ error: 'recommendation required' });
  if (!checklist) return res.status(400).json({ error: 'checklist required' });
  for (const k of CHECKLIST_KEYS) {
    if (!checklist[k]) return res.status(400).json({ error: `Checklist incomplete: ${k}` });
  }
  const docCount = db.prepare('SELECT COUNT(*) AS c FROM kyc_review_documents WHERE review_id = ?').get(req.params.id).c;
  if (docCount === 0) return res.status(400).json({ error: 'At least one supporting document required' });

  db.prepare(`
    UPDATE kyc_reviews
       SET status = 'pending_approval',
           checklist = ?, review_findings = ?, recommendation = ?,
           new_risk_rating = ?, new_cdd_level = ?,
           completed_at = ?, returned_to_analyst = 0, updated_at = ?
     WHERE id = ?
  `).run(JSON.stringify(checklist), review_findings, recommendation,
         new_risk_rating || existing.previous_risk_rating,
         new_cdd_level   || existing.previous_cdd_level,
         nowStamp(), nowStamp(), req.params.id);

  const ratingChanged = (new_risk_rating && new_risk_rating !== existing.previous_risk_rating);
  notify({
    recipient_id: null, recipient_role: 'manager', type: 'kyc_review_submitted',
    title: `KYC review submitted — ${existing.customer_name}${ratingChanged ? ' (rating change)' : ''}`,
    message: `${completed_by || existing.assigned_to} submitted a ${recommendation} recommendation. Awaiting your approval.`,
    related_id: String(req.params.id), tone: ratingChanged ? 'warning' : 'info'
  });

  res.json(deserialize(db.prepare('SELECT * FROM kyc_reviews WHERE id = ?').get(req.params.id)));
});

router.patch('/:id/approve', (req, res) => {
  const existing = db.prepare(`
    SELECT r.*, c.customer_name FROM kyc_reviews r LEFT JOIN customers c ON c.customer_id = r.customer_id WHERE r.id = ?
  `).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Review not found' });
  const approvedBy = req.body.approved_by || 'Compliance Manager';

  const cust = db.prepare('SELECT * FROM customers WHERE customer_id = ?').get(existing.customer_id);
  const newRating = existing.new_risk_rating || cust?.customer_risk_rating;
  const newCdd    = existing.new_cdd_level   || cust?.cdd_level;
  const interval  = intervalDaysForRating(newRating);
  const today     = ymd(new Date());
  const nextDue   = ymd(new Date(Date.now() + interval * 86400000));

  let exitStatus = cust?.exit_status || null;
  if (existing.recommendation === 'exit_customer') exitStatus = 'Pending Exit';

  if (cust) {
    db.prepare(`
      UPDATE customers
         SET customer_risk_rating = ?, cdd_level = ?, last_kyc_review_date = ?,
             next_kyc_due_date = ?, kyc_review_status = 'Current',
             last_review_id = ?, exit_status = ?
       WHERE customer_id = ?
    `).run(newRating, newCdd, today, nextDue, existing.id, exitStatus, existing.customer_id);
  }

  db.prepare(`
    UPDATE kyc_reviews
       SET status = 'completed', approved_by = ?, approved_at = ?, updated_at = ?
     WHERE id = ?
  `).run(approvedBy, nowStamp(), nowStamp(), existing.id);

  if (existing.recommendation === 'escalate_sar') {
    const last = db.prepare("SELECT case_id FROM cases WHERE case_id LIKE 'CASE-%' ORDER BY id DESC LIMIT 1").get();
    let n = 1;
    if (last) {
      const m = String(last.case_id).match(/(\d+)$/);
      if (m) n = parseInt(m[1], 10) + 1;
    }
    const caseId = `CASE-${String(n).padStart(5, '0')}`;
    db.prepare(`
      INSERT INTO cases (case_id, customer_id, customer_name, scenario, case_status, assigned_to, created_date, updated_date)
      VALUES (?, ?, ?, 'KYC Review Escalation', 'Work In Progress', ?, ?, ?)
    `).run(caseId, existing.customer_id, existing.customer_name, existing.assigned_to || null, today, today);
    notify({
      recipient_id: existing.assigned_to, recipient_role: 'employee', type: 'kyc_review_sar_case',
      title: `SAR case opened from KYC review — ${existing.customer_name}`,
      message: `${caseId} created. Open the case to begin the SAR filing.`,
      related_id: caseId, tone: 'warning'
    });
  }

  if (existing.assigned_to) {
    notify({
      recipient_id: existing.assigned_to, recipient_role: 'employee', type: 'kyc_review_approved',
      title: `Your KYC review was approved — ${existing.customer_name}`,
      message: `${approvedBy} approved your review. Next review due ${nextDue}.`,
      related_id: String(existing.id), tone: 'success'
    });
  }

  res.json(db.prepare('SELECT * FROM kyc_reviews WHERE id = ?').get(existing.id));
});

router.patch('/:id/reject', (req, res) => {
  const existing = db.prepare(`
    SELECT r.*, c.customer_name FROM kyc_reviews r LEFT JOIN customers c ON c.customer_id = r.customer_id WHERE r.id = ?
  `).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Review not found' });
  const { reason, comments, rejected_by } = req.body;
  if (!reason) return res.status(400).json({ error: 'reason required' });
  if (!comments || comments.length < 30) return res.status(400).json({ error: 'comments >= 30 chars required' });

  db.prepare(`
    UPDATE kyc_reviews
       SET status = 'returned', rejection_reason = ?, rejection_comments = ?,
           rejected_by = ?, rejected_at = ?, returned_to_analyst = 1, updated_at = ?
     WHERE id = ?
  `).run(reason, comments, rejected_by || 'Compliance Manager', nowStamp(), nowStamp(), existing.id);

  if (existing.assigned_to) {
    notify({
      recipient_id: existing.assigned_to, recipient_role: 'employee', type: 'kyc_review_rejected',
      title: `Your KYC review was returned — ${existing.customer_name}`,
      message: `${reason}: ${comments.slice(0, 120)}`,
      related_id: String(existing.id), tone: 'warning'
    });
  }
  res.json(db.prepare('SELECT * FROM kyc_reviews WHERE id = ?').get(existing.id));
});

router.post('/:id/documents', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const review = db.prepare('SELECT * FROM kyc_reviews WHERE id = ?').get(req.params.id);
  if (!review) {
    fs.unlinkSync(req.file.path);
    return res.status(404).json({ error: 'Review not found' });
  }
  const relPath = path.join('uploads', req.file.filename);
  const info = db.prepare(`
    INSERT INTO kyc_review_documents (review_id, document_name, file_path, document_type, uploaded_by, file_size)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.params.id, req.file.originalname, relPath,
         req.body.document_type || 'Supporting',
         req.body.uploaded_by || review.assigned_to || 'system',
         req.file.size);
  res.status(201).json(db.prepare('SELECT * FROM kyc_review_documents WHERE id = ?').get(info.lastInsertRowid));
});

router.delete('/:id/documents/:docId', (req, res) => {
  const doc = db.prepare('SELECT * FROM kyc_review_documents WHERE id = ? AND review_id = ?').get(req.params.docId, req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  const abs = path.isAbsolute(doc.file_path) ? doc.file_path : path.join(__dirname, '..', doc.file_path);
  if (fs.existsSync(abs)) { try { fs.unlinkSync(abs); } catch (_e) {} }
  db.prepare('DELETE FROM kyc_review_documents WHERE id = ?').run(doc.id);
  res.json({ ok: true });
});

router.get('/:id/documents/:docId/file', (req, res) => {
  const doc = db.prepare('SELECT * FROM kyc_review_documents WHERE id = ? AND review_id = ?').get(req.params.docId, req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  const abs = path.isAbsolute(doc.file_path) ? doc.file_path : path.join(__dirname, '..', doc.file_path);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'File missing' });
  if (req.query.preview === '1') return res.sendFile(abs);
  res.download(abs, doc.document_name);
});

module.exports = router;
