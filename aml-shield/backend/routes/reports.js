const express = require('express');
const { db } = require('../database/db');

const router = express.Router();

// ─────────────────────────────────────────────── helpers

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseRange(req, defaultDays = 90) {
  const today = new Date();
  const toStr = req.query.to || ymd(today);
  const fromStr = req.query.from || ymd(new Date(today.getTime() - defaultDays * 86400000));
  return { fromStr, toStr };
}

// Total resolution days helper
const RES_EXPR = `julianday(closed_date) - julianday(created_date)`;

// ─────────────────────────────────────────────── 1. SAR FILING SUMMARY

router.get('/sar-summary', (req, res) => {
  const { fromStr, toStr } = parseRange(req);
  const dateCol = `COALESCE(filed_date, draft_created_date)`;
  const rows = db.prepare(`
    SELECT sar_id, customer_name, prepared_by AS filed_by,
           COALESCE(filed_date, draft_created_date) AS filed_date,
           COALESCE(total_amount, amount_involved_inr, 0) AS amount,
           COALESCE(NULLIF(sar_type, ''), 'Initial SAR') AS type,
           sar_status AS status
      FROM sar_filings
     WHERE ${dateCol} IS NOT NULL
       AND date(${dateCol}) BETWEEN ? AND ?
     ORDER BY date(${dateCol}) DESC
  `).all(fromStr, toStr);

  const total = rows.length;
  const filed = rows.filter(r => r.status === 'Filed').length;
  const rejected = rows.filter(r =>
    r.status === 'Rejected' || r.status === 'Returned for Revision').length;
  const pending = rows.filter(r =>
    r.status === 'Pending Approval' || r.status === 'Under Manager Review' || r.status === 'Draft').length;
  const totalAmount = rows.reduce((s, r) => s + Number(r.amount || 0), 0);

  res.json({
    title: 'Monthly SAR Filing Summary',
    range: { from: fromStr, to: toStr },
    summary: [
      { label: 'Total Filed', value: total },
      { label: 'Approved', value: filed, tone: 'green' },
      { label: 'Rejected', value: rejected, tone: 'red' },
      { label: 'Pending', value: pending, tone: 'orange' },
      { label: 'Total Amount', value: '$' + totalAmount.toLocaleString('en-US') }
    ],
    columns: [
      { key: 'sar_id',        label: 'SAR ID' },
      { key: 'customer_name', label: 'Customer' },
      { key: 'filed_by',      label: 'Filed By' },
      { key: 'filed_date',    label: 'Filed Date' },
      { key: 'amount',        label: 'Amount', type: 'currency' },
      { key: 'type',          label: 'Type' },
      { key: 'status',        label: 'Status' }
    ],
    rows
  });
});

// ─────────────────────────────────────────────── 2. SLA BREACH

router.get('/sla-breach', (req, res) => {
  const { fromStr, toStr } = parseRange(req);
  const where = `date(created_date) BETWEEN ? AND ? AND sla_breached = 1`;
  const rows = db.prepare(`
    SELECT alert_id, scenario, assigned_to AS analyst,
           created_date AS assigned_date,
           sla_deadline AS sla_due,
           CAST(MAX(0, julianday(COALESCE(closed_date, datetime('now'))) - julianday(sla_deadline)) AS INTEGER) AS breached_by_days,
           alert_status AS current_status,
           CASE
             WHEN linked_sar_id IS NOT NULL THEN 'Escalated SAR'
             WHEN case_converted = 1        THEN 'Escalated L2'
             WHEN alert_status = 'Completed' THEN 'False Positive'
             ELSE 'Open'
           END AS disposition
      FROM alerts
     WHERE ${where}
     ORDER BY breached_by_days DESC
  `).all(fromStr, toStr);

  const totalBreaches = rows.length;
  const totalAlerts = db.prepare(
    `SELECT COUNT(*) AS c FROM alerts WHERE date(created_date) BETWEEN ? AND ?`
  ).get(fromStr, toStr).c;
  const breachRate = totalAlerts > 0
    ? Math.round((totalBreaches / totalAlerts) * 1000) / 10
    : 0;

  const byScenario = {};
  const byAnalyst = {};
  for (const r of rows) {
    byScenario[r.scenario] = (byScenario[r.scenario] || 0) + 1;
    if (r.analyst) byAnalyst[r.analyst] = (byAnalyst[r.analyst] || 0) + 1;
  }
  const worstScenario = Object.entries(byScenario).sort((a, b) => b[1] - a[1])[0];
  const worstAnalyst = Object.entries(byAnalyst).sort((a, b) => b[1] - a[1])[0];

  res.json({
    title: 'SLA Breach Report',
    range: { from: fromStr, to: toStr },
    summary: [
      { label: 'Total Breaches', value: totalBreaches, tone: 'red' },
      { label: 'Breach Rate', value: `${breachRate}%`, tone: 'red' },
      { label: 'Worst Scenario', value: worstScenario ? `${worstScenario[0]} (${worstScenario[1]})` : '—' },
      { label: 'Most Breaches by Analyst', value: worstAnalyst ? `${worstAnalyst[0]} (${worstAnalyst[1]})` : '—' }
    ],
    columns: [
      { key: 'alert_id',         label: 'Alert ID' },
      { key: 'scenario',         label: 'Scenario' },
      { key: 'analyst',          label: 'Analyst' },
      { key: 'assigned_date',    label: 'Assigned Date' },
      { key: 'sla_due',          label: 'SLA Due' },
      { key: 'breached_by_days', label: 'Breached By' },
      { key: 'current_status',   label: 'Status' },
      { key: 'disposition',      label: 'Disposition' }
    ],
    rows
  });
});

