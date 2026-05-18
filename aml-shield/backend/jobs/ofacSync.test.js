// ═══════════════════════════════════════════════════════════════════════════
// Unit tests for jobs/ofacSync.js — C-04 OFAC sync durability fix.
//
// All five tests mock pg.Pool and the downloader to avoid external state.
// Each assertion targets a specific failure mode the C-04 fix promises to
// solve:
//   1. Advisory lock acquired → happy path
//   2. Advisory lock NOT acquired → 'skipped' row written, no work done
//   3. First attempt fails, second succeeds → retry_count = 1, single row
//   4. All three retries exhausted → 'failed' row + notification fanout
//   5. Stale 'running' row from a crashed instance is force-failed on start
// ═══════════════════════════════════════════════════════════════════════════

// Mock the DB pool BEFORE requiring the module under test. The module reads
// pool at require-time, so the mock must be in place first.
const mockQuery = jest.fn();
jest.mock('../database/db', () => ({
  query: (...args) => mockQuery(...args),
  connect: jest.fn(),
  on: jest.fn()
}));

const mockDownload = jest.fn();
jest.mock('../utils/ofacDownloader', () => ({
  downloadAndStoreSdnList: (...args) => mockDownload(...args)
}));

const mockLogAudit = jest.fn();
jest.mock('../utils/audit', () => ({
  logAudit: (...args) => mockLogAudit(...args),
  ENTITY_TYPES: {}
}));

const {
  runOfacSync,
  cleanupStaleRunningRows,
  ADVISORY_LOCK_KEY,
  MAX_RETRIES,
  RETRY_DELAYS_MS
} = require('./ofacSync');

