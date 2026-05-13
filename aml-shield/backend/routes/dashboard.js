const express = require('express');
const pool = require('../database/db');
const { getManagerSetting } = require('../utils/getManagerSetting');

const router = express.Router();

// ─── Canonical alert_status taxonomy ──────────────────────────────────
// 'In Progress' is the canonical in-flight status (legacy 'Work in
// Progress' rows were canonicalised). 'Completed' is resolved-OK,
// 'Closed — False Positive' (em dash) is FP-closed. These constants are
// inlined into SQL fragments below so every KPI counts every relevant row.
const STATUS_IN_PROGRESS = "alert_status = 'In Progress'";
// Closed-state set: includes everything that's "no longer active" so KPIs
// like "Completed/Closed" and the FP-rate denominator capture the full
// set. Bulk-close writes 'Closed — False Positive'; the legacy path used
// 'Completed'; SAR submissions use 'Filed'.
const STATUS_CLOSED      = "alert_status IN ('Completed', 'Closed', 'Closed — False Positive')";
// "Open" = anything not closed. Used by the analyst-load and unassigned
// queries that need to ignore historical FP-closed rows.
const STATUS_NOT_CLOSED  = "alert_status NOT IN ('Completed', 'Closed', 'Closed — False Positive')";

// Real-time "is this alert currently breached?" criterion. Replaces the
// stale `sla_breached = 1` column flag — the latter was being set by an
// older slaMonitor run that didn't exclude FP-closed rows, and stays
// sticky even when the alert no longer needs attention. The new check
// recomputes from sla_deadline + alert_status on every query so the KPI
// always reflects the current state of the queue.
//
// NOTE: In-Progress alerts intentionally included in breach count —
// an actively-worked breach is the highest-priority signal for a manager,
// not something to hide.
const SLA_BREACHED_CONDITION = "sla_deadline IS NOT NULL AND sla_deadline::date < NOW()::date AND alert_status NOT IN ('Completed', 'Closed', 'Closed — False Positive', 'False Positive', 'Escalated - SAR')";

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

