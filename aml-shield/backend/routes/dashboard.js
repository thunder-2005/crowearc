const express = require('express');
const { db } = require('../database/db');

const router = express.Router();

router.get('/stats', (req, res) => {
  const { assigned_to } = req.query;
  const whereParts = [];
  const whereParams = [];
  if (assigned_to) { whereParts.push('assigned_to = ?'); whereParams.push(assigned_to); }
  const where = whereParts.length ? ' WHERE ' + whereParts.join(' AND ') : '';
  const withAnd = whereParts.length ? where + ' AND ' : ' WHERE ';

  const totalAlerts = db.prepare(`SELECT COUNT(*) AS c FROM alerts${where}`).get(...whereParams).c;
  const unassigned  = db.prepare(`SELECT COUNT(*) AS c FROM alerts${withAnd} alert_status = 'Unassigned'`).get(...whereParams).c;
  const notStarted  = db.prepare(`SELECT COUNT(*) AS c FROM alerts${withAnd} alert_status = 'Not Started'`).get(...whereParams).c;
  const inProgress  = db.prepare(`SELECT COUNT(*) AS c FROM alerts${withAnd} alert_status = 'Work in Progress'`).get(...whereParams).c;
  const completed   = db.prepare(`SELECT COUNT(*) AS c FROM alerts${withAnd} alert_status = 'Completed'`).get(...whereParams).c;
  const slaBreaches = db.prepare(`SELECT COUNT(*) AS c FROM alerts${withAnd} sla_breached = 1`).get(...whereParams).c;
  const avgAging    = db.prepare(`SELECT AVG(age_days) AS a FROM alerts${where}`).get(...whereParams).a || 0;
  const casesConverted = db.prepare(`SELECT COUNT(*) AS c FROM alerts${withAnd} case_converted = 1`).get(...whereParams).c;

  const closedFalsePositives = db.prepare(
    `SELECT COUNT(*) AS c FROM alerts${withAnd} alert_status = 'Completed' AND case_converted = 0`
  ).get(...whereParams).c;
  const falsePositiveRate = completed > 0
    ? Math.round((closedFalsePositives / completed) * 100)
    : 0;

  const trend = db.prepare(`
    SELECT created_date AS day, COUNT(*) AS alerts
      FROM alerts
     ${where}
     GROUP BY created_date
     ORDER BY created_date ASC
  `).all(...whereParams);

  const byStatus = db.prepare(`
    SELECT alert_status AS name, COUNT(*) AS value FROM alerts${where} GROUP BY alert_status
  `).all(...whereParams);

  const byScenario = db.prepare(`
    SELECT scenario AS name, COUNT(*) AS value FROM alerts${where} GROUP BY scenario
  `).all(...whereParams);

  const breachedRows = db.prepare(
    `SELECT age_days FROM alerts${withAnd} sla_breached = 1`
  ).all(...whereParams);
  const buckets = { '0-7': 0, '8-14': 0, '15-21': 0, '22-30': 0, '30+': 0 };
  for (const r of breachedRows) {
    const d = r.age_days;
    if (d <= 7) buckets['0-7']++;
    else if (d <= 14) buckets['8-14']++;
    else if (d <= 21) buckets['15-21']++;
    else if (d <= 30) buckets['22-30']++;
    else buckets['30+']++;
  }
  const slaBuckets = Object.entries(buckets).map(([name, value]) => ({ name, value }));

  const topBreaches = db.prepare(`
    SELECT alert_id, customer_name, scenario, priority, assigned_to, age_days, sla_days, due_status
      FROM alerts
     ${withAnd} sla_breached = 1
     ORDER BY age_days DESC
     LIMIT 10
  `).all(...whereParams);

  const workload = db.prepare(`
    SELECT assigned_to AS analyst,
           COUNT(*) AS total,
           SUM(CASE WHEN alert_status = 'Work in Progress' THEN 1 ELSE 0 END) AS in_progress,
           SUM(CASE WHEN sla_breached = 1 THEN 1 ELSE 0 END) AS breached,
           SUM(CASE WHEN alert_status = 'Completed' THEN 1 ELSE 0 END) AS completed
      FROM alerts
     WHERE assigned_to IS NOT NULL AND TRIM(assigned_to) <> ''
     GROUP BY assigned_to
     ORDER BY total DESC
  `).all().map(r => ({
    analyst: r.analyst,
    total: r.total,
    in_progress: r.in_progress,
    breached: r.breached,
    completed: r.completed,
    capacity: 15,
    utilization_pct: Math.min(100, Math.round(((r.in_progress + r.total * 0.2) / 15) * 100))
  }));

  res.json({
    scope: { assigned_to: assigned_to || null },
    kpis: {
      total_alerts: totalAlerts,
      unassigned,
      not_started: notStarted,
      in_progress: inProgress,
      completed,
      closed: completed,
      sla_breaches: slaBreaches,
      avg_aging_days: Math.round(avgAging * 10) / 10,
      cases_converted: casesConverted,
      false_positive_rate_pct: falsePositiveRate,
      team_capacity_pct: workload.length
        ? Math.round(workload.reduce((s, w) => s + w.utilization_pct, 0) / workload.length)
        : 0
    },
    trend,
    by_status: byStatus,
    by_scenario: byScenario,
    sla_buckets: slaBuckets,
    top_sla_breaches: topBreaches,
    analyst_workload: workload
  });
});

module.exports = router;
