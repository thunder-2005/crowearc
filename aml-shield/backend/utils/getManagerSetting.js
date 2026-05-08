const pool = require('../database/db');

// Fetch a single manager_settings value by key, parsing JSON if applicable.
// Always returns the supplied default on any failure (missing row, parse
// error, DB unavailable) — callers can rely on never crashing on a
// missing config.
async function getManagerSetting(key, defaultValue) {
  try {
    const result = await pool.query(
      'SELECT setting_value FROM manager_settings WHERE setting_key = $1',
      [key]
    );
    if (result.rows.length === 0) return defaultValue;
    const raw = result.rows[0].setting_value;
    try { return JSON.parse(raw); } catch (_e) { return raw; }
  } catch (_e) {
    return defaultValue;
  }
}

module.exports = { getManagerSetting };