// ─────────────────────────────────────────────── 3. TEAM PERFORMANCE

router.get('/team-performance', (req, res) => {
  const { fromStr, toStr } = parseRange(req);
  const rows = db.prepare(`
    SELECT a.assigned_to AS analyst,
           COUNT(*) AS assigned,
           SUM(CASE WHEN a.alert_status = 'Completed' THEN 1 ELSE 0 END) AS closed,
           SUM(CASE WHEN a.sla_breached = 1 THEN 1 ELSE 0 END) AS sla_breaches,
           SUM(CASE WHEN a.alert_status = 'Completed' AND a.case_converted = 0 THEN 1 ELSE 0 END) AS false_positives,
           AVG(CASE WHEN a.closed_date IS NOT NULL
                    THEN ${RES_EXPR}
                    ELSE NULL END) AS avg_resolution_days
      FROM alerts a
     WHERE date(a.created_date) BETWEEN ? AND ?
       AND a.assigned_to IS NOT NULL AND TRIM(a.assigned_to) <> ''
     GROUP BY a.assigned_to
     ORDER BY assigned DESC
  `).all(fromStr, toStr);

  // SARs filed per analyst (prepared_by) in same window
  const sarRows = db.prepare(`
    SELECT prepared_by AS analyst, COUNT(*) AS sars_filed
      FROM sar_filings
     WHERE prepared_by IS NOT NULL
       AND date(COALESCE(filed_date, draft_created_date)) BETWEEN ? AND ?
     GROUP BY prepared_by
  `).all(fromStr, toStr);
  const sarMap = Object.fromEntries(sarRows.map(r => [r.analyst, r.sars_filed]));

  const enriched = rows.map(r => ({
    analyst: r.analyst,
    assigned: r.assigned,
    closed: r.closed,
    sla_breaches: r.sla_breaches,
    false_positives: r.false_positives,
    sars_filed: sarMap[r.analyst] || 0,
    avg_resolution_days: r.avg_resolution_days != null ? Math.round(r.avg_resolution_days * 10) / 10 : null
  }));

  // Team totals row
  const totals = enriched.reduce((acc, r) => {
    acc.assigned += r.assigned;
    acc.closed += r.closed;
    acc.sla_breaches += r.sla_breaches;
    acc.false_positives += r.false_positives;
    acc.sars_filed += r.sars_filed;
    return acc;
  }, { assigned: 0, closed: 0, sla_breaches: 0, false_positives: 0, sars_filed: 0 });
  const teamAvgRes = enriched.filter(r => r.avg_resolution_days != null).length
    ? Math.round((enriched.filter(r => r.avg_resolution_days != null)
        .reduce((s, r) => s + r.avg_resolution_days, 0) /
        enriched.filter(r => r.avg_resolution_days != null).length) * 10) / 10
    : null;

  res.json({
    title: 'Team Performance Report',
    range: { from: fromStr, to: toStr },
    summary: [
      { label: 'Analysts', value: enriched.length },
      { label: 'Total Assigned', value: totals.assigned },
      { label: 'Total Closed', value: totals.closed, tone: 'green' },
      { label: 'Total Breaches', value: totals.sla_breaches, tone: 'red' },
      { label: 'Team Avg Resolution', value: teamAvgRes != null ? `${teamAvgRes}d` : '—' }
    ],
    columns: [
      { key: 'analyst',             label: 'Analyst' },
      { key: 'assigned',            label: 'Assigned' },
      { key: 'closed',              label: 'Closed' },
      { key: 'sla_breaches',        label: 'SLA Breaches' },
      { key: 'false_positives',     label: 'False Positives' },
      { key: 'sars_filed',          label: 'SARs Filed' },
      { key: 'avg_resolution_days', label: 'Avg Resolution', type: 'days' }
    ],
    rows: enriched,
    totals_row: {
      analyst: 'TEAM TOTALS',
      assigned: totals.assigned,
      closed: totals.closed,
      sla_breaches: totals.sla_breaches,
      false_positives: totals.false_positives,
      sars_filed: totals.sars_filed,
      avg_resolution_days: teamAvgRes
    }
  });
});

