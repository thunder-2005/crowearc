const express = require('express');
const pool = require('../database/db');
const { requireManager, requireBsaOfficer, requireBsaOrManager } = require('../middleware/roleGuard');
const { screenName, getScreeningResults } = require('../utils/ofacScreener');
const { downloadAndStoreSdnList } = require('../utils/ofacDownloader');
const { runOfacSync } = require('../jobs/ofacSync');
const { getManagerSetting } = require('../utils/getManagerSetting');
const { logAudit } = require('../utils/audit');

const router = express.Router();

// ─────────────────────────────────────────────── helpers

async function logAuditOfac({ entity_type, entity_id, action, performed_by, details }) {
  try {
    await pool.query(`
      INSERT INTO audit_trail (entity_type, sar_id, action, performed_by, details)
      VALUES ($1, $2, $3, $4, $5)
    `, [entity_type, entity_id, action, performed_by || 'system', details || null]);
  } catch (e) {
    console.warn('[ofac] audit log write failed:', e.message);
  }
}

async function notifyManager({ type, title, message, related_id, related_type, tone }) {
  try {
    await pool.query(`
      INSERT INTO notifications
        (recipient_id, recipient_role, type, title, message, related_id, related_type, tone)
      VALUES (NULL, 'manager', $1, $2, $3, $4, $5, $6)
    `, [type, title, message, related_id || null, related_type || null, tone || 'info']);
  } catch (e) {
    console.warn('[ofac] notification write failed:', e.message);
  }
}

// ─────────────────────────────────────────────── GET /status

