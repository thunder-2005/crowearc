const express = require('express');
const pool = require('../database/db');
const { upload } = require('../middleware/upload');
const { requireAnyAnalyst } = require('../middleware/roleGuard');
const { uploadFile, deleteFile, getSignedUrl } = require('../utils/supabaseStorage');

const router = express.Router();

router.post('/upload', requireAnyAnalyst, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { sar_id, document_type, uploaded_by } = req.body;
    if (!sar_id) return res.status(400).json({ error: 'sar_id is required' });

    const sar = await pool.query('SELECT sar_id FROM sar_filings WHERE sar_id = $1', [sar_id]);
    if (!sar.rows[0]) return res.status(404).json({ error: 'SAR not found' });

    const { filePath } = await uploadFile(
      req.file.buffer, req.file.originalname, req.file.mimetype, 'sar'
    );
    const ins = await pool.query(`
      INSERT INTO documents (sar_id, document_name, document_type, file_path, file_size, uploaded_by)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
    `, [sar_id, req.file.originalname, document_type || null, filePath,
        req.file.size, uploaded_by || 'system']);

    await pool.query(`
      INSERT INTO audit_trail (entity_type, sar_id, action, performed_by, details)
      VALUES ('sar', $1, $2, $3, $4)
    `, [sar_id, `Document attached — ${req.file.originalname} (${document_type || 'Other'})`,
        uploaded_by || 'system', req.file.originalname]);

    await pool.query(`
      UPDATE sar_filings
         SET documents_count = (SELECT COUNT(*) FROM documents WHERE sar_id = $1),
             latest_activity_date = $2
       WHERE sar_id = $3
    `, [sar_id, new Date().toISOString().slice(0, 10), sar_id]);

    res.status(201).json(ins.rows[0]);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
    const doc = result.rows[0];
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    if (!doc.file_path) return res.status(404).json({ error: 'File missing' });

    await pool.query(`
      INSERT INTO audit_trail (entity_type, sar_id, action, performed_by, details)
      VALUES ('sar', $1, 'Document Downloaded', $2, $3)
    `, [doc.sar_id, req.query.user || 'system', doc.document_name]);

    const url = await getSignedUrl(doc.file_path);
    res.redirect(url);
  } catch (err) { next(err); }
});

router.delete('/:id', requireAnyAnalyst, async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
    const doc = result.rows[0];
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    // Only the original uploader or a manager can delete.
    const requesterRole = req.headers['x-user-role'];
    const requesterName = req.headers['x-user-name'];
    if (requesterRole !== 'compliance_manager' && doc.uploaded_by && requesterName !== doc.uploaded_by) {
      return res.status(403).json({ error: 'Only the uploader or a manager can delete this document' });
    }

    if (doc.file_path) {
      try { await deleteFile(doc.file_path); } catch (e) { console.warn('[documents] supabase delete failed:', e.message); }
    }

    await pool.query('DELETE FROM documents WHERE id = $1', [req.params.id]);
    await pool.query(`
      INSERT INTO audit_trail (entity_type, sar_id, action, performed_by, details)
      VALUES ('sar', $1, 'Document Deleted', $2, $3)
    `, [doc.sar_id, req.query.user || 'system', doc.document_name]);

    await pool.query(`
      UPDATE sar_filings
         SET documents_count = (SELECT COUNT(*) FROM documents WHERE sar_id = $1)
       WHERE sar_id = $2
    `, [doc.sar_id, doc.sar_id]);

    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