// ─────────────────────────────────────────────── 4. KYC REVIEW STATUS

router.get('/kyc-status', (req, res) => {
  const { fromStr, toStr } = parseRange(req);
  const today = new Date().toISOString().slice(0, 10);

  const customers = db.prepare(`
    SELECT customer_name AS customer,
           customer_risk_rating AS risk_rating,
           last_kyc_review_date,
           next_kyc_due_date,
           customer_id
      FROM customers
     WHERE customer_id IS NOT NULL
  `).all();

  // Latest assigned analyst per customer (open review)
  const assignedRows = db.prepare(`
    SELECT customer_id, assigned_to
      FROM kyc_reviews
     WHERE status IN ('pending', 'in_progress')
     GROUP BY customer_id
  `).all();
  const assignedMap = Object.fromEntries(assignedRows.map(r => [r.customer_id, r.assigned_to]));

  const enriched = customers.map(c => {
    const due = c.next_kyc_due_date;
    let status = 'On Track';
    if (due && due < today) status = 'Overdue';
    else if (due && due <= toStr && due >= fromStr) status = 'Due Soon';
    return {
      customer: c.customer,
      risk_rating: c.risk_rating || '—',
      last_review: c.last_kyc_review_date || '—',
      next_due: due || '—',
      status,
      assigned_to: assignedMap[c.customer_id] || '—'
    };
  });

  const overdue = enriched.filter(r => r.status === 'Overdue').length;
  const dueThisMonth = enriched.filter(r => r.status === 'Due Soon').length;
  const onTrack = enriched.filter(r => r.status === 'On Track').length;
  const completed = db.prepare(`
    SELECT COUNT(*) AS c FROM kyc_reviews
     WHERE completed_at IS NOT NULL
       AND date(completed_at) BETWEEN ? AND ?
  `).get(fromStr, toStr).c;

  res.json({
    title: 'KYC Review Status Report',
    range: { from: fromStr, to: toStr },
    summary: [
      { label: 'Total Overdue', value: overdue, tone: 'red' },
      { label: 'Due This Month', value: dueThisMonth, tone: 'orange' },
      { label: 'Completed in Period', value: completed, tone: 'green' },
      { label: 'On Track', value: onTrack, tone: 'green' }
    ],
    columns: [
      { key: 'customer',     label: 'Customer' },
      { key: 'risk_rating',  label: 'Risk Rating' },
      { key: 'last_review',  label: 'Last Review' },
      { key: 'next_due',     label: 'Next Due' },
      { key: 'status',       label: 'Status' },
      { key: 'assigned_to',  label: 'Assigned To' }
    ],
    rows: enriched
  });
});

// ─────────────────────────────────────────────── 5. FALSE POSITIVE RATE