// Date-range parser for every /api/dashboard/* route.
//   - No params at all → return a span wide enough to include every row
//     ('2000-01-01' to today). Keeps the existing BETWEEN-clause SQL
//     working without any per-route rewrite.
//   - Either param supplied → fill the missing side with a 30-day default,
//     matching the historical "Last 30 days" behaviour.
function parseRange(req) {
  const q = req.query || {};
  const today = new Date();
  if (!q.from && !q.to) {
    return { from: '2000-01-01', to: today.toISOString().slice(0, 10) };
  }
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
    // PR3 / Issue 8: the operational dashboard reflects CURRENT STATE —
    // every open alert regardless of when it was created — so the global
    // date filter is no longer applied to operational counts. The endpoint
    // still accepts from/to for backward compatibility with the frontend
    // and other clients; only the trend chart and conversion-rate-window
    // metrics use a hard-coded window of their own below.
    const { from, to } = parseRange(req);
    const params = [];
    let whereSql = '';
    if (assigned_to) {
      params.push(assigned_to);
      whereSql = ` WHERE assigned_to = $${params.length}`;
    }
    const withAnd = whereSql ? whereSql + ' AND ' : ' WHERE ';

    const num = async (sql, p = params) => Number((await pool.query(sql, p)).rows[0].c);
    const numFrom = async (sql, p) => Number((await pool.query(sql, p)).rows[0].c);

    const totalAlerts = await num(`SELECT COUNT(*) AS c FROM alerts${whereSql}`);
    const unassigned  = await num(`SELECT COUNT(*) AS c FROM alerts${withAnd} alert_status = 'Unassigned'`);
    const notStarted  = await num(`SELECT COUNT(*) AS c FROM alerts${withAnd} alert_status = 'Not Started'`);
    const inProgress  = await num(`SELECT COUNT(*) AS c FROM alerts${withAnd} ${STATUS_IN_PROGRESS}`);
    const completed   = await num(`SELECT COUNT(*) AS c FROM alerts${withAnd} ${STATUS_CLOSED}`);
    const slaBreaches = await num(`SELECT COUNT(*) AS c FROM alerts${withAnd} (${SLA_BREACHED_CONDITION})`);
    const avgAging    = Number((await pool.query(`SELECT AVG(age_days) AS a FROM alerts${whereSql}`, params)).rows[0].a) || 0;
    const casesConverted = await num(`SELECT COUNT(*) AS c FROM alerts${withAnd} case_converted = 1`);

    const closedFalsePositives = await num(
      `SELECT COUNT(*) AS c FROM alerts${withAnd} ${STATUS_CLOSED} AND case_converted = 0`
    );
    const falsePositiveRate = completed > 0
      ? Math.round((closedFalsePositives / completed) * 100)
      : 0;

    // Trend chart genuinely needs a window — keep a hard-coded 30-day
    // window for the chart only.
    const trendWindowSql = "created_date >= (NOW() - INTERVAL '30 days')::date::text";
    const trend = (await pool.query(`
      SELECT created_date AS day, COUNT(*) AS alerts
        FROM alerts${whereSql}${whereSql ? ' AND ' : ' WHERE '} ${trendWindowSql}
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
      `SELECT age_days FROM alerts${withAnd} (${SLA_BREACHED_CONDITION})`, params
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
       ${withAnd} (${SLA_BREACHED_CONDITION})
       ORDER BY age_days DESC
       LIMIT 10
    `, params)).rows;

    // PR3 / Issue 9: capacity is per-role.
    //   L1 capacity comes from manager_settings.max_alerts_per_analyst (default 35).
    //   L2 capacity is fixed at 8 (L2 cases are deeper and longer).
    // The headline KPI flips from "team avg %" to "X of Y analysts overloaded"
    // — the per-analyst breakdown stays in the existing drawer.
    const l1Capacity = Number(await getManagerSetting('max_alerts_per_analyst', 35)) || 35;
    const L2_CAPACITY = 8;

    // PR3 / Issue 8: workload also drops the date filter — open count is
    // always current state. completed count keeps a 30-day window inside
    // the FILTER so the "what did this analyst close recently" view stays
    // meaningful.
    const workload = (await pool.query(`
      SELECT u.user_id,
             u.name AS analyst,
             u.role,
             u.team,
             u.avatar_color,
             COUNT(a.id) FILTER (WHERE a.alert_status NOT IN ('Completed','Closed','Closed — False Positive','False Positive')) AS open_alerts,
             COUNT(a.id) FILTER (WHERE ${STATUS_IN_PROGRESS}) AS in_progress,
             COUNT(a.id) FILTER (WHERE ${SLA_BREACHED_CONDITION}) AS breached,
             COUNT(a.id) FILTER (WHERE ${STATUS_CLOSED} AND closed_date >= (NOW() - INTERVAL '30 days')::date::text) AS completed
        FROM user_profiles u
        LEFT JOIN alerts a
          ON a.assigned_to = u.name
       WHERE u.status = 'Active'
         AND u.role IN ('analyst_l1', 'analyst_l2')
       GROUP BY u.user_id, u.name, u.role, u.team, u.avatar_color
       ORDER BY open_alerts DESC, u.name ASC
    `)).rows.map(r => {
      const open = Number(r.open_alerts);
      const inProgress = Number(r.in_progress);
      const roleCapacity = r.role === 'analyst_l2' ? L2_CAPACITY : l1Capacity;
      const isOverloaded = open > roleCapacity;
      const utilization_pct = roleCapacity > 0
        ? Math.min(999, Math.round((open / roleCapacity) * 100))
        : 0;
      return {
        user_id: r.user_id,
        analyst: r.analyst,
        role: r.role,
        team: r.team,
        avatar_color: r.avatar_color,
        // 'total' kept for legacy frontend callers — equals open_alerts now
        total: open,
        open_alerts: open,
        in_progress: inProgress,
        breached: Number(r.breached),
        completed: Number(r.completed),
        capacity: roleCapacity,
        role_capacity: roleCapacity,
        is_overloaded: isOverloaded,
        utilization_pct
      };
    });

    const overloadedCount = workload.filter(w => w.is_overloaded).length;
    const totalAnalysts = workload.length;

    // Conversion-rate metrics: keep all-time semantics (matches operational
    // counts above). The "in the period" numbers are not surfaced on the
    // dashboard anymore — they were tied to the now-removed date filter.
    const totalCases = await numFrom('SELECT COUNT(*) AS c FROM cases', []);
    const totalSars = await numFrom(
      "SELECT COUNT(*) AS c FROM sar_filings WHERE filed_date IS NOT NULL", []
    );
    const conversionRatePct = totalAlerts > 0
      ? Math.round((casesConverted / totalAlerts) * 1000) / 10
      : 0;

    // OFAC freshness signal for the dashboard stale-banner.
    const ofacLastSuccess = (await pool.query(
      "SELECT downloaded_at FROM ofac_download_log WHERE status = 'success' ORDER BY downloaded_at DESC LIMIT 1"
    )).rows[0] || null;
    const ofacLastAttempt = (await pool.query(
      "SELECT status FROM ofac_download_log ORDER BY downloaded_at DESC LIMIT 1"
    )).rows[0] || null;
    const hoursSinceSuccess = ofacLastSuccess
      ? (Date.now() - new Date(ofacLastSuccess.downloaded_at).getTime()) / 3600000
      : null;
    const ofacStatus = {
      last_success_at: ofacLastSuccess?.downloaded_at || null,
      last_status: ofacLastAttempt?.status || null,
      hours_since_success: hoursSinceSuccess != null ? Math.round(hoursSinceSuccess * 10) / 10 : null,
      is_stale: (ofacLastAttempt?.status === 'failed')
             || (hoursSinceSuccess != null && hoursSinceSuccess > 36)
             || (ofacLastSuccess == null)
    };

    // PR3 / Issue 13: program-health summary surfaced as the HealthStrip.
    // Each sub-pill returns { status: 'ok'|'warning'|'error'|'unknown',
    // message, …details }. Failures inside any block are swallowed so a
    // single broken table cannot crash the dashboard.
    const health = await buildHealthBlock({ ofacStatus });

    res.json({
      scope: { assigned_to: assigned_to || null, from, to },
      ofac_status: ofacStatus,
      health,
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
        // PR3 / Issue 9: new headline. team_capacity_pct preserved for
        // legacy consumers; drawer is unchanged.
        overloaded_count: overloadedCount,
        total_analysts: totalAnalysts,
        overload_headline: totalAnalysts > 0
          ? `${overloadedCount} of ${totalAnalysts} overloaded`
          : 'No active analysts',
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

// ───────────────────────── Issue 13: health block builder
//
// Returns { ofac, background_jobs, retention, kyc_queue } where each
// sub-block has `status` of 'ok' | 'warning' | 'error' | 'unknown' plus
// a short message and the raw counts the frontend pill needs.
async function buildHealthBlock({ ofacStatus }) {
  const health = {
    ofac: { status: 'unknown', message: null },
    background_jobs: { status: 'unknown', healthy_count: 0, total_count: 0, jobs: [] },
    retention: { status: 'unknown' },
    kyc_queue: { status: 'unknown' }
  };

  // OFAC pill — reuses the ofac_status computed for the stale banner.
  try {
    const hours = ofacStatus?.hours_since_success;
    let pendingAdj = 0;
    try {
      pendingAdj = Number((await pool.query(
        "SELECT COUNT(*) AS c FROM ofac_screening_results WHERE status = 'pending'"
      )).rows[0].c) || 0;
    } catch (_e) { /* leave at 0 */ }
    let status = 'ok';
    let message = null;
    if (ofacStatus?.last_status === 'failed') {
      status = 'error';
      message = `Last sync attempt failed${hours != null ? ` ${Math.round(hours)}h ago` : ''}`;
    } else if (hours != null && hours > 36) {
      status = 'error';
      message = `No successful sync in ${Math.round(hours)}h`;
    } else if (pendingAdj > 3) {
      status = 'warning';
      message = `${pendingAdj} OFAC matches pending adjudication`;
    }
    health.ofac = {
      status,
      last_sync_at: ofacStatus?.last_success_at || null,
      hours_since_sync: hours,
      pending_adjudications: pendingAdj,
      message
    };
  } catch (_e) { /* keep 'unknown' */ }

  // Background-job pill. The codebase doesn't have a sync_runs table yet —
  // only ofacSync has a real history via ofac_download_log. The other two
  // jobs (slaMonitor, kycReviewMonitor) report 'unknown' until that table
  // exists, with a message explaining why.
  try {
    const jobs = [];

    // ofacSync — real history available
    try {
      const r = await pool.query(
        "SELECT downloaded_at FROM ofac_download_log WHERE status = 'success' ORDER BY downloaded_at DESC LIMIT 1"
      );
      const last = r.rows[0]?.downloaded_at || null;
      const hours = last ? (Date.now() - new Date(last).getTime()) / 3600000 : null;
      jobs.push({
        name: 'ofacSync',
        last_success_at: last,
        status: last && hours <= 25 ? 'ok' : last ? 'error' : 'unknown'
      });
    } catch (_e) {
      jobs.push({ name: 'ofacSync', last_success_at: null, status: 'unknown' });
    }

    // slaMonitor + kycReviewMonitor — no history table; report unknown.
    jobs.push({
      name: 'slaMonitor',
      last_success_at: null,
      status: 'unknown',
      message: 'No run-history table; add sync_runs for precise tracking'
    });
    jobs.push({
      name: 'kycReviewMonitor',
      last_success_at: null,
      status: 'unknown',
      message: 'No run-history table; add sync_runs for precise tracking'
    });

    const healthyCount = jobs.filter(j => j.status === 'ok').length;
    const totalCount = jobs.length;
    let status;
    if (jobs.some(j => j.status === 'error')) status = 'error';
    else if (jobs.some(j => j.status === 'unknown')) status = 'warning';
    else status = 'ok';
    health.background_jobs = {
      status,
      healthy_count: healthyCount,
      total_count: totalCount,
      jobs,
      message: status === 'error'
        ? 'One or more jobs have no recent successful run'
        : status === 'warning'
          ? 'Some jobs have no run-history tracking'
          : null
    };
  } catch (_e) { /* keep 'unknown' */ }

  // Retention pill — SARs whose retention_expiry_date is within 30 days.
  try {
    const r = await pool.query(`
      SELECT
        COUNT(*) FILTER (
          WHERE retention_expiry_date IS NOT NULL
            AND retention_expiry_date::date <= (NOW() + INTERVAL '30 days')::date
            AND retention_expiry_date::date >= NOW()::date
            AND sar_status = 'Filed'
        )::int AS expiring_30,
        COUNT(*) FILTER (
          WHERE retention_expiry_date IS NOT NULL
            AND retention_expiry_date::date <= (NOW() + INTERVAL '90 days')::date
            AND retention_expiry_date::date >= NOW()::date
            AND sar_status = 'Filed'
        )::int AS expiring_90
      FROM sar_filings
    `);
    const e30 = Number(r.rows[0].expiring_30) || 0;
    const e90 = Number(r.rows[0].expiring_90) || 0;
    let status;
    if (e30 > 3) status = 'error';
    else if (e30 > 0) status = 'warning';
    else status = 'ok';
    health.retention = {
      status,
      expiring_within_30_days: e30,
      expiring_within_90_days: e90,
      message: status === 'error'
        ? `${e30} SARs expire within 30 days`
        : status === 'warning'
          ? `${e30} SAR expires within 30 days`
          : null
    };
  } catch (_e) { /* keep 'unknown' */ }

  // KYC queue pill — overdue and due-soon counts.
  try {
    const overdue = Number((await pool.query(
      "SELECT COUNT(*) AS c FROM kyc_reviews WHERE status = 'overdue'"
    )).rows[0].c) || 0;
    const dueSoon = Number((await pool.query(
      "SELECT COUNT(*) AS c FROM kyc_reviews WHERE due_date IS NOT NULL AND due_date::date <= (NOW() + INTERVAL '15 days')::date AND status NOT IN ('completed','approved')"
    )).rows[0].c) || 0;
    let status;
    if (overdue > 10) status = 'error';
    else if (overdue > 5) status = 'warning';
    else status = 'ok';
    health.kyc_queue = {
      status,
      overdue_count: overdue,
      due_soon_count: dueSoon,
      message: status === 'error'
        ? `${overdue} KYC reviews overdue`
        : status === 'warning'
          ? `${overdue} KYC reviews overdue`
          : null
    };
  } catch (_e) { /* keep 'unknown' */ }

  return health;
}

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
      "SELECT COUNT(*) AS c FROM alerts WHERE priority = 'High' AND alert_status NOT IN ('Completed','Closed','Closed — False Positive') AND created_date BETWEEN $1 AND $2",
      [from, to]
    );
    const breaching_today = await num(`
      SELECT COUNT(*) AS c FROM alerts
       WHERE alert_status NOT IN ('Completed','Closed','Closed — False Positive')
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
      "SELECT COUNT(*) AS c FROM alerts WHERE alert_status = 'In Progress' AND created_date BETWEEN $1 AND $2",
      [from, to]
    );
    // Single GROUP BY query joining user_profiles → alerts. Replaces the
    // previous N+1 pattern (one COUNT per analyst). Each analyst gets
    // in_progress + total_open in one round trip.
    const by_analyst = (await pool.query(`
      SELECT u.name,
             u.role,
             u.avatar_color,
             COUNT(a.id) FILTER (WHERE a.alert_status = 'In Progress') AS in_progress,
             COUNT(a.id) FILTER (WHERE a.alert_status NOT IN ('Completed','Closed','Closed — False Positive')) AS total_open
        FROM user_profiles u
        LEFT JOIN alerts a
          ON a.assigned_to = u.name
         AND a.created_date BETWEEN $1 AND $2
       WHERE u.status = 'Active'
         AND u.role IN ('analyst_l1', 'analyst_l2')
       GROUP BY u.name, u.role, u.avatar_color
       HAVING COUNT(a.id) FILTER (WHERE a.alert_status = 'In Progress') > 0
       ORDER BY in_progress DESC
    `, [from, to])).rows.map(r => {
      const inProgress = Number(r.in_progress);
      const totalOpen = Number(r.total_open);
      const level = /l2$/i.test(r.role || '') ? 'L2' : 'L1';
      return {
        name: r.name,
        role: r.role,
        level,
        initials: avatarInitials(r.name),
        avatar_color: r.avatar_color,
        in_progress: inProgress,
        total_open: totalOpen,
        capacity: ANALYST_CAPACITY,
        pct: Math.min(100, Math.round((totalOpen / ANALYST_CAPACITY) * 100))
      };
    });

    const oldest = (await pool.query(`
      SELECT alert_id, customer_name, age_days, priority
        FROM alerts
       WHERE alert_status = 'In Progress'
         AND created_date BETWEEN $1 AND $2
       ORDER BY age_days DESC
       LIMIT 3
    `, [from, to])).rows;

    const trend = await compareThisVsLast('alerts', 'last_activity_date', "alert_status = 'In Progress'");
    res.json({ total, by_analyst, oldest, trend });
  } catch (err) { next(err); }
});

// ─── 3. Completed
router.get('/drawer/completed', async (req, res, next) => {
  try {
    const { from, to } = parseRange(req);
    const num = async (sql, p) => Number((await pool.query(sql, p)).rows[0].c);
    const total = await num(
      "SELECT COUNT(*) AS c FROM alerts WHERE alert_status IN ('Completed', 'Closed', 'Closed — False Positive') AND created_date BETWEEN $1 AND $2",
      [from, to]
    );
    const fp = await num(
      "SELECT COUNT(*) AS c FROM alerts WHERE alert_status IN ('Completed', 'Closed', 'Closed — False Positive') AND case_converted = 0 AND created_date BETWEEN $1 AND $2",
      [from, to]
    );
    const l2 = await num(
      "SELECT COUNT(*) AS c FROM alerts WHERE alert_status IN ('Completed', 'Closed', 'Closed — False Positive') AND case_converted = 1 AND linked_sar_id IS NULL AND created_date BETWEEN $1 AND $2",
      [from, to]
    );
    const sar = await num(
      "SELECT COUNT(*) AS c FROM alerts WHERE alert_status IN ('Completed', 'Closed', 'Closed — False Positive') AND linked_sar_id IS NOT NULL AND created_date BETWEEN $1 AND $2",
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
       WHERE alert_status IN ('Completed', 'Closed', 'Closed — False Positive')
         AND closed_date IS NOT NULL
         AND created_date BETWEEN $1 AND $2
       ORDER BY days ASC
       LIMIT 3
    `, [from, to])).rows;

    const trend = await compareThisVsLast('alerts', 'closed_date', "alert_status IN ('Completed', 'Closed', 'Closed — False Positive')");
    res.json({ total, fp, l2, sar, by_week, fastest, trend });
  } catch (err) { next(err); }
});

