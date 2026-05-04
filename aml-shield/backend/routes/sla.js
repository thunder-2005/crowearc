const express = require('express');
const pool = require('../database/db');
const router = express.Router();

const TERMINAL = ['Completed', 'Closed', 'Filed', 'Escalated - L2', 'Escalated - SAR'];

function deadlineFor(a) {
  if (a.sla_deadline) {
    const d = new Date(a.sla_deadline.length <= 10 ? `${a.sla_deadline}T23:59:59` : a.sla_deadline);
    if (!isNaN(d.getTime())) return d;
  }
  if (a.created_date && a.sla_days != null) {
    const c = new Date(a.created_date.length <= 10 ? `${a.created_date}T00:00:00` : a.created_date);
    if (!isNaN(c.getTime())) return new Date(c.getTime() + a.sla_days * 86400000);
  }
  return null;
}

router.get('/status', async (_req, res, next) => {
  try {
    const placeholders = TERMINAL.map((_, i) => `$${i + 1}`).join(',');
    const result = await pool.query(
      `SELECT * FROM alerts WHERE alert_status NOT IN (${placeholders})`,
      TERMINAL
    );
    const rows = result.rows;

    const now = Date.now();
    const enriched = rows.map(a => {
      const dl = deadlineFor(a);
      const remainingMs = dl ? dl.getTime() - now : null;
      const remainingHours = remainingMs != null ? remainingMs / 3600000 : null;
      let bucket;
      if (remainingHours == null)        bucket = 'unknown';
      else if (remainingHours <= 0)      bucket = 'breached';
      else if (remainingHours <= 24)     bucket = 'critical';
      else if (remainingHours <= 72)     bucket = 'warning';
      else                                bucket = 'ok';
      return {
        alert_id: a.alert_id,
        customer_id: a.customer_id,
        customer_name: a.customer_name,
        scenario: a.scenario,
        priority: a.priority,
        assigned_to: a.assigned_to,
        alert_status: a.alert_status,
        created_date: a.created_date,
        sla_days: a.sla_days,
        sla_deadline: dl ? dl.toISOString() : null,
        remaining_hours: remainingHours != null ? Number(remainingHours.toFixed(2)) : null,
        bucket
      };
    });

    enriched.sort((x, y) => {
      const xr = x.remaining_hours ?? Number.POSITIVE_INFINITY;
      const yr = y.remaining_hours ?? Number.POSITIVE_INFINITY;
      return xr - yr;
    });
    res.json(enriched);
  } catch (err) { next(err); }
});

module.exports = router;