// Helper — record every query call and return whatever the mock has been
// scripted to return for the matching SQL fragment.
function setQueryScript(script) {
  mockQuery.mockReset();
  mockQuery.mockImplementation((sql, params) => {
    for (const entry of script) {
      if (entry.match.test(sql)) {
        if (entry.once) {
          entry.match = /__used__/; // consume the entry
        }
        if (typeof entry.result === 'function') {
          return Promise.resolve(entry.result(sql, params));
        }
        return Promise.resolve(entry.result);
      }
    }
    // Default — empty row set.
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

// Speed up RETRY_DELAYS_MS for tests. We monkeypatch the module-level
// constant via the timers API: setTimeout is faked.
beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick'] });
  mockQuery.mockReset();
  mockDownload.mockReset();
  mockLogAudit.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

// ─── Test 1 ───────────────────────────────────────────────────────────────
test('happy path: lock acquired, sync succeeds, row marked success', async () => {
  setQueryScript([
    // stale cleanup — no rows affected
    { match: /UPDATE ofac_sync_runs\s+SET status = 'failed'[\s\S]*timed out/i, result: { rowCount: 0 } },
    // advisory lock acquired
    { match: /pg_try_advisory_lock/i, result: { rows: [{ got: true }] } },
    // insert 'running' row
    { match: /INSERT INTO ofac_sync_runs[\s\S]*'running'/i, result: { rows: [{ id: 'run-uuid-1' }] } },
    // update to 'success' after download
    { match: /UPDATE ofac_sync_runs[\s\S]*'success'/i, result: { rowCount: 1 } },
    // advisory unlock
    { match: /pg_advisory_unlock/i, result: { rows: [{ pg_advisory_unlock: true }] } }
  ]);

  mockDownload.mockResolvedValueOnce({
    entries_added: 3,
    entries_total: 3,
    list_version: '2026-05-18'
  });

  const result = await runOfacSync({ triggered_by: 'scheduler' });

  expect(result.status).toBe('success');
  expect(result.runId).toBe('run-uuid-1');
  expect(mockDownload).toHaveBeenCalledTimes(1);
  // Advisory lock acquired AND released.
  const lockCall = mockQuery.mock.calls.find(c => /pg_try_advisory_lock/.test(c[0]));
  const unlockCall = mockQuery.mock.calls.find(c => /pg_advisory_unlock/.test(c[0]));
  expect(lockCall).toBeTruthy();
  expect(unlockCall).toBeTruthy();
  expect(lockCall[1]).toEqual([ADVISORY_LOCK_KEY]);
});

// ─── Test 2 ───────────────────────────────────────────────────────────────
test('lock not acquired: skipped row written, no download attempted', async () => {
  setQueryScript([
    { match: /UPDATE ofac_sync_runs\s+SET status = 'failed'[\s\S]*timed out/i, result: { rowCount: 0 } },
    // Lock NOT acquired
    { match: /pg_try_advisory_lock/i, result: { rows: [{ got: false }] } },
    // Skipped row insert
    { match: /INSERT INTO ofac_sync_runs[\s\S]*'skipped'/i, result: { rowCount: 1 } }
  ]);

  const result = await runOfacSync({ triggered_by: 'scheduler' });

  expect(result.status).toBe('skipped');
  expect(mockDownload).not.toHaveBeenCalled();
  // pg_advisory_unlock must NOT be called — we never held the lock.
  const unlockCall = mockQuery.mock.calls.find(c => /pg_advisory_unlock/.test(c[0]));
  expect(unlockCall).toBeFalsy();
  // Skipped row WAS written.
  const skippedInsert = mockQuery.mock.calls.find(c =>
    /INSERT INTO ofac_sync_runs/.test(c[0]) && /'skipped'/.test(c[0])
  );
  expect(skippedInsert).toBeTruthy();
});

// ─── Test 3 ───────────────────────────────────────────────────────────────
test('retry: first attempt fails, second succeeds — retry_count tracked, single row', async () => {
  setQueryScript([
    { match: /UPDATE ofac_sync_runs\s+SET status = 'failed'[\s\S]*timed out/i, result: { rowCount: 0 } },
    { match: /pg_try_advisory_lock/i, result: { rows: [{ got: true }] } },
    { match: /INSERT INTO ofac_sync_runs[\s\S]*'running'/i, result: { rows: [{ id: 'run-uuid-3' }] } },
    // retry_count update on second attempt
    { match: /UPDATE ofac_sync_runs SET retry_count/i, result: { rowCount: 1 } },
    // success update
    { match: /UPDATE ofac_sync_runs[\s\S]*'success'/i, result: { rowCount: 1 } },
    { match: /pg_advisory_unlock/i, result: { rows: [{ pg_advisory_unlock: true }] } }
  ]);

  mockDownload
    .mockRejectedValueOnce(new Error('Transient network failure'))
    .mockResolvedValueOnce({
      entries_added: 5,
      entries_total: 5,
      list_version: '2026-05-18'
    });

  // Kick off run; advance the fake timer past the first retry delay.
  // advanceTimersByTimeAsync drains the microtask queue between ticks so
  // the awaited download promise can resolve and the next attempt runs.
  const p = runOfacSync({ triggered_by: 'scheduler' });
  await jest.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0] + 100);
  const result = await p;

  expect(result.status).toBe('success');
  expect(mockDownload).toHaveBeenCalledTimes(2);
  // Only ONE 'running' row was inserted (not one per retry).
  const runningInserts = mockQuery.mock.calls.filter(c =>
    /INSERT INTO ofac_sync_runs/.test(c[0]) && /'running'/.test(c[0])
  );
  expect(runningInserts.length).toBe(1);
  // retry_count = 1 was written.
  const retryUpdate = mockQuery.mock.calls.find(c =>
    /UPDATE ofac_sync_runs SET retry_count/.test(c[0])
  );
  expect(retryUpdate).toBeTruthy();
  expect(retryUpdate[1]).toEqual([1, 'run-uuid-3']);
});

// ─── Test 4 ───────────────────────────────────────────────────────────────
test('all retries exhausted: row marked failed and failure notification written', async () => {
  setQueryScript([
    { match: /UPDATE ofac_sync_runs\s+SET status = 'failed'[\s\S]*timed out/i, result: { rowCount: 0 } },
    { match: /pg_try_advisory_lock/i, result: { rows: [{ got: true }] } },
    { match: /INSERT INTO ofac_sync_runs[\s\S]*'running'/i, result: { rows: [{ id: 'run-uuid-4' }] } },
    { match: /UPDATE ofac_sync_runs SET retry_count/i, result: { rowCount: 1 } },
    // Permanent failure update
    { match: /UPDATE ofac_sync_runs[\s\S]*SET status = 'failed'[\s\S]*completed_at/i, result: { rowCount: 1 } },
    // last successful sync lookup
    { match: /SELECT completed_at FROM ofac_sync_runs WHERE status = 'success'/i, result: { rows: [] } },
    // Notification inserts
    { match: /INSERT INTO notifications/i, result: { rowCount: 1 } },
    { match: /pg_advisory_unlock/i, result: { rows: [{ pg_advisory_unlock: true }] } }
  ]);

  mockDownload.mockRejectedValue(new Error('Persistent OFAC outage'));

  const p = runOfacSync({ triggered_by: 'scheduler' });
  // Drain enough fake time to cover every retry sleep. The retry loop
  // only sleeps BEFORE attempts 1 and 2 (not before attempt 0), so total
  // wait is RETRY_DELAYS_MS[0] + RETRY_DELAYS_MS[1].
  const totalWait = RETRY_DELAYS_MS[0] + RETRY_DELAYS_MS[1] + 1000;
  await jest.advanceTimersByTimeAsync(totalWait);
  const result = await p;

  expect(result.status).toBe('failed');
  expect(mockDownload).toHaveBeenCalledTimes(MAX_RETRIES);
  // Failure notification: at least one row written with type 'ofac_sync_failure'
  const notifInsert = mockQuery.mock.calls.find(c =>
    /INSERT INTO notifications/.test(c[0])
  );
  expect(notifInsert).toBeTruthy();
  // Advisory lock released.
  const unlockCall = mockQuery.mock.calls.find(c => /pg_advisory_unlock/.test(c[0]));
  expect(unlockCall).toBeTruthy();
});

// ─── Test 5 ───────────────────────────────────────────────────────────────
test('stale running cleanup: rows older than 2h are flipped to failed', async () => {
  setQueryScript([
    // cleanup query returns rowCount of 2
    { match: /UPDATE ofac_sync_runs\s+SET status = 'failed'[\s\S]*timed out/i, result: { rowCount: 2 } }
  ]);

  const count = await cleanupStaleRunningRows();

  expect(count).toBe(2);
  // Audit row was written.
  expect(mockLogAudit).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'ofac_sync_stale_cleanup',
      entity_type: 'ofac_sync_run'
    })
  );
});
