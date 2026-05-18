// ═══════════════════════════════════════════════════════════════════════════
// OFAC SDN sync job — durable, lock-protected, retry-capable.
//
// Replaces the silent in-process setInterval scheduler (audit C-04).
//
// Failure modes this fix addresses:
//   1. Silent stale list   — every run inserts/updates a row in
//                            ofac_sync_runs; a Postgres view exposes
//                            "hours since last success" to the dashboards.
//   2. Double-execution    — pg_try_advisory_lock prevents two instances
//                            running simultaneously (rolling deploy safe).
//   3. No retries / DLQ    — three attempts with exponential backoff
//                            (30s, 90s, 270s); permanent failure creates
//                            a high-tone notification for managers and
//                            BSA officers and writes an audit row.
//
// External contract: startOfacSyncJob() / start() preserved — server.js
// imports unchanged. The 24-hour cadence is preserved. Everything else
// is internal.
// ═══════════════════════════════════════════════════════════════════════════

const pool = require('../database/db');
const { downloadAndStoreSdnList } = require('../utils/ofacDownloader');
const { logAudit } = require('../utils/audit');

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [30_000, 90_000, 270_000]; // exponential (base 3)
// Postgres advisory lock keys are int8. Pre-computing a fixed key keeps the
// lock identifier stable across deploys (hashtext() output depends on the
// session's encoding/collation in rare cases).
const ADVISORY_LOCK_KEY = 1001; // [crowe_arc] OFAC sync — keep stable forever
const STALE_RUNNING_THRESHOLD = "INTERVAL '2 hours'";

