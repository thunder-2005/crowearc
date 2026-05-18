// ═══════════════════════════════════════════════════════════════════════════
// Integration smoke tests for routes/ofac.js — C-04 OFAC sync durability fix.
//
// Each test boots a minimal Express app, mounts the ofac router with mocked
// pg.Pool / ofacSync / utilities, and exercises the two new endpoints with
// each of the four role headers. The goal isn't full SQL coverage — it's
// proving the role guards work and the shapes match the spec.
// ═══════════════════════════════════════════════════════════════════════════

const mockQuery = jest.fn();
jest.mock('../database/db', () => ({
  query: (...args) => mockQuery(...args),
  connect: jest.fn(),
  on: jest.fn()
}));

const mockRunOfacSync = jest.fn();
jest.mock('../jobs/ofacSync', () => ({
  runOfacSync: (...args) => mockRunOfacSync(...args),
  startOfacSyncJob: jest.fn(),
  start: jest.fn()
}));

jest.mock('../utils/ofacScreener', () => ({
  screenName: jest.fn(),
  getScreeningResults: jest.fn()
}));

jest.mock('../utils/ofacDownloader', () => ({
  downloadAndStoreSdnList: jest.fn().mockResolvedValue({
    entries_added: 1, entries_total: 1, list_version: 'v'
  })
}));

jest.mock('../utils/getManagerSetting', () => ({
  getManagerSetting: jest.fn().mockResolvedValue(26)
}));

const mockLogAudit = jest.fn();
jest.mock('../utils/audit', () => ({
  logAudit: (...args) => mockLogAudit(...args)
}));

const express = require('express');
const request = require('supertest');
const ofacRouter = require('./ofac');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/ofac', ofacRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

beforeEach(() => {
  mockQuery.mockReset();
  mockRunOfacSync.mockReset();
  mockLogAudit.mockReset();
});

// ─── Sync-status: success for compliance_manager ──────────────────────────
test('GET /sync-status returns 200 for compliance_manager', async () => {
  mockQuery.mockImplementation((sql) => {
    if (/FROM ofac_sync_status/.test(sql)) {
      return Promise.resolve({ rows: [{
        id: 'run-1',
        completed_at: '2026-05-18T02:14:33Z',
        entries_total: 14203,
        list_version: '2026-05-18',
        hours_since_last_success: 11.4,
        is_stale: false
      }] });
    }
    if (/WHERE status = 'running'/.test(sql)) {
      return Promise.resolve({ rows: [] });
    }
    if (/ORDER BY started_at DESC\s+LIMIT 10/.test(sql)) {
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({ rows: [] });
  });

  const res = await request(buildApp())
    .get('/api/ofac/sync-status')
    .set('x-user-role', 'compliance_manager');

  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('lastSuccessfulSync');
  expect(res.body).toHaveProperty('isStale');
  expect(res.body).toHaveProperty('stalenessThresholdHours', 26);
  expect(res.body).toHaveProperty('recentRuns');
});

// ─── Sync-status: 403 for analyst_l1 ──────────────────────────────────────
test('GET /sync-status returns 403 for analyst_l1', async () => {
  const res = await request(buildApp())
    .get('/api/ofac/sync-status')
    .set('x-user-role', 'analyst_l1');

  expect(res.status).toBe(403);
});

// ─── Sync trigger: 200 for bsa_officer, runs job async ────────────────────
test('POST /sync/trigger returns 200 and fires runOfacSync for bsa_officer', async () => {
  mockRunOfacSync.mockResolvedValue({ status: 'success' });
  const res = await request(buildApp())
    .post('/api/ofac/sync/trigger')
    .set('x-user-role', 'bsa_officer')
    .set('x-user-name', 'James Carter')
    .send({ performed_by: 'James Carter' });

  expect(res.status).toBe(200);
  expect(res.body.status).toBe('triggered');
  expect(mockRunOfacSync).toHaveBeenCalledWith(
    expect.objectContaining({ triggered_by: 'manual' })
  );
  expect(mockLogAudit).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'ofac_sync_manual_trigger',
      entity_type: 'ofac_sync_run'
    })
  );
});

// ─── Sync trigger: 403 for compliance_manager (BSA-only) ──────────────────
test('POST /sync/trigger returns 403 for compliance_manager', async () => {
  const res = await request(buildApp())
    .post('/api/ofac/sync/trigger')
    .set('x-user-role', 'compliance_manager')
    .send({});

  expect(res.status).toBe(403);
  expect(mockRunOfacSync).not.toHaveBeenCalled();
});
