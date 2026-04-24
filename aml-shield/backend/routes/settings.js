const express = require('express');
const { db } = require('../database/db');
const { MANAGER_DEFAULTS, EMPLOYEE_DEFAULTS } = require('../database/admin_defaults');

const router = express.Router();

function readKV(row) {
  try { return JSON.parse(row.setting_value); } catch (_e) { return row.setting_value; }
}

function loadManager() {
  const rows = db.prepare('SELECT setting_key, setting_value FROM manager_settings').all();
  const stored = Object.fromEntries(rows.map(r => [r.setting_key, readKV(r)]));
  return { ...MANAGER_DEFAULTS, ...stored };
}

function loadEmployee(analystId) {
  const rows = db.prepare(
    'SELECT setting_key, setting_value FROM employee_settings WHERE analyst_id = ?'
  ).all(analystId);
  const stored = Object.fromEntries(rows.map(r => [r.setting_key, readKV(r)]));
  return { ...EMPLOYEE_DEFAULTS, ...stored };
}

router.get('/defaults', (_req, res) => {
  res.json({ manager: MANAGER_DEFAULTS, employee: EMPLOYEE_DEFAULTS });
});

router.get('/manager', (_req, res) => {
  res.json(loadManager());
});

router.post('/manager', (req, res) => {
  const body = req.body || {};
  const upsert = db.prepare(`
    INSERT INTO manager_settings (setting_key, setting_value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(setting_key) DO UPDATE SET
      setting_value = excluded.setting_value,
      updated_at = excluded.updated_at
  `);
  let changed = 0;
  for (const [k, v] of Object.entries(body)) {
    upsert.run(k, JSON.stringify(v));
    changed++;
  }
  res.json({ ok: true, changed, settings: loadManager() });
});

router.get('/employee/:id', (req, res) => {
  res.json(loadEmployee(req.params.id));
});

router.post('/employee/:id', (req, res) => {
  const body = req.body || {};
  const upsert = db.prepare(`
    INSERT INTO employee_settings (analyst_id, setting_key, setting_value, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(analyst_id, setting_key) DO UPDATE SET
      setting_value = excluded.setting_value,
      updated_at = excluded.updated_at
  `);
  let changed = 0;
  for (const [k, v] of Object.entries(body)) {
    upsert.run(req.params.id, k, JSON.stringify(v));
    changed++;
  }
  res.json({ ok: true, changed, settings: loadEmployee(req.params.id) });
});

router.delete('/manager', (_req, res) => {
  db.prepare('DELETE FROM manager_settings').run();
  res.json({ ok: true, settings: loadManager() });
});

router.delete('/employee/:id', (req, res) => {
  db.prepare('DELETE FROM employee_settings WHERE analyst_id = ?').run(req.params.id);
  res.json({ ok: true, settings: loadEmployee(req.params.id) });
});

module.exports = router;
