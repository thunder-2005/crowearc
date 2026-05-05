const express = require('express');
const pool = require('../database/db');

const router = express.Router();

// Demo-grade login. Plain-text password compare; no JWT/session.
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'username and password required' });
    }
    const result = await pool.query(
      `SELECT id, user_id, name, username, role, team, avatar_color, email
         FROM user_profiles
        WHERE username = $1 AND password = $2 AND status = 'Active'`,
      [username, password]
    );
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    res.json({
      success: true,
      user: {
        id: user.id,
        user_id: user.user_id,
        name: user.name,
        username: user.username,
        role: user.role,
        team: user.team,
        avatar_color: user.avatar_color,
        email: user.email
      }
    });
  } catch (err) { next(err); }
});

router.post('/logout', (_req, res) => {
  res.json({ success: true });
});

router.get('/me', async (req, res, next) => {
  try {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id query param required' });
    const idAsInt = /^\d+$/.test(String(id)) ? Number(id) : -1;
    const result = await pool.query(
      `SELECT id, user_id, name, username, role, team, avatar_color, email, status
         FROM user_profiles
        WHERE id = $1 OR user_id = $2 OR name = $2`,
      [idAsInt, String(id)]
    );
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) { next(err); }
});

module.exports = router;
