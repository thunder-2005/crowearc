const express = require('express');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const { db } = require('../database/db');

const router = express.Router();

router.get('/expiring-soon', (_req, res) => {
  const cutoff = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT * FROM sar_filings
     WHERE retention_expiry_date IS NOT NULL
       AND retention_expiry_date <> ''
       AND retention_expiry_date <= ?
     ORDER BY retention_expiry_date ASC
  `).all(cutoff);
  res.json(rows);
});

router.get('/', (req, res) => {
  const { sar_status, retention_status, current_owner, from, to, q, page = 1, pageSize = 50 } = req.query;
  let sql = 'SELECT * FROM sar_filings WHERE 1=1';
  const params = [];
  if (sar_status)       { sql += ' AND sar_status = ?';       params.push(sar_status); }
  if (retention_status) { sql += ' AND retention_status = ?'; params.push(retention_status); }
  if (current_owner)    { sql += ' AND current_owner = ?';    params.push(current_owner); }
  if (from) { sql += ' AND COALESCE(filed_date, draft_created_date) >= ?'; params.push(from); }
  if (to)   { sql += ' AND COALESCE(filed_date, draft_created_date) <= ?'; params.push(to); }
  if (q) {
    sql += ' AND (sar_id LIKE ? OR customer_name LIKE ? OR case_id LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY latest_activity_date DESC';
  const all = db.prepare(sql).all(...params);
  const p = parseInt(page, 10);
  const ps = parseInt(pageSize, 10);
  const start = (p - 1) * ps;
  res.json({ total: all.length, page: p, pageSize: ps, items: all.slice(start, start + ps) });
});

router.get('/:id', (req, res) => {
  const sar = db.prepare('SELECT * FROM sar_filings WHERE sar_id = ? OR id = ?')
    .get(req.params.id, req.params.id);
  if (!sar) return res.status(404).json({ error: 'SAR not found' });

  const documents = db.prepare('SELECT * FROM documents WHERE sar_id = ? ORDER BY uploaded_at DESC')
    .all(sar.sar_id);
  const audit_trail = db.prepare('SELECT * FROM audit_trail WHERE sar_id = ? ORDER BY timestamp DESC')
    .all(sar.sar_id);
  const source_alert = sar.source_alert_id
    ? db.prepare('SELECT * FROM alerts WHERE alert_id = ?').get(sar.source_alert_id)
    : null;
  const linked_case = sar.case_id
    ? db.prepare('SELECT * FROM cases WHERE case_id = ?').get(sar.case_id)
    : null;
  const triggeredReview = db.prepare(`
    SELECT id, status, due_date, assigned_to, recommendation
      FROM kyc_reviews WHERE triggered_by_sar_id = ?
     ORDER BY id DESC LIMIT 1
  `).get(sar.sar_id);
  const customer = sar.customer_id
    ? db.prepare(`
        SELECT customer_id, customer_name, customer_risk_rating, cdd_level,
               kyc_review_status, last_kyc_review_date, next_kyc_due_date, exit_status
          FROM customers WHERE customer_id = ?
      `).get(sar.customer_id)
    : null;

  res.json({
    ...sar, documents, audit_trail, source_alert, linked_case, customer,
    kyc_review_id: triggeredReview ? triggeredReview.id : null,
    triggered_kyc_review: triggeredReview || null
  });
});

router.patch('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM sar_filings WHERE sar_id = ? OR id = ?')
    .get(req.params.id, req.params.id);
  if (!existing) return res.status(404).json({ error: 'SAR not found' });

  const allowed = ['sar_status', 'narrative_summary', 'approved_by', 'reviewed_by',
                   'current_owner', 'retention_status', 'law_enforcement_hold',
                   'regulator_reference', 'access_classification'];
  const sets = [];
  const params = [];
  for (const f of allowed) {
    if (req.body[f] !== undefined) { sets.push(`${f} = ?`); params.push(req.body[f]); }
  }
  if (sets.length === 0) return res.json(existing);

  sets.push('latest_activity_date = ?');
  params.push(new Date().toISOString().slice(0, 10));
  params.push(existing.sar_id);
  db.prepare(`UPDATE sar_filings SET ${sets.join(', ')} WHERE sar_id = ?`).run(...params);

  db.prepare(`
    INSERT INTO audit_trail (sar_id, action, performed_by, details)
    VALUES (?, 'SAR Updated', ?, ?)
  `).run(existing.sar_id, req.body.performed_by || 'system', JSON.stringify(req.body));

  res.json(db.prepare('SELECT * FROM sar_filings WHERE sar_id = ?').get(existing.sar_id));
});

router.get('/:id/export', (req, res) => {
  const sar = db.prepare('SELECT * FROM sar_filings WHERE sar_id = ? OR id = ?')
    .get(req.params.id, req.params.id);
  if (!sar) return res.status(404).json({ error: 'SAR not found' });
  const documents = db.prepare('SELECT * FROM documents WHERE sar_id = ?').all(sar.sar_id);
  const audit = db.prepare('SELECT * FROM audit_trail WHERE sar_id = ? ORDER BY timestamp DESC')
    .all(sar.sar_id);

  const requester = req.query.requested_by || 'system';
  const purpose = req.query.purpose || 'Export Package';
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO retrieval_log (sar_id, requested_by, request_purpose, requested_at, exported_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(sar.sar_id, requester, purpose, now, now);
  db.prepare(`
    INSERT INTO audit_trail (sar_id, action, performed_by, details)
    VALUES (?, 'Export Package Generated', ?, ?)
  `).run(sar.sar_id, requester, purpose);
  db.prepare(`
    UPDATE sar_filings
       SET export_count = COALESCE(export_count, 0) + 1,
           last_exported_at = ?,
           latest_activity_date = ?
     WHERE sar_id = ?
  `).run(now.slice(0, 10), now.slice(0, 10), sar.sar_id);

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${sar.sar_id}_export.zip"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', err => { throw err; });
  archive.pipe(res);

  archive.append(JSON.stringify({ ...sar, documents, audit_trail: audit }, null, 2),
    { name: `${sar.sar_id}_metadata.json` });

  const readable = [
    `AML SHIELD — SAR EXPORT PACKAGE`,
    `Generated:       ${now}`,
    `Requested by:    ${requester}`,
    `Purpose:         ${purpose}`,
    ``,
    `SAR ID:          ${sar.sar_id}`,
    `Case ID:         ${sar.case_id || '-'}`,
    `Source Alert:    ${sar.source_alert_id || '-'}`,
    `Customer:        ${sar.customer_name} (${sar.customer_id || '-'})`,
    `Scenario:        ${sar.alert_scenario || '-'}`,
    `Status:          ${sar.sar_status}`,
    `Detection Date:  ${sar.detection_date || '-'}`,
    `Draft Created:   ${sar.draft_created_date || '-'}`,
    `Filed Date:      ${sar.filed_date || '-'}`,
    `Acknowledged:    ${sar.acknowledged_date || '-'}`,
    `Prepared By:     ${sar.prepared_by || '-'}`,
    `Reviewed By:     ${sar.reviewed_by || '-'}`,
    `Approved By:     ${sar.approved_by || '-'}`,
    `Jurisdiction:    ${sar.reporting_jurisdiction || '-'}`,
    `Regulator Ref:   ${sar.regulator_reference || '-'}`,
    `Retention:       ${sar.retention_status || '-'} (expires ${sar.retention_expiry_date || '-'})`,
    `Legal Hold:      ${sar.law_enforcement_hold ? 'YES' : 'no'}`,
    `Amount (USD):    ${sar.amount_involved_inr}`,
    ``,
    `NARRATIVE`,
    `---------`,
    sar.narrative_summary || '(none)',
    ``,
    `SUPPORTING DOCUMENTS (${documents.length})`,
    ...documents.map(d => ` - ${d.document_name} [${d.document_type || '?'}] ${d.file_size} bytes`),
    ``,
    `AUDIT TRAIL (${audit.length} events)`,
    ...audit.map(a => ` - ${a.timestamp}  ${a.action}  by ${a.performed_by || '-'}  ${a.details || ''}`)
  ].join('\n');
  archive.append(readable, { name: `${sar.sar_id}_summary.txt` });

  for (const doc of documents) {
    const abs = path.isAbsolute(doc.file_path)
      ? doc.file_path
      : path.join(__dirname, '..', doc.file_path);
    if (fs.existsSync(abs)) {
      archive.file(abs, { name: `documents/${doc.document_name}` });
    }
  }

  archive.finalize();
});

module.exports = router;
