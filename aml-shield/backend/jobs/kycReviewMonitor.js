const pool = require('../database/db');

const TICK_MS = 24 * 3600000;

function intervalDaysForRating(r) {
  switch ((r || '').toLowerCase()) {
    case 'low':       return 365 * 3;
    case 'medium':    return 365 * 2;
    case 'high':      return 365;
    case 'very high': return 180;
    default:          return 365 * 2;
  }
}

function nextDueDate(customer) {
  const interval = intervalDaysForRating(customer.customer_risk_rating);
  if (customer.last_kyc_review_date) {
    const last = new Date(customer.last_kyc_review_date);
    if (!isNaN(last.getTime())) {
      return new Date(last.getTime() + interval * 86400000);
    }
  }
  if (customer.customer_since_date) {
    const since = new Date(customer.customer_since_date);
    if (!isNaN(since.getTime())) {
      return new Date(since.getTime() + interval * 86400000);
    }
  }
  return new Date();
}

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

async function notifyManager(type, title, message, related_id, tone = 'warning') {
  await pool.query(`
    INSERT INTO notifications (recipient_id, recipient_role, type, title, message, related_id, related_type, tone)
    VALUES (NULL, 'manager', $1, $2, $3, $4, 'kyc_review', $5)
  `, [type, title, message, related_id, tone]);
}