router.get('/false-positive', (req, res) => {
  const { fromStr, toStr } = parseRange(req);
  const periodDays = (new Date(toStr) - new Date(fromStr)) / 86400000;
  const priorTo = fromStr;
  const priorFrom = ymd(new Date(new Date(fromStr).getTime() - (periodDays + 1) * 86400000));

  const cur = db.prepare(`
    SELECT scenario,
           COUNT(*) AS total,
           SUM(CASE WHEN alert_status = 'Completed' AND case_converted = 0 THEN 1 ELSE 0 END) AS fp
      FROM alerts
     WHERE date(created_date) BETWEEN ? AND ?
       AND scenario IS NOT NULL
     GROUP BY scenario
     ORDER BY total DESC
  `).all(fromStr, toStr);

  const prior = db.prepare(`
    SELECT scenario,
           COUNT(*) AS total,
           SUM(CASE WHEN alert_status = 'Completed' AND case_converted = 0 THEN 1 ELSE 0 END) AS fp
      FROM alerts
     WHERE date(created_date) BETWEEN ? AND ?
       AND scenario IS NOT NULL
     GROUP BY scenario
  `).all(priorFrom, priorTo);
  const priorMap = {};
  for (const r of prior) {
    priorMap[r.scenario] = r.total > 0 ? (r.fp / r.total) * 100 : 0;
  }

  const rows = cur.map(r => {
    const fpRate = r.total > 0 ? Math.round((r.fp / r.total) * 1000) / 10 : 0;
    const priorRate = priorMap[r.scenario];
    let trend = '—';
    if (priorRate != null) {
      const delta = fpRate - priorRate;
      if (delta > 2) trend = `↑ +${delta.toFixed(1)}%`;
      else if (delta < -2) trend = `↓ ${delta.toFixed(1)}%`;
      else trend = '→ flat';
    }
    return {
      scenario: r.scenario,
      total: r.total,
      false_positives: r.fp,
      fp_rate_pct: fpRate,
      trend
    };
  });

  const totalAll = rows.reduce((s, r) => s + r.total, 0);
  const fpAll = rows.reduce((s, r) => s + r.false_positives, 0);
  const overallRate = totalAll > 0 ? Math.round((fpAll / totalAll) * 1000) / 10 : 0;
  const sortedByRate = [...rows].sort((a, b) => a.fp_rate_pct - b.fp_rate_pct);

  res.json({
    title: 'False Positive Rate Report',
    range: { from: fromStr, to: toStr },
    summary: [
      { label: 'Overall FP Rate', value: `${overallRate}%`, tone: 'orange' },
      { label: 'Best Scenario', value: sortedByRate[0]?.scenario || '—', tone: 'green' },
      { label: 'Worst Scenario', value: sortedByRate[sortedByRate.length - 1]?.scenario || '—', tone: 'red' },
      { label: 'Total Closed', value: totalAll }
    ],
    columns: [
      { key: 'scenario',         label: 'Scenario' },
      { key: 'total',            label: 'Total Alerts' },
      { key: 'false_positives',  label: 'False Positives' },
      { key: 'fp_rate_pct',      label: 'FP Rate %', type: 'pct' },
      { key: 'trend',            label: 'Trend vs Last Period' }
    ],
    rows
  });
});

// ─────────────────────────────────────────────── 6. AUDIT TRAIL EXPORT

router.get('/audit-trail', (req, res) => {
  const { fromStr, toStr } = parseRange(req, 30);
  const actionType = req.query.action_type || '';
  const user = req.query.user || '';

  const rows = [];
  // SAR audit_trail
  db.prepare(`
    SELECT timestamp, performed_by AS user, action, sar_id AS entity_id,
           'SAR' AS entity_type, details
      FROM audit_trail
     WHERE date(timestamp) BETWEEN ? AND ?
  `).all(fromStr, toStr).forEach(r => rows.push(r));

  // SAR approvals
  db.prepare(`
    SELECT actioned_at AS timestamp, actioned_by AS user, action,
           sar_id AS entity_id, 'SAR' AS entity_type, comments AS details
      FROM sar_approval_log
     WHERE date(actioned_at) BETWEEN ? AND ?
  `).all(fromStr, toStr).forEach(r => rows.push(r));

  // Case notes
  db.prepare(`
    SELECT timestamp, analyst AS user, 'Case note added' AS action,
           alert_id AS entity_id, 'Alert' AS entity_type,
           SUBSTR(note_text, 1, 120) AS details
      FROM case_notes
     WHERE date(timestamp) BETWEEN ? AND ?
  `).all(fromStr, toStr).forEach(r => rows.push(r));

  rows.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

  // Filters available
  const allActions = [...new Set(rows.map(r => r.action).filter(Boolean))].sort();
  const allUsers = [...new Set(rows.map(r => r.user).filter(Boolean))].sort();

  let filtered = rows;
  if (actionType) filtered = filtered.filter(r => r.action === actionType);
  if (user) filtered = filtered.filter(r => r.user === user);

  res.json({
    title: 'Audit Trail Export',
    range: { from: fromStr, to: toStr },
    summary: [
      { label: 'Total Events', value: filtered.length },
      { label: 'Unique Users', value: [...new Set(filtered.map(r => r.user).filter(Boolean))].length },
      { label: 'Action Types', value: [...new Set(filtered.map(r => r.action).filter(Boolean))].length }
    ],
    columns: [
      { key: 'timestamp',   label: 'Timestamp' },
      { key: 'user',        label: 'User' },
      { key: 'action',      label: 'Action' },
      { key: 'entity_id',   label: 'Entity ID' },
      { key: 'entity_type', label: 'Entity Type' },
      { key: 'details',     label: 'Details' }
    ],
    rows: filtered,
    filters: {
      actions: allActions,
      users: allUsers,
      applied: { action_type: actionType, user }
    }
  });
});