router.get('/status', async (_req, res, next) => {
  try {
    const counts = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM ofac_sdn_entries)                                                AS sdn_count,
        (SELECT COUNT(*)::int FROM ofac_screening_results WHERE status = 'pending')                  AS pending_count,
        (SELECT COUNT(*)::int FROM ofac_screening_results WHERE status = 'confirmed')                AS confirmed_count,
        (SELECT COUNT(*)::int FROM ofac_screening_results WHERE status = 'dismissed')                AS dismissed_count,
        (SELECT MAX(last_updated) FROM ofac_sdn_entries)                                             AS last_updated
    `);
    const lastDownload = (await pool.query(
      `SELECT downloaded_at, status, error_message FROM ofac_download_log ORDER BY id DESC LIMIT 1`
    )).rows[0] || null;

    const r = counts.rows[0];
    res.json({
      entry_count: r.sdn_count,
      last_updated: r.last_updated,
      pending_count: r.pending_count,
      confirmed_count: r.confirmed_count,
      dismissed_count: r.dismissed_count,
      last_download: lastDownload
        ? {
            downloaded_at: lastDownload.downloaded_at,
            status: lastDownload.status,
            error_message: lastDownload.error_message
          }
        : null
    });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────── POST /screen/:entityType/:entityId
// Body: { name, performed_by? }
//
// entityId can be URL-encoded for counterparties (per Q2). Returns the
// matches plus a summarized current status. Inserts a manager
// notification if any matches were found.

router.post('/screen/:entityType/:entityId', async (req, res, next) => {
  try {
    const { entityType } = req.params;
    const entityId = decodeURIComponent(req.params.entityId);
    const { name, performed_by } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!['customer', 'counterparty'].includes(entityType)) {
      return res.status(400).json({ error: 'entityType must be "customer" or "counterparty"' });
    }

    const matches = await screenName(name, entityId, entityType);

    await logAuditOfac({
      entity_type: entityType,
      entity_id: entityId,
      action: matches.length === 0
        ? `OFAC screening — no matches above 85% for ${name}`
        : `OFAC screening — ${matches.length} potential match(es) for ${name}`,
      performed_by: performed_by,
      details: matches.length === 0
        ? null
        : matches.slice(0, 5).map(m => `${m.match_score}% · ${m.sdn_name}${m.program ? ' (' + m.program + ')' : ''}`).join('; ')
    });

    if (matches.length > 0) {
      const top = matches[0];
      await notifyManager({
        type: 'ofac_match',
        title: 'Potential OFAC Match',
        message: `${name} returned a ${top.match_score}% match against ${top.sdn_name}${top.program ? ' — ' + top.program : ''}`,
        related_id: entityId,
        related_type: entityType,
        tone: 'warning'
      });
    }

    res.json({
      entity_type: entityType,
      entity_id: entityId,
      entity_name: name,
      status: matches.length === 0 ? 'clear' : 'pending',
      match_count: matches.length,
      matches
    });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────── GET /results/:entityType/:entityId

router.get('/results/:entityType/:entityId', async (req, res, next) => {
  try {
    const entityType = req.params.entityType;
    const entityId = decodeURIComponent(req.params.entityId);
    const rows = await getScreeningResults(entityId, entityType);

    // Derive a single overall status:
    //  confirmed > pending > dismissed > clear > not_screened
    let overall = 'not_screened';
    if (rows.some(r => r.status === 'confirmed')) overall = 'confirmed';
    else if (rows.some(r => r.status === 'pending')) overall = 'pending';
    else if (rows.length > 0 && rows.every(r => r.status === 'dismissed' || r.status === 'clear')) {
      overall = rows.some(r => r.status === 'clear') ? 'clear' : 'dismissed';
    }

    const lastScreened = rows.length > 0 ? rows[0].screened_at : null;
    const listVersion = (await pool.query(
      `SELECT downloaded_at FROM ofac_download_log
        WHERE status = 'success'
        ORDER BY downloaded_at DESC NULLS LAST
        LIMIT 1`
    )).rows[0] || null;

    res.json({
      entity_type: entityType,
      entity_id: entityId,
      status: overall,
      last_screened: lastScreened,
      list_version: listVersion ? listVersion.downloaded_at : null,
      results: rows
    });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────── PATCH /results/:resultId
// Body: { status: 'confirmed' | 'dismissed', review_notes, performed_by }
//
// On 'confirmed' we set customers.sanctions_match = 1 (only when the
// reviewed result belongs to a customer) and notify the manager.

router.patch('/results/:resultId', async (req, res, next) => {
  try {
    const { resultId } = req.params;
    const { status, review_notes, performed_by } = req.body || {};
    if (!['confirmed', 'dismissed'].includes(status)) {
      return res.status(400).json({ error: 'status must be "confirmed" or "dismissed"' });
    }
    if (!review_notes || !String(review_notes).trim()) {
      return res.status(400).json({ error: 'review_notes is required' });
    }

    const existing = (await pool.query(
      'SELECT * FROM ofac_screening_results WHERE id = $1', [resultId]
    )).rows[0];
    if (!existing) return res.status(404).json({ error: 'Screening result not found' });

    const reviewer = (performed_by && String(performed_by).trim()) || 'system';

    await pool.query(`
      UPDATE ofac_screening_results
         SET status = $1, reviewed_by = $2, reviewed_at = NOW(), review_notes = $3
       WHERE id = $4
    `, [status, reviewer, review_notes, resultId]);

    if (status === 'confirmed' && existing.entity_type === 'customer') {
      await pool.query(
        'UPDATE customers SET sanctions_match = 1 WHERE customer_id = $1',
        [existing.entity_id]
      );
    }

    const action = status === 'confirmed'
      ? `OFAC match confirmed for ${existing.entity_name} — SDN: ${existing.sdn_name}${existing.program ? ' — Program: ' + existing.program : ''}`
      : `OFAC match dismissed for ${existing.entity_name} — SDN: ${existing.sdn_name} — Reason: ${review_notes}`;
    await logAuditOfac({
      entity_type: existing.entity_type,
      entity_id: existing.entity_id,
      action,
      performed_by: reviewer,
      details: review_notes
    });

    if (status === 'confirmed') {
      await notifyManager({
        type: 'ofac_confirmed',
        title: '🚨 OFAC Match Confirmed',
        message: `${existing.entity_name} confirmed as sanctions match against ${existing.sdn_name} — reviewed by ${reviewer}`,
        related_id: existing.entity_id,
        related_type: existing.entity_type,
        tone: 'error'
      });
    }

    const updated = (await pool.query(
      'SELECT * FROM ofac_screening_results WHERE id = $1', [resultId]
    )).rows[0];
    res.json(updated);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────── POST /sync (manager only)
//
// Legacy direct-call sync. Kept for the existing Force Sync button on the
// Manager Dashboard banner that still calls this. The new path is
// /sync/trigger which runs through the durable job runner; this one
// downloads in-band and returns the count synchronously. New code should
// prefer /sync/trigger.

router.post('/sync', requireManager, async (_req, res, next) => {
  try {
    const result = await downloadAndStoreSdnList();
    res.json({ status: 'success', entry_count: result.entries_total });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────── GET /sync-status
//
// Manager + BSA Officer dashboards consume this. Returns the most recent
// successful sync, any currently-running run, and the last 10 runs for the
// timeline panel. stalenessThresholdHours is read from manager_settings so
// the threshold is tunable without a code deploy.

router.get('/sync-status', requireBsaOrManager, async (_req, res, next) => {
  try {
    const stalenessThresholdHours = Number(
      await getManagerSetting('ofac.staleness_threshold_hours', 26)
    ) || 26;

    // Last successful sync — pull straight from the view so the staleness
    // math stays in one place.
    const lastSuccess = (await pool.query(
      'SELECT id, completed_at, entries_total, list_version, hours_since_last_success, is_stale FROM ofac_sync_status'
    )).rows[0] || null;

    // Any currently-running sync.
    const running = (await pool.query(`
      SELECT id, started_at, retry_count
        FROM ofac_sync_runs
       WHERE status = 'running'
       ORDER BY started_at DESC
       LIMIT 1
    `)).rows[0] || null;

    // Recent runs — last 10 by started_at desc.
    const recent = (await pool.query(`
      SELECT id, started_at, completed_at, status,
             entries_added, entries_total, list_version,
             error_message, retry_count, triggered_by
        FROM ofac_sync_runs
       ORDER BY started_at DESC
       LIMIT 10
    `)).rows;

    res.json({
      lastSuccessfulSync: lastSuccess
        ? {
            id: lastSuccess.id,
            completedAt: lastSuccess.completed_at,
            entriesTotal: lastSuccess.entries_total,
            listVersion: lastSuccess.list_version,
            hoursSinceSuccess: lastSuccess.hours_since_last_success != null
              ? Math.round(Number(lastSuccess.hours_since_last_success) * 10) / 10
              : null
          }
        : null,
      isStale: lastSuccess
        ? Number(lastSuccess.hours_since_last_success) > stalenessThresholdHours
        : true,
      stalenessThresholdHours,
      currentRunning: running
        ? {
            id: running.id,
            startedAt: running.started_at,
            retryCount: Number(running.retry_count) || 0
          }
        : null,
      recentRuns: recent.map(r => ({
        id: r.id,
        startedAt: r.started_at,
        completedAt: r.completed_at,
        status: r.status,
        entriesAdded: r.entries_added,
        entriesTotal: r.entries_total,
        listVersion: r.list_version,
        errorMessage: r.error_message,
        retryCount: Number(r.retry_count) || 0,
        triggeredBy: r.triggered_by
      }))
    });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────── POST /sync/trigger
//
// Manual sync trigger — BSA Officer only. Runs the durable job asynchronously
// and returns immediately. Caller polls /sync-status for progress.
//
// TODO(B-2): Once session auth lands, derive performed_by from req.user
// instead of req.body. Today the frontend stamps x-user-name and the body
// echoes the same — both are spoofable.

router.post('/sync/trigger', requireBsaOfficer, async (req, res, next) => {
  try {
    const performedBy = (req.headers['x-user-name'] || req.body?.performed_by || 'BSA Officer').toString();

    // Fire-and-forget — don't await. The job runs in the background, writes
    // its own audit + run-row, and the dashboard polls for completion.
    runOfacSync({ triggered_by: 'manual', performed_by: performedBy })
      .catch(err => {
        // runOfacSync swallows its own errors; this only fires on truly
        // unexpected synchronous throws.
        // eslint-disable-next-line no-console
        console.error('[ofac] manual trigger threw unexpectedly:', err.message);
      });

    await logAudit({
      entity_type: 'ofac_sync_run',
      entity_id: 'manual_trigger',
      action: 'ofac_sync_manual_trigger',
      performed_by: performedBy,
      details: 'Manual OFAC sync triggered from BSA Officer dashboard'
    });

    res.json({
      status: 'triggered',
      message: 'OFAC sync initiated. Check sync status for progress.'
    });
  } catch (err) { next(err); }
});

module.exports = router;
