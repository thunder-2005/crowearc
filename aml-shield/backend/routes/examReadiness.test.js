// ═══════════════════════════════════════════════════════════════════════════
// Integration tests for routes/examReadiness.js — C-11.
//
// Boots a minimal Express app with the exam-readiness router mounted and
// every external dependency mocked. Goal: prove the role guards work and
// the response shapes match the spec. Full SQL coverage isn't attempted.
// ═══════════════════════════════════════════════════════════════════════════

const mockQuery = jest.fn();
jest.mock('../database/db', () => ({
  query: (...args) => mockQuery(...args),
  connect: jest.fn(),
  on: jest.fn()
}));

const mockLogAudit = jest.fn();
jest.mock('../utils/audit', () => ({ logAudit: (...args) => mockLogAudit(...args) }));

jest.mock('../utils/getManagerSetting', () => ({
  getManagerSetting: jest.fn(async (_k, def) => def)
}));

// The route schedules an async run via Promise resolution; we leave it
// unawaited and only assert the synchronous response shape.
jest.mock('../utils/examChecks', () => ({
  CHECK_REGISTRY: { SAR_TIMELINESS: async () => ({}) },
  computeRunSummary: () => ({ overallScore: 0, overallStatus: 'pass', counts: { run: 0, passed: 0, concern: 0, failed: 0, skipped: 0 } })
}));

const express = require('express');
const request = require('supertest');
const router = require('./examReadiness');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/exam-readiness', router);
  app.use((err, _req, res, _next) => { res.status(err.status || 500).json({ error: err.message }); });
  return app;
}

beforeEach(() => {
  mockQuery.mockReset();
  mockLogAudit.mockReset();
});

// ─── 1. POST /run — 200 for bsa_officer ─────────────────────────────────
test('POST /run — bsa_officer gets 200 with runId + status:running', async () => {
  mockQuery.mockImplementation(async (sql) => {
    if (/INSERT INTO exam_readiness_runs/i.test(sql)) {
      return { rows: [{ id: 'run-uuid-1', started_at: new Date().toISOString() }] };
    }
    return { rows: [] };
  });
  const res = await request(buildApp())
    .post('/api/exam-readiness/run')
    .set('x-user-role', 'bsa_officer')
    .set('x-user-name', 'James Carter')
    .set('x-user-id', '7')
    .send({ checksEnabled: ['SAR_TIMELINESS'] });
  expect(res.status).toBe(200);
  expect(res.body.runId).toBe('run-uuid-1');
  expect(res.body.status).toBe('running');
});

// ─── 2. POST /run — 403 for compliance_manager ──────────────────────────
test('POST /run — compliance_manager gets 403', async () => {
  const res = await request(buildApp())
    .post('/api/exam-readiness/run')
    .set('x-user-role', 'compliance_manager')
    .send({});
  expect(res.status).toBe(403);
});

// ─── 3. GET /run/:id — running shape ────────────────────────────────────
test('GET /run/:id — returns running shape while in progress', async () => {
  mockQuery.mockImplementation(async (sql) => {
    if (/FROM exam_readiness_runs r/i.test(sql) && /LEFT JOIN user_profiles/i.test(sql)) {
      return { rows: [{
        id: 'run-2',
        status: 'running',
        started_at: new Date().toISOString(),
        config: { checksEnabled: ['SAR_TIMELINESS', 'CDD_COMPLETENESS'] },
        run_by_name: 'James Carter'
      }] };
    }
    if (/COUNT\(\*\)::int AS c FROM exam_readiness_findings/i.test(sql)) {
      return { rows: [{ c: 1 }] };
    }
    return { rows: [] };
  });
  const res = await request(buildApp())
    .get('/api/exam-readiness/run/run-2')
    .set('x-user-role', 'bsa_officer');
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('running');
  expect(res.body.checksCompleted).toBe(1);
  expect(res.body.checksTotal).toBe(2);
});

// ─── 4. GET /runs — paginated list ──────────────────────────────────────
test('GET /runs — returns paginated list of past runs', async () => {
  mockQuery.mockImplementation(async (sql) => {
    if (/FROM exam_readiness_runs r/i.test(sql) && /ORDER BY r\.started_at DESC/i.test(sql)) {
      return { rows: [
        {
          id: 'r1', started_at: '2025-05-01T00:00:00Z', completed_at: '2025-05-01T00:01:00Z',
          status: 'completed', overall_score: 88, overall_status: 'pass',
          checks_run: 7, checks_passed: 7, checks_concern: 0, checks_failed: 0,
          config: { targetExamDate: '2025-09-15' }, run_by_name: 'James Carter'
        }
      ] };
    }
    return { rows: [] };
  });
  const res = await request(buildApp())
    .get('/api/exam-readiness/runs?limit=10&offset=0')
    .set('x-user-role', 'bsa_officer');
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body.runs)).toBe(true);
  expect(res.body.runs[0].targetExamDate).toBe('2025-09-15');
});

// ─── 5. POST /mras — creates a record ───────────────────────────────────
test('POST /mras — creates and returns the inserted record', async () => {
  mockQuery.mockImplementation(async (sql) => {
    if (/INSERT INTO exam_mra_items/i.test(sql)) {
      return { rows: [{
        id: 'mra-1',
        exam_date: '2025-05-01',
        examiner_agency: 'OCC',
        category: 'SAR_FILING',
        title: 'Late SARs',
        description: 'Several SARs filed late in Q4 2024.',
        severity: 'mra',
        status: 'open'
      }] };
    }
    return { rows: [] };
  });
  const res = await request(buildApp())
    .post('/api/exam-readiness/mras')
    .set('x-user-role', 'bsa_officer')
    .send({
      examDate: '2025-05-01',
      examinerAgency: 'OCC',
      category: 'SAR_FILING',
      title: 'Late SARs',
      description: 'Several SARs filed late in Q4 2024.',
      severity: 'mra'
    });
  expect(res.status).toBe(201);
  expect(res.body.id).toBe('mra-1');
});

// ─── 6. PATCH /mras/:id — verified_closed sets verified_by + verified_at ─
test('PATCH /mras/:id — verified_closed updates verified_by + verified_at', async () => {
  let captured = null;
  mockQuery.mockImplementation(async (sql, params) => {
    if (/UPDATE exam_mra_items SET/i.test(sql)) {
      captured = { sql, params };
      return { rowCount: 1, rows: [{ id: 'mra-1', status: 'verified_closed' }] };
    }
    return { rows: [] };
  });
  const res = await request(buildApp())
    .patch('/api/exam-readiness/mras/mra-1')
    .set('x-user-role', 'bsa_officer')
    .set('x-user-id', '7')
    .send({ status: 'verified_closed', remediationNotes: 'Reviewed and signed off' });
  expect(res.status).toBe(200);
  expect(captured.sql).toMatch(/verified_by/);
  expect(captured.sql).toMatch(/verified_at = NOW\(\)/);
  expect(mockLogAudit).toHaveBeenCalledWith(
    expect.objectContaining({ action: 'exam_mra_verified_closed' })
  );
});
