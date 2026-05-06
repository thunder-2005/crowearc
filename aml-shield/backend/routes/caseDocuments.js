const express = require('express');
const path = require('path');
const fs = require('fs');
const pool = require('../database/db');
const { upload } = require('../middleware/upload');
const { logAudit, ENTITY_TYPES } = require('../utils/audit');
const { requireAnyAnalyst } = require('../middleware/roleGuard');

const router = express.Router();

router.post('/upload', requireAnyAnalyst, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { alert_id, document_type, description, uploaded_by } = req.body;
    if (!alert_id) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'alert_id is required' });
    }
    const alert = await pool.query('SELECT alert_id FROM alerts WHERE alert_id = $1', [alert_id]);
    if (!alert.rows[0]) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Alert not found' });
    }

    const relPath = path.join('uploads', req.file.filename);
    const ins = await pool.query(`
      INSERT INTO case_documents (alert_id, file_name, file_path, document_type, description, uploaded_by, file_size)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
    `, [alert_id, req.file.originalname, relPath, document_type || 'Other',
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
    const abs = path.isAbsolute(doc.file_path)
      ? doc.file_path
      : path.join(__dirname, '..', doc.file_path);
    if (!fs.existsSync(abs)) return res.status(404).json({ error: 'File missing on disk' });
    if (req.query.preview === '1') return res.sendFile(abs);
    res.download(abs, doc.file_name);
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

    const abs = path.isAbsolute(doc.file_path)
      ? doc.file_path
      : path.join(__dirname, '..', doc.file_path);
    if (fs.existsSync(abs)) { try { fs.unlinkSync(abs); } catch (_e) {} }
    await pool.query('DELETE FROM case_documents WHERE id = $1', [req.params.id]);
    await pool.query(`
      INSERT INTO case_notes (alert_id, note_text, analyst, timestamp)
      VALUES ($1, $2, $3, NOW())
    `, [doc.alert_id, `Removed evidence: ${doc.file_name}`, req.query.user || 'system']);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
