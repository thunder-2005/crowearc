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

// ─────────────────────────────────────────────── Drawer routes
//
// Each /drawer/* route is purpose-built for one KPI card on the manager
// dashboard. They return only what the drawer needs.

const ANALYST_CAPACITY = 15;
const FATIGUED_AT = 0.85;
const TODAY = "date('now')";
const THIS_MONTH_START = "date('now','start of month')";
const LAST_MONTH_START = "date('now','start of month','-1 month')";

function trendPct(curr, prev) {
  if (!prev) return curr > 0 ? 100 : 0;
  return Math.round(((curr - prev) / prev) * 100);
}
function compareThisVsLast(table, column, where = '') {
  const w = where ? ` AND ${where}` : '';
  const curr = db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE date(${column}) >= ${THIS_MONTH_START}${w}`).get().c;
  const prev = db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE date(${column}) >= ${LAST_MONTH_START} AND date(${column}) < ${THIS_MONTH_START}${w}`).get().c;
  return { curr, prev, pct: trendPct(curr, prev) };
}

function avatarInitials(name) {
  return (name || '?').split(/\s+/).slice(0, 2).map(s => s[0] || '').join('').toUpperCase();
}

function listAnalysts() {
  return db.prepare(`
    SELECT name, role, team, avatar_color
      FROM user_profiles
     WHERE status = 'Active' AND role LIKE 'AML Analyst%'
     ORDER BY role ASC, name ASC
  `).all().map(u => ({
    name: u.name,
    level: /L2/i.test(u.role) ? 'L2' : 'L1',
    team: u.team,
    initials: avatarInitials(u.name),
    avatar_color: u.avatar_color
  }));
}

// ─── 1. Total Alerts
router.get('/drawer/total-alerts', (_req, res) => {
  const total = db.prepare('SELECT COUNT(*) AS c FROM alerts').get().c;
  const breakdownRows = db.prepare(`
    SELECT alert_status AS name, COUNT(*) AS value
      FROM alerts GROUP BY alert_status
  `).all();
  // Roll up Escalated - L2 / SAR into "Escalated"
  const breakdown = [];
  let escalated = 0;
  for (const r of breakdownRows) {
    if (r.name && r.name.startsWith('Escalated')) escalated += r.value;
    else breakdown.push({ name: r.name || 'Other', value: r.value });
  }
  if (escalated > 0) breakdown.push({ name: 'Escalated', value: escalated });

  const high_priority = db.prepare("SELECT COUNT(*) AS c FROM alerts WHERE priority = 'High' AND alert_status NOT IN ('Completed','Closed')").get().c;
  const breaching_today = db.prepare(`
    SELECT COUNT(*) AS c FROM alerts
     WHERE alert_status NOT IN ('Completed','Closed')
       AND sla_deadline IS NOT NULL
       AND date(sla_deadline) = ${TODAY}
  `).get().c;
  const unassigned = db.prepare("SELECT COUNT(*) AS c FROM alerts WHERE alert_status = 'Unassigned'").get().c;

  const top_scenarios = db.prepare(`
    SELECT scenario AS name, COUNT(*) AS count
      FROM alerts
     WHERE scenario IS NOT NULL
     GROUP BY scenario
     ORDER BY count DESC
     LIMIT 3
  `).all().map(s => ({
    ...s,
    pct: total > 0 ? Math.round((s.count / total) * 1000) / 10 : 0
  }));

  const trend = compareThisVsLast('alerts', 'created_date');
  res.json({ total, breakdown, high_priority, breaching_today, unassigned, top_scenarios, trend });
});

// ─── 2. In Progress
router.get('/drawer/in-progress', (_req, res) => {
  const total = db.prepare("SELECT COUNT(*) AS c FROM alerts WHERE alert_status = 'Work in Progress'").get().c;
  const ipByAnalyst = db.prepare(`
    SELECT assigned_to AS analyst, COUNT(*) AS in_progress
      FROM alerts
     WHERE alert_status = 'Work in Progress'
       AND assigned_to IS NOT NULL AND TRIM(assigned_to) <> ''
     GROUP BY assigned_to
     ORDER BY in_progress DESC
  `).all();
  const analysts = listAnalysts();
  const profileByName = Object.fromEntries(analysts.map(a => [a.name, a]));
  const by_analyst = ipByAnalyst.map(r => {
    const total_open = db.prepare(`SELECT COUNT(*) AS c FROM alerts WHERE assigned_to = ? AND alert_status NOT IN ('Completed','Closed')`).get(r.analyst).c;
    const pct = Math.min(100, Math.round((total_open / ANALYST_CAPACITY) * 100));
    return {
      ...(profileByName[r.analyst] || { name: r.analyst, level: 'L1', initials: avatarInitials(r.analyst) }),
      in_progress: r.in_progress,
      total_open,
      capacity: ANALYST_CAPACITY,
      pct
    };
  });

  const oldest = db.prepare(`
    SELECT alert_id, customer_name, age_days, priority
      FROM alerts
     WHERE alert_status = 'Work in Progress'
     ORDER BY age_days DESC
     LIMIT 3
  `).all();

  const trend = compareThisVsLast('alerts', 'last_activity_date', "alert_status = 'Work in Progress'");
  res.json({ total, by_analyst, oldest, trend });
});

