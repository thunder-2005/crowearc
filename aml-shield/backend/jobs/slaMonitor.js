const pool = require('../database/db');
const { getManagerSetting } = require('../utils/getManagerSetting');

const TICK_MS = 5 * 60 * 1000;
// Statuses for which the SLA monitor should not produce notifications.
// 'Closed — False Positive' (em dash) is the seed-data convention; without
// it the monitor would keep nagging about FP-closed alerts that already
// have a closed_date.
const TERMINAL_STATUSES = new Set([
  'Completed', 'Closed', 'Filed',
  'Closed — False Positive',
  'Escalated - L2', 'Escalated - SAR'
]);

function nowIso() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function hoursBetween(later, earlier) {
  return (later.getTime() - earlier.getTime()) / 3600000;
}

function deadlineFor(alert) {
  if (alert.sla_deadline) {
    const d = new Date(alert.sla_deadline.length <= 10 ? `${alert.sla_deadline}T23:59:59` : alert.sla_deadline);
    if (!isNaN(d.getTime())) return d;
  }
  if (alert.created_date && alert.sla_days != null) {
    const created = new Date(alert.created_date.length <= 10 ? `${alert.created_date}T00:00:00` : alert.created_date);
    if (!isNaN(created.getTime())) {
      return new Date(created.getTime() + alert.sla_days * 86400000);
    }
  }
  return null;
}

async function alreadyNotifiedRecently(col, alertId) {
  const row = (await pool.query(`SELECT ${col} FROM alerts WHERE alert_id = $1`, [alertId])).rows[0];
  if (!row || !row[col]) return false;
  const last = new Date(row[col].includes('T') ? row[col] : row[col].replace(' ', 'T') + 'Z');
  if (isNaN(last.getTime())) return false;
  return (Date.now() - last.getTime()) < 24 * 3600000;
}

// 48hr warnings use query-based dedup so we don't have to add a new column
// to alerts. We look back 48 hours in the notifications table for a row
// matching this alert + type. Returns true if one already exists.
async function notification48hrAlreadyExists(alertId) {
  const r = await pool.query(
    `SELECT 1 FROM notifications
      WHERE type IN ('sla_warning_48hr', 'sla_warning_48hr_manager')
        AND related_id = $1
        AND created_at::timestamp >= (NOW() - INTERVAL '48 hours')
      LIMIT 1`,
    [alertId]
  );
  return r.rows.length > 0;
}

