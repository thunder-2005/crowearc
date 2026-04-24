const express = require('express');
const { db } = require('../database/db');

const router = express.Router();

function statsForAnalyst(name) {
  const open_alerts = db.prepare(
    "SELECT COUNT(*) AS c FROM alerts WHERE assigned_to = ? AND alert_status <> 'Completed'"
  ).get(name).c;
  const cases_in_progress = db.prepare(
    "SELECT COUNT(*) AS c FROM cases WHERE assigned_to = ? AND case_status IN ('Work In Progress','Pending Review','Not Started')"
  ).get(name).c;
  const alerts_closed_this_month = db.prepare(
    "SELECT COUNT(*) AS c FROM alerts WHERE assigned_to = ? AND alert_status = 'Completed' AND substr(closed_date,1,7) = substr(date('now'),1,7)"
  ).get(name).c;
  const avgRow = db.prepare(
    `SELECT AVG(julianday(closed_date) - julianday(created_date)) AS d
       FROM alerts WHERE assigned_to = ? AND alert_status = 'Completed' AND closed_date IS NOT NULL`
  ).get(name);
  const avg_resolution_days = avgRow.d ? Math.round(avgRow.d * 10) / 10 : null;
  const sla_breaches = db.prepare(
    'SELECT COUNT(*) AS c FROM alerts WHERE assigned_to = ? AND sla_breached = 1'
  ).get(name).c;
  const totalClosed = db.prepare(
    "SELECT COUNT(*) AS c FROM alerts WHERE assigned_to = ? AND alert_status = 'Completed'"
  ).get(name).c;
  const fp = db.prepare(
    "SELECT COUNT(*) AS c FROM alerts WHERE assigned_to = ? AND alert_status = 'Completed' AND case_converted = 0"
  ).get(name).c;
  const false_positive_rate_pct = totalClosed > 0 ? Math.round((fp / totalClosed) * 100) : 0;

  return {
    open_alerts, cases_in_progress, alerts_closed_this_month,
    avg_resolution_days, sla_breaches, false_positive_rate_pct
  };
}

router.get('/', (req, res) => {
  const { q, status, role, team } = req.query;
  let sql = 'SELECT * FROM user_profiles WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (role)   { sql += ' AND role = ?';   params.push(role); }
  if (team)   { sql += ' AND team = ?';   params.push(team); }
  if (q) {
    sql += ' AND (name LIKE ? OR role LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY name ASC';
  const rows = db.prepare(sql).all(...params);
  const withStats = rows.map(r => ({ ...r, stats: statsForAnalyst(r.name) }));
  res.json(withStats);
});

router.get('/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM user_profiles WHERE user_id = ? OR name = ? OR id = ?')
    .get(req.params.id, req.params.id, req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const open_alerts = db.prepare(
    "SELECT * FROM alerts WHERE assigned_to = ? AND alert_status <> 'Completed' ORDER BY age_days DESC LIMIT 50"
  ).all(user.name);
  const open_cases = db.prepare(
    "SELECT * FROM cases WHERE assigned_to = ? ORDER BY updated_date DESC LIMIT 50"
  ).all(user.name);

  const recent_notes = db.prepare(
    'SELECT * FROM case_notes WHERE analyst = ? ORDER BY timestamp DESC LIMIT 10'
  ).all(user.name);
  const recent_alerts = db.prepare(
    'SELECT alert_id, last_activity_date AS timestamp, alert_status, customer_name FROM alerts WHERE assigned_to = ? AND last_activity_date IS NOT NULL ORDER BY last_activity_date DESC LIMIT 10'
  ).all(user.name);

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
    stats: statsForAnalyst(user.name),
    open_alerts, open_cases,
    recent_activity: recent
  });
});

module.exports = router;