// ─── 4. SLA Breaches
router.get('/drawer/sla-breaches', async (req, res, next) => {
  try {
    const { from, to } = parseRange(req);
    const num = async (sql, p) => Number((await pool.query(sql, p)).rows[0].c);
    const total = await num(
      `SELECT COUNT(*) AS c FROM alerts WHERE (${SLA_BREACHED_CONDITION}) AND created_date BETWEEN $1 AND $2`,
      [from, to]
    );

    const overdue = (await pool.query(`
      SELECT alert_id, customer_name, scenario, assigned_to, priority, created_date,
             CAST(GREATEST(0, EXTRACT(EPOCH FROM (NOW() - sla_deadline::timestamp))/86400) AS INTEGER) AS days_overdue
        FROM alerts
       WHERE (${SLA_BREACHED_CONDITION})
         AND sla_deadline IS NOT NULL
         AND alert_status NOT IN ('Completed','Closed','Closed — False Positive')
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
       WHERE (${SLA_BREACHED_CONDITION})
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

    const trendBreached = await compareThisVsLast('alerts', 'created_date', `(${SLA_BREACHED_CONDITION})`);

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
       WHERE alert_status NOT IN ('Completed','Closed','Closed — False Positive')
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

    // Single GROUP BY query: every active analyst with their open count
    // in one round trip. Active-only roster avoids ghost rows.
    const enriched = (await pool.query(`
      SELECT u.name,
             u.role,
             u.team,
             u.avatar_color,
             COUNT(a.id) FILTER (WHERE a.alert_status NOT IN ('Completed','Closed','Closed — False Positive')) AS open
        FROM user_profiles u
        LEFT JOIN alerts a
          ON a.assigned_to = u.name
         AND a.created_date BETWEEN $1 AND $2
       WHERE u.status = 'Active'
         AND u.role IN ('analyst_l1', 'analyst_l2')
       GROUP BY u.name, u.role, u.team, u.avatar_color
       ORDER BY open DESC, u.name ASC
    `, [from, to])).rows.map(r => {
      const open = Number(r.open);
      const level = /l2$/i.test(r.role || '') ? 'L2' : 'L1';
      return {
        name: r.name,
        role: r.role,
        level,
        team: r.team,
        avatar_color: r.avatar_color,
        initials: avatarInitials(r.name),
        open,
        capacity: ANALYST_CAPACITY,
        pct: Math.min(100, Math.round((open / ANALYST_CAPACITY) * 100))
      };
    });
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
      "SELECT COUNT(*) AS c FROM alerts WHERE alert_status IN ('Completed', 'Closed', 'Closed — False Positive') AND created_date BETWEEN $1 AND $2", [from, to]
    );
    const fp = await num(
      "SELECT COUNT(*) AS c FROM alerts WHERE alert_status IN ('Completed', 'Closed', 'Closed — False Positive') AND case_converted = 0 AND created_date BETWEEN $1 AND $2", [from, to]
    );
    const rate_pct = closed > 0 ? Math.round((fp / closed) * 1000) / 10 : 0;

    const monthRate = async (sinceExpr, untilExpr) => {
      const sql = `SELECT
        SUM(CASE WHEN alert_status IN ('Completed', 'Closed', 'Closed — False Positive') AND case_converted = 0 THEN 1 ELSE 0 END) AS fp,
        SUM(CASE WHEN alert_status IN ('Completed', 'Closed', 'Closed — False Positive') THEN 1 ELSE 0 END) AS closed
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
             SUM(CASE WHEN alert_status IN ('Completed', 'Closed', 'Closed — False Positive') AND case_converted = 0 THEN 1 ELSE 0 END) AS fp_count
        FROM alerts
       WHERE alert_status IN ('Completed', 'Closed', 'Closed — False Positive') AND scenario IS NOT NULL
         AND created_date BETWEEN $1 AND $2
       GROUP BY scenario
       ORDER BY (CAST(SUM(CASE WHEN alert_status IN ('Completed', 'Closed', 'Closed — False Positive') AND case_converted = 0 THEN 1.0 ELSE 0 END) AS DOUBLE PRECISION) / NULLIF(COUNT(*), 0)) DESC
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

    // Single GROUP BY query for analyst capacity (replaces per-analyst N+1).
    const enriched = (await pool.query(`
      SELECT u.name,
             u.role,
             u.avatar_color,
             COUNT(a.id) FILTER (WHERE a.alert_status NOT IN ('Completed','Closed','Closed — False Positive')) AS open
        FROM user_profiles u
        LEFT JOIN alerts a
          ON a.assigned_to = u.name
         AND a.created_date BETWEEN $1 AND $2
       WHERE u.status = 'Active'
         AND u.role IN ('analyst_l1', 'analyst_l2')
       GROUP BY u.name, u.role, u.avatar_color
       ORDER BY open ASC, u.name ASC
    `, [from, to])).rows.map(r => {
      const open = Number(r.open);
      const pct = Math.min(100, Math.round((open / ANALYST_CAPACITY) * 100));
      const level = /l2$/i.test(r.role || '') ? 'L2' : 'L1';
      return {
        name: r.name,
        role: r.role,
        level,
        avatar_color: r.avatar_color,
        initials: avatarInitials(r.name),
        open,
        capacity: ANALYST_CAPACITY,
        pct,
        can_take: Math.max(0, ANALYST_CAPACITY - open)
      };
    });
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

// ─────────────────────────────────────────────── Manager worklist
//
// "Your Queue Today" — five action counts surfaced above the KPI grid
// so the manager can see at a glance what personally needs their
// attention. Five queries fire in parallel; each is independent and
// returns a small `{ count, oldest_days, label, urgent }` shape.
//
// Status / column conventions used here:
//   SARs:           sar_filings.sar_status = 'Pending Approval'
//   KYC:            kyc_reviews.status     = 'pending_approval'  (snake_case is the canonical value)
//   OFAC:           ofac_screening_results.status = 'pending'
//   L2 returns:     alerts.returned_from_l2_at IS NOT NULL (semantic column, not a status string)
//   Legal holds:    table doesn't exist yet → graceful 0 via try/catch
router.get('/worklist', async (_req, res, next) => {
  try {
    const sarQ = pool.query(`
      SELECT COUNT(*)::int AS count,
             MIN(submitted_at)                                      AS oldest_at,
             EXTRACT(DAY FROM NOW() - MIN(submitted_at)::timestamptz)::int AS oldest_days
        FROM sar_filings
       WHERE sar_status = 'Pending Approval'
    `);

    const kycQ = pool.query(`
      SELECT COUNT(*)::int AS count,
             MIN(completed_at)                                       AS oldest_at,
             EXTRACT(DAY FROM NOW() - MIN(completed_at)::timestamptz)::int AS oldest_days
        FROM kyc_reviews
       WHERE status = 'pending_approval'
    `);

    const ofacQ = pool.query(`
      SELECT COUNT(*)::int AS count,
             MIN(screened_at) AS oldest_at,
             EXTRACT(DAY FROM NOW() - MIN(screened_at))::int AS oldest_days
        FROM ofac_screening_results
       WHERE status = 'pending'
    `);

    const returnedQ = pool.query(`
      SELECT COUNT(*)::int AS count,
             MAX(returned_from_l2_at) AS most_recent
        FROM alerts
       WHERE returned_from_l2_at IS NOT NULL
         AND alert_status NOT IN ('Completed', 'Closed', 'Closed — False Positive')
    `);

    // Legal holds table is not built yet; query in a try/catch and fall
    // back to zero if the table is missing.
    const holdsQ = (async () => {
      try {
        const exists = await pool.query(
          "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'legal_holds') AS e"
        );
        if (!exists.rows[0].e) return { rows: [{ count: 0 }] };
        return await pool.query(
          'SELECT COUNT(*)::int AS count FROM legal_holds WHERE lifted_at IS NULL'
        );
      } catch (_e) {
        return { rows: [{ count: 0 }] };
      }
    })();

    const [sars, kyc, ofac, returned, holds] = await Promise.all([
      sarQ, kycQ, ofacQ, returnedQ, holdsQ
    ]);

    const sarsRow     = sars.rows[0]     || { count: 0, oldest_days: null };
    const kycRow      = kyc.rows[0]      || { count: 0, oldest_days: null };
    const ofacRow     = ofac.rows[0]     || { count: 0, oldest_days: null };
    const returnedRow = returned.rows[0] || { count: 0, most_recent: null };
    const holdsRow    = holds.rows[0]    || { count: 0 };

    res.json({
      sars_pending_approval: {
        count: Number(sarsRow.count) || 0,
        oldest_days: sarsRow.oldest_days != null ? Number(sarsRow.oldest_days) : null,
        oldest_at: sarsRow.oldest_at || null,
        label: 'SARs awaiting approval',
        urgent: (Number(sarsRow.oldest_days) || 0) > 7
      },
      kyc_pending_approval: {
        count: Number(kycRow.count) || 0,
        oldest_days: kycRow.oldest_days != null ? Number(kycRow.oldest_days) : null,
        oldest_at: kycRow.oldest_at || null,
        label: 'KYC reviews awaiting approval',
        urgent: (Number(kycRow.oldest_days) || 0) > 7
      },
      ofac_pending_review: {
        count: Number(ofacRow.count) || 0,
        oldest_days: ofacRow.oldest_days != null ? Number(ofacRow.oldest_days) : null,
        oldest_at: ofacRow.oldest_at || null,
        label: 'OFAC matches to adjudicate',
        urgent: (Number(ofacRow.oldest_days) || 0) > 5
      },
      alerts_returned_from_l2: {
        count: Number(returnedRow.count) || 0,
        most_recent: returnedRow.most_recent || null,
        label: 'Alerts returned from L2',
        urgent: (Number(returnedRow.count) || 0) > 0
      },
      active_legal_holds: {
        count: Number(holdsRow.count) || 0,
        label: 'Active legal holds',
        urgent: false,
        not_implemented: true   // surfaces the "Coming soon" badge on the frontend
      },
      generated_at: new Date().toISOString()
    });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────── Issue 11: SAR 30-day clock
//
// FinCEN 31 CFR 1020.320(b)(3) requires SARs to be filed within 30 days
// of detecting suspicious activity. There is no detection_date column on
// alerts today, so alerts.created_date is used as the proxy with a comment.
// When a real detection_date is added, swap COALESCE(a.detection_date, a.created_date)
// in below. The join chain is sar_filings → cases → alerts → customers
// using cases.source_alert_id (the actual FK; cases.alert_id does not exist).
router.get('/sar-clock', async (_req, res, next) => {
  try {
    const rows = (await pool.query(`
      SELECT sf.sar_id,
             sf.sar_status,
             sf.case_id,
             c.customer_id,
             cu.customer_name,
             a.alert_id,
             a.created_date::date                                      AS detection_date,
             sf.submitted_at,
             (NOW()::date - a.created_date::date)                      AS days_since_detection,
             (30 - (NOW()::date - a.created_date::date))               AS days_remaining
        FROM sar_filings sf
        JOIN cases c       ON sf.case_id = c.case_id
        JOIN alerts a      ON c.source_alert_id = a.alert_id
        JOIN customers cu  ON a.customer_id = cu.customer_id
       WHERE sf.sar_status NOT IN ('Filed', 'Draft')
       ORDER BY days_remaining ASC
    `)).rows;

    const items = rows.map(r => {
      const daysRemaining = Number(r.days_remaining);
      let urgency;
      if (daysRemaining < 0)      urgency = 'overdue';
      else if (daysRemaining <= 3) urgency = 'critical';
      else if (daysRemaining <= 7) urgency = 'warning';
      else                         urgency = 'ok';
      return {
        sar_id: r.sar_id,
        sar_status: r.sar_status,
        case_id: r.case_id,
        customer_id: r.customer_id,
        customer_name: r.customer_name,
        alert_id: r.alert_id,
        detection_date: r.detection_date,
        submitted_at: r.submitted_at || null,
        days_since_detection: Number(r.days_since_detection),
        days_remaining: daysRemaining,
        urgency
      };
    });

    res.json({
      generated_at: new Date().toISOString(),
      detection_date_source: 'alerts.created_date (proxy; no detection_date column yet)',
      overdue: items.filter(i => i.urgency === 'overdue').length,
      due_within_3_days: items.filter(i => i.urgency === 'critical').length,
      due_within_7_days: items.filter(i => i.urgency === 'warning').length,
      in_flight: items.length,
      items
    });
  } catch (err) { next(err); }
});

module.exports = router;
