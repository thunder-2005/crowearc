const express = require('express');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const pool = require('../database/db');

const router = express.Router();

router.get('/expiring-soon', async (_req, res, next) => {
  try {
    const cutoff = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
    const result = await pool.query(`
      SELECT * FROM sar_filings
       WHERE retention_expiry_date IS NOT NULL
         AND retention_expiry_date <> ''
         AND retention_expiry_date <= $1
       ORDER BY retention_expiry_date ASC
    `, [cutoff]);
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.get('/', async (req, res, next) => {
  try {
    const { sar_status, retention_status, current_owner, from, to, q, page = 1, pageSize = 50 } = req.query;
    let sql = 'SELECT * FROM sar_filings WHERE 1=1';
    const params = [];
    let n = 0;
    if (sar_status)       { params.push(sar_status);       sql += ` AND sar_status = $${++n}`; }
    if (retention_status) { params.push(retention_status); sql += ` AND retention_status = $${++n}`; }
    if (current_owner)    { params.push(current_owner);    sql += ` AND current_owner = $${++n}`; }
    if (from) { params.push(from); sql += ` AND COALESCE(filed_date, draft_created_date) >= $${++n}`; }
    if (to)   { params.push(to);   sql += ` AND COALESCE(filed_date, draft_created_date) <= $${++n}`; }
    if (q) {
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
      sql += ` AND (sar_id LIKE $${++n} OR customer_name LIKE $${++n} OR case_id LIKE $${++n})`;
    }
    sql += ' ORDER BY latest_activity_date DESC';
    const all = (await pool.query(sql, params)).rows;
    const p = parseInt(page, 10);
    const ps = parseInt(pageSize, 10);
    const start = (p - 1) * ps;
    res.json({ total: all.length, page: p, pageSize: ps, items: all.slice(start, start + ps) });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const idParam = req.params.id;
    const idAsInt = /^\d+$/.test(idParam) ? Number(idParam) : -1;
    const sarResult = await pool.query(
      'SELECT * FROM sar_filings WHERE sar_id = $1 OR id = $2', [idParam, idAsInt]
    );
    const sar = sarResult.rows[0];
    if (!sar) return res.status(404).json({ error: 'SAR not found' });

    const documents = (await pool.query(
      'SELECT * FROM documents WHERE sar_id = $1 ORDER BY uploaded_at DESC', [sar.sar_id]
    )).rows;
    const audit_trail = (await pool.query(
      'SELECT * FROM audit_trail WHERE sar_id = $1 ORDER BY timestamp DESC', [sar.sar_id]
    )).rows;
    const source_alert = sar.source_alert_id
      ? (await pool.query('SELECT * FROM alerts WHERE alert_id = $1', [sar.source_alert_id])).rows[0] || null
      : null;
    const linked_case = sar.case_id
      ? (await pool.query('SELECT * FROM cases WHERE case_id = $1', [sar.case_id])).rows[0] || null
      : null;
    const triggeredReview = (await pool.query(`
      SELECT id, status, due_date, assigned_to, recommendation
        FROM kyc_reviews WHERE triggered_by_sar_id = $1
       ORDER BY id DESC LIMIT 1
    `, [sar.sar_id])).rows[0] || null;
    const customer = sar.customer_id
      ? (await pool.query(`
          SELECT customer_id, customer_name, customer_risk_rating, cdd_level,
                 kyc_review_status, last_kyc_review_date, next_kyc_due_date, exit_status
            FROM customers WHERE customer_id = $1
        `, [sar.customer_id])).rows[0] || null
      : null;

    res.json({
      ...sar, documents, audit_trail, source_alert, linked_case, customer,
      kyc_review_id: triggeredReview ? triggeredReview.id : null,
      triggered_kyc_review: triggeredReview || null
    });
  } catch (err) { next(err); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const idParam = req.params.id;
    const idAsInt = /^\d+$/.test(idParam) ? Number(idParam) : -1;
    const existingResult = await pool.query(
      'SELECT * FROM sar_filings WHERE sar_id = $1 OR id = $2', [idParam, idAsInt]
    );
    const existing = existingResult.rows[0];
    if (!existing) return res.status(404).json({ error: 'SAR not found' });

    const allowed = ['sar_status', 'narrative_summary', 'approved_by', 'reviewed_by',
                     'current_owner', 'retention_status', 'law_enforcement_hold',
                     'regulator_reference', 'access_classification'];
    const sets = [];
    const params = [];
    let n = 0;
    for (const f of allowed) {
      if (req.body[f] !== undefined) {
        params.push(req.body[f]);
        sets.push(`${f} = $${++n}`);
      }
    }
    if (sets.length === 0) return res.json(existing);

    params.push(new Date().toISOString().slice(0, 10));
    sets.push(`latest_activity_date = $${++n}`);
    params.push(existing.sar_id);
    await pool.query(`UPDATE sar_filings SET ${sets.join(', ')} WHERE sar_id = $${++n}`, params);

    await pool.query(`
      INSERT INTO audit_trail (sar_id, action, performed_by, details)
      VALUES ($1, 'SAR Updated', $2, $3)
    `, [existing.sar_id, req.body.performed_by || 'system', JSON.stringify(req.body)]);

    const sel = await pool.query('SELECT * FROM sar_filings WHERE sar_id = $1', [existing.sar_id]);
    res.json(sel.rows[0]);
  } catch (err) { next(err); }
});

router.get('/:id/export', async (req, res, next) => {
  try {
    const idParam = req.params.id;
    const idAsInt = /^\d+$/.test(idParam) ? Number(idParam) : -1;
    const sarResult = await pool.query(
      'SELECT * FROM sar_filings WHERE sar_id = $1 OR id = $2', [idParam, idAsInt]
    );
    const sar = sarResult.rows[0];
    if (!sar) return res.status(404).json({ error: 'SAR not found' });
    const documents = (await pool.query('SELECT * FROM documents WHERE sar_id = $1', [sar.sar_id])).rows;
    const audit = (await pool.query(
      'SELECT * FROM audit_trail WHERE sar_id = $1 ORDER BY timestamp DESC', [sar.sar_id]
    )).rows;

    const requester = req.query.requested_by || 'system';
    const purpose = req.query.purpose || 'Export Package';
    const now = new Date().toISOString();
    await pool.query(`
      INSERT INTO retrieval_log (sar_id, requested_by, request_purpose, requested_at, exported_at)
      VALUES ($1, $2, $3, $4, $5)
    `, [sar.sar_id, requester, purpose, now, now]);
    await pool.query(`
      INSERT INTO audit_trail (sar_id, action, performed_by, details)
      VALUES ($1, 'Export Package Generated', $2, $3)
    `, [sar.sar_id, requester, purpose]);
    await pool.query(`
      UPDATE sar_filings
         SET export_count = COALESCE(export_count, 0) + 1,
             last_exported_at = $1,
             latest_activity_date = $2
       WHERE sar_id = $3
    `, [now.slice(0, 10), now.slice(0, 10), sar.sar_id]);

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
  } catch (err) { next(err); }
});

module.exports = router;
