const { db } = require('../database/db');

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

function ensureScheduledReview(customer, type = 'scheduled') {
  const due = nextDueDate(customer);
  const dueStr = ymd(due);
  const existing = db.prepare(`
    SELECT * FROM kyc_reviews
     WHERE customer_id = ? AND status NOT IN ('completed', 'rejected')
     ORDER BY id DESC LIMIT 1
  `).get(customer.customer_id);
  if (existing) return existing;
  const isOverdue = due.getTime() <= Date.now();
  db.prepare(`
    INSERT INTO kyc_reviews
      (customer_id, review_type, status, due_date, previous_risk_rating, previous_cdd_level)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    customer.customer_id, type,
    isOverdue ? 'overdue' : 'pending',
    dueStr,
    customer.customer_risk_rating, customer.cdd_level
  );
  return db.prepare('SELECT * FROM kyc_reviews WHERE customer_id = ? ORDER BY id DESC LIMIT 1').get(customer.customer_id);
}

function notifyManager(type, title, message, related_id, tone = 'warning') {
  db.prepare(`
    INSERT INTO notifications (recipient_id, recipient_role, type, title, message, related_id, related_type, tone)
    VALUES (NULL, 'manager', ?, ?, ?, ?, 'kyc_review', ?)
  `).run(type, title, message, related_id, tone);
}

function tick() {
  try {
    const customers = db.prepare(`
      SELECT customer_id, customer_name, customer_risk_rating, cdd_level,
             last_kyc_review_date, customer_since_date
        FROM customers
    `).all();

    let createdScheduled = 0, createdOverdue = 0, dueSoon = 0, triggeredSar = 0, triggeredAlerts = 0;
    const now = Date.now();
    const cutoffSar = ymd(new Date(now - 30 * 86400000));
    const cutoffAlerts = ymd(new Date(now - 90 * 86400000));

    for (const c of customers) {
      const due = nextDueDate(c);
      const dueStr = ymd(due);
      const remainingDays = Math.ceil((due.getTime() - now) / 86400000);

      const existingOpen = db.prepare(`
        SELECT id, status FROM kyc_reviews
         WHERE customer_id = ? AND status NOT IN ('completed', 'rejected')
         ORDER BY id DESC LIMIT 1
      `).get(c.customer_id);

      if (!existingOpen) {
        if (remainingDays <= 0) {
          db.prepare(`
            INSERT INTO kyc_reviews (customer_id, review_type, status, due_date, previous_risk_rating, previous_cdd_level)
            VALUES (?, 'scheduled', 'overdue', ?, ?, ?)
          `).run(c.customer_id, dueStr, c.customer_risk_rating, c.cdd_level);
          createdOverdue++;
          notifyManager('kyc_overdue',
            `KYC review overdue — ${c.customer_name}`,
            `${c.customer_name} (${c.customer_id}) is overdue. Due ${dueStr}.`,
            c.customer_id, 'error');
        } else if (remainingDays <= 30) {
          db.prepare(`
            INSERT INTO kyc_reviews (customer_id, review_type, status, due_date, previous_risk_rating, previous_cdd_level)
            VALUES (?, 'scheduled', 'pending', ?, ?, ?)
          `).run(c.customer_id, dueStr, c.customer_risk_rating, c.cdd_level);
          createdScheduled++;
          dueSoon++;
          notifyManager('kyc_due_soon',
            `KYC review due in ${remainingDays}d — ${c.customer_name}`,
            `Schedule a review for ${c.customer_name} (${c.customer_id}). Due ${dueStr}.`,
            c.customer_id);
        }
      } else if (existingOpen.status === 'pending' && remainingDays <= 0) {
        db.prepare("UPDATE kyc_reviews SET status = 'overdue', updated_at = datetime('now') WHERE id = ?")
          .run(existingOpen.id);
      }

      const recentSar = db.prepare(`
        SELECT sar_id FROM sar_filings
         WHERE customer_id = ?
           AND COALESCE(filed_date, draft_created_date) >= ?
         ORDER BY datetime(COALESCE(filed_date, draft_created_date)) DESC
         LIMIT 1
      `).get(c.customer_id, cutoffSar);
      if (recentSar) {
        const exists = db.prepare(`
          SELECT 1 FROM kyc_reviews
           WHERE customer_id = ? AND review_type = 'triggered_sar' AND status NOT IN ('completed', 'rejected')
           LIMIT 1
        `).get(c.customer_id);
        if (!exists) {
          db.prepare(`
            INSERT INTO kyc_reviews
              (customer_id, review_type, status, due_date, priority,
               previous_risk_rating, previous_cdd_level, triggered_by_sar_id)
            VALUES (?, 'triggered_sar', 'pending', ?, 'Urgent', ?, ?, ?)
          `).run(c.customer_id, ymd(new Date()), c.customer_risk_rating, c.cdd_level, recentSar.sar_id);
          triggeredSar++;
          notifyManager('kyc_triggered_sar',
            `SAR-triggered KYC review — ${c.customer_name}`,
            `A SAR was filed in the last 30 days for ${c.customer_name}; immediate review required.`,
            c.customer_id, 'error');
        }
      }

      const recentAlerts = db.prepare(`
        SELECT alert_id, COUNT(*) AS c FROM alerts
         WHERE customer_id = ? AND created_date >= ?
      `).get(c.customer_id, cutoffAlerts);
      const alertCount = recentAlerts ? recentAlerts.c : 0;
      if (alertCount >= 3) {
        const exists = db.prepare(`
          SELECT 1 FROM kyc_reviews
           WHERE customer_id = ? AND review_type = 'triggered_alerts' AND status NOT IN ('completed', 'rejected')
           LIMIT 1
        `).get(c.customer_id);
        if (!exists) {
          const latestAlert = db.prepare(`
            SELECT alert_id FROM alerts
             WHERE customer_id = ? AND created_date >= ?
             ORDER BY date(created_date) DESC LIMIT 1
          `).get(c.customer_id, cutoffAlerts);
          db.prepare(`
            INSERT INTO kyc_reviews
              (customer_id, review_type, status, due_date, priority,
               previous_risk_rating, previous_cdd_level, triggered_by_alert_id)
            VALUES (?, 'triggered_alerts', 'pending', ?, 'Urgent', ?, ?, ?)
          `).run(c.customer_id, ymd(new Date()), c.customer_risk_rating, c.cdd_level,
                 latestAlert ? latestAlert.alert_id : null);
          triggeredAlerts++;
          notifyManager('kyc_triggered_alerts',
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

function seedInitialIfEmpty() {
  const c = db.prepare('SELECT COUNT(*) AS c FROM kyc_reviews').get().c;
  if (c > 0) return;
  console.log('[kycReviewMonitor] seeding initial reviews from customers…');
  tick();
}

function start() {
  seedInitialIfEmpty();
  setTimeout(tick, 30_000);
  setInterval(tick, TICK_MS);
  console.log(`[kycReviewMonitor] started — every ${TICK_MS / 3600000}h`);
}

module.exports = { start, tick, seedInitialIfEmpty, intervalDaysForRating };
