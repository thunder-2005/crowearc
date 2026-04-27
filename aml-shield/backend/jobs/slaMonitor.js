const { db } = require('../database/db');

const TICK_MS = 5 * 60 * 1000;
const TERMINAL_STATUSES = new Set(['Completed', 'Closed', 'Filed', 'Escalated - L2', 'Escalated - SAR']);

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

function alreadyNotifiedRecently(col, alertId) {
  const row = db.prepare(`SELECT ${col} FROM alerts WHERE alert_id = ?`).get(alertId);
  if (!row || !row[col]) return false;
  const last = new Date(row[col].includes('T') ? row[col] : row[col].replace(' ', 'T') + 'Z');
  if (isNaN(last.getTime())) return false;
  return (Date.now() - last.getTime()) < 24 * 3600000;
}

function tick() {
  try {
    const alerts = db.prepare(`
      SELECT alert_id, customer_id, customer_name, scenario, priority,
             assigned_to, alert_status, created_date, sla_days, sla_deadline,
             sla_breached, due_status, sla_warning_notified_at, sla_breach_notified_at
        FROM alerts
       WHERE alert_status NOT IN ('Completed', 'Closed', 'Filed', 'Escalated - L2', 'Escalated - SAR')
    `).all();

    const now = new Date();
    const insertNotif = db.prepare(`
      INSERT INTO notifications (recipient_id, recipient_role, type, title, message, related_id, related_type, tone)
      VALUES (?, ?, ?, ?, ?, ?, 'alert', ?)
    `);

    let warnings = 0, breaches = 0;
    for (const a of alerts) {
      if (TERMINAL_STATUSES.has(a.alert_status)) continue;
      const deadline = deadlineFor(a);
      if (!deadline) continue;
      const remainingHours = hoursBetween(deadline, now);

      if (remainingHours <= 0) {
        if (alreadyNotifiedRecently('sla_breach_notified_at', a.alert_id)) continue;
        if (a.assigned_to) {
          insertNotif.run(a.assigned_to, 'employee', 'sla_breached',
            `SLA breached — ${a.alert_id}`,
            `${a.scenario} for ${a.customer_name} breached its SLA. Action required.`,
            a.alert_id, 'error');
        }
        insertNotif.run(null, 'manager', 'sla_breached_manager',
          `Team SLA breached — ${a.alert_id}`,
          `${a.scenario} for ${a.customer_name}${a.assigned_to ? ` (assigned to ${a.assigned_to})` : ''} has breached its SLA.`,
          a.alert_id, 'error');
        db.prepare("UPDATE alerts SET sla_breached = 1, sla_breach_notified_at = ?, due_status = 'Breached' WHERE alert_id = ?")
          .run(nowIso(), a.alert_id);
        breaches++;
      } else if (remainingHours <= 24) {
        if (alreadyNotifiedRecently('sla_warning_notified_at', a.alert_id)) continue;
        if (a.assigned_to) {
          insertNotif.run(a.assigned_to, 'employee', 'sla_warning',
            `SLA warning — ${a.alert_id}`,
            `${a.scenario} for ${a.customer_name} has under 24h remaining.`,
            a.alert_id, 'warning');
        }
        insertNotif.run(null, 'manager', 'sla_warning_manager',
          `Team SLA warning — ${a.alert_id}`,
          `${a.scenario} for ${a.customer_name}${a.assigned_to ? ` (assigned to ${a.assigned_to})` : ''} is within 24h of breach.`,
          a.alert_id, 'warning');
        db.prepare('UPDATE alerts SET sla_warning_notified_at = ? WHERE alert_id = ?')
          .run(nowIso(), a.alert_id);
        warnings++;
      }
    }
    if (warnings || breaches) {
      console.log(`[slaMonitor] ${warnings} warning(s) · ${breaches} breach(es) at ${nowIso()}`);
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