// ─────────────────────────────────────────────── 7. REGULATORY COMPLIANCE

router.get('/regulatory', (req, res) => {
  const { fromStr, toStr } = parseRange(req);

  // SAR Filing Timeliness — % filed within 30 days of detection
  const filed = db.prepare(`
    SELECT julianday(filed_date) - julianday(COALESCE(detection_date, draft_created_date)) AS d
      FROM sar_filings
     WHERE filed_date IS NOT NULL
       AND date(filed_date) BETWEEN ? AND ?
  `).all(fromStr, toStr);
  const onTime = filed.filter(r => r.d != null && r.d <= 30).length;
  const timeliness = filed.length > 0 ? Math.round((onTime / filed.length) * 1000) / 10 : 0;

  // KYC Currency — % customers with KYC current as of today (target 95%)
  const today = new Date();
  const todayStr = ymd(today);
  const kycRows = db.prepare(`
    SELECT customer_risk_rating AS rating, last_kyc_review_date FROM customers
  `).all();
  const intervalDays = (rating) => rating === 'Very High' ? 180
    : rating === 'High' ? 365 : rating === 'Medium' ? 730 : 1095;
  let kycCurrent = 0, kycApplicable = 0;
  for (const c of kycRows) {
    if (!c.last_kyc_review_date) continue;
    kycApplicable++;
    const days = (today - new Date(c.last_kyc_review_date)) / 86400000;
    if (days <= intervalDays(c.rating)) kycCurrent++;
  }
  const kycPct = kycApplicable > 0 ? Math.round((kycCurrent / kycApplicable) * 1000) / 10 : 0;

  // SLA Compliance — % alerts NOT breached
  const slaTotals = db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN sla_breached = 0 THEN 1 ELSE 0 END) AS not_breached
      FROM alerts
     WHERE date(created_date) BETWEEN ? AND ?
  `).get(fromStr, toStr);
  const slaPct = slaTotals.total > 0
    ? Math.round((slaTotals.not_breached / slaTotals.total) * 1000) / 10
    : 0;

  // Retention Compliance — % filed SARs with at least 1 supporting document
  const retention = db.prepare(`
    SELECT s.sar_id, COUNT(d.id) AS doc_count
      FROM sar_filings s
      LEFT JOIN documents d ON d.sar_id = s.sar_id
     WHERE s.sar_status = 'Filed'
       AND date(s.filed_date) BETWEEN ? AND ?
     GROUP BY s.sar_id
  `).all(fromStr, toStr);
  const withDocs = retention.filter(r => r.doc_count > 0).length;
  const retentionPct = retention.length > 0
    ? Math.round((withDocs / retention.length) * 1000) / 10
    : 0;

  const judge = (current, target, atRiskMin) => {
    if (current >= target) return 'pass';
    if (current >= atRiskMin) return 'at_risk';
    return 'fail';
  };

  const sections = [
    {
      title: 'SAR Filing Timeliness',
      detail: `% filed within 30 days of detection (${onTime} of ${filed.length})`,
      current_pct: timeliness,
      target_pct: 100,
      status: judge(timeliness, 95, 80)
    },
    {
      title: 'KYC Review Currency',
      detail: `% customers with current KYC (${kycCurrent} of ${kycApplicable})`,
      current_pct: kycPct,
      target_pct: 95,
      status: judge(kycPct, 95, 85)
    },
    {
      title: 'SLA Compliance Rate',
      detail: `% alerts not breached (${slaTotals.not_breached} of ${slaTotals.total})`,
      current_pct: slaPct,
      target_pct: 98,
      status: judge(slaPct, 98, 90)
    },
    {
      title: 'Retention Compliance',
      detail: `% filed SARs with supporting docs (${withDocs} of ${retention.length})`,
      current_pct: retentionPct,
      target_pct: 100,
      status: judge(retentionPct, 95, 80)
    }
  ];

  res.json({
    title: 'Regulatory Compliance Report',
    range: { from: fromStr, to: toStr },
    summary: [
      { label: 'Pass', value: sections.filter(s => s.status === 'pass').length, tone: 'green' },
      { label: 'At Risk', value: sections.filter(s => s.status === 'at_risk').length, tone: 'orange' },
      { label: 'Fail', value: sections.filter(s => s.status === 'fail').length, tone: 'red' }
    ],
    sections
  });
});

// ─────────────────────────────────────────────── 8. ALERT AGING

router.get('/alert-aging', (req, res) => {
  const { fromStr, toStr } = parseRange(req);
  const TERMINAL = ['Completed', 'Closed', 'Filed'];
  const placeholders = TERMINAL.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT alert_id, customer_name AS customer, scenario,
           assigned_to AS analyst,
           CAST(julianday('now') - julianday(created_date) AS INTEGER) AS age_days,
           CASE
             WHEN sla_breached = 1 THEN 'Breached'
             WHEN due_status IS NOT NULL THEN due_status
             ELSE 'On Track'
           END AS sla_status,
           priority
      FROM alerts
     WHERE alert_status NOT IN (${placeholders})
       AND date(created_date) BETWEEN ? AND ?
     ORDER BY age_days DESC
  `).all(...TERMINAL, fromStr, toStr);

  const buckets = {
    '0-7 days':   [],
    '7-15 days':  [],
    '15-30 days': [],
    '30+ days':   []
  };
  for (const r of rows) {
    const a = r.age_days;
    const k = a < 7 ? '0-7 days' : a < 15 ? '7-15 days' : a < 30 ? '15-30 days' : '30+ days';
    buckets[k].push(r);
  }
  const groups = Object.entries(buckets).map(([name, items]) => ({ name, rows: items }));

  res.json({
    title: 'Alert Aging Report',
    range: { from: fromStr, to: toStr },
    summary: [
      { label: 'Total Open', value: rows.length },
      { label: '0-7 days', value: buckets['0-7 days'].length, tone: 'green' },
      { label: '7-15 days', value: buckets['7-15 days'].length, tone: 'blue' },
      { label: '15-30 days', value: buckets['15-30 days'].length, tone: 'orange' },
      { label: '30+ days', value: buckets['30+ days'].length, tone: 'red' }
    ],
    columns: [
      { key: 'alert_id',   label: 'Alert ID' },
      { key: 'customer',   label: 'Customer' },
      { key: 'scenario',   label: 'Scenario' },
      { key: 'analyst',    label: 'Analyst' },
      { key: 'age_days',   label: 'Age (days)' },
      { key: 'sla_status', label: 'SLA Status' },
      { key: 'priority',   label: 'Priority' }
    ],
    groups,
    rows
  });
});

