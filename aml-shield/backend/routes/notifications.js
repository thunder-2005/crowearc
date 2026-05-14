const express = require('express');
const pool = require('../database/db');
const { requireAnyAnalyst } = require('../middleware/roleGuard');

const router = express.Router();

async function listManagerNotifications(limit = 50) {
  const result = await pool.query(`
    SELECT * FROM notifications
     WHERE recipient_role = 'manager'
     ORDER BY created_at DESC
     LIMIT $1
  `, [limit]);
  return result.rows;
}

async function listUserNotifications(userId, limit = 50) {
  const result = await pool.query(`
    SELECT * FROM notifications
     WHERE recipient_id = $1
     ORDER BY created_at DESC
     LIMIT $2
  `, [userId, limit]);
  return result.rows;
}

router.get('/manager', async (_req, res, next) => {
  try { res.json(await listManagerNotifications()); }
  catch (err) { next(err); }
});

router.get('/unread/manager', async (_req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT * FROM notifications
       WHERE recipient_role = 'manager' AND is_read = 0
       ORDER BY created_at DESC
       LIMIT 50
    `);
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.get('/unread/user/:userId', async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT * FROM notifications
       WHERE recipient_id = $1 AND is_read = 0
       ORDER BY created_at DESC
       LIMIT 50
    `, [req.params.userId]);
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.get('/user/:userId', async (req, res, next) => {
  try { res.json(await listUserNotifications(req.params.userId)); }
  catch (err) { next(err); }
});

router.get('/unread-count/manager', async (_req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT COUNT(*) AS c FROM notifications
       WHERE recipient_role = 'manager' AND is_read = 0
    `);
    res.json({ count: Number(result.rows[0].c) });
  } catch (err) { next(err); }
});

router.get('/unread-count/user/:userId', async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT COUNT(*) AS c FROM notifications
       WHERE recipient_id = $1 AND is_read = 0
    `, [req.params.userId]);
    res.json({ count: Number(result.rows[0].c) });
  } catch (err) { next(err); }
});

router.patch('/:id/read', async (req, res, next) => {
  try {
    const upd = await pool.query('UPDATE notifications SET is_read = 1 WHERE id = $1', [req.params.id]);
    if (upd.rowCount === 0) return res.status(404).json({ error: 'Notification not found' });
    const sel = await pool.query('SELECT * FROM notifications WHERE id = $1', [req.params.id]);
    res.json(sel.rows[0]);
  } catch (err) { next(err); }
});

router.patch('/read-all/manager', async (_req, res, next) => {
  try {
    await pool.query('UPDATE notifications SET is_read = 1 WHERE recipient_role = $1 AND is_read = 0', ['manager']);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.patch('/read-all/user/:userId', async (req, res, next) => {
  try {
    await pool.query('UPDATE notifications SET is_read = 1 WHERE recipient_id = $1 AND is_read = 0', [req.params.userId]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/', requireAnyAnalyst, async (req, res, next) => {
  try {
    const { recipient_id, recipient_role, type, title, message, related_id, related_type, tone } = req.body;
    if (!recipient_role || !type || !title) {
      return res.status(400).json({ error: 'recipient_role, type and title required' });
    }
    const result = await pool.query(`
      INSERT INTO notifications (recipient_id, recipient_role, type, title, message, related_id, related_type, tone)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *
    `, [recipient_id || null, recipient_role, type, title, message || '', related_id || null, related_type || null, tone || 'info']);
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