async function tick() {
  try {
    const customers = (await pool.query(`
      SELECT customer_id, customer_name, customer_risk_rating, cdd_level,
             last_kyc_review_date, customer_since_date
        FROM customers
    `)).rows;

    let createdScheduled = 0, createdOverdue = 0, dueSoon = 0, triggeredSar = 0, triggeredAlerts = 0;
    const now = Date.now();
    const cutoffSar = ymd(new Date(now - 30 * 86400000));
    const cutoffAlerts = ymd(new Date(now - 90 * 86400000));

    for (const c of customers) {
      const due = nextDueDate(c);
      const dueStr = ymd(due);
      const remainingDays = Math.ceil((due.getTime() - now) / 86400000);

      const existingOpen = (await pool.query(`
        SELECT id, status FROM kyc_reviews
         WHERE customer_id = $1 AND status NOT IN ('completed', 'rejected')
         ORDER BY id DESC LIMIT 1
      `, [c.customer_id])).rows[0];

      if (!existingOpen) {
        if (remainingDays <= 0) {
          await pool.query(`
            INSERT INTO kyc_reviews (customer_id, review_type, status, due_date, previous_risk_rating, previous_cdd_level)
            VALUES ($1, 'scheduled', 'overdue', $2, $3, $4)
          `, [c.customer_id, dueStr, c.customer_risk_rating, c.cdd_level]);
          createdOverdue++;
          await notifyManager('kyc_overdue',
            `KYC review overdue — ${c.customer_name}`,
            `${c.customer_name} (${c.customer_id}) is overdue. Due ${dueStr}.`,
            c.customer_id, 'error');
        } else if (remainingDays <= 30) {
          await pool.query(`
            INSERT INTO kyc_reviews (customer_id, review_type, status, due_date, previous_risk_rating, previous_cdd_level)
            VALUES ($1, 'scheduled', 'pending', $2, $3, $4)
          `, [c.customer_id, dueStr, c.customer_risk_rating, c.cdd_level]);
          createdScheduled++;
          dueSoon++;
          await notifyManager('kyc_due_soon',
            `KYC review due in ${remainingDays}d — ${c.customer_name}`,
            `Schedule a review for ${c.customer_name} (${c.customer_id}). Due ${dueStr}.`,
            c.customer_id);
        }
      } else if (existingOpen.status === 'pending' && remainingDays <= 0) {
        await pool.query(
          "UPDATE kyc_reviews SET status = 'overdue', updated_at = NOW() WHERE id = $1",
          [existingOpen.id]
        );
      }

      const recentSar = (await pool.query(`
        SELECT sar_id FROM sar_filings
         WHERE customer_id = $1
           AND COALESCE(filed_date, draft_created_date) >= $2
         ORDER BY COALESCE(filed_date, draft_created_date) DESC
         LIMIT 1
      `, [c.customer_id, cutoffSar])).rows[0];
      if (recentSar) {
        const exists = (await pool.query(`
          SELECT 1 FROM kyc_reviews
           WHERE customer_id = $1 AND review_type = 'triggered_sar' AND status NOT IN ('completed', 'rejected')
           LIMIT 1
        `, [c.customer_id])).rows[0];
        if (!exists) {
          await pool.query(`
            INSERT INTO kyc_reviews
              (customer_id, review_type, status, due_date, priority,
               previous_risk_rating, previous_cdd_level, triggered_by_sar_id)
            VALUES ($1, 'triggered_sar', 'pending', $2, 'Urgent', $3, $4, $5)
          `, [c.customer_id, ymd(new Date()), c.customer_risk_rating, c.cdd_level, recentSar.sar_id]);
          triggeredSar++;
          await notifyManager('kyc_triggered_sar',
            `SAR-triggered KYC review — ${c.customer_name}`,
            `A SAR was filed in the last 30 days for ${c.customer_name}; immediate review required.`,
            c.customer_id, 'error');
        }
      }

      const recentAlerts = (await pool.query(`
        SELECT COUNT(*) AS c FROM alerts
         WHERE customer_id = $1 AND created_date >= $2
      `, [c.customer_id, cutoffAlerts])).rows[0];
      const alertCount = recentAlerts ? Number(recentAlerts.c) : 0;
      if (alertCount >= 3) {
        const exists = (await pool.query(`
          SELECT 1 FROM kyc_reviews
           WHERE customer_id = $1 AND review_type = 'triggered_alerts' AND status NOT IN ('completed', 'rejected')
           LIMIT 1
        `, [c.customer_id])).rows[0];
        if (!exists) {
          const latestAlert = (await pool.query(`
            SELECT alert_id FROM alerts
             WHERE customer_id = $1 AND created_date >= $2
             ORDER BY created_date DESC LIMIT 1
          `, [c.customer_id, cutoffAlerts])).rows[0];
          await pool.query(`
            INSERT INTO kyc_reviews
              (customer_id, review_type, status, due_date, priority,
               previous_risk_rating, previous_cdd_level, triggered_by_alert_id)
            VALUES ($1, 'triggered_alerts', 'pending', $2, 'Urgent', $3, $4, $5)
          `, [c.customer_id, ymd(new Date()), c.customer_risk_rating, c.cdd_level,
              latestAlert ? latestAlert.alert_id : null]);
          triggeredAlerts++;
          await notifyManager('kyc_triggered_alerts',
            `Alert-triggered KYC review — ${c.customer_name}`,
            `${c.customer_name} has ${alertCount} alerts in the last 90 days; immediate review required.`,
            c.customer_id, 'warning');
        }
      }
    }

    if (createdScheduled || createdOverdue || triggeredSar || triggeredAlerts) {
      console.log(`[kycReviewMonitor] +${createdScheduled} scheduled, +${createdOverdue} overdue, +${triggeredSar} SAR-triggered, +${triggeredAlerts} alert-triggered`);
    }
  } catch (e) {
    console.error('[kycReviewMonitor] error:', e.message);
  }
}

async function seedInitialIfEmpty() {
  const c = Number((await pool.query('SELECT COUNT(*) AS c FROM kyc_reviews')).rows[0].c);
  if (c > 0) return;
  console.log('[kycReviewMonitor] seeding initial reviews from customers…');
  await tick();
}

function start() {
  // Fire seedInitialIfEmpty + first tick on a short delay so the pool is warm.
  setTimeout(() => { seedInitialIfEmpty().catch(e => console.error('[kycReviewMonitor] seed error:', e.message)); }, 30_000);
  setInterval(() => { tick().catch(e => console.error('[kycReviewMonitor] tick error:', e.message)); }, TICK_MS);
  console.log(`[kycReviewMonitor] started — every ${TICK_MS / 3600000}h`);
}

module.exports = { start, tick, seedInitialIfEmpty, intervalDaysForRating };