// ─────────────────────────────────────────────── EMPLOYEE: MY ALERTS

function requireAnalyst(req, res) {
  const a = req.query.analyst_id;
  if (!a) {
    res.status(400).json({ error: 'analyst_id required' });
    return null;
  }
  return a;
}

router.get('/my-alerts', (req, res) => {
  const analyst = requireAnalyst(req, res);
  if (!analyst) return;
  const { fromStr, toStr } = parseRange(req);
  const rows = db.prepare(`
    SELECT alert_id, customer_name AS customer, scenario, priority,
           created_date AS assigned_date, alert_status AS status,
           CASE WHEN sla_breached = 1 THEN 'Yes' ELSE 'No' END AS breached,
           CASE
             WHEN linked_sar_id IS NOT NULL                 THEN 'Escalated SAR'
             WHEN case_converted = 1                        THEN 'Escalated L2'
             WHEN alert_status = 'Completed'                THEN 'False Positive'
             ELSE 'Open'
           END AS disposition,
           linked_sar_id
      FROM alerts
     WHERE assigned_to = ?
       AND date(created_date) BETWEEN ? AND ?
     ORDER BY created_date DESC
  `).all(analyst, fromStr, toStr);

  const assigned = rows.length;
  const closed = rows.filter(r => r.status === 'Completed').length;
  const breached = rows.filter(r => r.breached === 'Yes').length;
  const fp = rows.filter(r => r.disposition === 'False Positive').length;
  const sars = rows.filter(r => r.linked_sar_id).length;

  res.json({
    title: 'My Alert Summary',
    range: { from: fromStr, to: toStr },
    summary: [
      { label: 'Assigned', value: assigned },
      { label: 'Closed', value: closed, tone: 'green' },
      { label: 'Breached', value: breached, tone: 'red' },
      { label: 'False Positives', value: fp, tone: 'orange' },
      { label: 'SARs Filed', value: sars, tone: 'blue' }
    ],
    columns: [
      { key: 'alert_id',      label: 'Alert ID' },
      { key: 'customer',      label: 'Customer' },
      { key: 'scenario',      label: 'Scenario' },
      { key: 'priority',      label: 'Priority' },
      { key: 'assigned_date', label: 'Assigned Date' },
      { key: 'status',        label: 'Status' },
      { key: 'breached',      label: 'Breached' },
      { key: 'disposition',   label: 'Disposition' }
    ],
    rows
  });
});

