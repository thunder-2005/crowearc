const express = require('express');
const pool = require('../database/db');

const router = express.Router();

async function statsForAnalyst(name) {
  const open_alerts = Number((await pool.query(
    "SELECT COUNT(*) AS c FROM alerts WHERE assigned_to = $1 AND alert_status <> 'Completed'",
    [name]
  )).rows[0].c);
  const cases_in_progress = Number((await pool.query(
    "SELECT COUNT(*) AS c FROM cases WHERE assigned_to = $1 AND case_status IN ('In Progress','Pending Review','Not Started')",
    [name]
  )).rows[0].c);
  const alerts_closed_this_month = Number((await pool.query(
    "SELECT COUNT(*) AS c FROM alerts WHERE assigned_to = $1 AND alert_status = 'Completed' AND substr(closed_date,1,7) = to_char(CURRENT_DATE,'YYYY-MM')",
    [name]
  )).rows[0].c);
  const avgRow = (await pool.query(
    `SELECT AVG((closed_date::date - created_date::date)) AS d
       FROM alerts WHERE assigned_to = $1 AND alert_status = 'Completed' AND closed_date IS NOT NULL`,
    [name]
  )).rows[0];
  const avg_resolution_days = avgRow.d ? Math.round(Number(avgRow.d) * 10) / 10 : null;
  const sla_breaches = Number((await pool.query(
    'SELECT COUNT(*) AS c FROM alerts WHERE assigned_to = $1 AND sla_breached = 1',
    [name]
  )).rows[0].c);
  const totalClosed = Number((await pool.query(
    "SELECT COUNT(*) AS c FROM alerts WHERE assigned_to = $1 AND alert_status = 'Completed'",
    [name]
  )).rows[0].c);
  const fp = Number((await pool.query(
    "SELECT COUNT(*) AS c FROM alerts WHERE assigned_to = $1 AND alert_status = 'Completed' AND case_converted = 0",
    [name]
  )).rows[0].c);
  const false_positive_rate_pct = totalClosed > 0 ? Math.round((fp / totalClosed) * 100) : 0;

  return {
    open_alerts, cases_in_progress, alerts_closed_this_month,
    avg_resolution_days, sla_breaches, false_positive_rate_pct
  };
}

router.get('/', async (req, res, next) => {
  try {
    const { q, status, role, team } = req.query;
    let sql = 'SELECT * FROM user_profiles WHERE 1=1';
    const params = [];
    let n = 0;
    if (status) { params.push(status); sql += ` AND status = $${++n}`; }
    if (role)   { params.push(role);   sql += ` AND role = $${++n}`; }
    if (team)   { params.push(team);   sql += ` AND team = $${++n}`; }
    if (q) {
      params.push(`%${q}%`, `%${q}%`);
      sql += ` AND (name LIKE $${++n} OR role LIKE $${++n})`;
    }
    sql += ' ORDER BY name ASC';
    const rows = (await pool.query(sql, params)).rows;
    const withStats = await Promise.all(rows.map(async r => ({ ...r, stats: await statsForAnalyst(r.name) })));
    res.json(withStats);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const idParam = req.params.id;
    const idAsInt = /^\d+$/.test(idParam) ? Number(idParam) : -1;
    const result = await pool.query(
      'SELECT * FROM user_profiles WHERE user_id = $1 OR name = $2 OR id = $3',
      [idParam, idParam, idAsInt]
    );
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    const open_alerts = (await pool.query(
      "SELECT * FROM alerts WHERE assigned_to = $1 AND alert_status <> 'Completed' ORDER BY age_days DESC LIMIT 50",
      [user.name]
    )).rows;
    const open_cases = (await pool.query(
      "SELECT * FROM cases WHERE assigned_to = $1 ORDER BY updated_date DESC LIMIT 50",
      [user.name]
    )).rows;

    const recent_notes = (await pool.query(
      'SELECT * FROM case_notes WHERE analyst = $1 ORDER BY timestamp DESC LIMIT 10',
      [user.name]
    )).rows;
    const recent_alerts = (await pool.query(
      'SELECT alert_id, last_activity_date AS timestamp, alert_status, customer_name FROM alerts WHERE assigned_to = $1 AND last_activity_date IS NOT NULL ORDER BY last_activity_date DESC LIMIT 10',
      [user.name]
    )).rows;

    const recent = [
      ...recent_notes.map(n => ({
        ts: n.timestamp, kind: 'Note added',
        detail: n.note_text.length > 100 ? n.note_text.slice(0, 100) + '…' : n.note_text,
        ref: n.alert_id
      })),
      ...recent_alerts.map(a => ({
        ts: `${a.timestamp} 00:00:00`, kind: `Worked on alert (${a.alert_status})`,
        detail: a.customer_name, ref: a.alert_id
      }))
    ].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 5);

    res.json({
      ...user,
      stats: await statsForAnalyst(user.name),
      open_alerts, open_cases,
      recent_activity: recent
    });
  } catch (err) { next(err); }
});

module.exports = router;
