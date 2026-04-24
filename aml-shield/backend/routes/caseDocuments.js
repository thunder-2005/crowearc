const express = require('express');
const path = require('path');
const fs = require('fs');
const { db } = require('../database/db');
const { upload } = require('../middleware/upload');

const router = express.Router();

router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { alert_id, document_type, description, uploaded_by } = req.body;
  if (!alert_id) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'alert_id is required' });
  }
  const alert = db.prepare('SELECT alert_id FROM alerts WHERE alert_id = ?').get(alert_id);
  if (!alert) {
    fs.unlinkSync(req.file.path);
    return res.status(404).json({ error: 'Alert not found' });
  }

  const relPath = path.join('uploads', req.file.filename);
  const info = db.prepare(`
    INSERT INTO case_documents (alert_id, file_name, file_path, document_type, description, uploaded_by, file_size)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(alert_id, req.file.originalname, relPath, document_type || 'Other',
         description || null, uploaded_by || 'system', req.file.size);

  db.prepare(`
    INSERT INTO case_notes (alert_id, note_text, analyst, timestamp)
    VALUES (?, ?, ?, datetime('now'))
  `).run(alert_id, `Uploaded evidence: ${req.file.originalname} (${document_type || 'Other'})`,
         uploaded_by || 'system');

  const row = db.prepare('SELECT * FROM case_documents WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(row);
});

router.get('/:alert_id', (req, res) => {
  res.json(db.prepare(
    'SELECT * FROM case_documents WHERE alert_id = ? ORDER BY uploaded_at DESC'
  ).all(req.params.alert_id));
});

router.get('/file/:id', (req, res) => {
  const doc = db.prepare('SELECT * FROM case_documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  const abs = path.isAbsolute(doc.file_path)
    ? doc.file_path
    : path.join(__dirname, '..', doc.file_path);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'File missing on disk' });
  if (req.query.preview === '1') return res.sendFile(abs);
  res.download(abs, doc.file_name);
});

router.delete('/:id', (req, res) => {
  const doc = db.prepare('SELECT * FROM case_documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  const abs = path.isAbsolute(doc.file_path)
    ? doc.file_path
    : path.join(__dirname, '..', doc.file_path);
  if (fs.existsSync(abs)) { try { fs.unlinkSync(abs); } catch (_e) {} }
  db.prepare('DELETE FROM case_documents WHERE id = ?').run(req.params.id);
  db.prepare(`
    INSERT INTO case_notes (alert_id, note_text, analyst, timestamp)
    VALUES (?, ?, ?, datetime('now'))
  `).run(doc.alert_id, `Removed evidence: ${doc.file_name}`, req.query.user || 'system');
  res.json({ ok: true });
});

module.exports = router;