// ─────────────────────────────────────────────── EMPLOYEE: MY SLA

router.get('/my-sla', (req, res) => {
  const analyst = requireAnalyst(req, res);
  if (!analyst) return;
  const { fromStr, toStr } = parseRange(req);
  const closed = db.prepare(`
    SELECT alert_id, customer_name AS customer, scenario,
           created_date, closed_date, sla_breached,
           CAST(julianday(closed_date) - julianday(created_date) AS REAL) AS res_days
      FROM alerts
     WHERE assigned_to = ?
       AND closed_date IS NOT NULL
       AND date(closed_date) BETWEEN ? AND ?
  `).all(analyst, fromStr, toStr);
  const onTime = closed.filter(r => r.sla_breached === 0).length;
  const breached = closed.filter(r => r.sla_breached === 1).length;
  const myAvg = closed.length > 0
    ? Math.round(closed.reduce((s, r) => s + (r.res_days || 0), 0) / closed.length * 10) / 10
    : 0;
  const teamAvgRow = db.prepare(`
    SELECT AVG(${RES_EXPR}) AS a FROM alerts
     WHERE closed_date IS NOT NULL
       AND date(closed_date) BETWEEN ? AND ?
  `).get(fromStr, toStr);
  const teamAvg = teamAvgRow.a != null ? Math.round(teamAvgRow.a * 10) / 10 : 0;

  res.json({
    title: 'My SLA Performance',
    range: { from: fromStr, to: toStr },
    summary: [
      { label: 'On Time', value: onTime, tone: 'green' },
      { label: 'Breached', value: breached, tone: 'red' },
      { label: 'My Avg Resolution', value: `${myAvg}d` },
      { label: 'Team Avg Resolution', value: `${teamAvg}d` },
      { label: 'My vs Team', value: `${myAvg <= teamAvg ? '↓' : '↑'} ${Math.abs(myAvg - teamAvg).toFixed(1)}d`,
        tone: myAvg <= teamAvg ? 'green' : 'red' }
    ],
    columns: [
      { key: 'alert_id',     label: 'Alert ID' },
      { key: 'customer',     label: 'Customer' },
      { key: 'scenario',     label: 'Scenario' },
      { key: 'created_date', label: 'Created' },
      { key: 'closed_date',  label: 'Closed' },
      { key: 'res_days',     label: 'Resolution (days)', type: 'days' },
      { key: 'sla_breached', label: 'Breached',
        format: 'yesno' }
    ],
    rows: closed.map(r => ({
      ...r,
      res_days: r.res_days != null ? Math.round(r.res_days * 10) / 10 : null,
      sla_breached: r.sla_breached === 1 ? 'Yes' : 'No'
    }))
  });
});

// ─────────────────────────────────────────────── EMPLOYEE: MY SARS

router.get('/my-sars', (req, res) => {
  const analyst = requireAnalyst(req, res);
  if (!analyst) return;
  const { fromStr, toStr } = parseRange(req);
  const dateCol = "COALESCE(filed_date, draft_created_date)";
  const rows = db.prepare(`
    SELECT sar_id, customer_name AS customer,
           COALESCE(filed_date, draft_created_date) AS filed_date,
           sar_status AS status,
           COALESCE(NULLIF(sar_type, ''), 'Initial SAR') AS type,
           COALESCE(total_amount, amount_involved_inr, 0) AS amount,
           rejection_reason_category AS rejection_reason,
           rejection_comments,
           regulator_reference
      FROM sar_filings
     WHERE prepared_by = ?
       AND ${dateCol} IS NOT NULL
       AND date(${dateCol}) BETWEEN ? AND ?
     ORDER BY date(${dateCol}) DESC
  `).all(analyst, fromStr, toStr);

  const total = rows.length;
  const filed = rows.filter(r => r.status === 'Filed').length;
  const rejected = rows.filter(r =>
    r.status === 'Rejected' || r.status === 'Returned for Revision').length;
  const pending = rows.filter(r =>
    r.status === 'Pending Approval' || r.status === 'Under Manager Review' || r.status === 'Draft').length;

  res.json({
    title: 'My SAR History',
    range: { from: fromStr, to: toStr },
    summary: [
      { label: 'Total Submitted', value: total },
      { label: 'Approved & Filed', value: filed, tone: 'green' },
      { label: 'Rejected/Returned', value: rejected, tone: 'red' },
      { label: 'Pending', value: pending, tone: 'orange' }
    ],
    columns: [
      { key: 'sar_id',           label: 'SAR ID' },
      { key: 'customer',         label: 'Customer' },
      { key: 'filed_date',       label: 'Date' },
      { key: 'type',             label: 'Type' },
      { key: 'amount',           label: 'Amount', type: 'currency' },
      { key: 'status',           label: 'Status' },
      { key: 'rejection_reason', label: 'Rejection Reason' },
      { key: 'regulator_reference', label: 'Regulator Ref' }
    ],
    rows
  });
});

