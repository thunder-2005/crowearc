const express = require('express');
const path = require('path');
const fs = require('fs');
const { db } = require('../database/db');
const { upload } = require('../middleware/upload');

const router = express.Router();

router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { sar_id, document_type, uploaded_by } = req.body;
  if (!sar_id) return res.status(400).json({ error: 'sar_id is required' });

  const sar = db.prepare('SELECT sar_id FROM sar_filings WHERE sar_id = ?').get(sar_id);
  if (!sar) {
    fs.unlinkSync(req.file.path);
    return res.status(404).json({ error: 'SAR not found' });
  }

  const relPath = path.join('uploads', req.file.filename);
  const info = db.prepare(`
    INSERT INTO documents (sar_id, document_name, document_type, file_path, file_size, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sar_id, req.file.originalname, document_type || null, relPath,
         req.file.size, uploaded_by || 'system');

  db.prepare(`
    INSERT INTO audit_trail (sar_id, action, performed_by, details)
    VALUES (?, 'Document Uploaded', ?, ?)
  `).run(sar_id, uploaded_by || 'system', req.file.originalname);

  db.prepare(`
    UPDATE sar_filings
       SET documents_count = (SELECT COUNT(*) FROM documents WHERE sar_id = ?),
           latest_activity_date = ?
     WHERE sar_id = ?
  `).run(sar_id, new Date().toISOString().slice(0, 10), sar_id);

  const row = db.prepare('SELECT * FROM documents WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(row);
});

router.get('/:id', (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });

  const abs = path.isAbsolute(doc.file_path)
    ? doc.file_path
    : path.join(__dirname, '..', doc.file_path);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'File missing on disk' });

  db.prepare(`
    INSERT INTO audit_trail (sar_id, action, performed_by, details)
    VALUES (?, 'Document Downloaded', ?, ?)
  `).run(doc.sar_id, req.query.user || 'system', doc.document_name);

  res.download(abs, doc.document_name);
});

router.delete('/:id', (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });

  const abs = path.isAbsolute(doc.file_path)
    ? doc.file_path
    : path.join(__dirname, '..', doc.file_path);
  if (fs.existsSync(abs)) { try { fs.unlinkSync(abs); } catch (_e) {} }

  db.prepare('DELETE FROM documents WHERE id = ?').run(req.params.id);
  db.prepare(`
    INSERT INTO audit_trail (sar_id, action, performed_by, details)
    VALUES (?, 'Document Deleted', ?, ?)
  `).run(doc.sar_id, req.query.user || 'system', doc.document_name);

  db.prepare(`
    UPDATE sar_filings
       SET documents_count = (SELECT COUNT(*) FROM documents WHERE sar_id = ?)
     WHERE sar_id = ?
  `).run(doc.sar_id, doc.sar_id);

  res.json({ ok: true });
});

module.exports = router;
