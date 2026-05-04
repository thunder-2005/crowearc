const express = require('express');
const pool = require('../database/db');
const { MANAGER_DEFAULTS, EMPLOYEE_DEFAULTS } = require('../database/admin_defaults');

const router = express.Router();

function readKV(row) {
  try { return JSON.parse(row.setting_value); } catch (_e) { return row.setting_value; }
}

async function loadManager() {
  const result = await pool.query('SELECT setting_key, setting_value FROM manager_settings');
  const stored = Object.fromEntries(result.rows.map(r => [r.setting_key, readKV(r)]));
  return { ...MANAGER_DEFAULTS, ...stored };
}

async function loadEmployee(analystId) {
  const result = await pool.query(
    'SELECT setting_key, setting_value FROM employee_settings WHERE analyst_id = $1',
    [analystId]
  );
  const stored = Object.fromEntries(result.rows.map(r => [r.setting_key, readKV(r)]));
  return { ...EMPLOYEE_DEFAULTS, ...stored };
}

router.get('/defaults', (_req, res) => {
  res.json({ manager: MANAGER_DEFAULTS, employee: EMPLOYEE_DEFAULTS });
});

router.get('/manager', async (_req, res, next) => {
  try {
    res.json(await loadManager());
  } catch (err) { next(err); }
});

router.post('/manager', async (req, res, next) => {
  try {
    const body = req.body || {};
    let changed = 0;
    for (const [k, v] of Object.entries(body)) {
      await pool.query(`
        INSERT INTO manager_settings (setting_key, setting_value, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT(setting_key) DO UPDATE SET
          setting_value = EXCLUDED.setting_value,
          updated_at    = EXCLUDED.updated_at
      `, [k, JSON.stringify(v)]);
      changed++;
    }
    res.json({ ok: true, changed, settings: await loadManager() });
  } catch (err) { next(err); }
});

router.get('/employee/:id', async (req, res, next) => {
  try {
    res.json(await loadEmployee(req.params.id));
  } catch (err) { next(err); }
});

router.post('/employee/:id', async (req, res, next) => {
  try {
    const body = req.body || {};
    let changed = 0;
    for (const [k, v] of Object.entries(body)) {
      await pool.query(`
        INSERT INTO employee_settings (analyst_id, setting_key, setting_value, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT(analyst_id, setting_key) DO UPDATE SET
          setting_value = EXCLUDED.setting_value,
          updated_at    = EXCLUDED.updated_at
      `, [req.params.id, k, JSON.stringify(v)]);
      changed++;
    }
    res.json({ ok: true, changed, settings: await loadEmployee(req.params.id) });
  } catch (err) { next(err); }
});

router.delete('/manager', async (_req, res, next) => {
  try {
    await pool.query('DELETE FROM manager_settings');
    res.json({ ok: true, settings: await loadManager() });
  } catch (err) { next(err); }
});

router.delete('/employee/:id', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM employee_settings WHERE analyst_id = $1', [req.params.id]);
    res.json({ ok: true, settings: await loadEmployee(req.params.id) });
  } catch (err) { next(err); }
});

module.exports = router;
