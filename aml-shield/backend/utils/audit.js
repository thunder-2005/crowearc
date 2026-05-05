const pool = require('../database/db');

/**
 * Log a row to audit_trail. The sar_id column doubles as the entity's
 * natural id (alert_id for alerts, sar_id for SARs, kyc_review.id for KYC).
 *
 *   await logAudit({ entity_type: 'alert', entity_id: alert.alert_id,
 *                    action: 'Investigation started', performed_by: analyst });
 *
 * Pass `client` if you're inside a BEGIN/COMMIT transaction.
 */
async function logAudit({ entity_type, entity_id, action, performed_by, details, client }) {
  if (!entity_type || !entity_id || !action) return; // best-effort; never crash a request
  const q = client || pool;
  await q.query(
    `INSERT INTO audit_trail (entity_type, sar_id, action, performed_by, details)
     VALUES ($1, $2, $3, $4, $5)`,
    [entity_type, String(entity_id), action, performed_by || 'system', details || null]
  );
}

const ENTITY_TYPES = Object.freeze({
  ALERT:      'alert',
  SAR:        'sar',
  KYC_REVIEW: 'kyc_review',
  CASE:       'case'
});

module.exports = { logAudit, ENTITY_TYPES };
