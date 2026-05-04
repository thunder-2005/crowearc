const express = require('express');
const pool = require('../database/db');

const router = express.Router();

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

// PG SQL period expression operating on a TEXT column representing a date.
function periodSql(col, granularity) {
  if (granularity === 'week') return `to_char(date_trunc('week', (${col})::date)::date, 'YYYY-MM-DD')`;
  return `to_char((${col})::date, 'YYYY-MM')`;
}

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

function fillSeries(periods, byKey, defaults = {}) {
  return periods.map(p => ({
    period: p.key,
    label: p.label,
    ...defaults,
    ...(byKey[p.key] || {})
  }));
}

// Cast COUNT/SUM strings (pg returns numerics as strings) to numbers
function n(v) { return v == null ? 0 : Number(v); }

// ─────────────────────────────────────────────── TAB 1: ALERT TRENDS

router.get('/alert-trends', async (req, res, next) => {
  try {
    const { fromStr, toStr, granularity } = parseRange(req);
    const periods = buildPeriods(fromStr, toStr, granularity);

    const newRows = (await pool.query(`
      SELECT ${periodSql('created_date', granularity)} AS pk, COUNT(*) AS n
        FROM alerts
       WHERE created_date BETWEEN $1 AND $2
       GROUP BY pk
    `, [fromStr, toStr])).rows;

    const closedRows = (await pool.query(`
      SELECT ${periodSql('closed_date', granularity)} AS pk, COUNT(*) AS n
        FROM alerts
       WHERE closed_date IS NOT NULL
         AND closed_date BETWEEN $1 AND $2
       GROUP BY pk
    `, [fromStr, toStr])).rows;

    const volMap = {};
    for (const r of newRows) (volMap[r.pk] ||= { new: 0, closed: 0 }).new = n(r.n);
    for (const r of closedRows) (volMap[r.pk] ||= { new: 0, closed: 0 }).closed = n(r.n);
    const volume = fillSeries(periods, volMap, { new: 0, closed: 0 });

    const fpRows = (await pool.query(`
      SELECT ${periodSql('closed_date', granularity)} AS pk,
             COUNT(*) AS total_closed,
             SUM(CASE WHEN case_converted = 0 THEN 1 ELSE 0 END) AS fp
        FROM alerts
       WHERE closed_date IS NOT NULL
         AND alert_status = 'Completed'
         AND closed_date BETWEEN $1 AND $2
       GROUP BY pk
    `, [fromStr, toStr])).rows;
    const fpMap = {};
    for (const r of fpRows) {
      const tc = n(r.total_closed);
      const fpN = n(r.fp);
      fpMap[r.pk] = {
        total_closed: tc, fp: fpN,
        fp_pct: tc > 0 ? Math.round((fpN / tc) * 100) : 0
      };
    }
    const false_positive_rate = fillSeries(periods, fpMap, { total_closed: 0, fp: 0, fp_pct: 0 });

    const ageRows = (await pool.query(`
      SELECT ${periodSql('closed_date', granularity)} AS pk,
             (closed_date::date - created_date::date) AS age
        FROM alerts
       WHERE closed_date IS NOT NULL
         AND closed_date BETWEEN $1 AND $2
    `, [fromStr, toStr])).rows;
    const ageMap = {};
    for (const r of ageRows) {
      const a = n(r.age);
      const bucket = a < 7 ? 'lt7' : a < 15 ? 'd7_15' : a < 30 ? 'd15_30' : 'gt30';
      (ageMap[r.pk] ||= { lt7: 0, d7_15: 0, d15_30: 0, gt30: 0 })[bucket]++;
    }
    const age_distribution = fillSeries(periods, ageMap, { lt7: 0, d7_15: 0, d15_30: 0, gt30: 0 });

    const dispRows = (await pool.query(`
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
         AND closed_date BETWEEN $1 AND $2
       GROUP BY pk, bucket
    `, [fromStr, toStr])).rows;
    const dispMap = {};
    for (const r of dispRows) {
      (dispMap[r.pk] ||= { false_positive: 0, escalated_l2: 0, escalated_sar: 0, other_closed: 0 })[r.bucket] = n(r.n);
    }
    const disposition_breakdown = fillSeries(periods, dispMap, {
      false_positive: 0, escalated_l2: 0, escalated_sar: 0, other_closed: 0
    });

    const scenRows = (await pool.query(`
      SELECT ${periodSql('created_date', granularity)} AS pk,
             scenario,
             COUNT(*) AS n
        FROM alerts
       WHERE created_date BETWEEN $1 AND $2
       GROUP BY pk, scenario
    `, [fromStr, toStr])).rows;
    const scenarios = [...new Set(scenRows.map(r => r.scenario).filter(Boolean))];
    const scenMap = {};
    for (const r of scenRows) {
      (scenMap[r.pk] ||= {})[r.scenario] = n(r.n);
    }
    const empty = Object.fromEntries(scenarios.map(s => [s, 0]));
    const by_scenario = fillSeries(periods, scenMap, empty);

    const recent = volume.slice(-Math.min(6, volume.length));
    const backlogGrowing = recent.length >= 2 &&
      recent.filter(p => p.closed < p.new).length >= Math.ceil(recent.length / 2);

    res.json({
      range: { from: fromStr, to: toStr, granularity },
      volume, false_positive_rate, age_distribution, disposition_breakdown,
      by_scenario, scenarios, backlog_growing: backlogGrowing
    });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────── TAB 2: SAR TRENDS

router.get('/sar-trends', async (req, res, next) => {
  try {
    const { fromStr, toStr, granularity } = parseRange(req);
    const periods = buildPeriods(fromStr, toStr, granularity);
    const dateCol = "COALESCE(filed_date, draft_created_date)";

    const volRows = (await pool.query(`
      SELECT ${periodSql(dateCol, granularity)} AS pk,
             COALESCE(NULLIF(sar_type, ''), 'Initial SAR') AS type,
             COUNT(*) AS n
        FROM sar_filings
       WHERE ${dateCol} IS NOT NULL
         AND ${dateCol} BETWEEN $1 AND $2
       GROUP BY pk, type
    `, [fromStr, toStr])).rows;
    const sarTypes = [...new Set(volRows.map(r => r.type))];
    if (!sarTypes.includes('Initial SAR')) sarTypes.unshift('Initial SAR');
    const volMap = {};
    for (const r of volRows) {
      (volMap[r.pk] ||= {})[r.type] = n(r.n);
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

    const convRows = (await pool.query(`
      SELECT ${periodSql('created_date', granularity)} AS pk,
             COUNT(*) AS alerts,
             SUM(CASE WHEN linked_sar_id IS NOT NULL THEN 1 ELSE 0 END) AS sars
        FROM alerts
       WHERE created_date BETWEEN $1 AND $2
       GROUP BY pk
    `, [fromStr, toStr])).rows;
    const convMap = {};
    for (const r of convRows) {
      const aN = n(r.alerts);
      const sN = n(r.sars);
      convMap[r.pk] = {
        alerts: aN, sars: sN,
        rate_pct: aN > 0 ? Math.round((sN / aN) * 1000) / 10 : 0
      };
    }
    const conversion_rate = fillSeries(periods, convMap, { alerts: 0, sars: 0, rate_pct: 0 });

    const timelyRows = (await pool.query(`
      SELECT ${periodSql('filed_date', granularity)} AS pk,
             (filed_date::date - COALESCE(detection_date, draft_created_date)::date) AS days
        FROM sar_filings
       WHERE filed_date IS NOT NULL
         AND filed_date BETWEEN $1 AND $2
    `, [fromStr, toStr])).rows;
    const timelyMap = {};
    for (const r of timelyRows) {
      const days = r.days != null ? Number(r.days) : null;
      const onTime = (days != null && days <= 30) ? 1 : 0;
      const m = (timelyMap[r.pk] ||= { on_time: 0, late: 0 });
      if (onTime) m.on_time++; else m.late++;
    }
    const timeliness = fillSeries(periods, timelyMap, { on_time: 0, late: 0 }).map(r => {
      const total = r.on_time + r.late;
      return { ...r, compliance_pct: total > 0 ? Math.round((r.on_time / total) * 100) : 0 };
    });

    const dollarRows = (await pool.query(`
      SELECT ${periodSql(dateCol, granularity)} AS pk,
             SUM(COALESCE(total_amount, amount_involved_inr, 0)) AS amount
        FROM sar_filings
       WHERE ${dateCol} IS NOT NULL
         AND ${dateCol} BETWEEN $1 AND $2
       GROUP BY pk
    `, [fromStr, toStr])).rows;
    const dollarMap = {};
    for (const r of dollarRows) dollarMap[r.pk] = { amount: n(r.amount) };
    const dollar_amount = fillSeries(periods, dollarMap, { amount: 0 });

    const rejRows = (await pool.query(`
      SELECT ${periodSql('updated_at', granularity)} AS pk,
             COUNT(*) AS submitted,
             SUM(CASE WHEN sar_status IN ('Rejected', 'Returned for Revision') OR returned_to_analyst = 1
                      THEN 1 ELSE 0 END) AS rejected
        FROM sar_filings
       WHERE updated_at IS NOT NULL
         AND updated_at BETWEEN $1 AND $2
         AND sar_status IN ('Pending Approval', 'Under Manager Review', 'Filed', 'Rejected', 'Returned for Revision')
       GROUP BY pk
    `, [fromStr, toStr])).rows;
    const rejMap = {};
    for (const r of rejRows) {
      const sN = n(r.submitted);
      const rN = n(r.rejected);
      rejMap[r.pk] = {
        submitted: sN, rejected: rN,
        rate_pct: sN > 0 ? Math.round((rN / sN) * 1000) / 10 : 0
      };
    }
    const rejection_rate = fillSeries(periods, rejMap, { submitted: 0, rejected: 0, rate_pct: 0 });

    const rejReasons = (await pool.query(`
      SELECT COALESCE(NULLIF(rejection_reason_category, ''), 'Other') AS reason,
             COUNT(*) AS count
        FROM sar_filings
       WHERE rejected_at IS NOT NULL
         AND rejected_at BETWEEN $1 AND $2
       GROUP BY reason
       ORDER BY count DESC
       LIMIT 10
    `, [fromStr, toStr])).rows.map(r => ({ ...r, count: n(r.count) }));

    const recent = rejection_rate.slice(-3);
    const prev = rejection_rate.slice(-6, -3);
    const avg = a => a.length ? a.reduce((s, x) => s + x.rate_pct, 0) / a.length : 0;
    const rejection_trending_up = avg(recent) > avg(prev) + 2;

    res.json({
      range: { from: fromStr, to: toStr, granularity },
      filing_volume, sar_types: sarTypes, filing_volume_avg,
      conversion_rate, timeliness, dollar_amount,
      rejection_rate, rejection_reasons: rejReasons, rejection_trending_up
    });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────── TAB 3: TEAM PERFORMANCE

router.get('/team-performance', async (req, res, next) => {
  try {
    const { fromStr, toStr, granularity } = parseRange(req);
    const periods = buildPeriods(fromStr, toStr, granularity);

    const slaSetting = (await pool.query(
      "SELECT setting_value FROM manager_settings WHERE setting_key IN ('sla.high_days','sla.medium_days','sla.low_days')"
    )).rows;
    const slaTargetDays = slaSetting.length
      ? Math.round(slaSetting.reduce((s, r) => s + (parseInt(JSON.parse(r.setting_value), 10) || 0), 0) / slaSetting.length)
      : 30;

    const capRow = (await pool.query(
      "SELECT setting_value FROM manager_settings WHERE setting_key = 'team.capacity_warn_pct'"
    )).rows[0];
    const capacityThresholdPct = capRow ? (parseInt(JSON.parse(capRow.setting_value), 10) || 85) : 85;

    const avgRows = (await pool.query(`
      SELECT ${periodSql('closed_date', granularity)} AS pk,
             AVG(closed_date::date - created_date::date) AS avg_days
        FROM alerts
       WHERE closed_date IS NOT NULL
         AND closed_date BETWEEN $1 AND $2
       GROUP BY pk
    `, [fromStr, toStr])).rows;
    const avgMap = {};
    for (const r of avgRows) avgMap[r.pk] = { avg_days: Math.round(n(r.avg_days) * 10) / 10 };
    const avg_resolution = fillSeries(periods, avgMap, { avg_days: 0 });

    const slaRows = (await pool.query(`
      SELECT ${periodSql('created_date', granularity)} AS pk,
             priority,
             COUNT(*) AS total,
             SUM(CASE WHEN sla_breached = 1 THEN 1 ELSE 0 END) AS breached
        FROM alerts
       WHERE created_date BETWEEN $1 AND $2
       GROUP BY pk, priority
    `, [fromStr, toStr])).rows;
    const slaMap = {};
    for (const r of slaRows) {
      const key = (r.priority || '').toLowerCase();
      const m = (slaMap[r.pk] ||= { high_pct: 0, medium_pct: 0, low_pct: 0 });
      const total = n(r.total);
      const breached = n(r.breached);
      const pct = total > 0 ? Math.round((breached / total) * 100) : 0;
      if (key === 'high') m.high_pct = pct;
      else if (key === 'medium') m.medium_pct = pct;
      else if (key === 'low') m.low_pct = pct;
    }
    const sla_breach_rate = fillSeries(periods, slaMap, { high_pct: 0, medium_pct: 0, low_pct: 0 });

    const prodRows = (await pool.query(`
      SELECT ${periodSql('closed_date', granularity)} AS pk,
             assigned_to AS analyst,
             COUNT(*) AS closed
        FROM alerts
       WHERE closed_date IS NOT NULL
         AND assigned_to IS NOT NULL AND TRIM(assigned_to) <> ''
         AND closed_date BETWEEN $1 AND $2
       GROUP BY pk, analyst
    `, [fromStr, toStr])).rows;
    const analystSet = [...new Set(prodRows.map(r => r.analyst))].sort();
    const prodMap = {};
    for (const r of prodRows) {
      (prodMap[r.pk] ||= {})[r.analyst] = n(r.closed);
    }
    const prodDefault = Object.fromEntries(analystSet.map(a => [a, 0]));
    const productivity = fillSeries(periods, prodMap, prodDefault).map(row => {
      const total = analystSet.reduce((s, a) => s + (row[a] || 0), 0);
      const team_avg = analystSet.length > 0
        ? Math.round((total / analystSet.length) * 10) / 10
        : 0;
      return { ...row, team_avg };
    });

    const capacity = 15;
    const workRows = (await pool.query(`
      SELECT ${periodSql('created_date', granularity)} AS pk,
             assigned_to AS analyst,
             COUNT(*) AS open_count
        FROM alerts
       WHERE assigned_to IS NOT NULL AND TRIM(assigned_to) <> ''
         AND created_date BETWEEN $1 AND $2
       GROUP BY pk, analyst
    `, [fromStr, toStr])).rows;
    const workMap = {};
    for (const r of workRows) {
      (workMap[r.pk] ||= {})[r.analyst] = Math.min(100, Math.round((n(r.open_count) / capacity) * 100));
    }
    const workDefault = Object.fromEntries(analystSet.map(a => [a, 0]));
    const workload_balance = fillSeries(periods, workMap, workDefault);

    const heatRows = (await pool.query(`
      SELECT to_char(date_trunc('week', timestamp::date)::date, 'YYYY-MM-DD') AS week_start,
             analyst,
             COUNT(*) AS n
        FROM case_notes
       WHERE analyst IS NOT NULL AND TRIM(analyst) <> ''
         AND timestamp BETWEEN $1 AND $2
       GROUP BY week_start, analyst
    `, [fromStr, toStr])).rows;

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
      for (const r of heatRows) if (r.analyst === a) byWeek[r.week_start] = n(r.n);
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
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────── TAB 4: RULE EFFECTIVENESS

router.get('/rule-effectiveness', async (req, res, next) => {
  try {
    const { fromStr, toStr } = parseRange(req);
    const rows = (await pool.query(`
      SELECT scenario,
             COUNT(*) AS total,
             SUM(CASE WHEN case_converted = 1 THEN 1 ELSE 0 END) AS true_positive,
             SUM(CASE WHEN alert_status = 'Completed' AND case_converted = 0 THEN 1 ELSE 0 END) AS false_positive,
             SUM(CASE WHEN linked_sar_id IS NOT NULL THEN 1 ELSE 0 END) AS sar_count,
             AVG(CASE WHEN closed_date IS NOT NULL
                      THEN closed_date::date - created_date::date
                      ELSE NULL END) AS avg_resolution
        FROM alerts
       WHERE created_date BETWEEN $1 AND $2
         AND scenario IS NOT NULL
       GROUP BY scenario
       ORDER BY total DESC
    `, [fromStr, toStr])).rows;

    const scenarios = rows.map(r => {
      const total = n(r.total);
      const truePos = n(r.true_positive);
      const fp = n(r.false_positive);
      const sars = n(r.sar_count);
      return {
        scenario: r.scenario,
        total, true_positive: truePos, false_positive: fp, sar_count: sars,
        sar_conversion_pct: total > 0 ? Math.round((sars / total) * 1000) / 10 : 0,
        fp_rate_pct: total > 0 ? Math.round((fp / total) * 1000) / 10 : 0,
        true_positive_rate_pct: total > 0 ? Math.round((truePos / total) * 1000) / 10 : 0,
        avg_resolution_days: r.avg_resolution != null ? Math.round(Number(r.avg_resolution) * 10) / 10 : null
      };
    });

    res.json({ range: { from: fromStr, to: toStr }, scenarios });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────── TAB 5: CUSTOMER RISK

router.get('/customer-risk', async (req, res, next) => {
  try {
    const { fromStr, toStr, granularity } = parseRange(req);
    const periods = buildPeriods(fromStr, toStr, granularity);
    const RANK = { 'Low': 1, 'Medium': 2, 'High': 3, 'Very High': 4 };

    const distRows = (await pool.query(`
      SELECT COALESCE(NULLIF(customer_risk_rating, ''), 'Unrated') AS rating, COUNT(*) AS count
        FROM customers
       GROUP BY rating
       ORDER BY count DESC
    `)).rows.map(r => ({ ...r, count: n(r.count) }));
    const total = distRows.reduce((s, r) => s + r.count, 0);
    const current_distribution = distRows.map(r => ({
      rating: r.rating,
      count: r.count,
      pct: total > 0 ? Math.round((r.count / total) * 1000) / 10 : 0
    }));

    const changeRows = (await pool.query(`
      SELECT ${periodSql('completed_at', granularity)} AS pk,
             previous_risk_rating AS prev,
             new_risk_rating AS next
        FROM kyc_reviews
       WHERE completed_at IS NOT NULL
         AND completed_at BETWEEN $1 AND $2
    `, [fromStr, toStr])).rows;
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

    const customers = (await pool.query(`
      SELECT customer_risk_rating AS rating, last_kyc_review_date, customer_since_date
        FROM customers
    `)).rows;
    const intervalDays = (rating) => {
      if (rating === 'Very High') return 180;
      if (rating === 'High') return 365;
      if (rating === 'Medium') return 730;
      return 1095;
    };
    const periodEndDate = (key, gran) => {
      if (gran === 'week') {
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
        if (since > end) continue;
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

    const concRows = (await pool.query(`
      SELECT ${periodSql('created_date', granularity)} AS pk,
             COUNT(*) AS total,
             SUM(CASE WHEN customer_risk_rating IN ('High','Very High') THEN 1 ELSE 0 END) AS high_count
        FROM alerts
       WHERE created_date BETWEEN $1 AND $2
       GROUP BY pk
    `, [fromStr, toStr])).rows;
    const concMap = {};
    for (const r of concRows) {
      const t = n(r.total);
      const h = n(r.high_count);
      concMap[r.pk] = {
        total: t, high_count: h,
        high_risk_pct: t > 0 ? Math.round((h / t) * 100) : 0
      };
    }
    const high_risk_concentration = fillSeries(periods, concMap, { total: 0, high_count: 0, high_risk_pct: 0 });

    const indRows = (await pool.query(`
      SELECT COALESCE(NULLIF(industry, ''), 'Unspecified') AS industry,
             COALESCE(NULLIF(customer_risk_rating, ''), 'Unrated') AS rating,
             COUNT(*) AS n
        FROM customers
       GROUP BY industry, rating
    `)).rows;
    const ratings = ['Low', 'Medium', 'High', 'Very High'];
    const indMap = {};
    for (const r of indRows) {
      if (!ratings.includes(r.rating)) continue;
      (indMap[r.industry] ||= Object.fromEntries(ratings.map(rt => [rt, 0])))[r.rating] = n(r.n);
    }
    const industry_risk_matrix = Object.entries(indMap)
      .map(([industry, byRating]) => {
        const totalRow = ratings.reduce((s, rt) => s + byRating[rt], 0);
        return { industry, ...byRating, total: totalRow };
      })
      .sort((a, b) => b.total - a.total);

    res.json({
      range: { from: fromStr, to: toStr, granularity },
      current_distribution, rating_changes, kyc_compliance,
      high_risk_concentration, industry_risk_matrix, ratings
    });
  } catch (err) { next(err); }
});

module.exports = router;