// ─────────────────────────────────────────────── EMPLOYEE: MY KYC

router.get('/my-kyc', (req, res) => {
  const analyst = requireAnalyst(req, res);
  if (!analyst) return;
  const { fromStr, toStr } = parseRange(req);
  const today = ymd(new Date());
  const rows = db.prepare(`
    SELECT kr.id, kr.customer_id,
           c.customer_name AS customer,
           kr.review_type, kr.status, kr.priority,
           kr.due_date, kr.assigned_at,
           kr.completed_at,
           c.customer_risk_rating AS risk_rating
      FROM kyc_reviews kr
      LEFT JOIN customers c ON c.customer_id = kr.customer_id
     WHERE kr.assigned_to = ?
       AND (
         (kr.completed_at IS NOT NULL AND date(kr.completed_at) BETWEEN ? AND ?)
         OR (kr.completed_at IS NULL AND date(kr.assigned_at) BETWEEN ? AND ?)
       )
     ORDER BY kr.due_date ASC
  `).all(analyst, fromStr, toStr, fromStr, toStr);

  const enriched = rows.map(r => ({
    ...r,
    bucket: r.status === 'completed' || r.completed_at
      ? 'Completed'
      : (r.due_date && r.due_date < today ? 'Overdue' : 'Pending')
  }));
  const completed = enriched.filter(r => r.bucket === 'Completed').length;
  const pending = enriched.filter(r => r.bucket === 'Pending').length;
  const overdue = enriched.filter(r => r.bucket === 'Overdue').length;

  res.json({
    title: 'My KYC Reviews',
    range: { from: fromStr, to: toStr },
    summary: [
      { label: 'Completed', value: completed, tone: 'green' },
      { label: 'Pending', value: pending, tone: 'orange' },
      { label: 'Overdue', value: overdue, tone: 'red' }
    ],
    columns: [
      { key: 'customer',     label: 'Customer' },
      { key: 'risk_rating',  label: 'Risk Rating' },
      { key: 'review_type',  label: 'Review Type' },
      { key: 'priority',     label: 'Priority' },
      { key: 'due_date',     label: 'Due Date' },
      { key: 'assigned_at',  label: 'Assigned' },
      { key: 'completed_at', label: 'Completed' },
      { key: 'bucket',       label: 'Status' }
    ],
    rows: enriched
  });
});

// ─────────────────────────────────────────────── SCHEDULES

router.get('/schedules', (_req, res) => {
  const rows = db.prepare(`SELECT * FROM report_schedules ORDER BY created_at DESC`).all();
  res.json(rows);
});

router.post('/schedules', (req, res) => {
  const { report_key, frequency, day_of, format, recipients, created_by } = req.body || {};
  if (!report_key || !frequency || !format || !recipients) {
    return res.status(400).json({ error: 'report_key, frequency, format and recipients are required' });
  }
  if (!['weekly', 'monthly', 'quarterly'].includes(frequency)) {
    return res.status(400).json({ error: 'frequency must be weekly|monthly|quarterly' });
  }
  if (!['pdf', 'excel'].includes(format)) {
    return res.status(400).json({ error: 'format must be pdf|excel' });
  }
  const info = db.prepare(`
    INSERT INTO report_schedules (report_key, frequency, day_of, format, recipients, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(report_key, frequency, day_of || null, format, recipients, created_by || null);
  const row = db.prepare(`SELECT * FROM report_schedules WHERE id = ?`).get(info.lastInsertRowid);
  res.status(201).json(row);
});

router.delete('/schedules/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare(`SELECT * FROM report_schedules WHERE id = ?`).get(id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  db.prepare(`DELETE FROM report_schedules WHERE id = ?`).run(id);
  res.json({ ok: true, id });
});

module.exports = router;
