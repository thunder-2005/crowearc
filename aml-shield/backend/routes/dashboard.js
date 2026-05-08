const express = require('express');
const pool = require('../database/db');

const router = express.Router();

// ─── Canonical alert_status taxonomy ──────────────────────────────────
// The DB carries multiple variants for the same conceptual state — most
// notably 'In Progress' (seeded) vs 'Work in Progress' (live transitions),
// and 'Completed' (resolved-OK) vs 'Closed — False Positive' (em dash,
// FP-closed). These constants are inlined into SQL fragments below so
// every KPI counts every relevant row.
const STATUS_IN_PROGRESS = "alert_status IN ('In Progress', 'Work in Progress')";
// Closed-state set: includes everything that's "no longer active" so KPIs
// like "Completed/Closed" and the FP-rate denominator capture the full
// set. Bulk-close writes 'Closed — False Positive'; the legacy path used
// 'Completed'; SAR submissions use 'Filed'.
const STATUS_CLOSED      = "alert_status IN ('Completed', 'Closed', 'Filed', 'Closed — False Positive')";
// "Open" = anything not closed. Used by the analyst-load and unassigned
// queries that need to ignore historical FP-closed rows.
const STATUS_NOT_CLOSED  = "alert_status NOT IN ('Completed', 'Closed', 'Filed', 'Closed — False Positive')";

// PG SQL fragments for date math (text-comparable YYYY-MM-DD).
const TODAY            = "to_char(CURRENT_DATE, 'YYYY-MM-DD')";
const THIS_MONTH_START = "to_char(date_trunc('month', CURRENT_DATE)::date, 'YYYY-MM-DD')";
const LAST_MONTH_START = "to_char((date_trunc('month', CURRENT_DATE) - INTERVAL '1 month')::date, 'YYYY-MM-DD')";

const ANALYST_CAPACITY = 15;
const FATIGUED_AT = 0.85;

function trendPct(curr, prev) {
  if (!prev) return curr > 0 ? 100 : 0;
  return Math.round(((curr - prev) / prev) * 100);
}

async function compareThisVsLast(table, column, where = '') {
  const w = where ? ` AND ${where}` : '';
  const curr = Number((await pool.query(
    `SELECT COUNT(*) AS c FROM ${table} WHERE ${column} >= ${THIS_MONTH_START}${w}`
  )).rows[0].c);
  const prev = Number((await pool.query(
    `SELECT COUNT(*) AS c FROM ${table} WHERE ${column} >= ${LAST_MONTH_START} AND ${column} < ${THIS_MONTH_START}${w}`
  )).rows[0].c);
  return { curr, prev, pct: trendPct(curr, prev) };
}

function parseRange(req) {
  const q = req.query || {};
  const today = new Date();
  const to = q.to || today.toISOString().slice(0, 10);
  const from = q.from || new Date(today.getTime() - 30 * 86400000).toISOString().slice(0, 10);
  return { from, to };
}

function avatarInitials(name) {
  return (name || '?').split(/\s+/).slice(0, 2).map(s => s[0] || '').join('').toUpperCase();
}

async function listAnalysts() {
  const result = await pool.query(`
    SELECT name, role, team, avatar_color
      FROM user_profiles
     WHERE status = 'Active' AND role LIKE 'AML Analyst%'
     ORDER BY role ASC, name ASC
  `);
  return result.rows.map(u => ({
    name: u.name,
    level: /L2/i.test(u.role) ? 'L2' : 'L1',
    team: u.team,
    initials: avatarInitials(u.name),
    avatar_color: u.avatar_color
  }));
}