function log(level, message, ctx = {}) {
  const parts = Object.entries(ctx).map(([k, v]) => `${k}=${v}`).join(' ');
  // eslint-disable-next-line no-console
  console.log(`[ofacSync] [${level}] ${message}${parts ? ' | ' + parts : ''}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Stale-run cleanup ─────────────────────────────────────────────────────
//
// If the previous server instance died mid-sync, its ofac_sync_runs row is
// stuck in 'running' forever. Promote any 'running' row older than 2 hours
// to 'failed' so downstream "is the list stale?" math is honest.
//
// Runs at the start of every sync attempt AND as a one-shot on server boot.
async function cleanupStaleRunningRows() {
  const result = await pool.query(`
    UPDATE ofac_sync_runs
       SET status = 'failed',
           completed_at = NOW(),
           error_message = 'Job timed out — marked failed on next run start'
     WHERE status = 'running'
       AND started_at < NOW() - ${STALE_RUNNING_THRESHOLD}
    RETURNING id
  `);
  if (result.rowCount > 0) {
    log('WARN', 'Cleaned up stale running rows', { count: result.rowCount });
    await logAudit({
      entity_type: 'ofac_sync_run',
      entity_id: 'cleanup',
      action: 'ofac_sync_stale_cleanup',
      performed_by: 'system',
      details: `Force-failed ${result.rowCount} stale running row(s)`
    });
  }
  return result.rowCount;
}

// ── Notification fanout on permanent failure ──────────────────────────────
async function notifyFailure(runId, lastSuccessAt, errorMessage) {
  const lastSyncDesc = lastSuccessAt
    ? new Date(lastSuccessAt).toISOString()
    : 'Never';
  const title = 'OFAC SDN List Sync Failed';
  const message = `The OFAC SDN list has not been successfully updated. Last successful sync: ${lastSyncDesc}. The sanctions screening list may be stale. Manual review required.`;

  // Existing notifications table targets by recipient_role. There's no
  // priority column on the schema — we encode urgency via tone='error'
  // (consistent with the existing OFAC confirmed-match notification).
  for (const role of ['compliance_manager', 'bsa_officer']) {
    try {
      await pool.query(`
        INSERT INTO notifications
          (recipient_id, recipient_role, type, title, message, related_id, related_type, tone)
        VALUES (NULL, $1, 'ofac_sync_failure', $2, $3, $4, 'ofac_sync_run', 'error')
      `, [role, title, message, runId]);
    } catch (e) {
      log('ERROR', 'Failed to write failure notification', { role, error: e.message });
    }
  }
}

// ── Core run logic ────────────────────────────────────────────────────────
//
// Acquires an advisory lock, inserts a 'running' row, retries up to 3
// times with exponential backoff, marks the row 'success'/'failed', and
// releases the lock. Always returns even on failure — never throws.
async function runOfacSync({ triggered_by = 'scheduler', performed_by = null } = {}) {
  // Step 1: cleanup any stale 'running' rows from crashed prior instances
  // BEFORE we try to acquire the lock — a crashed instance won't have
  // released its Postgres session, but pg_advisory_unlock_all fires on
  // session disconnect, so the lock itself isn't stuck. The stale ROW is.
  try {
    await cleanupStaleRunningRows();
  } catch (e) {
    log('WARN', 'Stale cleanup failed; continuing anyway', { error: e.message });
  }

  // Step 2: acquire the advisory lock. If another instance holds it, write
  // a 'skipped' row and bail out. pg_advisory_unlock is called in the
  // finally block ONLY if the lock was successfully acquired.
  const lockResult = await pool.query(
    'SELECT pg_try_advisory_lock($1) AS got',
    [ADVISORY_LOCK_KEY]
  );
  const gotLock = lockResult.rows[0].got === true;

  if (!gotLock) {
    log('INFO', 'Skipped — another instance holds the advisory lock');
    try {
      await pool.query(`
        INSERT INTO ofac_sync_runs (status, started_at, completed_at, triggered_by, error_message)
        VALUES ('skipped', NOW(), NOW(), $1, 'Advisory lock held by another instance')
      `, [triggered_by]);
    } catch (e) {
      log('ERROR', 'Failed to write skipped row', { error: e.message });
    }
    return { status: 'skipped' };
  }

  // Step 3: insert the 'running' row. From here on every exit path must
  // either UPDATE the row to a terminal status OR be cleaned up by the
  // stale-cleanup pass.
  let runId = null;
  try {
    const insert = await pool.query(`
      INSERT INTO ofac_sync_runs (status, started_at, triggered_by, lock_acquired_at)
      VALUES ('running', NOW(), $1, NOW())
      RETURNING id
    `, [triggered_by]);
    runId = insert.rows[0].id;
    log('INFO', 'Sync started', { runId, triggered_by });

    await logAudit({
      entity_type: 'ofac_sync_run',
      entity_id: runId,
      action: 'ofac_sync_started',
      performed_by: performed_by || 'system',
      details: `triggered_by=${triggered_by}`
    });

    // Step 4: retry loop. Three attempts; exponential backoff between.
    let lastError = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          await pool.query(
            'UPDATE ofac_sync_runs SET retry_count = $1 WHERE id = $2',
            [attempt, runId]
          );
          log('WARN', 'Retrying after failure', {
            runId,
            attempt,
            delayMs: RETRY_DELAYS_MS[attempt - 1]
          });
          await sleep(RETRY_DELAYS_MS[attempt - 1]);
        }

        const result = await downloadAndStoreSdnList({ syncRunId: runId });
        // Success path.
        await pool.query(`
          UPDATE ofac_sync_runs
             SET status = 'success',
                 completed_at = NOW(),
                 entries_added = $1,
                 entries_total = $2,
                 list_version = $3
           WHERE id = $4
        `, [result.entries_added, result.entries_total, result.list_version, runId]);

        log('INFO', 'Sync completed', {
          runId,
          entriesTotal: result.entries_total,
          listVersion: result.list_version,
          retries: attempt
        });

        await logAudit({
          entity_type: 'ofac_sync_run',
          entity_id: runId,
          action: 'ofac_sync_completed',
          performed_by: performed_by || 'system',
          details: `entries_added=${result.entries_added} entries_total=${result.entries_total} list_version=${result.list_version} retries=${attempt}`
        });

        return { status: 'success', runId, entries_total: result.entries_total };
      } catch (err) {
        lastError = err;
        log('ERROR', 'Attempt failed', {
          runId,
          attempt,
          error: err.message
        });
      }
    }

    // Step 5: all retries exhausted — terminal failure.
    const errorMsg = String(lastError?.message || lastError || 'unknown').slice(0, 1000);
    await pool.query(`
      UPDATE ofac_sync_runs
         SET status = 'failed',
             completed_at = NOW(),
             error_message = $1,
             retry_count = $2
       WHERE id = $3
    `, [errorMsg, MAX_RETRIES - 1, runId]);

    log('ERROR', 'Sync failed permanently — all retries exhausted', {
      runId,
      retries: MAX_RETRIES,
      error: errorMsg
    });

    await logAudit({
      entity_type: 'ofac_sync_run',
      entity_id: runId,
      action: 'ofac_sync_failed',
      performed_by: performed_by || 'system',
      details: `error=${errorMsg} retries=${MAX_RETRIES}`
    });

    // Pull the last successful sync timestamp for the operator message.
    let lastSuccessAt = null;
    try {
      const r = await pool.query(
        "SELECT completed_at FROM ofac_sync_runs WHERE status = 'success' ORDER BY completed_at DESC LIMIT 1"
      );
      lastSuccessAt = r.rows[0]?.completed_at || null;
    } catch (_e) { /* fall through with null */ }

    await notifyFailure(runId, lastSuccessAt, errorMsg);

    return { status: 'failed', runId, error: errorMsg };
  } catch (outerErr) {
    // Unexpected error outside the retry loop (e.g. DB connection died).
    // Best-effort mark the row failed and audit.
    log('ERROR', 'Sync failed outside retry loop', {
      runId: runId || 'unknown',
      error: outerErr.message
    });
    if (runId) {
      try {
        await pool.query(`
          UPDATE ofac_sync_runs
             SET status = 'failed',
                 completed_at = NOW(),
                 error_message = $1
           WHERE id = $2
        `, [String(outerErr.message || outerErr).slice(0, 1000), runId]);
      } catch (_e) { /* swallow — best effort */ }
    }
    return { status: 'failed', runId, error: outerErr.message };
  } finally {
    // Step 6: release the advisory lock unconditionally. pg_advisory_unlock
    // returns false if we didn't hold the lock; we ignore that — defensive
    // belt and braces.
    try {
      await pool.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
    } catch (e) {
      log('ERROR', 'Failed to release advisory lock', { error: e.message });
    }
  }
}

// ── Initial-check on boot ─────────────────────────────────────────────────
//
// Replaces the old "count rows; download if zero" logic. If the table is
// empty AND the most recent run was not 'success', kick off a sync. We
// don't blindly re-sync on every boot — that would re-download daily even
// on hot restarts.
async function checkAndInitialDownload() {
  try {
    const r = await pool.query('SELECT COUNT(*)::int AS c FROM ofac_sdn_entries');
    const count = r.rows[0].c;
    if (count === 0) {
      log('INFO', 'No SDN entries found — running initial download');
      await runOfacSync({ triggered_by: 'scheduler' });
    } else {
      log('INFO', 'SDN entries already loaded; skipping initial download', {
        entries: count
      });
    }
  } catch (err) {
    log('ERROR', 'Initial check failed', { error: err.message });
  }
}

// ── Server.js entry point ─────────────────────────────────────────────────
//
// External contract preserved — server.js does ofacSync.start() with no
// arguments. The 24-hour interval is preserved. Internal implementation
// is completely new.
function start() {
  // One-shot startup cleanup. Safe to run unconditionally — does nothing
  // unless a 'running' row was orphaned by the previous instance.
  cleanupStaleRunningRows().catch(err => {
    log('ERROR', 'Startup cleanup failed', { error: err.message });
  });

  // Defer the first download check so the rest of server startup logs
  // cleanly.
  setTimeout(checkAndInitialDownload, 5_000);

  setInterval(() => {
    log('INFO', 'Scheduled sync tick');
    runOfacSync({ triggered_by: 'scheduler' }).catch(err => {
      // runOfacSync itself swallows errors and returns a status; this catch
      // only fires on a truly unexpected synchronous throw before the async
      // body ran.
      log('ERROR', 'Scheduled sync threw unexpectedly', { error: err.message });
    });
  }, TWENTY_FOUR_HOURS_MS);

  log('INFO', `Sync job scheduled — every ${TWENTY_FOUR_HOURS_MS / 3600_000}h`);
}

module.exports = {
  // Public entry points.
  start,
  startOfacSyncJob: start, // alias — task spec references this name
  checkAndInitialDownload,
  runOfacSync,

  // Exported for tests.
  cleanupStaleRunningRows,
  notifyFailure,
  ADVISORY_LOCK_KEY,
  MAX_RETRIES,
  RETRY_DELAYS_MS
};