// ─── 3. Completed
router.get('/drawer/completed', (_req, res) => {
  const total = db.prepare("SELECT COUNT(*) AS c FROM alerts WHERE alert_status = 'Completed'").get().c;
  const fp = db.prepare("SELECT COUNT(*) AS c FROM alerts WHERE alert_status = 'Completed' AND case_converted = 0").get().c;
  const l2 = db.prepare("SELECT COUNT(*) AS c FROM alerts WHERE alert_status = 'Completed' AND case_converted = 1 AND linked_sar_id IS NULL").get().c;
  const sar = db.prepare("SELECT COUNT(*) AS c FROM alerts WHERE alert_status = 'Completed' AND linked_sar_id IS NOT NULL").get().c;

  // Last 4 weeks (Mon-start)
  const by_week = db.prepare(`
    SELECT date(closed_date, 'weekday 1', '-7 days') AS week_start,
           COUNT(*) AS count
      FROM alerts
     WHERE closed_date IS NOT NULL
       AND date(closed_date) >= date('now', '-28 days')
     GROUP BY week_start
     ORDER BY week_start ASC
  `).all().map(r => ({
    label: new Date(r.week_start + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    count: r.count
  }));

  const fastest = db.prepare(`
    SELECT alert_id, assigned_to AS analyst,
           CAST(julianday(closed_date) - julianday(created_date) AS INTEGER) AS days
      FROM alerts
     WHERE alert_status = 'Completed'
       AND closed_date IS NOT NULL
       AND date(closed_date) >= ${THIS_MONTH_START}
     ORDER BY days ASC
     LIMIT 3
  `).all();

  const trend = compareThisVsLast('alerts', 'closed_date', "alert_status = 'Completed'");
  res.json({ total, fp, l2, sar, by_week, fastest, trend });
});

// ─── 4. SLA Breaches
router.get('/drawer/sla-breaches', (_req, res) => {
  const total = db.prepare('SELECT COUNT(*) AS c FROM alerts WHERE sla_breached = 1').get().c;

  const overdue = db.prepare(`
    SELECT alert_id, customer_name, scenario,
           CAST(MAX(0, julianday('now') - julianday(sla_deadline)) AS INTEGER) AS days_overdue
      FROM alerts
     WHERE sla_breached = 1
       AND sla_deadline IS NOT NULL
       AND alert_status NOT IN ('Completed','Closed')
  `).all();

  const buckets = { gt7: 0, between3and7: 0, lt3: 0 };
  for (const r of overdue) {
    if (r.days_overdue > 7) buckets.gt7++;
    else if (r.days_overdue >= 3) buckets.between3and7++;
    else buckets.lt3++;
  }

  const by_analyst = db.prepare(`
    SELECT assigned_to AS analyst, COUNT(*) AS breaches
      FROM alerts
     WHERE sla_breached = 1
       AND assigned_to IS NOT NULL AND TRIM(assigned_to) <> ''
     GROUP BY assigned_to
     ORDER BY breaches DESC
  `).all();
  const analysts = Object.fromEntries(listAnalysts().map(a => [a.name, a]));
  const by_analyst_enriched = by_analyst.map(r => ({
    ...(analysts[r.analyst] || { name: r.analyst, level: 'L1', initials: avatarInitials(r.analyst) }),
    breaches: r.breaches
  }));

  const most_overdue = [...overdue]
    .sort((a, b) => b.days_overdue - a.days_overdue)
    .slice(0, 3);

  // Trend: count of NEW breaches this month vs last month
  const trendBreached = compareThisVsLast('alerts', 'created_date', 'sla_breached = 1');

  res.json({
    total,
    urgency_buckets: { gt7: buckets.gt7, between3and7: buckets.between3and7, lt3: buckets.lt3 },
    by_analyst: by_analyst_enriched,
    most_overdue,
    trend: trendBreached
  });
});

// ─── 5. Avg Aging
router.get('/drawer/avg-aging', (_req, res) => {
  const open = db.prepare(`
    SELECT alert_id, customer_name, age_days, assigned_to
      FROM alerts
     WHERE alert_status NOT IN ('Completed','Closed')
  `).all();
  const total_open = open.length;
  const avg = total_open > 0
    ? Math.round((open.reduce((s, a) => s + (a.age_days || 0), 0) / total_open) * 10) / 10
    : 0;

  const distribution = { '1-7d': 0, '7-15d': 0, '15-30d': 0, '30d+': 0 };
  for (const a of open) {
    const d = a.age_days || 0;
    if (d < 7) distribution['1-7d']++;
    else if (d < 15) distribution['7-15d']++;
    else if (d < 30) distribution['15-30d']++;
    else distribution['30d+']++;
  }
  const dist_pct = {};
  for (const [k, v] of Object.entries(distribution)) {
    dist_pct[k] = total_open > 0 ? Math.round((v / total_open) * 1000) / 10 : 0;
  }

  const longest = Math.max(0, ...open.map(a => a.age_days || 0));
  const newest = total_open > 0 ? Math.min(...open.map(a => a.age_days || 0)) : 0;
  const target = 7;

  const oldest_4 = [...open]
    .filter(a => (a.age_days || 0) >= 30)
    .sort((a, b) => (b.age_days || 0) - (a.age_days || 0))
    .slice(0, 4)
    .map(a => ({ alert_id: a.alert_id, customer_name: a.customer_name, age: a.age_days, assigned_to: a.assigned_to }));

  // Trend: avg age this month vs last month (based on closed_date for closed alerts in those windows)
  const cur = db.prepare(`SELECT AVG(julianday(closed_date) - julianday(created_date)) AS d FROM alerts WHERE closed_date IS NOT NULL AND date(closed_date) >= ${THIS_MONTH_START}`).get();
  const prv = db.prepare(`SELECT AVG(julianday(closed_date) - julianday(created_date)) AS d FROM alerts WHERE closed_date IS NOT NULL AND date(closed_date) >= ${LAST_MONTH_START} AND date(closed_date) < ${THIS_MONTH_START}`).get();
  const trend = {
    curr: cur?.d != null ? Math.round(cur.d * 10) / 10 : 0,
    prev: prv?.d != null ? Math.round(prv.d * 10) / 10 : 0,
    pct: trendPct(cur?.d || 0, prv?.d || 0)
  };

  res.json({ avg, total_open, distribution, dist_pct, longest, newest, target, oldest_4, trend });
});

// ─── 6. Cases Converted
router.get('/drawer/cases-converted', (_req, res) => {
  const total = db.prepare('SELECT COUNT(*) AS c FROM alerts WHERE case_converted = 1').get().c;
  const total_alerts = db.prepare('SELECT COUNT(*) AS c FROM alerts').get().c;
  const filed = db.prepare("SELECT COUNT(*) AS c FROM sar_filings WHERE sar_status = 'Filed'").get().c;
  const pending_approval = db.prepare("SELECT COUNT(*) AS c FROM sar_filings WHERE sar_status IN ('Pending Approval','Under Manager Review')").get().c;
  const filed_this_month = db.prepare(`SELECT COUNT(*) AS c FROM sar_filings WHERE sar_status = 'Filed' AND filed_date IS NOT NULL AND date(filed_date) >= ${THIS_MONTH_START}`).get().c;

  const recent = db.prepare(`
    SELECT c.case_id, c.customer_name, c.assigned_to AS filed_by, c.created_date AS date
      FROM cases c
     WHERE c.linked_sar_id IS NOT NULL
     ORDER BY date(c.updated_date) DESC, c.id DESC
     LIMIT 4
  `).all();

  const trend = compareThisVsLast('alerts', 'last_activity_date', 'case_converted = 1');

  res.json({
    total,
    funnel: {
      alerts: total_alerts,
      escalated_sar: total,
      filed
    },
    pending_approval,
    filed_this_month,
    recent,
    trend
  });
});

// ─── 7. Team Capacity
router.get('/drawer/team-capacity', (_req, res) => {
  const analysts = listAnalysts();
  const enriched = analysts.map(a => {
    const open = db.prepare(`SELECT COUNT(*) AS c FROM alerts WHERE assigned_to = ? AND alert_status NOT IN ('Completed','Closed')`).get(a.name).c;
    const pct = Math.min(100, Math.round((open / ANALYST_CAPACITY) * 100));
    return { ...a, open, capacity: ANALYST_CAPACITY, pct };
  });
  const at_capacity_count = enriched.filter(a => a.pct >= 100).length;
  const team_pct = enriched.length > 0
    ? Math.round(enriched.reduce((s, a) => s + a.pct, 0) / enriched.length)
    : 0;
  const total_unassigned = db.prepare("SELECT COUNT(*) AS c FROM alerts WHERE alert_status = 'Unassigned'").get().c;

  res.json({
    team_pct,
    analysts: enriched,
    at_capacity_count,
    total_unassigned,
    threshold_pct: Math.round(FATIGUED_AT * 100)
  });
});

// ─── 8. False Positive Rate
router.get('/drawer/false-positive', (_req, res) => {
  const closed = db.prepare("SELECT COUNT(*) AS c FROM alerts WHERE alert_status = 'Completed'").get().c;
  const fp = db.prepare("SELECT COUNT(*) AS c FROM alerts WHERE alert_status = 'Completed' AND case_converted = 0").get().c;
  const rate_pct = closed > 0 ? Math.round((fp / closed) * 1000) / 10 : 0;

  // This month vs last month FP rate
  const monthRate = (sinceExpr, untilExpr) => {
    const sql = `SELECT
      SUM(CASE WHEN alert_status = 'Completed' AND case_converted = 0 THEN 1 ELSE 0 END) AS fp,
      SUM(CASE WHEN alert_status = 'Completed' THEN 1 ELSE 0 END) AS closed
      FROM alerts
     WHERE closed_date IS NOT NULL
       AND date(closed_date) >= ${sinceExpr}
       ${untilExpr ? ' AND date(closed_date) < ' + untilExpr : ''}`;
    const row = db.prepare(sql).get();
    return row.closed > 0 ? Math.round((row.fp / row.closed) * 1000) / 10 : 0;
  };
  const this_month_pct = monthRate(THIS_MONTH_START, null);
  const last_month_pct = monthRate(LAST_MONTH_START, THIS_MONTH_START);

  const by_scenario = db.prepare(`
    SELECT scenario,
           COUNT(*) AS total,
           SUM(CASE WHEN alert_status = 'Completed' AND case_converted = 0 THEN 1 ELSE 0 END) AS fp_count
      FROM alerts
     WHERE alert_status = 'Completed' AND scenario IS NOT NULL
     GROUP BY scenario
     ORDER BY (CAST(SUM(CASE WHEN alert_status = 'Completed' AND case_converted = 0 THEN 1.0 ELSE 0 END) AS REAL) / NULLIF(COUNT(*), 0)) DESC
     LIMIT 4
  `).all().map(r => ({
    scenario: r.scenario,
    total: r.total,
    fp_count: r.fp_count,
    fp_rate_pct: r.total > 0 ? Math.round((r.fp_count / r.total) * 1000) / 10 : 0
  }));

  res.json({
    rate_pct,
    benchmark_pct: 30,
    by_scenario,
    this_month_pct,
    last_month_pct
  });
});

// ─── 9. Unassigned Queue
router.get('/drawer/unassigned', (_req, res) => {
  const total = db.prepare("SELECT COUNT(*) AS c FROM alerts WHERE alert_status = 'Unassigned'").get().c;
  const byPriority = db.prepare(`
    SELECT priority, COUNT(*) AS c
      FROM alerts
     WHERE alert_status = 'Unassigned'
     GROUP BY priority
  `).all();
  const by_priority = { High: 0, Medium: 0, Low: 0 };
  for (const r of byPriority) by_priority[r.priority || 'Low'] = r.c;

  // Available analysts = under threshold capacity
  const analysts = listAnalysts();
  const available = analysts.map(a => {
    const open = db.prepare(`SELECT COUNT(*) AS c FROM alerts WHERE assigned_to = ? AND alert_status NOT IN ('Completed','Closed')`).get(a.name).c;
    const pct = Math.min(100, Math.round((open / ANALYST_CAPACITY) * 100));
    return { ...a, open, capacity: ANALYST_CAPACITY, pct, can_take: Math.max(0, ANALYST_CAPACITY - open) };
  })
    .filter(a => a.pct < FATIGUED_AT * 100 && a.can_take > 0)
    .sort((a, b) => a.pct - b.pct);

  // Recommendation: assign HIGH priority unassigned alerts to least-loaded available analyst
  let recommendation = null;
  if (available.length > 0 && by_priority.High > 0) {
    const target = available[0];
    const n = Math.min(by_priority.High, target.can_take);
    if (n > 0) {
      recommendation = {
        message: `Assign ${n} high-priority alert${n === 1 ? '' : 's'} to ${target.name} (${target.pct}% capacity)`,
        analyst: target.name,
        count: n
      };
    }
  }

  const top_5 = db.prepare(`
    SELECT alert_id, scenario, priority, age_days
      FROM alerts
     WHERE alert_status = 'Unassigned'
     ORDER BY CASE priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END,
              age_days DESC
     LIMIT 5
  `).all();

  res.json({ total, by_priority, available_analysts: available, recommendation, top_5 });
});

module.exports = router;
