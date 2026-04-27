const express = require('express');
const { db } = require('../database/db');

const router = express.Router();

function listManagerNotifications(limit = 50) {
  return db.prepare(`
    SELECT * FROM notifications
     WHERE recipient_role = 'manager'
     ORDER BY datetime(created_at) DESC
     LIMIT ?
  `).all(limit);
}

function listUserNotifications(userId, limit = 50) {
  return db.prepare(`
    SELECT * FROM notifications
     WHERE recipient_id = ?
     ORDER BY datetime(created_at) DESC
     LIMIT ?
  `).all(userId, limit);
}

router.get('/manager', (_req, res) => {
  res.json(listManagerNotifications());
});

router.get('/unread/manager', (_req, res) => {
  res.json(db.prepare(`
    SELECT * FROM notifications
     WHERE recipient_role = 'manager' AND is_read = 0
     ORDER BY datetime(created_at) DESC
     LIMIT 50
  `).all());
});

router.get('/unread/user/:userId', (req, res) => {
  res.json(db.prepare(`
    SELECT * FROM notifications
     WHERE recipient_id = ? AND is_read = 0
     ORDER BY datetime(created_at) DESC
     LIMIT 50
  `).all(req.params.userId));
});

router.get('/user/:userId', (req, res) => {
  res.json(listUserNotifications(req.params.userId));
});

router.get('/unread-count/manager', (_req, res) => {
  const c = db.prepare(`
    SELECT COUNT(*) AS c FROM notifications
     WHERE recipient_role = 'manager' AND is_read = 0
  `).get().c;
  res.json({ count: c });
});

router.get('/unread-count/user/:userId', (req, res) => {
  const c = db.prepare(`
    SELECT COUNT(*) AS c FROM notifications
     WHERE recipient_id = ? AND is_read = 0
  `).get(req.params.userId).c;
  res.json({ count: c });
});

router.patch('/:id/read', (req, res) => {
  const info = db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Notification not found' });
  res.json(db.prepare('SELECT * FROM notifications WHERE id = ?').get(req.params.id));
});

router.patch('/read-all/manager', (_req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE recipient_role = ? AND is_read = 0').run('manager');
  res.json({ ok: true });
});

router.patch('/read-all/user/:userId', (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE recipient_id = ? AND is_read = 0').run(req.params.userId);
  res.json({ ok: true });
});

router.post('/', (req, res) => {
  const { recipient_id, recipient_role, type, title, message, related_id, related_type, tone } = req.body;
  if (!recipient_role || !type || !title) {
    return res.status(400).json({ error: 'recipient_role, type and title required' });
  }
  const info = db.prepare(`
    INSERT INTO notifications (recipient_id, recipient_role, type, title, message, related_id, related_type, tone)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(recipient_id || null, recipient_role, type, title, message || '', related_id || null, related_type || null, tone || 'info');
  res.status(201).json(db.prepare('SELECT * FROM notifications WHERE id = ?').get(info.lastInsertRowid));
});

module.exports = router;