router.get('/stats', async (req, res, next) => {
  try {
    const { assigned_to } = req.query;
    const { from, to } = parseRange(req);
    const params = [from, to];
    let whereSql = ' WHERE created_date BETWEEN $1 AND $2';
    if (assigned_to) { params.push(assigned_to); whereSql += ` AND assigned_to = $${params.length}`; }
    const withAnd = whereSql + ' AND ';

    const num = async (sql, p = params) => Number((await pool.query(sql, p)).rows[0].c);
    const numFrom = async (sql, p) => Number((await pool.query(sql, p)).rows[0].c);

    const totalAlerts = await num(`SELECT COUNT(*) AS c FROM alerts${whereSql}`);
    const unassigned  = await num(`SELECT COUNT(*) AS c FROM alerts${withAnd} alert_status = 'Unassigned'`);
    const notStarted  = await num(`SELECT COUNT(*) AS c FROM alerts${withAnd} alert_status = 'Not Started'`);
    const inProgress  = await num(`SELECT COUNT(*) AS c FROM alerts${withAnd} ${STATUS_IN_PROGRESS}`);
    const completed   = await num(`SELECT COUNT(*) AS c FROM alerts${withAnd} ${STATUS_CLOSED}`);
    const slaBreaches = await num(`SELECT COUNT(*) AS c FROM alerts${withAnd} sla_breached = 1`);
    const avgAging    = Number((await pool.query(`SELECT AVG(age_days) AS a FROM alerts${whereSql}`, params)).rows[0].a) || 0;
    const casesConverted = await num(`SELECT COUNT(*) AS c FROM alerts${withAnd} case_converted = 1`);

    const closedFalsePositives = await num(
      `SELECT COUNT(*) AS c FROM alerts${withAnd} ${STATUS_CLOSED} AND case_converted = 0`
    );
    const falsePositiveRate = completed > 0
      ? Math.round((closedFalsePositives / completed) * 100)
      : 0;

    const trend = (await pool.query(`
      SELECT created_date AS day, COUNT(*) AS alerts
        FROM alerts
       ${whereSql}
       GROUP BY created_date
       ORDER BY created_date ASC
    `, params)).rows.map(r => ({ ...r, alerts: Number(r.alerts) }));

    const byStatus = (await pool.query(`
      SELECT alert_status AS name, COUNT(*) AS value FROM alerts${whereSql} GROUP BY alert_status
    `, params)).rows.map(r => ({ ...r, value: Number(r.value) }));

    const byScenario = (await pool.query(`
      SELECT scenario AS name, COUNT(*) AS value FROM alerts${whereSql} GROUP BY scenario
    `, params)).rows.map(r => ({ ...r, value: Number(r.value) }));

    const breachedRows = (await pool.query(
      `SELECT age_days FROM alerts${withAnd} sla_breached = 1`, params
    )).rows;
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

    const topBreaches = (await pool.query(`
      SELECT alert_id, customer_name, scenario, priority, assigned_to, age_days, sla_days, due_status
        FROM alerts
       ${withAnd} sla_breached = 1
       ORDER BY age_days DESC
       LIMIT 10
    `, params)).rows;

    const workload = (await pool.query(`
      SELECT assigned_to AS analyst,
             COUNT(*) AS total,
             SUM(CASE WHEN ${STATUS_IN_PROGRESS} THEN 1 ELSE 0 END) AS in_progress,
             SUM(CASE WHEN sla_breached = 1 THEN 1 ELSE 0 END) AS breached,
             SUM(CASE WHEN ${STATUS_CLOSED} THEN 1 ELSE 0 END) AS completed
        FROM alerts
       WHERE assigned_to IS NOT NULL AND TRIM(assigned_to) <> ''
         AND created_date BETWEEN $1 AND $2
       GROUP BY assigned_to
       ORDER BY total DESC
    `, [from, to])).rows.map(r => ({
      analyst: r.analyst,
      total: Number(r.total),
      in_progress: Number(r.in_progress),
      breached: Number(r.breached),
      completed: Number(r.completed),
      capacity: 15,
      utilization_pct: Math.min(100, Math.round(((Number(r.in_progress) + Number(r.total) * 0.2) / 15) * 100))
    }));

    const totalCases = await numFrom(
      'SELECT COUNT(*) AS c FROM cases WHERE created_date BETWEEN $1 AND $2',
      [from, to]
    );
    const totalSars = await numFrom(
      "SELECT COUNT(*) AS c FROM sar_filings WHERE filed_date IS NOT NULL AND filed_date BETWEEN $1 AND $2",
      [from, to]
    );
    const conversionRatePct = totalAlerts > 0
      ? Math.round((casesConverted / totalAlerts) * 1000) / 10
      : 0;

    res.json({
      scope: { assigned_to: assigned_to || null, from, to },
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
        total_cases: totalCases,
        total_sars: totalSars,
        conversion_rate_pct: conversionRatePct,
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
  } catch (err) { next(err); }
});

// ─── 1. Total Alerts
router.get('/drawer/total-alerts', async (req, res, next) => {
  try {
    const { from, to } = parseRange(req);
    const num = async (sql, p) => Number((await pool.query(sql, p)).rows[0].c);
    const total = await num('SELECT COUNT(*) AS c FROM alerts WHERE created_date BETWEEN $1 AND $2', [from, to]);
    const breakdownRows = (await pool.query(`
      SELECT alert_status AS name, COUNT(*) AS value
        FROM alerts WHERE created_date BETWEEN $1 AND $2
       GROUP BY alert_status
    `, [from, to])).rows.map(r => ({ ...r, value: Number(r.value) }));
    const breakdown = [];
    let escalated = 0;
    for (const r of breakdownRows) {
      if (r.name && r.name.startsWith('Escalated')) escalated += r.value;
      else breakdown.push({ name: r.name || 'Other', value: r.value });
    }
    if (escalated > 0) breakdown.push({ name: 'Escalated', value: escalated });

    const high_priority = await num(
      "SELECT COUNT(*) AS c FROM alerts WHERE priority = 'High' AND alert_status NOT IN ('Completed','Closed','Filed','Closed — False Positive') AND created_date BETWEEN $1 AND $2",
      [from, to]
    );
    const breaching_today = await num(`
      SELECT COUNT(*) AS c FROM alerts
       WHERE alert_status NOT IN ('Completed','Closed','Filed','Closed — False Positive')
         AND sla_deadline IS NOT NULL
         AND substr(sla_deadline, 1, 10) = ${TODAY}
         AND created_date BETWEEN $1 AND $2
    `, [from, to]);
    const unassigned = await num(
      "SELECT COUNT(*) AS c FROM alerts WHERE alert_status = 'Unassigned' AND created_date BETWEEN $1 AND $2",
      [from, to]
    );

    const top_scenarios = (await pool.query(`
      SELECT scenario AS name, COUNT(*) AS count
        FROM alerts
       WHERE scenario IS NOT NULL
         AND created_date BETWEEN $1 AND $2
       GROUP BY scenario
       ORDER BY count DESC
       LIMIT 3
    `, [from, to])).rows.map(s => ({
      ...s,
      count: Number(s.count),
      pct: total > 0 ? Math.round((Number(s.count) / total) * 1000) / 10 : 0
    }));

    const trend = await compareThisVsLast('alerts', 'created_date');
    res.json({ total, breakdown, high_priority, breaching_today, unassigned, top_scenarios, trend });
  } catch (err) { next(err); }
});

// ─── 2. In Progress
router.get('/drawer/in-progress', async (req, res, next) => {
  try {
    const { from, to } = parseRange(req);
    const num = async (sql, p) => Number((await pool.query(sql, p)).rows[0].c);
    const total = await num(
      "SELECT COUNT(*) AS c FROM alerts WHERE alert_status IN ('In Progress', 'Work in Progress') AND created_date BETWEEN $1 AND $2",
      [from, to]
    );
    const ipByAnalyst = (await pool.query(`
      SELECT assigned_to AS analyst, COUNT(*) AS in_progress
        FROM alerts
       WHERE alert_status IN ('In Progress', 'Work in Progress')
         AND assigned_to IS NOT NULL AND TRIM(assigned_to) <> ''
         AND created_date BETWEEN $1 AND $2
       GROUP BY assigned_to
       ORDER BY in_progress DESC
    `, [from, to])).rows.map(r => ({ ...r, in_progress: Number(r.in_progress) }));
    const analysts = await listAnalysts();
    const profileByName = Object.fromEntries(analysts.map(a => [a.name, a]));
    const by_analyst = [];
    for (const r of ipByAnalyst) {
      const total_open = await num(
        "SELECT COUNT(*) AS c FROM alerts WHERE assigned_to = $1 AND alert_status NOT IN ('Completed','Closed','Filed','Closed — False Positive') AND created_date BETWEEN $2 AND $3",
        [r.analyst, from, to]
      );
      const pct = Math.min(100, Math.round((total_open / ANALYST_CAPACITY) * 100));
      by_analyst.push({
        ...(profileByName[r.analyst] || { name: r.analyst, level: 'L1', initials: avatarInitials(r.analyst) }),
        in_progress: r.in_progress,
        total_open,
        capacity: ANALYST_CAPACITY,
        pct
      });
    }

    const oldest = (await pool.query(`
      SELECT alert_id, customer_name, age_days, priority
        FROM alerts
       WHERE alert_status IN ('In Progress', 'Work in Progress')
         AND created_date BETWEEN $1 AND $2
       ORDER BY age_days DESC
       LIMIT 3
    `, [from, to])).rows;

    const trend = await compareThisVsLast('alerts', 'last_activity_date', "alert_status IN ('In Progress', 'Work in Progress')");
    res.json({ total, by_analyst, oldest, trend });
  } catch (err) { next(err); }
});

// ─── 3. Completed
router.get('/drawer/completed', async (req, res, next) => {
  try {
    const { from, to } = parseRange(req);
    const num = async (sql, p) => Number((await pool.query(sql, p)).rows[0].c);
    const total = await num(
      "SELECT COUNT(*) AS c FROM alerts WHERE alert_status IN ('Completed', 'Closed', 'Filed', 'Closed — False Positive') AND created_date BETWEEN $1 AND $2",
      [from, to]
    );
    const fp = await num(
      "SELECT COUNT(*) AS c FROM alerts WHERE alert_status IN ('Completed', 'Closed', 'Filed', 'Closed — False Positive') AND case_converted = 0 AND created_date BETWEEN $1 AND $2",
      [from, to]
    );
    const l2 = await num(
      "SELECT COUNT(*) AS c FROM alerts WHERE alert_status IN ('Completed', 'Closed', 'Filed', 'Closed — False Positive') AND case_converted = 1 AND linked_sar_id IS NULL AND created_date BETWEEN $1 AND $2",
      [from, to]
    );
    const sar = await num(
      "SELECT COUNT(*) AS c FROM alerts WHERE alert_status IN ('Completed', 'Closed', 'Filed', 'Closed — False Positive') AND linked_sar_id IS NOT NULL AND created_date BETWEEN $1 AND $2",
      [from, to]
    );

    const by_week = (await pool.query(`
      SELECT to_char(date_trunc('week', closed_date::date)::date, 'YYYY-MM-DD') AS week_start,
             COUNT(*) AS count
        FROM alerts
       WHERE closed_date IS NOT NULL
         AND closed_date::date >= (CURRENT_DATE - INTERVAL '28 days')
       GROUP BY week_start
       ORDER BY week_start ASC
    `)).rows.map(r => ({
      label: new Date(r.week_start + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      count: Number(r.count)
    }));

    const fastest = (await pool.query(`
      SELECT alert_id, assigned_to AS analyst,
             CAST(closed_date::date - created_date::date AS INTEGER) AS days
        FROM alerts
       WHERE alert_status IN ('Completed', 'Closed', 'Filed', 'Closed — False Positive')
         AND closed_date IS NOT NULL
         AND created_date BETWEEN $1 AND $2
       ORDER BY days ASC
       LIMIT 3
    `, [from, to])).rows;

    const trend = await compareThisVsLast('alerts', 'closed_date', "alert_status IN ('Completed', 'Closed', 'Filed', 'Closed — False Positive')");
    res.json({ total, fp, l2, sar, by_week, fastest, trend });
  } catch (err) { next(err); }
});

// ─── 4. SLA Breaches
router.get('/drawer/sla-breaches', async (req, res, next) => {
  try {
    const { from, to } = parseRange(req);
    const num = async (sql, p) => Number((await pool.query(sql, p)).rows[0].c);
    const total = await num(
      'SELECT COUNT(*) AS c FROM alerts WHERE sla_breached = 1 AND created_date BETWEEN $1 AND $2',
      [from, to]
    );

    const overdue = (await pool.query(`
      SELECT alert_id, customer_name, scenario, assigned_to, priority, created_date,
             CAST(GREATEST(0, EXTRACT(EPOCH FROM (NOW() - sla_deadline::timestamp))/86400) AS INTEGER) AS days_overdue
        FROM alerts
       WHERE sla_breached = 1
         AND sla_deadline IS NOT NULL
         AND alert_status NOT IN ('Completed','Closed','Filed','Closed — False Positive')
         AND created_date BETWEEN $1 AND $2
    `, [from, to])).rows.map(r => ({ ...r, days_overdue: Number(r.days_overdue) }));

    const buckets = { gt7: 0, between3and7: 0, lt3: 0 };
    for (const r of overdue) {
      if (r.days_overdue > 7) buckets.gt7++;
      else if (r.days_overdue >= 3) buckets.between3and7++;
      else buckets.lt3++;
    }

    const by_analyst = (await pool.query(`
      SELECT assigned_to AS analyst, COUNT(*) AS breaches
        FROM alerts
       WHERE sla_breached = 1
         AND assigned_to IS NOT NULL AND TRIM(assigned_to) <> ''
         AND created_date BETWEEN $1 AND $2
       GROUP BY assigned_to
       ORDER BY breaches DESC
    `, [from, to])).rows.map(r => ({ ...r, breaches: Number(r.breaches) }));
    const analysts = Object.fromEntries((await listAnalysts()).map(a => [a.name, a]));
    const by_analyst_enriched = by_analyst.map(r => ({
      ...(analysts[r.analyst] || { name: r.analyst, level: 'L1', initials: avatarInitials(r.analyst) }),
      breaches: r.breaches
    }));

    const most_overdue = [...overdue]
      .sort((a, b) => b.days_overdue - a.days_overdue)
      .slice(0, 3);

    const trendBreached = await compareThisVsLast('alerts', 'created_date', 'sla_breached = 1');

    res.json({
      total,
      urgency_buckets: { gt7: buckets.gt7, between3and7: buckets.between3and7, lt3: buckets.lt3 },
      by_analyst: by_analyst_enriched,
      most_overdue,
      trend: trendBreached
    });
  } catch (err) { next(err); }
});

// ─── 5. Avg Aging
router.get('/drawer/avg-aging', async (req, res, next) => {
  try {
    const { from, to } = parseRange(req);
    const open = (await pool.query(`
      SELECT alert_id, customer_name, age_days, assigned_to
        FROM alerts
       WHERE alert_status NOT IN ('Completed','Closed','Filed','Closed — False Positive')
         AND created_date BETWEEN $1 AND $2
    `, [from, to])).rows;
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

    const cur = (await pool.query(
      `SELECT AVG(closed_date::date - created_date::date) AS d FROM alerts WHERE closed_date IS NOT NULL AND closed_date >= ${THIS_MONTH_START}`
    )).rows[0];
    const prv = (await pool.query(
      `SELECT AVG(closed_date::date - created_date::date) AS d FROM alerts WHERE closed_date IS NOT NULL AND closed_date >= ${LAST_MONTH_START} AND closed_date < ${THIS_MONTH_START}`
    )).rows[0];
    const curD = cur?.d != null ? Number(cur.d) : 0;
    const prvD = prv?.d != null ? Number(prv.d) : 0;
    const trend = {
      curr: Math.round(curD * 10) / 10,
      prev: Math.round(prvD * 10) / 10,
      pct: trendPct(curD, prvD)
    };

    res.json({ avg, total_open, distribution, dist_pct, longest, newest, target, oldest_4, trend });
  } catch (err) { next(err); }
});

// ─── 6. Cases Converted
router.get('/drawer/cases-converted', async (req, res, next) => {
  try {
    const { from, to } = parseRange(req);
    const num = async (sql, p = []) => Number((await pool.query(sql, p)).rows[0].c);
    const total = await num('SELECT COUNT(*) AS c FROM alerts WHERE case_converted = 1 AND created_date BETWEEN $1 AND $2', [from, to]);
    const total_alerts = await num('SELECT COUNT(*) AS c FROM alerts WHERE created_date BETWEEN $1 AND $2', [from, to]);
    const total_cases = await num('SELECT COUNT(*) AS c FROM cases WHERE created_date BETWEEN $1 AND $2', [from, to]);
    const filed = await num("SELECT COUNT(*) AS c FROM sar_filings WHERE sar_status = 'Filed' AND filed_date IS NOT NULL AND filed_date BETWEEN $1 AND $2", [from, to]);
    const total_sars = await num("SELECT COUNT(*) AS c FROM sar_filings WHERE filed_date IS NOT NULL AND filed_date BETWEEN $1 AND $2", [from, to]);
    const conversion_rate_pct = total_alerts > 0 ? Math.round((total / total_alerts) * 1000) / 10 : 0;
    const pending_approval = await num("SELECT COUNT(*) AS c FROM sar_filings WHERE sar_status IN ('Pending Approval','Under Manager Review')");
    const filed_this_month = await num(`SELECT COUNT(*) AS c FROM sar_filings WHERE sar_status = 'Filed' AND filed_date IS NOT NULL AND filed_date >= ${THIS_MONTH_START}`);

    const recent = (await pool.query(`
      SELECT c.case_id, c.customer_name, c.assigned_to AS filed_by, c.created_date AS date
        FROM cases c
       WHERE c.linked_sar_id IS NOT NULL
         AND c.created_date BETWEEN $1 AND $2
       ORDER BY c.updated_date DESC, c.id DESC
       LIMIT 4
    `, [from, to])).rows;

    const trend = await compareThisVsLast('alerts', 'last_activity_date', 'case_converted = 1');

    res.json({
      total, total_alerts, total_cases, total_sars,
      conversion_rate_pct,
      funnel: { alerts: total_alerts, escalated_sar: total, filed },
      pending_approval, filed_this_month, recent, trend
    });
  } catch (err) { next(err); }
});

// ─── 7. Team Capacity
router.get('/drawer/team-capacity', async (req, res, next) => {
  try {
    const { from, to } = parseRange(req);
    const num = async (sql, p) => Number((await pool.query(sql, p)).rows[0].c);
    const analysts = await listAnalysts();
    const enriched = [];
    for (const a of analysts) {
      const open = await num(
        "SELECT COUNT(*) AS c FROM alerts WHERE assigned_to = $1 AND alert_status NOT IN ('Completed','Closed','Filed','Closed — False Positive') AND created_date BETWEEN $2 AND $3",
        [a.name, from, to]
      );
      const pct = Math.min(100, Math.round((open / ANALYST_CAPACITY) * 100));
      enriched.push({ ...a, open, capacity: ANALYST_CAPACITY, pct });
    }
    const at_capacity_count = enriched.filter(a => a.pct >= 100).length;
    const team_pct = enriched.length > 0
      ? Math.round(enriched.reduce((s, a) => s + a.pct, 0) / enriched.length)
      : 0;
    const total_unassigned = await num(
      "SELECT COUNT(*) AS c FROM alerts WHERE alert_status = 'Unassigned' AND created_date BETWEEN $1 AND $2",
      [from, to]
    );

    res.json({
      team_pct,
      analysts: enriched,
      at_capacity_count,
      total_unassigned,
      threshold_pct: Math.round(FATIGUED_AT * 100)
    });
  } catch (err) { next(err); }
});

// ─── 8. False Positive Rate
router.get('/drawer/false-positive', async (req, res, next) => {
  try {
    const { from, to } = parseRange(req);
    const num = async (sql, p) => Number((await pool.query(sql, p)).rows[0].c);
    const closed = await num(
      "SELECT COUNT(*) AS c FROM alerts WHERE alert_status IN ('Completed', 'Closed', 'Filed', 'Closed — False Positive') AND created_date BETWEEN $1 AND $2", [from, to]
    );
    const fp = await num(
      "SELECT COUNT(*) AS c FROM alerts WHERE alert_status IN ('Completed', 'Closed', 'Filed', 'Closed — False Positive') AND case_converted = 0 AND created_date BETWEEN $1 AND $2", [from, to]
    );
    const rate_pct = closed > 0 ? Math.round((fp / closed) * 1000) / 10 : 0;

    const monthRate = async (sinceExpr, untilExpr) => {
      const sql = `SELECT
        SUM(CASE WHEN alert_status IN ('Completed', 'Closed', 'Filed', 'Closed — False Positive') AND case_converted = 0 THEN 1 ELSE 0 END) AS fp,
        SUM(CASE WHEN alert_status IN ('Completed', 'Closed', 'Filed', 'Closed — False Positive') THEN 1 ELSE 0 END) AS closed
        FROM alerts
       WHERE closed_date IS NOT NULL
         AND closed_date >= ${sinceExpr}
         ${untilExpr ? ' AND closed_date < ' + untilExpr : ''}`;
      const row = (await pool.query(sql)).rows[0];
      const closedN = Number(row.closed) || 0;
      const fpN = Number(row.fp) || 0;
      return closedN > 0 ? Math.round((fpN / closedN) * 1000) / 10 : 0;
    };
    const this_month_pct = await monthRate(THIS_MONTH_START, null);
    const last_month_pct = await monthRate(LAST_MONTH_START, THIS_MONTH_START);

    const by_scenario = (await pool.query(`
      SELECT scenario,
             COUNT(*) AS total,
             SUM(CASE WHEN alert_status IN ('Completed', 'Closed', 'Filed', 'Closed — False Positive') AND case_converted = 0 THEN 1 ELSE 0 END) AS fp_count
        FROM alerts
       WHERE alert_status IN ('Completed', 'Closed', 'Filed', 'Closed — False Positive') AND scenario IS NOT NULL
         AND created_date BETWEEN $1 AND $2
       GROUP BY scenario
       ORDER BY (CAST(SUM(CASE WHEN alert_status IN ('Completed', 'Closed', 'Filed', 'Closed — False Positive') AND case_converted = 0 THEN 1.0 ELSE 0 END) AS DOUBLE PRECISION) / NULLIF(COUNT(*), 0)) DESC
       LIMIT 4
    `, [from, to])).rows.map(r => {
      const total = Number(r.total);
      const fp_count = Number(r.fp_count);
      return {
        scenario: r.scenario,
        total, fp_count,
        fp_rate_pct: total > 0 ? Math.round((fp_count / total) * 1000) / 10 : 0
      };
    });

    res.json({ rate_pct, benchmark_pct: 30, by_scenario, this_month_pct, last_month_pct });
  } catch (err) { next(err); }
});

// ─── 9. Unassigned Queue
router.get('/drawer/unassigned', async (req, res, next) => {
  try {
    const { from, to } = parseRange(req);
    const num = async (sql, p) => Number((await pool.query(sql, p)).rows[0].c);
    const total = await num(
      "SELECT COUNT(*) AS c FROM alerts WHERE alert_status = 'Unassigned' AND created_date BETWEEN $1 AND $2", [from, to]
    );
    const byPriority = (await pool.query(`
      SELECT priority, COUNT(*) AS c
        FROM alerts
       WHERE alert_status = 'Unassigned'
         AND created_date BETWEEN $1 AND $2
       GROUP BY priority
    `, [from, to])).rows;
    const by_priority = { High: 0, Medium: 0, Low: 0 };
    for (const r of byPriority) by_priority[r.priority || 'Low'] = Number(r.c);

    const analysts = await listAnalysts();
    const enriched = [];
    for (const a of analysts) {
      const open = await num(
        "SELECT COUNT(*) AS c FROM alerts WHERE assigned_to = $1 AND alert_status NOT IN ('Completed','Closed','Filed','Closed — False Positive') AND created_date BETWEEN $2 AND $3",
        [a.name, from, to]
      );
      const pct = Math.min(100, Math.round((open / ANALYST_CAPACITY) * 100));
      enriched.push({ ...a, open, capacity: ANALYST_CAPACITY, pct, can_take: Math.max(0, ANALYST_CAPACITY - open) });
    }
    const available = enriched
      .filter(a => a.pct < FATIGUED_AT * 100 && a.can_take > 0)
      .sort((a, b) => a.pct - b.pct);

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

    const top_5 = (await pool.query(`
      SELECT alert_id, scenario, priority, age_days
        FROM alerts
       WHERE alert_status = 'Unassigned'
         AND created_date BETWEEN $1 AND $2
       ORDER BY CASE priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END,
                age_days DESC
       LIMIT 5
    `, [from, to])).rows;

    res.json({ total, by_priority, available_analysts: available, recommendation, top_5 });
  } catch (err) { next(err); }
});

module.exports = router;
