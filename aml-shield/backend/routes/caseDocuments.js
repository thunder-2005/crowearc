const express = require('express');
const pool = require('../database/db');
const { upload } = require('../middleware/upload');
const { logAudit, ENTITY_TYPES } = require('../utils/audit');
const { requireAnyAnalyst } = require('../middleware/roleGuard');
const { uploadFile, deleteFile, getSignedUrl } = require('../utils/supabaseStorage');

const router = express.Router();

router.post('/upload', requireAnyAnalyst, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { alert_id, document_type, description, uploaded_by } = req.body;
    if (!alert_id) return res.status(400).json({ error: 'alert_id is required' });
    const alert = await pool.query('SELECT alert_id FROM alerts WHERE alert_id = $1', [alert_id]);
    if (!alert.rows[0]) return res.status(404).json({ error: 'Alert not found' });

    const { filePath } = await uploadFile(
      req.file.buffer, req.file.originalname, req.file.mimetype, 'alerts'
    );
    const ins = await pool.query(`
      INSERT INTO case_documents (alert_id, file_name, file_path, document_type, description, uploaded_by, file_size)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
    `, [alert_id, req.file.originalname, filePath, document_type || 'Other',
        description || null, uploaded_by || 'system', req.file.size]);

    await pool.query(`
      INSERT INTO case_notes (alert_id, note_text, analyst, timestamp)
      VALUES ($1, $2, $3, NOW())
    `, [alert_id, `Uploaded evidence: ${req.file.originalname} (${document_type || 'Other'})`,
        uploaded_by || 'system']);

    await logAudit({
      entity_type: ENTITY_TYPES.ALERT, entity_id: alert_id,
      action: `Document uploaded — ${req.file.originalname}`,
      performed_by: uploaded_by || 'system',
      details: document_type || null
    });

    res.status(201).json(ins.rows[0]);
  } catch (err) { next(err); }
});

router.get('/:alert_id', async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT * FROM case_documents WHERE alert_id = $1 ORDER BY uploaded_at DESC',
      [req.params.alert_id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.get('/file/:id', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM case_documents WHERE id = $1', [req.params.id]);
    const doc = result.rows[0];
    if (!doc) return res.status(404).json({ error: 'Not found' });
    if (!doc.file_path) return res.status(404).json({ error: 'File missing' });
    const url = await getSignedUrl(doc.file_path);
    res.redirect(url);
  } catch (err) { next(err); }
});

router.delete('/:id', requireAnyAnalyst, async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM case_documents WHERE id = $1', [req.params.id]);
    const doc = result.rows[0];
    if (!doc) return res.status(404).json({ error: 'Not found' });

    // Only the original uploader or a manager can delete.
    const requesterRole = req.headers['x-user-role'];
    const requesterName = req.headers['x-user-name'];
    if (requesterRole !== 'compliance_manager' && doc.uploaded_by && requesterName !== doc.uploaded_by) {
      return res.status(403).json({ error: 'Only the uploader or a manager can delete this document' });
    }

    if (doc.file_path) {
      try { await deleteFile(doc.file_path); } catch (e) { console.warn('[caseDocuments] supabase delete failed:', e.message); }
    }
    await pool.query('DELETE FROM case_documents WHERE id = $1', [req.params.id]);
    await pool.query(`
      INSERT INTO case_notes (alert_id, note_text, analyst, timestamp)
      VALUES ($1, $2, $3, NOW())
    `, [doc.alert_id, `Removed evidence: ${doc.file_name}`, req.query.user || 'system']);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
