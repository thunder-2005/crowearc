const express = require('express');
const { db } = require('../database/db');

const router = express.Router();

// ─────────────────────────────────────────────── helpers

function parseRange(req) {
  const today = new Date();
  const toDate = req.query.to ? new Date(req.query.to) : today;
  const fromDate = req.query.from
    ? new Date(req.query.from)
    : new Date(today.getTime() - 365 * 24 * 3600 * 1000);
  const granularity = req.query.granularity === 'week' ? 'week' : 'month';
  return {
    fromStr: ymd(fromDate),
    toStr: ymd(toDate),
    granularity
  };
}

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// SQL period expression operating on a date column.
function periodSql(col, granularity) {
  if (granularity === 'week') return `date(${col}, 'weekday 1', '-7 days')`;
  return `strftime('%Y-%m', ${col})`;
}

// Build the canonical period series in JS so we can fill zero rows for empty buckets.
function buildPeriods(fromStr, toStr, granularity) {
  const out = [];
  const from = new Date(fromStr + 'T00:00:00');
  const to = new Date(toStr + 'T23:59:59');
  if (granularity === 'week') {
    const cur = new Date(from);
    const dow = (cur.getDay() + 6) % 7; // Mon=0
    cur.setDate(cur.getDate() - dow);
    while (cur <= to) {
      const key = ymd(cur);
      out.push({
        key,
        label: cur.toLocaleString('en-US', { month: 'short', day: 'numeric' })
      });
      cur.setDate(cur.getDate() + 7);
    }
  } else {
    const cur = new Date(from.getFullYear(), from.getMonth(), 1);
    const end = new Date(to.getFullYear(), to.getMonth(), 1);
    while (cur <= end) {
      const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`;
      out.push({
        key,
        label: cur.toLocaleString('en-US', { month: 'short', year: '2-digit' })
      });
      cur.setMonth(cur.getMonth() + 1);
    }
  }
  return out;
}

// Merge a key→value map into the period series so empty buckets show as zero.
function fillSeries(periods, byKey, defaults = {}) {
  return periods.map(p => ({
    period: p.key,
    label: p.label,
    ...defaults,
    ...(byKey[p.key] || {})
  }));
}

// ─────────────────────────────────────────────── TAB 1: ALERT TRENDS

router.get('/alert-trends', (req, res) => {
  const { fromStr, toStr, granularity } = parseRange(req);
  const periods = buildPeriods(fromStr, toStr, granularity);

  // Volume — new alerts (by created_date) and closed alerts (by closed_date)
  const newRows = db.prepare(`
    SELECT ${periodSql('created_date', granularity)} AS pk, COUNT(*) AS n
      FROM alerts
     WHERE date(created_date) BETWEEN ? AND ?
     GROUP BY pk
  `).all(fromStr, toStr);

  const closedRows = db.prepare(`
    SELECT ${periodSql('closed_date', granularity)} AS pk, COUNT(*) AS n
      FROM alerts
     WHERE closed_date IS NOT NULL
       AND date(closed_date) BETWEEN ? AND ?
     GROUP BY pk
  `).all(fromStr, toStr);

  const volMap = {};
  for (const r of newRows) (volMap[r.pk] ||= { new: 0, closed: 0 }).new = r.n;
  for (const r of closedRows) (volMap[r.pk] ||= { new: 0, closed: 0 }).closed = r.n;
  const volume = fillSeries(periods, volMap, { new: 0, closed: 0 });

  // FP rate by period of closed_date — closed FP / total closed
  const fpRows = db.prepare(`
    SELECT ${periodSql('closed_date', granularity)} AS pk,
           COUNT(*) AS total_closed,
           SUM(CASE WHEN case_converted = 0 THEN 1 ELSE 0 END) AS fp
      FROM alerts
     WHERE closed_date IS NOT NULL
       AND alert_status = 'Completed'
       AND date(closed_date) BETWEEN ? AND ?
     GROUP BY pk
  `).all(fromStr, toStr);
  const fpMap = {};
  for (const r of fpRows) {
    fpMap[r.pk] = {
      total_closed: r.total_closed,
      fp: r.fp,
      fp_pct: r.total_closed > 0 ? Math.round((r.fp / r.total_closed) * 100) : 0
    };
  }
  const false_positive_rate = fillSeries(periods, fpMap, { total_closed: 0, fp: 0, fp_pct: 0 });

  // Age distribution at close time
  const ageRows = db.prepare(`
    SELECT ${periodSql('closed_date', granularity)} AS pk,
           julianday(closed_date) - julianday(created_date) AS age
      FROM alerts
     WHERE closed_date IS NOT NULL
       AND date(closed_date) BETWEEN ? AND ?
  `).all(fromStr, toStr);
  const ageMap = {};
  for (const r of ageRows) {
    const a = r.age || 0;
    const bucket = a < 7 ? 'lt7' : a < 15 ? 'd7_15' : a < 30 ? 'd15_30' : 'gt30';
    (ageMap[r.pk] ||= { lt7: 0, d7_15: 0, d15_30: 0, gt30: 0 })[bucket]++;
  }
  const age_distribution = fillSeries(periods, ageMap, { lt7: 0, d7_15: 0, d15_30: 0, gt30: 0 });

  // Disposition breakdown — derived from data signals (works regardless of disposition text)
  const dispRows = db.prepare(`
    SELECT ${periodSql('closed_date', granularity)} AS pk,
           CASE
             WHEN linked_sar_id IS NOT NULL                 THEN 'escalated_sar'
             WHEN case_converted = 1                        THEN 'escalated_l2'
             WHEN alert_status = 'Completed' AND case_converted = 0
                                                            THEN 'false_positive'
             ELSE 'other_closed'
           END AS bucket,
           COUNT(*) AS n
      FROM alerts
     WHERE closed_date IS NOT NULL
       AND date(closed_date) BETWEEN ? AND ?
     GROUP BY pk, bucket
  `).all(fromStr, toStr);
  const dispMap = {};
  for (const r of dispRows) {
    (dispMap[r.pk] ||= { false_positive: 0, escalated_l2: 0, escalated_sar: 0, other_closed: 0 })[r.bucket] = r.n;
  }
  const disposition_breakdown = fillSeries(periods, dispMap, {
    false_positive: 0, escalated_l2: 0, escalated_sar: 0, other_closed: 0
  });

  // Volume by scenario over time
  const scenRows = db.prepare(`
    SELECT ${periodSql('created_date', granularity)} AS pk,
           scenario,
           COUNT(*) AS n
      FROM alerts
     WHERE date(created_date) BETWEEN ? AND ?
     GROUP BY pk, scenario
  `).all(fromStr, toStr);
  const scenarios = [...new Set(scenRows.map(r => r.scenario).filter(Boolean))];
  const scenMap = {};
  for (const r of scenRows) {
    (scenMap[r.pk] ||= {})[r.scenario] = r.n;
  }
  const empty = Object.fromEntries(scenarios.map(s => [s, 0]));
  const by_scenario = fillSeries(periods, scenMap, empty);

  // Backlog flag — true if closed < new in majority of recent buckets
  const recent = volume.slice(-Math.min(6, volume.length));
  const backlogGrowing = recent.length >= 2 &&
    recent.filter(p => p.closed < p.new).length >= Math.ceil(recent.length / 2);

  res.json({
    range: { from: fromStr, to: toStr, granularity },
    volume,
    false_positive_rate,
    age_distribution,
    disposition_breakdown,
    by_scenario,
    scenarios,
    backlog_growing: backlogGrowing
  });
});

// ─────────────────────────────────────────────── TAB 2: SAR TRENDS

router.get('/sar-trends', (req, res) => {
  const { fromStr, toStr, granularity } = parseRange(req);
  const periods = buildPeriods(fromStr, toStr, granularity);
  // SARs use filed_date when present, else draft_created_date
  const dateCol = "COALESCE(filed_date, draft_created_date)";

  // Filing volume by sar_type per period
  const volRows = db.prepare(`
    SELECT ${periodSql(dateCol, granularity)} AS pk,
           COALESCE(NULLIF(sar_type, ''), 'Initial SAR') AS type,
           COUNT(*) AS n
      FROM sar_filings
     WHERE ${dateCol} IS NOT NULL
       AND date(${dateCol}) BETWEEN ? AND ?
     GROUP BY pk, type
  `).all(fromStr, toStr);
  const sarTypes = [...new Set(volRows.map(r => r.type))];
  if (!sarTypes.includes('Initial SAR')) sarTypes.unshift('Initial SAR');
  const volMap = {};
  for (const r of volRows) {
    (volMap[r.pk] ||= {})[r.type] = r.n;
  }
  const typeDefault = Object.fromEntries(sarTypes.map(t => [t, 0]));
  const filing_volume = fillSeries(periods, volMap, typeDefault).map(row => {
    const total = sarTypes.reduce((s, t) => s + (row[t] || 0), 0);
    return { ...row, total };
  });
  const totalAll = filing_volume.reduce((s, r) => s + r.total, 0);
  const filing_volume_avg = filing_volume.length > 0
    ? Math.round((totalAll / filing_volume.length) * 10) / 10
    : 0;

  // Conversion rate — alerts in period that ended up linked to a SAR / total alerts in period
  const convRows = db.prepare(`
    SELECT ${periodSql('created_date', granularity)} AS pk,
           COUNT(*) AS alerts,
           SUM(CASE WHEN linked_sar_id IS NOT NULL THEN 1 ELSE 0 END) AS sars
      FROM alerts
     WHERE date(created_date) BETWEEN ? AND ?
     GROUP BY pk
  `).all(fromStr, toStr);
  const convMap = {};
  for (const r of convRows) {
    convMap[r.pk] = {
      alerts: r.alerts,
      sars: r.sars,
      rate_pct: r.alerts > 0 ? Math.round((r.sars / r.alerts) * 1000) / 10 : 0
    };
  }
  const conversion_rate = fillSeries(periods, convMap, { alerts: 0, sars: 0, rate_pct: 0 });

  // Timeliness — filed within 30 days of detection
  const timelyRows = db.prepare(`
    SELECT ${periodSql('filed_date', granularity)} AS pk,
           julianday(filed_date) - julianday(COALESCE(detection_date, draft_created_date)) AS days
      FROM sar_filings
     WHERE filed_date IS NOT NULL
       AND date(filed_date) BETWEEN ? AND ?
  `).all(fromStr, toStr);
  const timelyMap = {};
  for (const r of timelyRows) {
    const onTime = (r.days != null && r.days <= 30) ? 1 : 0;
    const m = (timelyMap[r.pk] ||= { on_time: 0, late: 0 });
    if (onTime) m.on_time++; else m.late++;
  }
  const timeliness = fillSeries(periods, timelyMap, { on_time: 0, late: 0 }).map(r => {
    const total = r.on_time + r.late;
    return { ...r, compliance_pct: total > 0 ? Math.round((r.on_time / total) * 100) : 0 };
  });

  // Dollar amount filed per period
  const dollarRows = db.prepare(`
    SELECT ${periodSql(dateCol, granularity)} AS pk,
           SUM(COALESCE(total_amount, amount_involved_inr, 0)) AS amount
      FROM sar_filings
     WHERE ${dateCol} IS NOT NULL
       AND date(${dateCol}) BETWEEN ? AND ?
     GROUP BY pk
  `).all(fromStr, toStr);
  const dollarMap = {};
  for (const r of dollarRows) dollarMap[r.pk] = { amount: r.amount || 0 };
  const dollar_amount = fillSeries(periods, dollarMap, { amount: 0 });

  // Rejection rate — submitted (Pending/Under Review/Filed/Rejected/Returned) vs rejected/returned
  const rejRows = db.prepare(`
    SELECT ${periodSql('updated_at', granularity)} AS pk,
           COUNT(*) AS submitted,
           SUM(CASE WHEN sar_status IN ('Rejected', 'Returned for Revision') OR returned_to_analyst = 1
                    THEN 1 ELSE 0 END) AS rejected
      FROM sar_filings
     WHERE updated_at IS NOT NULL
       AND date(updated_at) BETWEEN ? AND ?
       AND sar_status IN ('Pending Approval', 'Under Manager Review', 'Filed', 'Rejected', 'Returned for Revision')
     GROUP BY pk
  `).all(fromStr, toStr);
  const rejMap = {};
  for (const r of rejRows) {
    rejMap[r.pk] = {
      submitted: r.submitted,
      rejected: r.rejected,
      rate_pct: r.submitted > 0 ? Math.round((r.rejected / r.submitted) * 1000) / 10 : 0
    };
  }
  const rejection_rate = fillSeries(periods, rejMap, { submitted: 0, rejected: 0, rate_pct: 0 });

  // Top rejection reasons in window
  const rejReasons = db.prepare(`
    SELECT COALESCE(NULLIF(rejection_reason_category, ''), 'Other') AS reason,
           COUNT(*) AS count
      FROM sar_filings
     WHERE rejected_at IS NOT NULL
       AND date(rejected_at) BETWEEN ? AND ?
     GROUP BY reason
     ORDER BY count DESC
     LIMIT 10
  `).all(fromStr, toStr);

  // Trend flag — last 3 buckets vs previous 3
  const recent = rejection_rate.slice(-3);
  const prev = rejection_rate.slice(-6, -3);
  const avg = a => a.length ? a.reduce((s, x) => s + x.rate_pct, 0) / a.length : 0;
  const rejection_trending_up = avg(recent) > avg(prev) + 2;

  res.json({
    range: { from: fromStr, to: toStr, granularity },
    filing_volume,
    sar_types: sarTypes,
    filing_volume_avg,
    conversion_rate,
    timeliness,
    dollar_amount,
    rejection_rate,
    rejection_reasons: rejReasons,
    rejection_trending_up
  });
});

// ─────────────────────────────────────────────── TAB 3: TEAM PERFORMANCE

router.get('/team-performance', (req, res) => {
  const { fromStr, toStr, granularity } = parseRange(req);
  const periods = buildPeriods(fromStr, toStr, granularity);

  // SLA target from settings (median across high/medium/low) — default 30
  const slaSetting = db.prepare(
    `SELECT setting_value FROM manager_settings WHERE setting_key IN ('sla.high_days','sla.medium_days','sla.low_days')`
  ).all();
  const slaTargetDays = slaSetting.length
    ? Math.round(slaSetting.reduce((s, r) => s + (parseInt(JSON.parse(r.setting_value), 10) || 0), 0) / slaSetting.length)
    : 30;

  // Capacity threshold from settings
  const capRow = db.prepare(
    `SELECT setting_value FROM manager_settings WHERE setting_key = 'team.capacity_warn_pct'`
  ).get();
  const capacityThresholdPct = capRow ? (parseInt(JSON.parse(capRow.setting_value), 10) || 85) : 85;

  // Avg resolution per period
  const avgRows = db.prepare(`
    SELECT ${periodSql('closed_date', granularity)} AS pk,
           AVG(julianday(closed_date) - julianday(created_date)) AS avg_days
      FROM alerts
     WHERE closed_date IS NOT NULL
       AND date(closed_date) BETWEEN ? AND ?
     GROUP BY pk
  `).all(fromStr, toStr);
  const avgMap = {};
  for (const r of avgRows) avgMap[r.pk] = { avg_days: Math.round((r.avg_days || 0) * 10) / 10 };
  const avg_resolution = fillSeries(periods, avgMap, { avg_days: 0 });

  // SLA breach rate per priority per period
  const slaRows = db.prepare(`
    SELECT ${periodSql('created_date', granularity)} AS pk,
           priority,
           COUNT(*) AS total,
           SUM(CASE WHEN sla_breached = 1 THEN 1 ELSE 0 END) AS breached
      FROM alerts
     WHERE date(created_date) BETWEEN ? AND ?
     GROUP BY pk, priority
  `).all(fromStr, toStr);
  const slaMap = {};
  for (const r of slaRows) {
    const key = (r.priority || '').toLowerCase();
    const m = (slaMap[r.pk] ||= { high_pct: 0, medium_pct: 0, low_pct: 0 });
    const pct = r.total > 0 ? Math.round((r.breached / r.total) * 100) : 0;
    if (key === 'high') m.high_pct = pct;
    else if (key === 'medium') m.medium_pct = pct;
    else if (key === 'low') m.low_pct = pct;
  }
  const sla_breach_rate = fillSeries(periods, slaMap, { high_pct: 0, medium_pct: 0, low_pct: 0 });

  // Productivity — alerts closed per analyst per period
  const prodRows = db.prepare(`
    SELECT ${periodSql('closed_date', granularity)} AS pk,
           assigned_to AS analyst,
           COUNT(*) AS closed
      FROM alerts
     WHERE closed_date IS NOT NULL
       AND assigned_to IS NOT NULL AND TRIM(assigned_to) <> ''
       AND date(closed_date) BETWEEN ? AND ?
     GROUP BY pk, analyst
  `).all(fromStr, toStr);
  const analystSet = [...new Set(prodRows.map(r => r.analyst))].sort();
  const prodMap = {};
  for (const r of prodRows) {
    (prodMap[r.pk] ||= {})[r.analyst] = r.closed;
  }
  const prodDefault = Object.fromEntries(analystSet.map(a => [a, 0]));
  const productivity = fillSeries(periods, prodMap, prodDefault).map(row => {
    const total = analystSet.reduce((s, a) => s + (row[a] || 0), 0);
    const team_avg = analystSet.length > 0
      ? Math.round((total / analystSet.length) * 10) / 10
      : 0;
    return { ...row, team_avg };
  });

  // Workload balance — capacity % per analyst per period (open alerts in period vs capacity 15)
  const capacity = 15;
  const workRows = db.prepare(`
    SELECT ${periodSql('created_date', granularity)} AS pk,
           assigned_to AS analyst,
           COUNT(*) AS open_count
      FROM alerts
     WHERE assigned_to IS NOT NULL AND TRIM(assigned_to) <> ''
       AND date(created_date) BETWEEN ? AND ?
     GROUP BY pk, analyst
  `).all(fromStr, toStr);
  const workMap = {};
  for (const r of workRows) {
    (workMap[r.pk] ||= {})[r.analyst] = Math.min(100, Math.round((r.open_count / capacity) * 100));
  }
  const workDefault = Object.fromEntries(analystSet.map(a => [a, 0]));
  const workload_balance = fillSeries(periods, workMap, workDefault);

  // Activity heatmap — case_notes per analyst per week within range
  const heatRows = db.prepare(`
    SELECT date(timestamp, 'weekday 1', '-7 days') AS week_start,
           analyst,
           COUNT(*) AS n
      FROM case_notes
     WHERE analyst IS NOT NULL AND TRIM(analyst) <> ''
       AND date(timestamp) BETWEEN ? AND ?
     GROUP BY week_start, analyst
  `).all(fromStr, toStr);
  // Build week list
  const weekList = [];
  {
    const cur = new Date(fromStr + 'T00:00:00');
    const dow = (cur.getDay() + 6) % 7;
    cur.setDate(cur.getDate() - dow);
    const end = new Date(toStr + 'T23:59:59');
    while (cur <= end) {
      weekList.push(ymd(cur));
      cur.setDate(cur.getDate() + 7);
    }
  }
  const heatAnalystSet = [...new Set([...heatRows.map(r => r.analyst), ...analystSet])].sort();
  const heatmapRows = heatAnalystSet.map(a => {
    const byWeek = {};
    for (const r of heatRows) if (r.analyst === a) byWeek[r.week_start] = r.n;
    return { analyst: a, values: weekList.map(w => byWeek[w] || 0) };
  });

  res.json({
    range: { from: fromStr, to: toStr, granularity },
    avg_resolution,
    sla_target_days: slaTargetDays,
    sla_breach_rate,
    productivity,
    analysts: analystSet,
    workload_balance,
    capacity_threshold_pct: capacityThresholdPct,
    activity_heatmap: {
      weeks: weekList.map(w => {
        const d = new Date(w + 'T00:00:00');
        return d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
      }),
      week_keys: weekList,
      rows: heatmapRows
    }
  });
});

// ─────────────────────────────────────────────── TAB 4: RULE EFFECTIVENESS

router.get('/rule-effectiveness', (req, res) => {
  const { fromStr, toStr } = parseRange(req);
  const rows = db.prepare(`
    SELECT scenario,
           COUNT(*) AS total,
           SUM(CASE WHEN case_converted = 1 THEN 1 ELSE 0 END) AS true_positive,
           SUM(CASE WHEN alert_status = 'Completed' AND case_converted = 0 THEN 1 ELSE 0 END) AS false_positive,
           SUM(CASE WHEN linked_sar_id IS NOT NULL THEN 1 ELSE 0 END) AS sar_count,
           AVG(CASE WHEN closed_date IS NOT NULL
                    THEN julianday(closed_date) - julianday(created_date)
                    ELSE NULL END) AS avg_resolution
      FROM alerts
     WHERE date(created_date) BETWEEN ? AND ?
       AND scenario IS NOT NULL
     GROUP BY scenario
     ORDER BY total DESC
  `).all(fromStr, toStr);

  const scenarios = rows.map(r => ({
    scenario: r.scenario,
    total: r.total,
    true_positive: r.true_positive,
    false_positive: r.false_positive,
    sar_count: r.sar_count,
    sar_conversion_pct: r.total > 0 ? Math.round((r.sar_count / r.total) * 1000) / 10 : 0,
    fp_rate_pct: r.total > 0 ? Math.round((r.false_positive / r.total) * 1000) / 10 : 0,
    true_positive_rate_pct: r.total > 0 ? Math.round((r.true_positive / r.total) * 1000) / 10 : 0,
    avg_resolution_days: r.avg_resolution != null ? Math.round(r.avg_resolution * 10) / 10 : null
  }));

  res.json({
    range: { from: fromStr, to: toStr },
    scenarios
  });
});

// ─────────────────────────────────────────────── TAB 5: CUSTOMER RISK

router.get('/customer-risk', (req, res) => {
  const { fromStr, toStr, granularity } = parseRange(req);
  const periods = buildPeriods(fromStr, toStr, granularity);
  const RANK = { 'Low': 1, 'Medium': 2, 'High': 3, 'Very High': 4 };

  // Current distribution
  const distRows = db.prepare(`
    SELECT COALESCE(NULLIF(customer_risk_rating, ''), 'Unrated') AS rating, COUNT(*) AS count
      FROM customers
     GROUP BY rating
     ORDER BY count DESC
  `).all();
  const total = distRows.reduce((s, r) => s + r.count, 0);
  const current_distribution = distRows.map(r => ({
    rating: r.rating,
    count: r.count,
    pct: total > 0 ? Math.round((r.count / total) * 1000) / 10 : 0
  }));

  // Risk rating changes — from kyc_reviews completed in period
  const changeRows = db.prepare(`
    SELECT ${periodSql('completed_at', granularity)} AS pk,
           previous_risk_rating AS prev,
           new_risk_rating AS next
      FROM kyc_reviews
     WHERE completed_at IS NOT NULL
       AND date(completed_at) BETWEEN ? AND ?
  `).all(fromStr, toStr);
  const changeMap = {};
  for (const r of changeRows) {
    const m = (changeMap[r.pk] ||= { upgraded: 0, downgraded: 0, no_change: 0 });
    const a = RANK[r.prev] || 0;
    const b = RANK[r.next] || 0;
    if (a && b && b > a) m.upgraded++;
    else if (a && b && b < a) m.downgraded++;
    else m.no_change++;
  }
  const rating_changes = fillSeries(periods, changeMap, { upgraded: 0, downgraded: 0, no_change: 0 });

  // KYC compliance trend — % of customers whose KYC was current as of end of each period
  const customers = db.prepare(`
    SELECT customer_risk_rating AS rating, last_kyc_review_date, customer_since_date
      FROM customers
  `).all();
  const intervalDays = (rating) => {
    if (rating === 'Very High') return 180;
    if (rating === 'High') return 365;
    if (rating === 'Medium') return 730;
    return 1095; // Low / Unrated
  };
  const periodEndDate = (key, granularity) => {
    if (granularity === 'week') {
      const d = new Date(key + 'T23:59:59');
      d.setDate(d.getDate() + 6);
      return d;
    }
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m, 0, 23, 59, 59);
  };
  const kyc_compliance = periods.map(p => {
    const end = periodEndDate(p.key, granularity);
    let current = 0, applicable = 0;
    for (const c of customers) {
      const sinceStr = c.last_kyc_review_date || c.customer_since_date;
      if (!sinceStr) continue;
      const since = new Date(sinceStr + 'T00:00:00');
      if (since > end) continue; // customer/KYC not yet existed at period end
      applicable++;
      const days = (end - since) / (1000 * 3600 * 24);
      if (days <= intervalDays(c.rating)) current++;
    }
    return {
      period: p.key,
      label: p.label,
      current_pct: applicable > 0 ? Math.round((current / applicable) * 100) : 0
    };
  });

  // High risk concentration — % of alerts in period from High/Very High customers
  const concRows = db.prepare(`
    SELECT ${periodSql('created_date', granularity)} AS pk,
           COUNT(*) AS total,
           SUM(CASE WHEN customer_risk_rating IN ('High','Very High') THEN 1 ELSE 0 END) AS high_count
      FROM alerts
     WHERE date(created_date) BETWEEN ? AND ?
     GROUP BY pk
  `).all(fromStr, toStr);
  const concMap = {};
  for (const r of concRows) {
    concMap[r.pk] = {
      total: r.total,
      high_count: r.high_count,
      high_risk_pct: r.total > 0 ? Math.round((r.high_count / r.total) * 100) : 0
    };
  }
  const high_risk_concentration = fillSeries(periods, concMap, { total: 0, high_count: 0, high_risk_pct: 0 });

  // Industry × risk matrix
  const indRows = db.prepare(`
    SELECT COALESCE(NULLIF(industry, ''), 'Unspecified') AS industry,
           COALESCE(NULLIF(customer_risk_rating, ''), 'Unrated') AS rating,
           COUNT(*) AS n
      FROM customers
     GROUP BY industry, rating
  `).all();
  const ratings = ['Low', 'Medium', 'High', 'Very High'];
  const indMap = {};
  for (const r of indRows) {
    if (!ratings.includes(r.rating)) continue;
    (indMap[r.industry] ||= Object.fromEntries(ratings.map(rt => [rt, 0])))[r.rating] = r.n;
  }
  const industry_risk_matrix = Object.entries(indMap)
    .map(([industry, byRating]) => {
      const totalRow = ratings.reduce((s, rt) => s + byRating[rt], 0);
      return { industry, ...byRating, total: totalRow };
    })
    .sort((a, b) => b.total - a.total);

  res.json({
    range: { from: fromStr, to: toStr, granularity },
    current_distribution,
    rating_changes,
    kyc_compliance,
    high_risk_concentration,
    industry_risk_matrix,
    ratings
  });
});

module.exports = router;