async function tick() {
  try {
    // Manager-tunable: how much of the SLA window must elapse before the
    // early warning fires. Default 80% (matches the legacy 48hr-on-7-day
    // ratio close enough). Setting it higher delays the early warning;
    // lower brings it forward.
    const warnPct = Number(await getManagerSetting('sla.warning_threshold_pct', 80)) || 80;

    const alerts = (await pool.query(`
      SELECT alert_id, customer_id, customer_name, scenario, priority,
             assigned_to, alert_status, created_date, sla_days, sla_deadline,
             sla_breached, due_status, sla_warning_notified_at, sla_breach_notified_at
        FROM alerts
       WHERE alert_status NOT IN ('Completed', 'Closed', 'Filed', 'Closed — False Positive', 'Escalated - L2', 'Escalated - SAR')
    `)).rows;

    const now = new Date();
    const insertNotif = async (params) => pool.query(`
      INSERT INTO notifications (recipient_id, recipient_role, type, title, message, related_id, related_type, tone)
      VALUES ($1, $2, $3, $4, $5, $6, 'alert', $7)
    `, params);

    let warnings = 0, breaches = 0, warnings48 = 0;
    for (const a of alerts) {
      if (TERMINAL_STATUSES.has(a.alert_status)) continue;
      const deadline = deadlineFor(a);
      if (!deadline) continue;
      const remainingHours = hoursBetween(deadline, now);

      // Per-alert early-warning band: fires when more than `warnPct`% of
      // the SLA has elapsed but at least a day still remains. For a 7-day
      // SLA at 80%: warns when ≤ 33.6 hrs remain. At 50%: warns at ≤ 84 hrs.
      const totalSlaHours = Number(a.sla_days || 0) * 24;
      const earlyWarningHours = totalSlaHours > 0
        ? Math.max(0, totalSlaHours * (100 - warnPct) / 100)
        : 0;

      if (remainingHours <= 0) {
        if (await alreadyNotifiedRecently('sla_breach_notified_at', a.alert_id)) continue;
        if (a.assigned_to) {
          await insertNotif([a.assigned_to, 'employee', 'sla_breached',
            `SLA breached — ${a.alert_id}`,
            `${a.scenario} for ${a.customer_name} breached its SLA. Action required.`,
            a.alert_id, 'error']);
        }
        await insertNotif([null, 'manager', 'sla_breached_manager',
          `Team SLA breached — ${a.alert_id}`,
          `${a.scenario} for ${a.customer_name}${a.assigned_to ? ` (assigned to ${a.assigned_to})` : ''} has breached its SLA.`,
          a.alert_id, 'error']);
        await pool.query(
          "UPDATE alerts SET sla_breached = 1, sla_breach_notified_at = $1, due_status = 'Breached' WHERE alert_id = $2",
          [nowIso(), a.alert_id]
        );
        breaches++;
      } else if (remainingHours <= 24) {
        if (await alreadyNotifiedRecently('sla_warning_notified_at', a.alert_id)) continue;
        if (a.assigned_to) {
          await insertNotif([a.assigned_to, 'employee', 'sla_warning',
            `SLA warning — ${a.alert_id}`,
            `${a.scenario} for ${a.customer_name} has under 24h remaining.`,
            a.alert_id, 'warning']);
        }
        await insertNotif([null, 'manager', 'sla_warning_manager',
          `Team SLA warning — ${a.alert_id}`,
          `${a.scenario} for ${a.customer_name}${a.assigned_to ? ` (assigned to ${a.assigned_to})` : ''} is within 24h of breach.`,
          a.alert_id, 'warning']);
        await pool.query(
          'UPDATE alerts SET sla_warning_notified_at = $1 WHERE alert_id = $2',
          [nowIso(), a.alert_id]
        );
        warnings++;
      } else if (earlyWarningHours > 24 && remainingHours <= earlyWarningHours && remainingHours > 24) {
        // Earliest warning tier — fires once per alert per 48-hour dedup
        // window. The trigger band is now manager-tunable via the
        // sla.warning_threshold_pct setting (see top of tick()). When the
        // chosen threshold puts the early window inside the 24hr final
        // tier, this branch is silently skipped.
        if (await notification48hrAlreadyExists(a.alert_id)) continue;
        const hrsLabel = `${Math.floor(remainingHours)}h remaining`;
        if (a.assigned_to) {
          await insertNotif([a.assigned_to, 'employee', 'sla_warning_48hr',
            'SLA Warning — 48 Hours',
            `${a.alert_id} — ${a.scenario} — ${a.customer_name} — ${hrsLabel}`,
            a.alert_id, 'warning']);
        }
        await insertNotif([null, 'manager', 'sla_warning_48hr_manager',
          'Team SLA Warning — 48 Hours',
          `${a.assigned_to || 'Unassigned'} — ${a.alert_id} — ${a.scenario} — ${hrsLabel}`,
          a.alert_id, 'warning']);
        warnings48++;
      }
    }
    if (warnings || breaches || warnings48) {
      console.log(`[slaMonitor] ${warnings48} 48h · ${warnings} 24h · ${breaches} breach(es) at ${nowIso()}`);
    }
  } catch (e) {
    console.error('[slaMonitor] error:', e.message);
  }
}

function start() {
  setTimeout(tick, 5_000);
  setInterval(tick, TICK_MS);
  console.log(`[slaMonitor] started — every ${TICK_MS / 60000} min`);
}

module.exports = { start, tick };
